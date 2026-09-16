# ADR 0003 Aislamiento multi-tenant por perfil

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-02, ADM-03, ADM-04, OPS-01, OPS-04, OPS-14, OPS-19, OPS-21, OPS-23 y OPS-24

## Contexto

Quantum administra varias empresas desde una plataforma central, mientras cada empresa opera un CRM con usuarios, datos, archivos, integraciones y automatizaciones propios. Inicialmente varios perfiles pueden compartir un VPS y componentes de plataforma, pero una equivocacion de contexto no debe permitir acceso entre clientes.

El aislamiento debe cubrir identidad, procesos, red, base de datos, archivos, cache, colas, secretos, observabilidad, respaldos y operaciones. Tambien debe permitir mover un perfil a otro servidor sin cambiar el codigo del producto.

## Decision

Se adopta un modelo **silo por perfil**: cada cliente tiene entorno logico, base PostgreSQL, rol, identidad, configuracion, secretos y espacio de archivos separados. Los perfiles pueden compartir infraestructura fisica inicialmente, pero no comparten credenciales de aplicacion ni datos comerciales.

La plataforma central conserva solo el inventario y estado operativo necesario para administrar perfiles. No consulta ni modifica directamente las tablas comerciales de los clientes.

## Identidad estable del perfil

- Cada perfil recibe un `tenant_id` UUID inmutable generado por la plataforma.
- El slug, nombre comercial, hostname, servidor y dominio son atributos modificables; no sustituyen al identificador.
- El registro central relaciona el `tenant_id` con sus recursos, release, configuracion y estado observado.
- Los identificadores de recursos externos conservan el `tenant_id` o una referencia inequívoca al perfil propietario.
- No se reutiliza un `tenant_id` eliminado ni un slug mientras pueda causar colisiones con datos, callbacks o respaldos conservados.

## Limite de ejecucion

Cada perfil dispone de:

- Procesos web, API y workers propios.
- Proyecto Compose, red y nombres de recursos propios.
- Configuracion y secretos propios.
- Limites de CPU, memoria, procesos y concurrencia cuando el host lo permita.
- Hostname explicito y rutas de proxy autorizadas.

Todos los perfiles usan las mismas imagenes inmutables por digest. No se crean ramas, copias de codigo ni imagenes compiladas manualmente para un cliente.

Compartir kernel o VPS no equivale a aislamiento fuerte del host. Un perfil con requisitos regulatorios o de capacidad superiores puede trasladarse a otro VPS conservando el mismo modelo.

## Base de datos

- Cada cliente usa una base PostgreSQL independiente.
- El runtime usa un rol exclusivo con acceso solo a esa base y sin privilegios de superusuario.
- Las migraciones usan otro rol limitado y se ejecutan mediante un proceso controlado por perfil.
- La base administrativa es independiente de todas las bases comerciales.
- Una cadena de conexion de un cliente no se entrega a procesos de otro cliente ni a agentes externos.
- Las migraciones, respaldos, restauraciones y verificaciones se identifican por `tenant_id` y base objetivo.
- Los esquemas internos por modulo definidos en ADR-0002 organizan una base de cliente; no sustituyen la separacion entre clientes.

El `tenant_id` no tiene que repetirse en todas las tablas comerciales porque la base ya representa el limite del cliente. Si aparece en outbox, auditoria, trabajos o integraciones, se valida contra el perfil configurado y nunca se usa para cambiar dinamicamente a otra base.

## Resolucion del contexto

El servidor construye un `TenantContext` desde fuentes confiables:

1. Configuracion inyectada al despliegue.
2. Hostname registrado para el perfil.
3. Emisor, audiencia y claims verificados de la identidad.
4. Identidad del servicio en comunicaciones internas.

Un `tenant_id` recibido en headers, query, formulario, cuerpo o parametros no se considera confiable por si solo. Si un contrato lo necesita, debe coincidir con el contexto autenticado y autorizado.

El contexto acompaña cada solicitud, trabajo, evento, log, metrica, callback y llamada a herramientas. No existe un valor global mutable para el cliente actual.

Las APIs administrativas pueden indicar un perfil objetivo porque administran varios clientes, pero validan al operador, la accion, el recurso, el servidor asignado y el `tenant_id` antes de solicitar una operacion tipada.

## Keycloak

- La plataforma central usa un realm independiente de los CRM.
- Cada cliente usa un realm de Keycloak propio con sus clientes OIDC, usuarios, roles y politicas.
- La API acepta solo el issuer y audience configurados para su perfil.
- Un token valido para el cliente A se rechaza en el cliente B.
- Los administradores de un CRM no reciben permisos de plataforma ni de otros realms.
- La configuracion del realm forma parte del aprovisionamiento y de la recuperacion del perfil.

La federacion o inicio de sesion empresarial puede configurarse por realm posteriormente sin unir los limites de autorizacion.

## Archivos y objetos

- Cada perfil usa un bucket propio o un prefijo exclusivo protegido por credenciales y politicas que solo permiten ese espacio.
- Un prefijo sin controles de acceso no constituye aislamiento.
- Las claves de objetos incluyen identificadores no adivinables y no aceptan rutas proporcionadas sin normalizacion.
- La descarga siempre verifica identidad, autorizacion, perfil y metadatos propietarios.
- Las URLs firmadas son de corta duracion, limitadas al objeto y no se registran en logs.
- Respaldo y restauracion coordinan la base con sus objetos correspondientes.

## Redis, colas y trabajos

Redis puede compartirse inicialmente con las siguientes condiciones:

- Credenciales o ACL restringidas por perfil cuando la tecnologia lo permita.
- Namespaces de cache, locks, rate limits, sesiones y colas derivados de un identificador estable.
- Todo trabajo incluye contexto autenticable del perfil y un identificador idempotente.
- El consumidor comprueba que su perfil configurado coincide antes de ejecutar el trabajo.
- Los datos comerciales y operaciones pendientes recuperables permanecen en PostgreSQL; Redis no es su unica copia.

Una base logica o prefijo de Redis ayuda a organizar, pero no se considera una barrera de seguridad suficiente.

## Integraciones y agentes

- Credenciales, webhooks, callbacks y listas de destinos permitidos pertenecen a un solo perfil.
- Los secretos se resuelven mediante referencias del perfil y no viajan en eventos ni respuestas.
- Los agentes LangGraph reciben un token o capacidad de alcance minimo para herramientas autorizadas.
- Una herramienta reconstruye el contexto desde la identidad del agente y no confia en el cliente declarado por el modelo.
- Los eventos entrantes se vinculan al perfil por endpoint o conexion registrada antes de procesar su contenido.
- Los callbacks verifican perfil, ejecucion, conversacion, firma, antiguedad e idempotencia.

## Plataforma central y soporte

La plataforma almacena metadatos operativos, no replicas de contactos, mensajes, oportunidades o pagos. El ejecutor realiza un conjunto cerrado de operaciones tipadas y conserva privilegios de host fuera del CRM.

El acceso excepcional de soporte a datos de un cliente no se obtiene desde permisos ordinarios de plataforma. Si se implementa, requiere autorizacion explicita, alcance y duracion limitados, motivo, auditoria y revocacion; esta decision no lo habilita automaticamente.

## Ciclo de vida

- `provisioning`: se reservan identidad y recursos mediante pasos idempotentes.
- `active`: se permiten trafico y trabajos normales.
- `suspended`: se bloquea el acceso interactivo y se definen explicitamente los trabajos permitidos.
- `decommissioning`: se detienen integraciones y se aplican exportacion, retencion y respaldo aprobados.
- `deleted`: se eliminan recursos solo tras verificar politica, autorizacion y evidencia; el registro de auditoria requerido se conserva.

Desactivar un perfil no elimina automaticamente bases, archivos, realms ni respaldos.

## Alternativas consideradas

### Una base y tablas compartidas con tenant_id

Se rechaza para el modelo inicial. Reduce infraestructura, pero una consulta sin filtro, una politica incorrecta o una tarea con contexto equivocado puede mezclar clientes. Tambien complica restaurar y migrar un cliente independientemente.

### Un esquema PostgreSQL por cliente

Se rechaza como limite principal. Ofrece organizacion, pero comparte conexion, permisos y varias operaciones del motor, y aumenta el riesgo de seleccionar el esquema incorrecto.

### Un VPS completo por cliente

No se exige inicialmente. Aumenta el aislamiento de recursos, pero tambien el costo y la administracion antes de medir necesidades. El diseño permite adoptarlo por cliente sin cambiar la aplicacion.

### Un realm de Keycloak compartido

Se rechaza inicialmente porque mezcla administracion de identidades y eleva el impacto de errores de audiencia, roles o configuracion. Un realm por cliente coincide con el limite operativo adoptado.

## Consecuencias positivas

- Una credencial de aplicacion no permite consultar todas las empresas.
- Un cliente puede migrarse, respaldarse, restaurarse o actualizarse por separado.
- La identidad y administracion de cada empresa permanecen separadas.
- Disminuye el riesgo de errores comunes de filtrado por `tenant_id`.
- No se requiere una bifurcacion de codigo para ofrecer configuracion por cliente.

## Costos y riesgos

- Aumentan las bases, roles, realms, secretos, procesos y migraciones que debe administrar la plataforma.
- Compartir VPS, motor PostgreSQL o Redis conserva riesgos de agotamiento de recursos y fallos comunes.
- El aprovisionamiento y la recuperacion deben ser automatizados e idempotentes.
- Consultas analiticas entre clientes no pueden acceder directamente a las bases comerciales y necesitan metricas agregadas autorizadas.
- Las pruebas locales y CI deben levantar al menos dos perfiles y comprobar intentos de cruce.

## Validacion

La decision se considera aplicada cuando una prueba automatizada con dos perfiles demuestra que:

- Las credenciales de base del cliente A no pueden conectarse ni operar sobre la base B.
- Un token, sesion, hostname o callback del cliente A se rechaza en B.
- Un usuario de CRM no accede a APIs de plataforma.
- Archivos y URLs firmadas no atraviesan el limite del perfil.
- Cache, locks, colas y trabajos no colisionan ni se ejecutan con otro contexto.
- Una herramienta de agente no puede seleccionar otro cliente mediante sus argumentos.
- Se puede actualizar, respaldar y restaurar A sin modificar datos ni version de B.
- Los logs incluyen `tenant_id` y `correlation_id` sin exponer secretos.
- Un perfil puede moverse a otro host conservando identidad y datos.

Se revisa esta decision si la cantidad de perfiles hace inviable operar bases o realms separados, si aparecen requisitos regulatorios nuevos o si se necesita una plataforma compartida con aislamiento diferente.
