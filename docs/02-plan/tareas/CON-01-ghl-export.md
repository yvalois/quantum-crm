# CON-01 — Extraccion GHL de prueba

Estado: CARGA HISTORICA DESPLEGADA; adjuntos transferidos con excepciones explicitas de origen/formato. Fases 4 y 5. Requisitos relacionados: CON-05/06/07, PIPE-01/03/05/06, CHAT-01/04/07.

## Alcance y evidencia previa

Script reutilizable para extraer y cargar contactos, etiquetas, campos personalizados, pipelines/etapas, oportunidades, conversaciones y mensajes de una ubicacion autorizada. No necesita Company ID. El exportador no modifica GHL ni Quantum; el importador escribe exclusivamente en el perfil aprobado. No crea usuarios ni cambia identidad.

Se revisaron funcionalidades, fases, subtareas, estado, codigo existente y reglas de aislamiento, contratos, persistencia, secretos y ejecucion exclusiva en VPS. El importador CON-01 existente conserva solamente nombre/correo/telefono; los comandos actuales de conversaciones producen outbox. No se usan para importar historia porque podrian perder datos o enviar mensajes.

## Contrato

### Ampliacion autorizada: participantes originales (CON-06 / PIPE-06 / CHAT-07)

El propietario difiere expresamente la conexion de envio desde Quantum. Este bloque no conecta canales, no envia mensajes de prueba ni procesa colas antiguas. El catalogo de campos se presenta completo con busqueda y opcion de incluir vacios; en oportunidades se distinguen los campos del contacto asociado. Las vistas previas usan exclusivamente archivos AVAILABLE y autorizaciones nuevas, sin persistir URLs firmadas.

EN_CURSO 2026-10-11. Recuperar el directorio de nombres GHL mediante GET acotado a la ubicacion aprobada y validarlo completo antes de persistirlo. IAM conserva un directorio externo independiente de cuentas, sesiones, membresias, roles y permisos; solo ID externo y nombre. Cada modulo proyecta exclusivamente responsable y seguidores desde su propio payload historico. El lookup publico IAM resuelve nombres solo despues de autorizar el recurso. La respuesta opcional `sourceParticipants` distingue origen GHL y conserva intactas las asignaciones Quantum. No se importan correos, credenciales ni permisos GHL.

Cierre 2026-10-11: DESPLEGADO. CI siete checks verdes en PR #129 (`a4c83586`). Migracion autorizada y PARTICIPANTS del candidato `646e9e3d` SUCCEEDED, salida 0; 12 participantes y 3510/3510 referencias resueltas. El registro original de importacion conserva su checksum. Conciliacion read-only confirma los 1332 valores originales intactos y ningun cambio en recuentos comerciales, membresias u outbox entre mediciones. La verificacion de GHL devuelve 160 definiciones de contacto y cero de oportunidad; las ultimas no se inventan. UI autenticada en `/inbox` muestra el catalogo completo, nombres originales, WhatsApp y acceso a imagenes; reproduccion de audio/video verificada en navegador sintetico del VPS. No se guardan capturas de clientes.

Imagenes construidas una vez desde `646e9e3d91bd4f3abab40388752957e774599349`: API `sha256:86ef49166a60a61bf3c2d088437ab23f2048d9df5cd071d3c2754f13ae317522`; CRM web `sha256:3c3f74e41594d77fba1815ca0cd4686553c09b8b5c93a148319d45c03e09041f`; worker de carga `sha256:809c9ed027293539e5d7d91a4e24757193e84922d835937ff304e1496ce3277a`; migrador `sha256:dbfa0dc4d8e6433ed77dfe47432a8b00a633212c6a1fb8bb6327c6ddc6dbedb8`. API/CRM healthy y predecesores retenidos; worker residente no sustituido. Recibo privado `candidates/646e9e3d91bd4f3abab40388752957e774599349/interamerican-deployment.json`. Cambios de cierre exclusivamente documentales no invalidan evidencia ni reconstruyen imagenes.

Migracion nueva aditiva y forward-only: tablas IAM de directorio y recibo durable, sin backfill SQL ni cambios a tablas comerciales. La carga tipada PARTICIPANTS usa el artefacto original autenticado, configuracion de perfil y token por archivo; no repite APPLY ni emite outbox. Una identidad externa repetida conserva su nombre original y un payload distinto del mismo recibo produce conflicto. Rollback de aplicacion conserva las tablas y datos; no se ejecuta borrado inverso. Verificacion enfocada: contrato, autorizacion, directorio ajeno rechazado, reintento/concurrencia, lectura por dos perfiles, ausencia de nuevas cuentas/outbox y proyecciones visibles sin payload privado.

Validacion VPS 2026-10-11: candidato funcional `646e9e3d`, formato de pruebas `ce7eb151`; ocho proyectos afectados pasan typecheck, 117 pruebas enfocadas (incluidas cuatro de arquitectura), lint afectado y validacion Prisma aprobados. Siete pruebas PostgreSQL reales sobre dos perfiles sinteticos verifican migracion, concurrencia, permisos, aislamiento, campos, participantes y ausencia de efectos. Cuatro recorridos Playwright pasan sin reintentos: escritorio/movil, PNG decodificado, audio WAV y video WebM reproducidos, renovacion de autorizacion, rechazo seguro, WhatsApp, campos vacios/busqueda y participantes. El migrador se construyo una vez como insumo necesario del laboratorio y se reutilizara para el perfil; las aplicaciones esperan CI. Las primeras comprobaciones detectaron un import de tipos fuera de la dependencia publica y tres aserciones anteriores al nuevo contrato; corregidos y repetidos solo sus checks afectados. La evidencia sin cambios ejecutables se reutiliza. Envio diferido por el propietario.

### Ampliacion autorizada: adjuntos historicos (CHAT-04)

Copiar los bytes de adjuntos del artefacto autenticado sin repetir la carga comercial. Resolver cada mensaje por su correspondencia de origen; conservar una asociacion durable por indice y `fileId`, con progreso y errores seguros. Las fuentes se consultan por HTTPS con destinos permitidos, limites de bytes/tiempo y sin reenviar credenciales a servidores de archivos. Reutilizar el pipeline propietario Files, cuarentena, validacion, ClamAV y promocion inmutable; nunca marcar disponible una referencia sin bytes verificados. Las descargas autorizan nuevamente el hilo y el estado del archivo. Cambios de esquema aditivos y forward-only, sin modificar migraciones aplicadas. El despliegue conserva aplicaciones anteriores; un rollback de aplicacion no borra archivos ni asociaciones. Probar aislamiento, reintentos, fuentes no disponibles, rechazo de contenidos y descarga real. No modificar GHL ni activar envios.

### Ampliacion autorizada: importacion en desarrollo

La extraccion no satisface por si sola la migracion solicitada. El bloque activo agrega un comando de apply al perfil derivado de configuracion verificada, ejecutado por el host adapter mediante una operacion tipada y sin paths ni shell libres. El propietario difiere expresamente el respaldo externo para esta operacion en desarrollo; la regla permanece para produccion. No hay borrado ni sobrescritura de registros comerciales existentes.

- Verificar el artefacto completo y su manifiesto antes de cualquier escritura; validar ubicacion, destino y esquema.
- Persistir definiciones/valores de campos, etiquetas, contactos, pipelines/etapas y oportunidades mediante puertos de sus modulos propietarios. Mapas externos unicos conservan idempotencia y detectan conflictos sin fusionar personas por correo o telefono ambiguos.
- Importar conversaciones y mensajes en almacenamiento historico del modulo conversations, visible y paginado desde la bandeja. Se preservan IDs y fechas originales, cuerpos vacios, canales/tipos originales y referencias incompletas sin crear contactos ficticios. El flujo historico no crea outbox, notificaciones ni automatizaciones.
- Conservar referencias de adjuntos como pendientes; no exponer URLs ni marcar archivos disponibles sin Files/ClamAV.
- Registrar progreso durable, resultados por recurso y conflictos; reanudar sin duplicar efectos. Repetir el mismo artefacto conserva cambios realizados en Quantum.
- Migraciones nuevas aditivas y forward-only; aplicar mediante el migrador controlado. Pruebas enfocadas de aislamiento, reintento, corrupcion, fallos parciales y ausencia de envios, ademas de verificacion API/UI en el VPS.

La implementacion se divide entre contactos/ventas/campos, historial de conversaciones, operacion tipada de host y orquestador de importacion. No se tocan login, Keycloak ni formularios/documentos.

- Origen GHL fijo, Location ID fijo y allowlist de operaciones de lectura; POST solo para busqueda de contactos.
- Token y clave de cifrado mediante archivos. Ningun secreto, contacto, mensaje o cursor aparece en logs o Git.
- Exportacion completa paginada con deduplicacion por ID, timeouts, presupuesto de peticiones y limite conservador de velocidad. No sigue URLs entregadas por el proveedor.
- Cada pagina y checkpoint quedan cifrados juntos con AES-256-GCM, secuencia autenticada y hash encadenado. Al finalizar se verifica el artefacto completo, sin generar archivos en claro.
- Preserva campos y metadatos originales; no convierte fechas ni custom fields de forma destructiva.
- Un cursor estable de mensajes puede avanzar: se detecta estancamiento por IDs, no por igualdad del token.
- Conteos variables, respuestas malformadas o discrepancias se reportan como PARTIAL. No se confunde el total anunciado con registros realmente extraidos.
- RESTART_ONLY: una corrida interrumpida se reinicia en otro directorio; no sobrescribe artefactos anteriores. No existe apply ni escritura de BD en este comando.

## Uso

En el VPS, tras compilar config y worker, ejecutar `node apps/worker/dist/ghl-migration-export-cli.js` con:

```text
QCRM_ENV=production
QCRM_GHL_LOCATION_ID=<ubicacion autorizada>
QCRM_GHL_MIGRATION_TOKEN_FILE=/run/secrets/qcrm_ghl_migration_token
QCRM_GHL_EXPORT_KEY_FILE=/opt/quantum/secrets/ghl-export/export-key
QCRM_GHL_EXPORT_ROOT=/opt/quantum/exports/ghl
```

El directorio de exportacion debe existir con permisos 0700; archivos secretos 0600. La clave AES es de 32 bytes representados en hexadecimal y debe conservarse fuera del checkout. Opcionales: `QCRM_GHL_EXPORT_MAX_REQUESTS` y `QCRM_GHL_EXPORT_DEADLINE_SECONDS`. Cada corrida crea `<UUID>/records.qcrm`; solo se imprimen progreso y conteos. El verificador autentica cada pagina y el manifiesto final.

Scopes requeridos: contacts.readonly, locations/tags.readonly, locations/customFields.readonly, opportunities.readonly, conversations.readonly, conversations/message.readonly.

### Carga al CRM

El host conserva un registro protegido `tenant/<tenantId>/ghl-imports/<exportId>.json`, fuera de Git, que vincula perfil, servidor, release, operacion, exportacion, SHA256 del artefacto, imagenes inmutables de worker/migrador, moneda y excepcion de respaldo limitada a desarrollo. No se aceptan rutas, SQL ni comandos libres desde la solicitud.

Con ese registro aprobado, el mismo CLI de deploy-host ejecuta las operaciones reutilizables:

```text
node apps/deploy-host/dist/ghl-candidate-cli.js MIGRATE <tenantId> <exportId>
node apps/deploy-host/dist/ghl-candidate-cli.js APPLY <tenantId> <exportId>
node apps/deploy-host/dist/ghl-candidate-cli.js VERIFY <tenantId> <exportId>
node apps/deploy-host/dist/ghl-candidate-cli.js ATTACHMENTS <tenantId> <exportId> [attempt]
```

Repetir el comando observa el trabajo existente y devuelve un recibo agregado; no lo vuelve a ejecutar. Tras una interrupcion confirmada se puede indicar un nuevo numero de intento como cuarto argumento: las correspondencias durables impiden duplicados y conservan ediciones locales. `VERIFY` concilia registros, relaciones, checkpoints y ausencia de mensajes en outbox. El proceso nunca contacta proveedores de mensajeria.

Los contactos y oportunidades quedan en sus modulos habituales; los campos personalizados aparecen en la ficha del contacto. `/inbox` ofrece el historial GHL paginado, separado de los mensajes activos para impedir reenvios accidentales. Los adjuntos no disponibles se indican expresamente.

`ATTACHMENTS` autentica el artefacto original y carga los archivos pendientes mediante Files/ClamAV, sin repetir `APPLY`. Reutiliza asociaciones y archivos ya disponibles. Un recibo con fallos o rechazos termina con salida 2 y conserva sus causas; no declara una transferencia completa. La descarga de cada archivo disponible se autoriza desde el historial del hilo. No necesita reenviar la credencial de GHL a los servidores de adjuntos.

## Validacion

Adjuntos, candidato funcional `900fcbe3`: nueve proyectos afectados aprobaron typecheck; 116 pruebas enfocadas y cuatro de arquitectura aprobadas en el VPS. Se reutiliza evidencia por contenido entre commits de formato y pruebas. Las seis pruebas PostgreSQL reales cubren dos perfiles, permisos por hilo, referencias inmutables, reintento, auditoria y exclusion de cargas concurrentes; detectaron y corrigieron el alias SQL del enlace idempotente de Files. La migracion aditiva fue aplicada una sola vez en ambos perfiles sinteticos del laboratorio y despues en el perfil autorizado. Los siete checks de CI aprobaron en `c2431339`; API, CRM, worker y migrador se construyeron una sola vez desde `900fcbe3` y se desplegaron por digest, preservando los contenedores anteriores.

La transferencia real concilia todas las referencias: cada archivo disponible tiene scan limpio, checksum y version verificados, propietario correcto y una referencia exacta al mensaje. No hay asociaciones ausentes, disponibles sin bytes verificados ni outbox historico. Una descarga real mediante el servicio Files desplegado y permisos de administrador activo devolvio HTTPS 200, longitud, checksum y version correctos; no se creo una sesion ni se simulo una revision visual autenticada.

La carga evidencio reinicios OOM del almacenamiento limitado a 768 MiB. El helper tipado `5d0b88cd` amplio solamente su memoria a 3 GiB y swap a 6 GiB, sin reinicio ni cambio de imagen/volumen/red. Persistio el override operativo sin modificar checkouts historicos. En VPS aprobaron 39 pruebas enfocadas, lint, formato, typecheck y build; los siete checks de CI aprobaron. Tras el ajuste no se observaron nuevos OOM y el reintento recupero los archivos afectados.

El candidato `b97ab5dc` amplio el tmpfs receptor de 64 a 512 MiB mediante una operacion tipada: exclusion de imports activos, preservacion de imagen/volumen/limites/red/IP/alias, recibo privado y predecesor detenido conservado. La recuperacion concilia respuestas Docker perdidas y verifica salud antes de permitir otro escritor. Cincuenta pruebas enfocadas, formato, lint, typecheck y build aprobaron en VPS; siete checks de CI verdes (run `38161912689`). La operacion termino APPLIED con el nuevo contenedor saludable y recupero la ultima transferencia soportada. No se reconstruyeron aplicaciones ni se repitieron migraciones o carga comercial.

Conciliacion final de solo lectura: ninguna referencia ausente, pendiente, con propietario incorrecto, asociacion invalida o procesamiento incompleto; ningun mensaje historico en outbox. Los unicos no disponibles corresponden a origen inaccesible o formato rechazado, conservados explicitamente en el recibo con salida 2. Descarga autorizada repetida tras el cambio de almacenamiento: HTTPS, status, bytes, checksum y version correctos. No se presenta esta evidencia como una revision visual autenticada, diferida por el propietario.

Digests de la ampliacion de adjuntos: API `sha256:b55d3cfb62402c380b33bec9904332edbd2fabc7820e06a35e3921ee57250df1`; CRM `sha256:ebb4e431690f88288828f403964314ce025906f73cdd2b50be4c86f740837b0f`; worker `sha256:c803dd9530bf544d2cf759f98f462da029ad2d046760c564fe08db345755ba70`; migrador `sha256:532c50fd71ac8b08888173c4f6ae24acebff41a8ba19f45a34966f1751d93896`. Almacenamiento conservado en `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`.

VPS autorizado, Node 24.21.0, 2026-10-11:

- 27 pruebas enfocadas aprobadas: exportador, transporte, cifrado y configuracion. Cuatro pruebas de limites de arquitectura aprobadas.
- Compilacion de `packages/config` y `apps/worker` aprobada; ESLint de archivos afectados aprobado. Prettier aplicado exclusivamente en el VPS.
- Exportacion real completa: todos los streams alcanzaron su fin, sus conteos coincidieron con la fuente durante la corrida aceptada y el artefacto paso autenticacion de cada pagina/manifiesto. Sin modificaciones de origen/destino.
- Auditoria en memoria: relaciones contacto/pipeline/etapa de oportunidades y contacto de conversaciones presentes; parte del historial de mensajes referencia IDs ausentes en las listas actuales de contactos/conversaciones. Se conservan integramente y requieren conciliacion antes del apply; no se descartan ni se inventan entidades.
- Se reutiliza evidencia de codigo identico por contenido entre la rama exploratoria y el candidato enfocado; se verifico de nuevo la compilacion del candidato enfocado por el cambio de composicion. Solo se repitieron pruebas al corregir tipos, una expectativa de fixture y el manejo real del cursor opaco.
- No se guardan conteos comerciales, IDs de cliente, credenciales ni datos del artefacto en Git. El cambio se limita al script/configuracion y no publica las APIs administrativas experimentales.
- Importacion: candidato de aplicaciones `59a9289f` construido en el VPS (worker, API, CRM y migrador). Prevalidacion autenticada de la fuente aprobada antes de cualquier escritura. Los limites de nombres/claves de campos se ampliaron coherentemente a 1.000 caracteres para conservar datos sin truncar. Typechecks de los doce proyectos afectados y pruebas enfocadas aprobados; verificaciones de contenido no modificado reutilizadas. El helper de laboratorio usa la IP privada de su red interna verificada, sin publicar PostgreSQL.
- Integracion real en PostgreSQL aislado: cuatro pruebas aprobadas sobre las migraciones completas del candidato `59a9289f`, usando dos roles runtime independientes. Verifican persistencia sin truncar, reintento/concurrencia, conservacion de cambios locales, aislamiento, historial sin outbox y reanudacion durable. Helper `99512d3b`: trece pruebas enfocadas, build y ESLint aprobados; no cambia ni reconstruye las imagenes de aplicaciones ya verificadas.
- Cierre operativo: siete checks verdes de CI sobre `a7fcd3bb`. MIGRATE, APPLY y VERIFY del perfil aprobado terminaron con salida 0; COMPLETE y conciliacion consistente. Todos los mapas concuerdan con entidades existentes, las oportunidades conservan etapas validas, los contadores historicos coinciden y no existen mensajes importados en outbox. No se reexporto ni repitio la carga; las consultas de progreso observaron el mismo trabajo. API/CRM saludables, readiness publica 200, rutas protegidas 401/307 sin sesion. La revision visual autenticada fue diferida por decision del propietario.
- Digests desplegados: API `sha256:f2bc218c985eb5562bc855ac8394773c33505e0666cd5a62a460621404b83bfc`; CRM `sha256:0286b5f6c2ec86429444a0ffb9634e05c9f37c5055957a858e8e0cd90e2e048f`. Jobs: worker `sha256:85911a01fa14d3c2ac6d51be61c00c3f2b6ccd11b7578c2304d5bd87bba22000`; migrador `sha256:d03f79ad5c0fd9f3c53de85f7085c0993ce568bd8c91518d312f0037223de549`. Todos construidos una vez desde `59a9289f`; el cambio posterior afecta solo al helper de laboratorio, su prueba y documentacion. Los contenedores anteriores se conservaron para recuperacion.
- Este cierre documental registra evidencia obtenida despues del despliegue; no invalida ni repite builds, migraciones, carga o smoke aprobados. El checklist general permanece sin cambios porque este bloque no acredita por si solo todos los requisitos CON/CHAT.

## Pendientes de estabilizacion posterior

- Seguimiento CHAT-01/CON-05 del 2026-10-11 (PR #128): la auditoria confirma que los hilos reconstruidos desde mensajes usan el ID de contacto original solo cuando es unico y aparece en el stream de contactos; el importador conserva referencias no resueltas sin inventar clientes. La UI ahora muestra nombres y ficha/customs de relaciones confirmadas y separa explicitamente los historicos sin contacto, sin reimportar ni reasociar datos. Las fichas ausentes de la exportacion siguen pendientes de recuperacion verificable desde el origen.

- Adjuntos con origen inaccesible o formato no admitido permanecen identificados y no disponibles: URLs externas 403/404, documentos Office fuera de la allowlist actual y fuentes cuya extension PNG contradice su Content-Type JPEG. No se publican sus URLs ni se omiten las validaciones. La transferencia disponible si conserva bytes propios verificados mediante Files/ClamAV.
- GHL excluye Group Chat y SMS Review Request del exportador; su API no ofrece snapshot transaccional del conjunto.
- Este artefacto en el VPS no sustituye un respaldo cifrado externo ni una restauracion verificada. El propietario difirio ese requisito exclusivamente para esta carga en desarrollo; produccion sigue bloqueada por configuracion.
- Paginas historicas excepcionalmente grandes: evaluar presupuesto por bytes antes de migrar otras fuentes; la fuente actual fue medida y cabe en el limite del BFF sin recortar mensajes.
- Orquestacion administrativa durable: preparada en rama experimental separada, fuera de esta entrega. Esta prueba no necesita migraciones de plataforma ni nuevas APIs del Admin.
