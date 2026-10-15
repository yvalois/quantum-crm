# CHAT-04 - Recepcion de audio e imagen para el agente

> Plan derivado de `CHAT-04` y `BASE-02`; no sustituye el alcance completo de ninguno.

## Identificacion

- Requisito principal: `CHAT-04` (envio y recepcion de audios, imagenes y documentos).
- Requisito relacionado: `BASE-02` (contexto de conversacion del agente).
- Fase del MVP: chat multicanal y agente nativo; depende de YCloud, Files/ClamAV y OpenAI ya conectados.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Reglas: ADR-0003, ADR-0006, ADR-0008, ADR-0011, ADR-0012, ADR-0013 y ADR-0015; reglas 07, 09, 12, 13 y 15.

## Resultado esperado

Un cliente envia audio o imagen por WhatsApp. El mismo perfil guarda el archivo validado, espera el escaneo, transcribe o describe el contenido y el agente responde en el idioma y contexto de esa conversacion. No se amplia el envio saliente en este bloque.

## Auditoria y alcance

Antes del cambio, el webhook guardaba etiquetas de medios, solo `TEXT` generaba solicitudes del agente y `/agent/v1/run` recibia texto. Se extienden el receptor YCloud, `conversations`, el worker, Files y el runtime; no se da al agente acceso directo a S3 ni a secretos. La migracion `20261015080000_chat_04_inbound_media` agrega un trabajo cercado por mensaje al esquema del perfil. El proveedor se descarga en host fijo, con limite de bytes y checksum; el analisis ocurre solo tras estado `AVAILABLE`. El texto posterior no adelanta un adjunto pendiente.

## Riesgos y mitigacion

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Archivo inseguro o de otro perfil | Files/ClamAV, propietario de conversacion y checksum antes de analisis | Prueba del gate `SCANNING` y lectura `AVAILABLE` |
| Reintentos y entregas duplicadas | Un trabajo por mensaje, lease generacional, referencias y solicitud del agente idempotentes | Pruebas de repositorio y reintento |
| Cambio de idioma indebido por OCR o descripcion | Deteccion sobre texto real del cliente e historial, no sobre analisis interno | Pruebas de idioma |
| Migrar datos reales sin recuperacion | Exigir copia cifrada externa y restauracion verificada antes de despliegue | Comprobar `BackupSet VERIFIED` |

## Criterios de aceptacion y verificacion

- [x] Audio e imagen entrantes generan trabajo durable, no respuesta prematura.
- [x] El worker espera Files `AVAILABLE` antes de llamar OpenAI y de despertar al agente.
- [x] La respuesta usa transcripcion o descripcion sin perder el idioma del hilo.
- [ ] La candidata aprueba CI y se despliega por digest en InterAmerican.
- [ ] Audio e imagen reales reciben respuesta correcta de extremo a extremo en el VPS.

## Recuperacion

La migracion es aditiva y forward-only. Un rollback de aplicacion requiere compatibilidad con la tabla nueva; no restaura datos. No aplicar a InterAmerican antes de respaldo externo cifrado y restauracion verificada. No se repiten efectos externos de resultado incierto.

## Evidencia y pendientes

- Candidato `09f1f114` y correccion `005f9ae4`. En VPS: build afectado de diez proyectos, pruebas enfocadas API 4/4, worker 5/5 y base de datos 2/2, 19 pruebas de arquitectura, Prettier y ESLint aprobados. Migracion aplicada a PostgreSQL 18 aislado con esquema sintetico.
- No se ha verificado respuesta real a medios de InterAmerican ni se ha desplegado; por tanto el bloque sigue abierto.
- **Pendientes de estabilizacion posterior:** ampliar formatos compatibles, telemetria de errores por archivo y experiencia visual del adjunto.
