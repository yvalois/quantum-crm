# Quantum CRM — DevOps, despliegues y actualizaciones

Plan técnico para desarrollar localmente, empaquetar Quantum en contenedores, publicar versiones y desplegar perfiles de clientes de forma individual o global. Incluye HTTPS temporal con nip.io. Todas las casillas representan trabajo pendiente; este documento no acredita instalaciones, conexiones al VPS ni despliegues realizados.

El administrador central se desarrolla en `Quantum_CRM_Funcionalidades.md` y `Quantum_CRM_Checklist_Trabajo.md`, requisitos **ADM-01 a ADM-20**. Este documento define los mecanismos que ese administrador utilizará. No establece tiempos de implementación.

## 1. Decisión de arquitectura

Un mismo código base, imágenes versionadas y un entorno lógico por cliente. Cada perfil tendrá su aplicación, workers, configuración y base de datos. Inicialmente los entornos podrán compartir un VPS; su capacidad real determinará cuántos admite.

Se adopta **Docker Engine + Docker Compose + Caddy + PostgreSQL**, con **GitHub Actions y GHCR** para CI/CD y registro de imagenes conforme a [ADR-0009](../06-decisiones/ADR-0009-integracion-entrega-releases.md). El repositorio y la cuenta del registro todavia no han sido proporcionados. La arquitectura permite sustituir el servicio CI/CD conservando el contrato del ejecutor y los artefactos publicados.

DevOps es la práctica completa de desarrollo y operación. Docker empaqueta los procesos; Compose declara cómo ejecutarlos; CI verifica e integra cambios; CD entrega versiones a los entornos. El administrador selecciona clientes y operaciones; un ejecutor restringido las lleva a cabo.

| Componente | Responsabilidad | Alcance inicial |
|---|---|---|
| Repositorio Git | Código, pruebas, migraciones y definiciones de infraestructura | Común a Quantum |
| CI/CD y registro | Verificar, construir y publicar releases inmutables | Común a Quantum |
| Administrador central | Clientes, configuración, versiones y estado de operaciones | Plataforma |
| Ejecutor | Aprovisionar, migrar, desplegar y recuperar según solicitudes válidas | VPS y recursos autorizados |
| Caddy | Entrada HTTPS y encaminamiento a cada entorno | Compartido en el VPS |
| Aplicación web, API y workers | Ejecutar el CRM de una release | Por cliente |
| PostgreSQL | Base central y bases separadas de clientes, con roles propios | Motor inicialmente compartido |
| Colas y trabajos | Ejecuciones pendientes identificadas por cliente y versión de formato | Separación lógica y permisos |
| Archivos | Documentos, medios y adjuntos persistentes | Separación por cliente |
| Respaldo externo | Recuperación después de pérdida del VPS | Fuera del VPS |

Docker documenta Compose como una opción para producción en un servidor y recomienda configuración específica de producción, sin montar el código fuente como en desarrollo. Aquí la imagen se construirá en CI y el VPS descargará el artefacto publicado. [Docker Compose en producción](https://docs.docker.com/compose/how-tos/production/)

- [ ] **OPS-01 — Formalizar la arquitectura de operación.**
  - [ ] Mantener un único repositorio y evitar ramas permanentes de código por cliente.
  - [ ] Separar la base de datos administrativa de las bases comerciales.
  - [ ] Definir proyectos Compose diferenciados para plataforma, pruebas y perfiles.
  - [ ] Definir imágenes y procesos web, API y worker; API y worker pueden compartir imagen con comandos distintos.
  - [ ] Registrar qué componentes son compartidos y cuáles se actualizan por cliente.

Los contenedores de un cliente no constituyen un servidor independiente: comparten kernel, CPU y almacenamiento del host. El motor PostgreSQL, Caddy y el propio VPS también tienen un alcance común. Sus actualizaciones requieren un procedimiento de plataforma distinto de una actualización del CRM de un cliente. Un VPS único no ofrece alta disponibilidad ante una caída completa del servidor.

## 2. Datos del VPS pendientes

No se recibieron datos concretos del VPS en el mensaje. Los valores siguientes deben completarse con información real; no se asumen proveedor, IP, distribución ni capacidad.

| Dato | Estado | Uso |
|---|---|---|
| Proveedor y nombre del VPS | Pendiente | Inventario de infraestructura |
| IPv4 pública estable | Pendiente | Hosts nip.io y acceso al proxy |
| IPv6 pública, si existe | Pendiente | Revisar DNS y conectividad coherentes |
| Sistema operativo y versión | Pendiente | Instalación compatible y mantenimiento |
| Arquitectura CPU, amd64 o arm64 | Pendiente | Construcción y selección de imágenes |
| vCPU y RAM | Pendiente | Límites por cliente y capacidad de despliegue |
| Disco total, libre y tipo | Pendiente | Bases, archivos, imágenes y copias temporales |
| Usuario y puerto SSH | Pendiente | Acceso operativo cuando se implemente |
| Método de acceso SSH | Pendiente; no incluir claves en este archivo | Credencial gestionada de forma segura |
| Servicios y contenedores existentes | Pendiente | Evitar conflictos o interrupciones |
| Uso actual de puertos 80 y 443 | Pendiente | Integración de Caddy sin sustituir servicios a ciegas |
| Firewall del proveedor y del sistema | Pendiente | Exposición HTTP/HTTPS y acceso administrativo |
| Repositorio y registro de imágenes | Pendiente | Configuración de CI/CD |
| Destino de respaldos fuera del VPS | Pendiente | Recuperación ante pérdida total |
| Perfiles iniciales y carga prevista | Pendiente | Dimensionamiento y concurrencia |

- [ ] **OPS-02 — Validar el VPS antes de instalar.**
  - [ ] Completar la ficha y revisar el inventario de servicios existentes.
  - [ ] Confirmar una IP pública alcanzable y el control de los puertos de entrada.
  - [ ] Estimar memoria de plataforma, PostgreSQL y cada aplicación/worker mediante mediciones.
  - [ ] Reservar margen para backups, migraciones y dos versiones simultáneas durante una actualización.
  - [ ] Definir límites efectivos de CPU, RAM, procesos y concurrencia según la capacidad comprobada.
  - [ ] Rechazar o aplazar nuevos despliegues cuando no haya capacidad suficiente.

No se fija un número de clientes por VPS antes de conocer sus recursos y medir las cargas reales. Una modificación de infraestructura compartida debe considerar a todos los perfiles alojados en ese servidor.

## 3. Contenedores, redes y datos persistentes

- [ ] **OPS-03 — Preparar Docker y Compose para producción.**
  - [ ] Instalar versiones compatibles y mantenidas de Docker Engine y Compose en el sistema confirmado.
  - [ ] Crear imágenes de aplicación con dependencias fijadas y proceso sin privilegios cuando sea viable.
  - [ ] Usar archivos separados para configuración local y de producción.
  - [ ] Desplegar imágenes por digest y conservar su relación con la release; no depender de una etiqueta mutable como `latest`.
  - [ ] Configurar comprobaciones de salud, reinicio y rotación de registros.
  - [ ] Mantener el código dentro de la imagen; los cambios en producción se publican como nuevas versiones.
  - [ ] Definir un identificador estable del perfil y nombres distintos para sus slots de despliegue activo y candidato.

- [ ] **OPS-04 — Aislar conexiones y persistencia.**
  - [ ] Publicar únicamente el proxy en 80/443 y restringir SSH según el acceso operativo definido.
  - [ ] Mantener PostgreSQL, colas y puertos internos de aplicación fuera de la exposición pública.
  - [ ] Crear redes por perfil y conectar el proxy únicamente con los servicios que debe publicar.
  - [ ] Crear una base y rol de aplicación por cliente; revocar accesos heredados o públicos que permitan conectarse a otras bases.
  - [ ] Usar un rol distinto y limitado para migraciones; el CRM no operará como superusuario de PostgreSQL.
  - [ ] Separar archivos por cliente y comprobar autorización al leerlos o descargarlos.
  - [ ] Mantener volúmenes de datos, archivos y certificados fuera del ciclo de recreación de contenedores de aplicación.
  - [ ] Respaldar los datos antes de cualquier operación que afecte a volúmenes; no utilizar eliminaciones de volúmenes como mecanismo de actualización.
  - [ ] Si se comparte Redis, usar credenciales/ACL y prefijos por cliente; una base lógica o un prefijo por sí solo no es una barrera de seguridad.

Para trabajos pendientes se propone un registro duradero en PostgreSQL y un outbox por cliente. Redis puede acelerar colas y caché; no debe ser la única copia de una operación comercial pendiente si el sistema no puede recuperarla al perder Redis.

## 4. HTTPS temporal con nip.io

**nip.io resuelve DNS; Caddy obtiene y renueva los certificados HTTPS.** El hostname contiene la IP pública del VPS. El servicio nip.io permite certificados para hosts individuales y actualmente no ofrece certificados wildcard. Se utilizarán nombres explícitos por entorno. [Documentación de nip.io](https://nip.io/)

| Entorno | Patrón de hostname, pendiente de sustituir la IP |
|---|---|
| Administración | `admin.<IP_CON_GUIONES>.nip.io` |
| Pruebas | `staging.<IP_CON_GUIONES>.nip.io` |
| Cliente A | `cliente-a.<IP_CON_GUIONES>.nip.io` |
| Cliente B | `cliente-b.<IP_CON_GUIONES>.nip.io` |

`IP_CON_GUIONES` es un marcador, no un host utilizable. Ejemplo ilustrativo: `cliente-a.203-0-113-10.nip.io`; esa IP pertenece a un rango reservado para documentación y debe sustituirse por la IP pública real. Usar slugs sin secuencias numéricas que puedan confundirse con una dirección y comprobar siempre la resolución final.

- [ ] **OPS-05 — Habilitar HTTPS por hostname.**
  - [ ] Resolver cada nombre y comprobar que devuelve exactamente la IP prevista.
  - [ ] Verificar accesibilidad de 80/443 en el firewall del proveedor, host y publicación de contenedores.
  - [ ] Configurar en Caddy únicamente los hosts de clientes registrados y sus destinos autorizados.
  - [ ] Probar primero la emisión con el entorno ACME de pruebas y después usar un emisor público de producción.
  - [ ] Obtener un certificado individual por host y verificarlo desde fuera del VPS.
  - [ ] Persistir el almacenamiento de Caddy para conservar claves, cuenta ACME y certificados al reiniciar.
  - [ ] Verificar redirección a HTTPS, renovación y alertas de errores de certificados.
  - [ ] Confirmar que WebSocket/SSE y los tiempos de espera del chat funcionan a través del proxy.
  - [ ] Usar cookies seguras limitadas al host, sin compartir sesión mediante `Domain=.nip.io`.
  - [ ] Registrar URLs de retorno, orígenes permitidos y webhooks con el host exacto de cada cliente.

Caddy automatiza certificados y redirección HTTPS cuando el nombre resuelve correctamente, los puertos necesarios son accesibles y su almacenamiento es persistente. Su arranque no demuestra que la emisión haya finalizado: la comprobación externa es un paso obligatorio del alta. Los certificados ACME de pruebas no son de confianza pública. [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https)

nip.io depende de un servicio DNS externo y la emisión está sujeta a límites de la autoridad certificadora. Cambiar la IP cambia estos hosts y obliga a revisar callbacks y webhooks. Algunos proveedores exigen propiedad verificable del dominio para ciertas integraciones; disponer de HTTPS no sustituye esa verificación.

- [ ] **OPS-06 — Preparar el cambio a dominio propio.**
  - [ ] Mantener la URL pública en configuración y no incrustada en el código o las imágenes.
  - [ ] Registrar el nuevo dominio y validar DNS y certificado antes de cambiar enlaces.
  - [ ] Actualizar callbacks OAuth, orígenes, cookies, enlaces públicos y endpoints registrados con proveedores.
  - [ ] Mantener temporalmente recepción en las URLs antiguas de webhooks si sigue siendo necesaria; no depender de que el proveedor siga redirecciones.
  - [ ] Verificar sesiones, formularios, documentos públicos y chat antes de retirar el host temporal.

## 5. Cambios locales y control de versiones

Hay dos tipos de cambios locales: el código que desarrollas en tu equipo y la configuración particular de un cliente. Se gestionan por mecanismos separados y ambos deben sobrevivir al proceso de publicación.

- [ ] **OPS-07 — Establecer el flujo de desarrollo local.**
  - [ ] Mantener `main` como línea integrable y usar ramas cortas de funcionalidad o corrección.
  - [ ] Levantar aplicación, base y dependencias locales con Compose y datos sintéticos.
  - [ ] Usar recarga de código y montajes locales únicamente en desarrollo.
  - [ ] Mantener `.env.example` sin secretos y excluir `.env`, respaldos y credenciales reales del repositorio.
  - [ ] Deshabilitar envíos externos reales en las pruebas locales y usar cuentas o conectores de prueba.
  - [ ] Versionar juntos los cambios de código, las migraciones y el esquema de configuración que necesiten.
  - [ ] Revisar el cambio mediante pull request y ejecutar CI antes de integrarlo.
  - [ ] Publicar una release identificable para trasladar el cambio a producción; no copiar carpetas locales al VPS.

- [ ] **OPS-08 — Gestionar correcciones urgentes sin perder trazabilidad.**
  - [ ] Partir de la versión afectada y reproducir el problema con datos de prueba.
  - [ ] Crear la corrección, verificarla y publicar una release nueva con su digest.
  - [ ] Aplicarla al cliente afectado y posteriormente a los clientes compatibles que la necesiten.
  - [ ] Incorporar la corrección a la línea principal para no perderla en futuras versiones.
  - [ ] Evitar ediciones manuales dentro de contenedores; cualquier cambio de emergencia de configuración debe registrarse y reconciliarse con la configuración declarada.

## 6. Configuración global y cambios particulares del cliente

La separación entre configuración técnica, configuración comercial y secretos cumple `../06-decisiones/ADR-0008-entornos-configuracion-secretos.md`.

La configuración efectiva se calcula a partir de valores predeterminados de la release, configuración global de Quantum y excepciones del cliente, en ese orden. Las restricciones de seguridad y permisos de plataforma se aplican después y no pueden relajarse mediante una excepción del cliente.

| Tipo de información | Dónde se guarda | Efecto de actualizar el código |
|---|---|---|
| Colores, módulos y reglas heredadas | Configuración versionada | Se preservan excepciones compatibles |
| Campos, tipos, opciones y etiquetas personalizados | Datos del cliente | Se conservan identificadores y valores |
| Pipelines, automatizaciones, formularios y plantillas editados | Datos y revisiones del cliente | No se reemplazan por semillas globales |
| Credenciales y endpoints | Secretos y referencias por perfil | No se sustituyen por valores del desarrollador |
| Código de una funcionalidad | Imagen de la release | Se reemplaza mediante despliegue controlado |

- [ ] **OPS-09 — Preservar personalizaciones durante actualizaciones.**
  - [ ] Versionar la configuración global y cada revisión por cliente.
  - [ ] Mostrar el valor efectivo y su procedencia en ADM-08.
  - [ ] Permitir restablecer una excepción para que el cliente vuelva a heredar un valor global.
  - [ ] Validar tipos y claves contra el esquema de configuración de la release de destino.
  - [ ] Convertir campos de configuración mediante migraciones explícitas cuando cambie su estructura.
  - [ ] Crear datos iniciales una sola vez o mediante operaciones idempotentes; nunca volver a sembrar sobrescribiendo datos de negocio.
  - [ ] Publicar nuevas plantillas globales como revisiones y permitir adoptar cambios sin reemplazar copias editadas por el cliente.
  - [ ] Previsualizar diferencias antes de aplicar una configuración a varios perfiles.

Una personalización que requiera código se incorpora al producto común con configuración o feature flag compatible. Si necesita comportamiento externo especializado, se conecta mediante una integración o agente. Mantener una copia divergente del CRM por cliente haría que las actualizaciones globales dejaran de ser uniformes.

## 7. CI y construcción de releases

El flujo aprobado en [ADR-0009](../06-decisiones/ADR-0009-integracion-entrega-releases.md) usa GitHub Actions para comprobar cambios, construir una sola vez y publicar imagenes en GHCR. El repositorio pendiente debera implementar esas protecciones; esta documentacion no afirma que los workflows ya existan. [Publicacion de imagenes con GitHub Actions](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)

- [ ] **OPS-10 — Implementar integración continua.**
  - [ ] Verificar instalación reproducible, tipos, formato y compilación.
  - [ ] Ejecutar pruebas relevantes de aislamiento de perfiles, permisos y contratos API/agent.
  - [ ] Verificar migraciones sobre una base temporal de la versión anterior y sobre una base vacía.
  - [ ] Comprobar idempotencia de mensajes, pagos, reservas y operaciones de despliegue cuando cambien esas áreas.
  - [ ] Construir las imágenes para la arquitectura confirmada del VPS.
  - [ ] Revisar dependencias e imágenes antes de publicarlas y corregir hallazgos que bloqueen la release.
  - [ ] Mantener credenciales de producción fuera de ejecuciones de código no confiable o pull requests externos.

- [ ] **OPS-11 — Publicar una release inmutable.**
  - [ ] Construir una vez cada artefacto a partir del commit verificado.
  - [ ] Publicar imágenes y conservar sus digests en un manifiesto de release.
  - [ ] Registrar versión, commit, imágenes, migraciones, contratos y esquema de configuración soportados.
  - [ ] Identificar si el cambio requiere pausa de escrituras y si permite rollback de aplicación.
  - [ ] Conservar la release anterior y evitar eliminar imágenes aún usadas por clientes o necesarias para reversión.
  - [ ] Publicar el manifiesto en ADM-09 solo cuando todos los artefactos requeridos estén disponibles.

El manifiesto debe describir frontend, API y worker como un conjunto compatible. También debe registrar el rango de contratos de LangGraph admitidos; no basta una etiqueta comercial como `v1.5.0` para reconstruir exactamente el despliegue.

## 8. Pruebas y promoción a producción

- [ ] **OPS-12 — Desplegar y verificar un entorno de pruebas.**
  - [ ] Desplegar el mismo digest que se propone para producción.
  - [ ] Separar base, archivos, credenciales y destinos de notificación de pruebas.
  - [ ] Probar acceso, chat, toma humana, una automatización y una operación comercial relevante.
  - [ ] Verificar migraciones y compatibilidad con agentes Python y JavaScript conectados mediante el contrato común.
  - [ ] Marcar la release como validada y elegible para promoción cuando supere los criterios.
  - [ ] Si pruebas comparte el VPS, limitar su carga y evitar builds pesados que afecten a clientes activos.

La rama principal puede publicar candidatos y actualizar pruebas automáticamente. La promoción comercial se solicita para un cliente o conjunto definido desde el administrador o el workflow autorizado. GitHub Actions permite controlar entornos y concurrencia de despliegue; el bloqueo definitivo por cliente también debe existir en el ejecutor para cubrir solicitudes originadas fuera de CI. [Control de despliegues en GitHub Actions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)

## 9. Administrador y ejecutor de despliegues

El panel web no ejecuta comandos de shell proporcionados por un usuario. Guarda una operación tipada. Un ejecutor en el VPS obtiene las operaciones autorizadas mediante una conexión autenticada saliente y reporta avances. CI registra la release y utiliza el mismo mecanismo de operaciones para evitar dos rutas de despliegue divergentes.

- [ ] **OPS-13 — Implementar el ejecutor restringido.**
  - [ ] Definir operaciones de aprovisionamiento, actualización, rollback, respaldo y consulta.
  - [ ] Recibir `operation_id`, `tenant_id`, `release_id`, `config_revision` y destino registrado; no aceptar comandos arbitrarios.
  - [ ] Validar la release, los digests y el servidor asignado al cliente.
  - [ ] Autenticar al ejecutor y limitar su alcance a sus servidores y recursos autorizados.
  - [ ] Persistir pasos, resultados, bloqueos y señales de actividad para recuperar interrupciones.
  - [ ] Controlar idempotencia y exclusión mutua por perfil.
  - [ ] Mantener el socket Docker y privilegios del host únicamente en el componente operativo autorizado, nunca en el CRM ni en el panel público.
  - [ ] Validar la configuración del proxy antes de recargarla y coordinar recargas concurrentes.
  - [ ] Informar estado observado, no solo el resultado de enviar un comando.

Tener acceso al daemon Docker supone privilegios elevados sobre el host. El ejecutor se trata como componente de infraestructura: entrada restringida, dependencias controladas y operaciones predefinidas. Las aplicaciones de los clientes conservan credenciales de aplicación, no de administración del host.

## 10. Alta y despliegue de un perfil

- [ ] **OPS-14 — Implementar aprovisionamiento repetible.**
  - [ ] Registrar el perfil y reservar su identificador, slug y hostname únicos.
  - [ ] Comprobar capacidad y seleccionar una release validada.
  - [ ] Crear base y roles, espacio de archivos, secretos y configuración inicial.
  - [ ] Ejecutar las migraciones iniciales mediante un trabajo controlado.
  - [ ] Levantar aplicación y worker con límites y credenciales del perfil.
  - [ ] Configurar ruta Caddy y solicitar certificado del hostname nip.io real.
  - [ ] Crear o invitar al administrador del cliente sin guardar contraseñas en registros.
  - [ ] Verificar HTTPS, autenticación, aislamiento, salud de la aplicación y procesamiento de trabajos.
  - [ ] Activar el perfil y registrar sus recursos y versiones observadas.
  - [ ] Reanudar pasos fallidos usando los recursos ya creados, evitando borrados de datos como compensación automática.

## 11. Actualización individual y manejo del tráfico

Se propone preparación de una versión candidata junto a la activa cuando la RAM y el disco lo permitan. Compose no ofrece por sí solo una actualización blue/green con cambio de tráfico y drenaje: esos pasos los implementa el ejecutor. Si el VPS no puede mantener ambas versiones, se define una actualización con pausa controlada y se muestra ese efecto antes de ejecutarla; no se promete interrupción cero.

- [ ] **OPS-15 — Actualizar un perfil con control de estado.**
  - [ ] Adquirir bloqueo del perfil y guardar versión, configuración y esquema iniciales.
  - [ ] Validar recursos, secretos, compatibilidad de agentes y migraciones de destino.
  - [ ] Crear y verificar un respaldo previo acorde al cambio.
  - [ ] Aplicar migraciones compatibles con la versión activa, o pausar escrituras si la release lo requiere.
  - [ ] Preparar el slot candidato con frontend y API de la release exacta.
  - [ ] Mantener sus workers sin consumir hasta completar la transferencia de ejecución.
  - [ ] Comprobar readiness real: conexión a base, esquema, configuración y dependencias esenciales.
  - [ ] Transferir tráfico y consumo de trabajos bajo una operación coordinada.
  - [ ] Revalidar salud y operación antes de marcar el despliegue como completado.
  - [ ] Conservar temporalmente el slot anterior según el plan de recuperación y liberar recursos cuando sea seguro.

- [ ] **OPS-16 — Mantener consistencia de chat, agentes y trabajos.**
  - [ ] Dejar de tomar trabajos nuevos en workers anteriores y permitir terminar o recuperar los que estaban en curso.
  - [ ] Usar leases y un identificador de generación para impedir que un worker anterior siga produciendo efectos después de perder la titularidad.
  - [ ] Registrar mensajes y eventos entrantes de forma duradera antes de confirmar su recepción al proveedor.
  - [ ] Deduplicar eventos, envíos y efectos; el procesamiento puede repetirse, el efecto comercial debe controlarse de forma idempotente.
  - [ ] Versionar el formato de trabajos y callbacks y mantener compatibilidad mientras existan tareas antiguas pendientes.
  - [ ] En callbacks de agentes, validar cliente, conversación, ejecución y modo de atención antes de enviar.
  - [ ] Mantener bloqueadas respuestas y seguimientos cuando un asesor haya tomado la conversación, también tras un despliegue.
  - [ ] Manejar reconexión de WebSockets/SSE con cursor de mensajes para recuperar eventos durante el cambio.
  - [ ] Mantener APIs compatibles con las pestañas abiertas del frontend anterior o solicitar recarga controlada antes de acciones incompatibles.

El cambio de tráfico afecta a peticiones nuevas; las conexiones existentes pueden seguir en la versión anterior. El drenaje, los bloqueos y los contratos compatibles son parte del despliegue y no se resuelven solo cambiando una ruta del proxy.

## 12. Actualizaciones globales y plataforma compartida

- [ ] **OPS-17 — Ejecutar promociones globales por lotes.**
  - [ ] Capturar la lista de clientes elegibles y las exclusiones al iniciar la operación.
  - [ ] Aplicar primero la release a un perfil de prueba o piloto definido.
  - [ ] Verificar errores, salud y trabajos antes de continuar con el siguiente lote.
  - [ ] Limitar el número de actualizaciones simultáneas según la capacidad real del VPS.
  - [ ] Detener lotes pendientes cuando se detecten fallos, manteniendo el resultado individual de los ya procesados.
  - [ ] Reanudar solo clientes pendientes o fallidos después de diagnosticar el problema.
  - [ ] Aplicar la misma release por digest sin reconstruir imágenes para cada cliente.
  - [ ] Mantener una política explícita de versiones soportadas y registrar perfiles que permanezcan atrás.

- [ ] **OPS-18 — Actualizar componentes comunes.**
  - [ ] Gestionar cambios de Caddy, Docker, sistema operativo, PostgreSQL y colas como operaciones de plataforma.
  - [ ] Identificar todos los perfiles afectados y su compatibilidad antes de actualizar un servicio compartido.
  - [ ] Probar el procedimiento y contar con respaldo y recuperación del componente común.
  - [ ] Coordinar bloqueos para que no coincidan con altas o migraciones incompatibles.
  - [ ] Verificar todos los perfiles afectados al finalizar.
  - [ ] Actualizar el administrador y su ejecutor mediante un procedimiento de bootstrap externo a la propia interfaz, preservando compatibilidad entre ambos.

La separación de bases permite migrar el esquema de un cliente independientemente; no permite actualizar la versión mayor del motor PostgreSQL para solo una base del mismo proceso. Para esa independencia se necesitaría otro motor o servidor y una migración adicional.

## 13. Migraciones y rollback

- [ ] **OPS-19 — Versionar y ejecutar migraciones por cliente.**
  - [ ] Guardar migraciones ordenadas y su historial en cada base.
  - [ ] Ejecutar un único migrador por perfil, con bloqueo y credenciales específicas.
  - [ ] Agregar estructuras compatibles antes de cambiar lectores y escritores.
  - [ ] Completar conversiones o backfills con avance persistente y operaciones reanudables.
  - [ ] Verificar que versiones anteriores, pestañas abiertas y trabajos pendientes ya no dependan de estructuras antiguas antes de retirarlas.
  - [ ] Marcar los cambios destructivos como operaciones con procedimiento específico; no aplicarlos automáticamente durante el arranque de todos los contenedores.
  - [ ] Comprobar la versión de configuración y contrato del agente junto con el esquema de datos.

- [ ] **OPS-20 — Revertir de forma compatible.**
  - [ ] Validar si la versión anterior puede leer los datos actuales y procesar los trabajos pendientes.
  - [ ] Volver al conjunto exacto de imágenes anterior y a una revisión de configuración compatible.
  - [ ] Coordinar tráfico, workers y leases igual que en una actualización normal.
  - [ ] Conservar nuevas operaciones de clientes cuando el rollback sea solo de aplicación.
  - [ ] Bloquear rollback automático si existen cambios de datos incompatibles y presentar el procedimiento de recuperación aplicable.
  - [ ] Registrar versión final observada, resultado y causa de la reversión.

Rollback de aplicación y restauración de datos son operaciones diferentes. Restaurar una copia anterior puede descartar información posterior; por eso la recuperación se valida primero en un entorno aislado y se documenta el punto al que se vuelve.

## 14. Backups y recuperación

- [ ] **OPS-21 — Implementar respaldos y restauración comprobada.**
  - [ ] Definir frecuencia, retención y objetivos de recuperación según la operación real; quedan pendientes de acordar.
  - [ ] Respaldar cada base de cliente y la base administrativa con métodos consistentes de PostgreSQL.
  - [ ] Respaldar archivos, configuración y material necesario para reconstruir conexiones y despliegues, protegiendo los secretos.
  - [ ] Coordinar referencias de archivos y datos para no producir una copia con adjuntos ausentes.
  - [ ] Enviar copias cifradas fuera del VPS y comprobar integridad y resultado.
  - [ ] Restaurar un cliente en un entorno aislado y verificar registros, adjuntos y configuración.
  - [ ] Desactivar envíos, pagos y automatizaciones reales durante pruebas de restauración.
  - [ ] Probar la reconstrucción de un servidor desde el inventario, artefactos y respaldos.
  - [ ] Evitar tratar un volumen Docker o una copia en el mismo disco como respaldo frente a pérdida del VPS.

## 15. Observabilidad, secretos y capacidad

- [ ] **OPS-22 — Hacer visible el estado operativo.**
  - [ ] Registrar logs con tenant_id, release_id, deployment_id y correlation_id.
  - [ ] Mostrar CPU, RAM, disco, errores, latencia, cola pendiente y salud por perfil.
  - [ ] Distinguir proceso vivo de aplicación lista para atender.
  - [ ] Detectar caducidad de certificados, errores de backups, disco insuficiente y trabajadores atascados.
  - [ ] Guardar auditoría de quién solicitó cada cambio y qué ejecutó realmente el sistema.
  - [ ] Aplicar retención y rotación para que registros e imágenes no agoten el disco.

- [ ] **OPS-23 — Administrar secretos y acceso operativo.**
  - [ ] Cumplir el almacenamiento, montaje, rotación y validación definidos en `../06-decisiones/ADR-0008-entornos-configuracion-secretos.md`.
  - [ ] Guardar secretos por perfil y entorno en un almacén o archivos restringidos gestionados por el ejecutor.
  - [ ] Mantener referencias a secretos en la base administrativa; no sus valores en respuestas de API o formularios de consulta.
  - [ ] Usar credenciales de registro de solo lectura en el VPS y permisos de publicación únicamente en CI.
  - [ ] Restringir acceso SSH, verificar identidad del host y rotar credenciales de operación.
  - [ ] Excluir secretos de imágenes, manifiestos públicos, repositorio, artefactos de pruebas y logs.
  - [ ] Proteger las operaciones administrativas con roles, autenticación y validación del perfil objetivo.

El agotamiento de recursos por un cliente puede afectar al resto si todos comparten servidor. Los límites y la cola de despliegues reducen ese riesgo, pero el dimensionamiento sigue dependiendo de las métricas del VPS. El crecimiento posterior puede distribuir perfiles entre varios hosts usando el registro cliente-servidor existente.

## 16. Entregables técnicos de implementación

Estos elementos son trabajo de desarrollo pendiente; sus nombres describen los archivos o componentes a crear en el repositorio real, no entregables ejecutables incluidos en este documento.

| Entregable | Contenido esperado |
|---|---|
| Dockerfiles | Builds reproducibles para web, API y worker |
| Compose local | Desarrollo con base de prueba y recarga de código |
| Compose de plataforma | Caddy, administrador, motor de datos y dependencias compartidas |
| Plantilla Compose de cliente | Recursos, redes y slots de aplicación parametrizados por perfil |
| Configuración Caddy generada | Hosts permitidos, rutas y HTTPS persistente |
| Workflows CI/CD | Verificación, build, publicación y promoción |
| Manifiesto de release | Digests, commit, migraciones y compatibilidad |
| Ejecutor | Operaciones tipadas, progreso, bloqueos y recuperación |
| Registro de perfiles y operaciones | Estado deseado/observado, ubicación y auditoría |
| Migraciones | Base administrativa y bases de clientes |
| Procedimientos de recuperación | Rollback compatible, restore por cliente y recuperación del VPS |

- [ ] **OPS-24 — Verificar la puesta en marcha completa.**
  - [ ] Completar datos del VPS y confirmar recursos antes del primer despliegue.
  - [ ] Aplicar un cambio local mediante Git, CI, release y entorno de pruebas.
  - [ ] Crear dos perfiles y confirmar aislamiento de datos, archivos y credenciales.
  - [ ] Verificar HTTPS público y renovación con hosts nip.io reales.
  - [ ] Actualizar un perfil sin cambiar la versión de otro.
  - [ ] Ejecutar una actualización global con detención ante un fallo controlado.
  - [ ] Conservar configuraciones y plantillas propias de ambos clientes tras el cambio global.
  - [ ] Reiniciar procesos durante una operación y comprobar recuperación sin recursos ni mensajes duplicados.
  - [ ] Verificar chat mixto y tareas pendientes durante el cambio de versión.
  - [ ] Revertir una release compatible y comprobar la restauración aislada de un respaldo.
  - [ ] Validar que el panel muestra el estado real y que sus acciones llaman al ejecutor implementado.

## 17. Relación con el desarrollo del administrador

| Funciones del administrador | Trabajo operativo relacionado |
|---|---|
| ADM-01 a ADM-03: acceso, perfiles y ciclo de vida | OPS-01, OPS-04, OPS-13, OPS-23 |
| ADM-04 a ADM-06: alta, VPS y estado | OPS-02, OPS-03, OPS-14, OPS-22 |
| ADM-07 y ADM-08: módulos y configuración | OPS-09, OPS-11, OPS-19 |
| ADM-09 a ADM-12: releases y operaciones | OPS-10 a OPS-17 |
| ADM-13 y ADM-14: migraciones y reversión | OPS-18 a OPS-20 |
| ADM-15 y ADM-16: respaldos y salud | OPS-21 y OPS-22 |
| ADM-17: hosts y HTTPS | OPS-05 y OPS-06 |
| ADM-18: agentes y conexiones | OPS-09, OPS-12, OPS-16, OPS-23 |
| ADM-19 y ADM-20: auditoría y ejecutor | OPS-13, OPS-22, OPS-23 |

La implementación se considera terminada cuando las operaciones del administrador funcionan contra esta infraestructura y superan OPS-24. Dibujar los controles del panel sin aprovisionamiento, migraciones, observación y recuperación reales no completa la función.
