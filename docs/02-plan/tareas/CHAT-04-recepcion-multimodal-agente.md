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
- [x] La candidata aprueba CI y se despliega por digest en InterAmerican.
- [ ] Audio e imagen reales reciben respuesta correcta de extremo a extremo en el VPS.

## Recuperacion

La migracion es aditiva y forward-only. Un rollback de aplicacion requiere compatibilidad con la tabla nueva; no restaura datos. No aplicar a InterAmerican antes de respaldo externo cifrado y restauracion verificada. No se repiten efectos externos de resultado incierto.

## Evidencia y pendientes

- Candidato `09f1f114` y correccion `005f9ae4`. En VPS: build afectado de diez proyectos, pruebas enfocadas API 4/4, worker 5/5 y base de datos 2/2, 19 pruebas de arquitectura, Prettier y ESLint aprobados. Migracion aplicada a PostgreSQL 18 aislado con esquema sintetico.
- La candidata tecnica previa al despliegue no incluia una respuesta real a medios de InterAmerican; esa prueba sigue pendiente y por tanto el bloque no se cierra.
- Actualizacion 2026-10-15: siete checks CI aprobados para `5d252647`. Migracion aditiva aplicada por migrador controlado en InterAmerican; API, worker y agent-runtime saludables por digest. El worker recibe los mounts de YCloud, OpenAI y S3 y el readiness publico respondio `ok`. El flujo real de audio/imagen permanece pendiente de una prueba enviada al numero conectado. Por solicitud expresa del propietario se desplego sin copia cifrada fuera del VPS; se verifico un `pg_dump` previo en el mismo VPS, que no satisface ADR-0015. El disco quedo con 2,2 GiB libres.
- Incidente real 2026-10-15: dos adjuntos entrantes agotaron cinco intentos cada uno con `SOURCE_UNAVAILABLE`; una peticion desde el worker a la URL formada solo con el ID obtuvo HTTP 400. YCloud entrega una URL firmada en `media.link`, no basta el ID. Correccion `fa9e7a59`: validar URL exacta, cifrarla antes de persistirla, utilizarla con la API key y borrar la referencia al completar la carga a Files. Migracion forward-only `20261015090000_chat_04_signed_media_source` aplicada en InterAmerican (42/42); API y worker nuevos por digest estan saludables. Los dos mensajes originales carecen del enlace firmado, asi que su reintento no es posible con los datos guardados; se solicito repetir la prueba. El commit `736d9598` solo normaliza formato tras el fallo de static; sus siete checks CI aprobaron. La prueba E2E con medios nuevos sigue pendiente.
- Audio real repetido: el enlace firmado permitio descargarlo, pero SeaweedFS rechazo la carga por disco bajo su umbral minimo (1 % libre). Se retiraron unicamente cache reclamable e imagenes antiguas no asociadas a contenedores: 12 GiB libres al cierre de la comprobacion, sin borrar volumenes o datos comerciales. Tras la carga y el scan el worker fallo por permiso `crm:conversations:read` faltante; `1679bc59` lo agrega y deja una asercion de regresion. Build TypeScript y 7 pruebas enfocadas pasaron en VPS. Audio reintentado con destino exacto: `inbound_media=completed`, archivo `available`, `messages.file_id` y referencia presentes. El chat de prueba estaba cerrado en modo humano; se reabrio solo ese chat para generar la respuesta, y `agent_requests=completed`. Entrega externa `DELIVERY_UNCERTAIN`: no se reenvio para evitar duplicados. Aun falta confirmar recepcion telefonica y probar una imagen nueva; por ello el bloque sigue `EN_CURSO`.
- Vista de medios 2026-10-15: candidato `992e3f4f` del PR #169 aprobado por siete checks CI y validacion VPS (formato, lint, 30 pruebas y builds afectados). API y CRM web por digest estan saludables en InterAmerican. Las imagenes verificadas se entregan inline y se amplian; el audio usa reproductor nativo. La UI muestra estado explicito para un adjunto entrante sin `fileId`. La base tiene un audio nuevo asociado y una imagen vieja sin archivo recuperable. Aun falta comprobar el clic autenticado y una imagen nueva; no se declara el E2E completo.
- Refresco del hilo 2026-10-15: candidato `d3a83074`, siete checks CI verdes, build y prueba Playwright sintetica en VPS. La conversacion seleccionada recibe mensajes nuevos y cambios de `fileId` en segundo plano sin ocultar el hilo ni perder el borrador; prueba imagen y audio pendientes que pasan a vista/reproductor disponible. Solo `crm-web` se desplego por digest `sha256:b0b4acb14e9c871c79f4f646d62e9ff2f328f3a13a3a00ec9aa314d1cc912235` y quedo healthy con readiness publico `ok`. Falta prueba de una recepcion nueva con sesion autenticada y medios reales; no se cierra el E2E completo de CHAT-04.
- Reproductor 2026-10-15: el candidato `fb4a0e82` sustituye el control nativo comprimido por una barra horizontal de reproducir/pausar, progreso y tiempo, sin mostrar la etiqueta redundante «Audio». La prueba Chromium 1/1 sobre la imagen publicada `sha256:d997202f90bdb8b69a8d460c1accfa4729299823efee72c4f1d66b74371cf5b8` comprueba el medio entrante pendiente→disponible y ancho util del control. CI 7/7, API y CRM web saludables. Un audio real anterior fue transcrito y produjo respuesta; YCloud mantuvo la entrega incierta, por lo que no se reenvia. Falta reproducir un audio nuevo con sesion autenticada y confirmar el siguiente turno real del agente.
- **Pendientes de estabilizacion posterior:** ampliar formatos compatibles, telemetria de errores por archivo y experiencia visual del adjunto.
