# ADR 0008 Entornos, configuracion y secretos

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: OPS-03, OPS-07, OPS-09, OPS-10, OPS-12, OPS-19, OPS-20, OPS-23, ADM-08 y ADM-18

## Contexto

Quantum debe ejecutar la misma release en desarrollo, pruebas, staging y produccion, pero con identidades, URLs, recursos y credenciales diferentes. Ademas, cada perfil de cliente conserva configuracion y secretos propios sin crear una variante del codigo ni de la imagen.

Las variables de entorno de Node.js llegan como texto, los valores publicos de Next.js pueden quedar embebidos durante el build y los secretos expuestos como variables o argumentos pueden filtrarse en procesos y logs. La estrategia debe fallar antes de servir trafico cuando falte configuracion, limitar el alcance de cada credencial y permitir rotacion sin almacenar valores secretos en Git o en la base administrativa.

## Decision

Quantum usa artefactos inmutables promovidos entre entornos. `packages/config` es la unica frontera que lee, convierte y valida configuracion de proceso mediante schemas Zod especificos por aplicacion.

La configuracion tecnica no secreta entra por variables `QCRM_*`; los secretos de staging y produccion entran como archivos montados explicitamente mediante Docker Compose Secrets y referencias `*_FILE`. La configuracion comercial global y por perfil permanece versionada en la plataforma y no se mezcla con secretos ni con configuracion de arranque.

Inicialmente los archivos secretos viven fuera del repositorio en el VPS, con permisos restrictivos y gestion exclusiva del ejecutor. Un gestor externo se adopta cuando la escala o el cumplimiento justifiquen su carga operativa.

## Entornos

| Entorno | Proposito | Datos y efectos externos |
|---|---|---|
| `local` | Desarrollo en una maquina | Datos sinteticos y proveedores simulados o sandbox |
| `test` | Suites desechables locales o de CI | Datos generados, recursos efimeros y sin efectos comerciales |
| `preview` | Revision opcional de un cambio desplegable | Aislado por cambio, datos sinteticos y secretos de alcance minimo |
| `staging` | Validar una release candidata | Infraestructura persistente separada, proveedores sandbox y ningun dato copiado de produccion sin anonimizar |
| `production` | Operacion real | Datos y proveedores reales bajo controles operativos |

Reglas:

- `QCRM_ENV` solo admite esos cinco valores.
- `CI=true` describe el ejecutor, no selecciona credenciales ni convierte un entorno en staging o produccion.
- `NODE_ENV` controla comportamiento de las librerias: `development` en local, `test` en test y `production` en preview, staging y produccion.
- `NODE_ENV` nunca se usa para descubrir paths de secretos, perfiles o bases.
- Preview es opcional y expira automaticamente; no recibe secretos ni datos de produccion.
- Staging y produccion no comparten bases, roles, realms, buckets, Redis, hosts ni secretos.
- Un respaldo de produccion solo entra a otro entorno mediante un procedimiento autorizado de restauracion y anonimizacion.
- El entorno de destino se registra explicitamente en cada operacion; no se infiere de rama, hostname o nombre de archivo.

## Artefactos y promocion

- El mismo digest de imagen se promueve desde staging a produccion.
- No se construyen imagenes por cliente ni se copian archivos locales dentro de un contenedor desplegado.
- El build no recibe credenciales de runtime.
- Un secreto necesario solo para descargar dependencias durante el build usa un secreto efimero del builder y no queda en capas ni metadatos.
- La release declara version de codigo, contratos, migraciones y schema de configuracion compatible.
- Cambiar solo configuracion genera una revision auditable, no una nueva variante de codigo.

## Modelo de configuracion de proceso

Cada aplicacion tiene un schema propio en `packages/config` y sigue esta secuencia:

```text
process.env y referencias *_FILE
  -> seleccionar claves permitidas
  -> leer archivos secretos autorizados
  -> convertir tipos explicitamente
  -> validar invariantes y combinaciones
  -> producir objeto tipado e inmutable
  -> iniciar dependencias
  -> declarar readiness
```

Reglas obligatorias:

- Ningun paquete fuera de `packages/config` lee `process.env` directamente.
- Cada valor se convierte de texto a booleano, numero, URL, duracion, enum o lista antes de usarse.
- Los booleanos aceptan solo representaciones documentadas; una cadena no vacia no significa automaticamente `true`.
- Los nombres propios usan el prefijo `QCRM_`; las variables de runtime y librerias externas se permiten mediante listas explicitas.
- Una clave `QCRM_*` desconocida falla para detectar errores tipograficos y configuracion obsoleta.
- En staging y produccion, una clave requerida no tiene default silencioso.
- Los defaults seguros se limitan a local y test o a constantes invariantes de la release.
- Se rechazan valores vacios, placeholders como `CHANGE_ME`, URLs inseguras donde se exige HTTPS y combinaciones incompatibles.
- El resultado validado se trata como inmutable y se inyecta por dependencia; no se consulta el entorno durante cada operacion.
- Un cambio de schema de configuracion declara compatibilidad y, si afecta datos versionados, su migracion.

## Precedencia y separacion de responsabilidades

La configuracion tecnica de proceso y la configuracion comercial son espacios distintos.

La configuracion tecnica usa:

1. Constantes seguras de la release.
2. Variables no secretas permitidas para el entorno.
3. Valores secretos leidos desde referencias `*_FILE`.

Un valor secreto no puede definirse simultaneamente en texto y archivo. Si existen ambas formas, el proceso falla en lugar de elegir silenciosamente.

La configuracion comercial efectiva usa:

1. Definiciones predeterminadas de la release.
2. Revision global de Quantum.
3. Excepciones versionadas del perfil.
4. Restricciones de seguridad y plataforma que no pueden relajarse por una excepcion.

Pipelines, campos, plantillas, automatizaciones y feature flags comerciales viven en datos versionados, no en variables del contenedor. Contraseñas, tokens y claves viven en el mecanismo de secretos, no en configuracion comercial.

## Configuracion publica del frontend

- Todo valor entregado al navegador se considera publico.
- `NEXT_PUBLIC_*` se limita a constantes publicas invariantes de la release.
- Origenes, flags y valores publicos especificos del entorno se resuelven en runtime mediante same-origin o un endpoint BFF con allowlist de campos.
- El endpoint publico nunca refleja `process.env`, paths `*_FILE`, nombres internos, connection strings ni referencias de secretos.
- `crm-web` y `admin-web` reciben contratos publicos separados.
- Cambiar el entorno o perfil no requiere reconstruir el bundle del navegador.

## Almacenamiento inicial de secretos

En staging y produccion, el host conserva los archivos fuera del checkout, con una estructura equivalente a:

```text
/opt/quantum/secrets/
  staging/
    platform/
    tenants/<tenant_uuid>/
  production/
    platform/
    tenants/<tenant_uuid>/
```

- Los segmentos proceden de IDs registrados y validados, no de paths recibidos libremente.
- Los directorios son propiedad de la cuenta operativa autorizada y usan permisos minimos, normalmente `0700`.
- Cada archivo usa permisos minimos, normalmente `0600`, y se reemplaza de forma atomica.
- El deploy-executor gestiona el material; las aplicaciones reciben solo los archivos que necesitan.
- Compose declara cada secreto y lo monta de solo lectura bajo `/run/secrets/<nombre>` para el servicio autorizado.
- No se monta el directorio completo de secretos en un contenedor.
- Un CRM no recibe secretos de plataforma ni de otro perfil.
- La base administrativa almacena referencia, tipo, propietario, version y fechas; nunca el valor.
- Los archivos del host y sus respaldos requieren proteccion del disco, acceso SSH restringido y cifrado externo. El bind mount de Compose no cifra el secreto en reposo por si mismo.

En local y test se usan credenciales sinteticas y desechables. Pueden vivir en archivos ignorados bajo una ruta local documentada; nunca se copian secretos de staging o produccion al equipo del desarrollador.

## Consumo de secretos

- Cada referencia usa una variable con sufijo `*_FILE` cuyo valor es un path fijo permitido.
- El cargador limita tamano, tipo y path, sigue una lista de secretos esperados y rechaza symlinks o ubicaciones fuera de los mounts autorizados.
- El contenido se lee una vez durante bootstrap y se conserva solo el tiempo necesario.
- Los errores mencionan el nombre logico faltante, nunca el valor ni el contenido del archivo.
- Los secretos no aparecen en argumentos de procesos, URLs, nombres de archivo, metricas, trazas, respuestas o health checks.
- Los objetos de configuracion marcan campos sensibles para impedir serializacion o inspeccion accidental.
- La aplicacion no devuelve el valor a la plataforma despues de consumirlo.

## Ciclo de vida de secretos

Cada secreto tiene metadatos sin valor:

- Identificador y tipo.
- Entorno y perfil o componente propietario.
- Servicios consumidores.
- Fecha de creacion, ultima rotacion y expiracion cuando aplique.
- Responsable y procedimiento de rotacion y revocacion.
- Referencia activa y, durante una rotacion compatible, referencia siguiente.

La rotacion sigue un procedimiento probado:

1. Crear material nuevo con aleatoriedad criptografica o en el proveedor.
2. Registrar una nueva version sin exponer el valor.
3. Distribuirla solo a consumidores autorizados.
4. Recargar o reiniciar de forma controlada y verificar conectividad.
5. Revocar la version anterior despues de la ventana necesaria.
6. Auditar el resultado y eliminar copias temporales.

Cuando el proveedor admita dos credenciales activas, se usa una ventana `current`/`next`. Si no la admite, la operacion declara la pausa o riesgo esperado. Una sospecha de exposicion inicia revocacion y rotacion inmediata; borrar una cadena de un archivo no invalida la credencial.

## CI y GitHub

- Los pull requests sin confianza y los forks no reciben secretos.
- Las pruebas normales usan credenciales sinteticas y servicios desechables.
- Los despliegues usan entornos de GitHub separados y protecciones acordes con staging y produccion.
- Se prefieren credenciales temporales mediante OIDC sobre tokens estaticos cuando el proveedor lo soporte.
- Un job recibe solo el secreto necesario para su accion y entorno.
- Produccion requiere autorizacion y no comparte secretos con jobs de build o validacion.
- Los workflows fijan permisos minimos y no imprimen contextos completos ni cuerpos que puedan contener secretos.
- El registro de contenedores entrega lectura al VPS y publicacion solo al workflow autorizado.

La seleccion final de jobs, actions y protecciones pertenece a ADR-0009; estas restricciones no pueden relajarse alli.

## Deteccion y respuesta

- `.gitignore` excluye `.env`, variantes locales, claves, certificados privados, exports y directorios de secretos.
- `.env.example` contiene nombres, descripcion y ejemplos no sensibles; nunca valores que puedan funcionar.
- `pnpm config:check` valida schemas, ejemplos, claves desconocidas y compatibilidad.
- `pnpm secrets:scan` inspecciona contenido versionado y cambios antes de integrar; ADR-0009 fija la herramienta.
- La redaccion se prueba con valores canario para demostrar que logs, trazas y errores no los contienen.
- Un secreto detectado en Git, log o artefacto se considera comprometido: primero se revoca o rota y despues se sanea la copia afectada.
- No se reescribe historia compartida automaticamente; cualquier limpieza historica se coordina sin sustituir la revocacion.
- El incidente registra alcance, consumidores, momento de exposicion, rotacion y validacion posterior, nunca el valor.

## Observabilidad sin exposicion

Readiness puede informar:

- Aplicacion y version de schema de configuracion.
- Revision no secreta y fingerprint seguro.
- Presencia y version de referencias requeridas.
- Conectividad esencial como estado agregado.

No informa valores, paths internos, nombres de usuarios, hosts privados, connection strings ni contenido de respuestas de proveedores. El fingerprint excluye valores secretos y no permite ataques por diccionario sobre ellos.

## Adopcion futura de un gestor externo

No se opera Vault, OpenBao u otro gestor dedicado durante el inicio en un solo VPS. Se revisa esta decision cuando ocurra alguno de estos disparadores:

- Mas de un VPS o region.
- Varios operadores necesitan acceso diferenciado.
- Rotacion frecuente o credenciales dinamicas.
- Auditoria de lectura de secretos exigida.
- Requisitos regulatorios o de custodia de claves.
- El numero de perfiles vuelve insegura o costosa la gestion de archivos.

El contrato `*_FILE` y las referencias logicas permiten cambiar el proveedor sin modificar dominio ni contratos comerciales.

## Alternativas consideradas

### Variables de entorno para todo

Se rechaza porque los secretos pueden aparecer en dumps, herramientas de inspeccion, logs o procesos hijos y porque todas las entradas llegan como texto. Se conservan variables para configuracion no secreta y referencias a archivos.

### Un solo archivo `.env` por servidor

Se rechaza porque mezcla plataforma, perfiles y servicios, amplifica el impacto de lectura y dificulta rotacion y minimo privilegio.

### Guardar secretos en la base administrativa

Se rechaza porque una consulta, exportacion o compromiso del panel revelaria credenciales de todos los perfiles. La base guarda referencias y metadatos.

### Secretos cifrados dentro del repositorio de aplicacion

Se rechaza inicialmente porque acopla acceso a Git con custodia de claves y acumula secretos de clientes en el historial. Puede reevaluarse en un repositorio operativo separado con claves por entorno.

### Gestor externo desde el primer VPS

Se difiere porque agrega disponibilidad, respaldo, desbloqueo y operacion de otro sistema critico antes de tener escala. Los archivos restringidos mantienen una ruta de migracion explicita.

### Builds por entorno o cliente

Se rechaza porque impide demostrar que staging y produccion ejecutan el mismo artefacto y genera variantes imposibles de actualizar uniformemente.

### Confiar en defaults para mantener el servicio arriba

Se rechaza en staging y produccion porque una aplicacion disponible con credenciales, URLs o permisos equivocados es mas peligrosa que un fallo de readiness visible.

## Consecuencias positivas

- La misma imagen puede promoverse y comprobarse entre entornos.
- Los errores de configuracion aparecen antes de servir trafico.
- Cada servicio y perfil recibe solo sus secretos.
- La configuracion comercial sobrevive releases sin divergir el codigo.
- La rotacion y la respuesta a exposiciones tienen un procedimiento rastreable.
- El frontend no requiere compilarse de nuevo por cada host o cliente.

## Costos y riesgos

- El ejecutor se convierte en custodio sensible de archivos y requiere endurecimiento y auditoria.
- Los secretos siguen existiendo en el disco del VPS; Compose limita montaje, pero no aporta cifrado en reposo.
- La validacion estricta obliga a mantener schemas, ejemplos y migraciones de configuracion.
- La rotacion de proveedores que solo admiten una clave puede requerir una pausa coordinada.
- Configuracion publica runtime agrega un endpoint y contrato que deben mantenerse.
- Un solo VPS conserva un punto comun de compromiso aunque las credenciales esten separadas.

## Validacion

La decision se considera aplicada cuando:

- Una misma imagen por digest inicia correctamente en staging y produccion con configuracion separada.
- Cada aplicacion obtiene un objeto tipado sin leer `process.env` fuera de `packages/config`.
- Una clave requerida ausente, desconocida, vacia o con tipo invalido impide readiness.
- `config:check` detecta diferencias entre schema y `.env.example`.
- Una imagen y sus capas no contienen secretos ni valores de build sensibles.
- Los contenedores reciben solo sus archivos bajo `/run/secrets` y no pueden leer los de otro perfil.
- El navegador recibe solo la allowlist de configuracion publica.
- Dos perfiles usan credenciales, bases, realms, archivos y colas distintos.
- Rotar una credencial conserva o declara explicitamente la continuidad y revoca la anterior.
- Un valor canario no aparece en logs, errores, trazas, reportes o respuestas.
- `secrets:scan` bloquea un secreto de prueba antes de integrar.
- Un job de pull request sin confianza no puede obtener secretos de staging o produccion.
- El inventario muestra propietario, consumidores y fechas sin revelar valores.

## Referencias

- [Node.js: variables de entorno](https://nodejs.org/api/environment_variables.html)
- [Docker: secretos en Compose](https://docs.docker.com/compose/how-tos/use-secrets/)
- [Docker: buenas practicas de variables en Compose](https://docs.docker.com/compose/how-tos/environment-variables/best-practices/)
- [GitHub Actions: secretos](https://docs.github.com/en/actions/reference/security/secrets)
- [GitHub Actions: deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
- [OWASP: Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

Se revisa esta decision al adoptar un gestor externo, agregar otro proveedor de despliegue, operar en varios hosts o necesitar credenciales dinamicas y auditoria centralizada de lectura.
