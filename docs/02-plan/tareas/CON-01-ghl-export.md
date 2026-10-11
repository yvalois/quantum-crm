# CON-01 — Extraccion GHL de prueba

Estado: EN_CURSO. Fases 4 y 5. Requisitos relacionados: CON-05/06/07, PIPE-01/03/05/06, CHAT-01/07.

## Alcance y evidencia previa

Script reutilizable para extraer y cargar contactos, etiquetas, campos personalizados, pipelines/etapas, oportunidades, conversaciones y mensajes de una ubicacion autorizada. No necesita Company ID. El exportador no modifica GHL ni Quantum; el importador escribe exclusivamente en el perfil aprobado. No crea usuarios ni cambia identidad.

Se revisaron funcionalidades, fases, subtareas, estado, codigo existente y reglas de aislamiento, contratos, persistencia, secretos y ejecucion exclusiva en VPS. El importador CON-01 existente conserva solamente nombre/correo/telefono; los comandos actuales de conversaciones producen outbox. No se usan para importar historia porque podrian perder datos o enviar mensajes.

## Contrato

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
```

Repetir el comando observa el trabajo existente y devuelve un recibo agregado; no lo vuelve a ejecutar. Tras una interrupcion confirmada se puede indicar un nuevo numero de intento como cuarto argumento: las correspondencias durables impiden duplicados y conservan ediciones locales. `VERIFY` concilia registros, relaciones, checkpoints y ausencia de mensajes en outbox. El proceso nunca contacta proveedores de mensajeria.

Los contactos y oportunidades quedan en sus modulos habituales; los campos personalizados aparecen en la ficha del contacto. `/inbox` ofrece el historial GHL paginado, separado de los mensajes activos para impedir reenvios accidentales. Los adjuntos no disponibles se indican expresamente.

## Validacion

Adjuntos, candidato funcional `900fcbe3`: nueve proyectos afectados aprobaron typecheck; 116 pruebas enfocadas y cuatro de arquitectura aprobadas en el VPS. Se reutiliza evidencia por contenido entre commits de formato y pruebas. Las seis pruebas PostgreSQL reales cubren dos perfiles, permisos por hilo, referencias inmutables, reintento, auditoria y exclusion de cargas concurrentes; detectaron y corrigieron el alias SQL del enlace idempotente de Files. La migracion aditiva fue aplicada una sola vez en ambos perfiles sinteticos del laboratorio. Transferencia real y despliegue pendientes de los checks del candidato; no se presentan como realizados. El primer push aun no genero ejecucion de Actions pese a estar el workflow activo; se registra esta evidencia antes de reintentar la sincronizacion documental, sin repetir comprobaciones aprobadas.

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

- Adjuntos: se conservan referencias; copiar bytes requiere Files/ClamAV. No se publican URLs ni se marcan archivos AVAILABLE.
- GHL excluye Group Chat y SMS Review Request del exportador; su API no ofrece snapshot transaccional del conjunto.
- Este artefacto en el VPS no sustituye un respaldo cifrado externo ni una restauracion verificada. El propietario difirio ese requisito exclusivamente para esta carga en desarrollo; produccion sigue bloqueada por configuracion.
- Paginas historicas excepcionalmente grandes: evaluar presupuesto por bytes antes de migrar otras fuentes; la fuente actual fue medida y cabe en el limite del BFF sin recortar mensajes.
- Orquestacion administrativa durable: preparada en rama experimental separada, fuera de esta entrega. Esta prueba no necesita migraciones de plataforma ni nuevas APIs del Admin.
