# CON-01 — Extraccion GHL de prueba

Estado: EN_CURSO. Fases 4 y 5. Requisitos relacionados: CON-05/06/07, PIPE-01/03/05/06, CHAT-01/07.

## Alcance y evidencia previa

Script reutilizable solicitado para comprobar cuanto se puede extraer: contactos, etiquetas, campos personalizados, pipelines/etapas, oportunidades, conversaciones y mensajes de una ubicacion autorizada. No necesita Company ID. No modifica GHL ni Quantum, no crea usuarios y no cambia identidad ni despliegues del CRM.

Se revisaron funcionalidades, fases, subtareas, estado, codigo existente y reglas de aislamiento, contratos, persistencia, secretos y ejecucion exclusiva en VPS. El importador CON-01 existente conserva solamente nombre/correo/telefono; los comandos actuales de conversaciones producen outbox. No se usan para importar historia porque podrian perder datos o enviar mensajes.

## Contrato

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

## Validacion

Pruebas sinteticas de paginacion, cursores opacos, deduplicacion, ubicacion, presupuesto, timeout, respuestas malformadas, cifrado, tampering y archivos privados. Ejecucion tecnica exclusivamente en el VPS. Evidencia final se consolida tras la corrida; datos reales y rutas privadas no se registran en Git.

## Pendientes de estabilizacion posterior

- Apply al CRM: definiciones/valores de custom fields, mapeos externos idempotentes, puerto de mensajes historicos sin outbox, tipos/canales originales, moneda y conflictos de contacto. No se presenta la extraccion como migracion aplicada.
- Adjuntos: se conservan referencias; copiar bytes requiere Files/ClamAV. No se publican URLs ni se marcan archivos AVAILABLE.
- GHL excluye Group Chat y SMS Review Request del exportador; su API no ofrece snapshot transaccional del conjunto.
- Este artefacto en el VPS no sustituye un respaldo cifrado externo y una restauracion verificada antes del apply de datos reales.
- Orquestacion administrativa durable: preparada en rama experimental separada, fuera de esta entrega. Esta prueba no necesita migraciones de plataforma ni nuevas APIs del Admin.
