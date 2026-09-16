# API y contratos

Estas reglas aplican a HTTP, WebSocket, SSE, eventos, webhooks y contratos de agentes. La decision completa vive en `../06-decisiones/ADR-0005-diseno-contratos-api.md`.

## Antes de agregar o cambiar un endpoint

- Identificar el requisito y el modulo propietario.
- Buscar primero un contrato o caso de uso existente.
- Definir entrada, salida, autorizacion, errores, idempotencia y compatibilidad antes del controlador.
- Colocar schemas publicos en `packages/contracts`; no exponer entidades internas ni modelos Prisma.
- Validar entrada y salida en runtime aunque exista tipado TypeScript.
- Actualizar OpenAPI o AsyncAPI generado y sus ejemplos.
- Ejecutar la deteccion de cambios incompatibles y las pruebas contractuales aplicables.

## HTTP

- Usar `/api/v1`, recursos plurales en `kebab-case`, metodos y estados HTTP con su semantica real.
- Usar `camelCase` en JSON, RFC 3339 para timestamps y decimal string mas moneda para dinero.
- Responder exitos con `data`, `meta` y `links` cuando correspondan.
- Responder errores con `application/problem+json` conforme a RFC 9457.
- No devolver `200` para errores ni filtrar detalles internos mediante `500`.
- Proteger recursos concurrentes con `ETag` e `If-Match` cuando una sobrescritura pueda perder cambios.
- Aplicar limites de body, pagina, campos, archivos y frecuencia.

## Colecciones

- Usar cursor opaco y orden estable en colecciones activas o grandes.
- Permitir offset solo cuando la experiencia requiera paginas o totales.
- Autorizar filtros, ordenamientos e inclusiones mediante listas explicitas.
- No aceptar nombres de columnas, expresiones SQL ni rutas internas como parametros de consulta.
- No calcular `total` automaticamente si su costo no esta controlado.

## Reintentos e idempotencia

- Exigir `Idempotency-Key` en operaciones criticas no idempotentes.
- Ligar la clave a perfil, principal, operacion y hash de la solicitud.
- Devolver el resultado anterior al repetir la misma solicitud y `409` si cambia el contenido.
- Mantener restricciones unicas, inbox, outbox y consumidores idempotentes; la clave HTTP no los reemplaza.
- Documentar cuales errores son reintentables y respetar `Retry-After`.

## Operaciones y tiempo real

- Devolver `202` y un recurso de operacion para trabajos largos; no informar exito final antes de observarlo.
- Usar SSE para progreso unidireccional y WebSocket para chat o interaccion en tiempo real.
- Autenticar la conexion, autorizar cada recurso y soportar reconexion mediante cursor.
- Incluir ID y version de evento; asumir entregas repetidas y deduplicar.
- No usar el socket como unica evidencia de una operacion comercial duradera.

## Eventos, webhooks y agentes

- Versionar payloads que crucen procesos y usar envelope compatible con CloudEvents.
- Documentar canales asincronos en AsyncAPI cuando abandonen el proceso.
- Verificar firma, timestamp, perfil y deduplicacion antes de producir efectos desde un webhook.
- Aplicar backoff con jitter, limite y visibilidad de fallos a entregas salientes.
- Mantener un unico contrato JSON Schema para agentes JavaScript y Python.
- No permitir que callbacks o argumentos del agente cambien perfil, permisos o identidad de ejecucion.

## Compatibilidad

- Tratar eliminaciones, renombres, entradas obligatorias, cambios de tipo o semantica como breaking changes.
- Revisar valores nuevos de enums como potencialmente incompatibles.
- Publicar version mayor nueva y plan de migracion cuando el cambio sea incompatible.
- Usar `Deprecation` y `Sunset` antes de retirar una version publicada.
- No aprobar snapshots o clientes regenerados si ocultan una ruptura no explicada.

## Evidencia minima

- Contrato generado y validado sin diferencias pendientes.
- Ejemplos comprobados contra schemas.
- Pruebas positivas, de validacion, autorizacion y aislamiento.
- Prueba de reintento para efectos criticos.
- Prueba de compatibilidad o version mayor documentada.
