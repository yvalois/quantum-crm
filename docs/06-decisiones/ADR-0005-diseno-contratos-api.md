# ADR 0005 Diseno, versionado y contratos de API

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: BASE-01, BASE-04, BASE-05, CFG-06, ADM-18, OPS-10, OPS-16 y todos los casos de uso expuestos

## Contexto

Quantum expone operaciones a dos interfaces web, servicios internos, integraciones, agentes JavaScript y Python, webhooks y conexiones en tiempo real. Sin convenciones comunes, los DTO, errores, reintentos y versiones pueden divergir entre consumidores, o una operacion larga puede aparentar haber terminado cuando solo fue aceptada.

El stack ya establece REST y OpenAPI 3.1 para HTTP, WebSocket para chat y SSE para progreso administrativo. Esta decision precisa como se definen, validan, versionan y hacen compatibles esos contratos.

## Decision

REST con JSON es la interfaz sincrona principal. Los contratos publicos se definen una sola vez mediante esquemas runtime en `packages/contracts`, generan documentos OpenAPI 3.1.x y se verifican con pruebas de contrato.

Los limites asincronos entre procesos o sistemas usan mensajes versionados compatibles con CloudEvents y se documentan mediante AsyncAPI. Las operaciones criticas son idempotentes y las operaciones largas se representan como recursos consultables.

## Superficies

Se mantienen contratos independientes para:

- API comercial del CRM.
- API de la plataforma administrativa.
- API y callbacks de agentes.
- Webhooks de proveedores y suscripciones salientes.
- WebSocket, SSE y eventos entre procesos.

La API administrativa no se mezcla con la comercial. Cada servicio HTTP publica su propia raiz `/api/v1`; el contrato de agentes usa un namespace explicito `/agent/v1` y los receptores de proveedores usan rutas registradas bajo `/webhooks/v1`.

Los endpoints de salud pueden vivir fuera de la version publica, no exponen datos sensibles y se protegen segun su audiencia.

## Fuente de verdad del contrato

Los esquemas Zod y metadatos de rutas viven junto a los contratos publicos del modulo, por ejemplo:

```text
packages/contracts/src/<module>/
  http/v1/
  events/v1/
```

De estos artefactos se derivan:

- Tipos TypeScript.
- Validacion runtime de entrada y salida.
- OpenAPI 3.1.x por superficie HTTP.
- JSON Schema para consumidores no TypeScript.
- Documentacion y clientes cuando sean necesarios.
- Fixtures y pruebas contractuales.

El documento OpenAPI generado se publica como artefacto verificable, pero no se edita como una segunda fuente manual. Los modelos Prisma, entidades internas y tipos del proveedor no forman parte del contrato.

OpenAPI permanece en 3.1.x por la decision de stack vigente. Una adopcion de 3.2 requiere comprobar generadores, validadores y clientes y, si cambia la conclusion aceptada, crear un ADR sustituto.

## Convenciones HTTP y JSON

- Los recursos usan sustantivos plurales, minusculas y `kebab-case`.
- Se prefieren relaciones poco profundas; no se encadenan mas de dos niveles sin justificacion.
- Los verbos se reservan para acciones que no representan CRUD, por ejemplo `POST /documents/{id}/accept`.
- Los campos JSON usan `camelCase`.
- Fechas y horas usan RFC 3339 con zona explicita y se normalizan a UTC cuando se almacenan.
- Importes usan decimal serializado como string y codigo de moneda ISO 4217; no usan punto flotante binario.
- Los identificadores son opacos para consumidores y no codifican permisos ni significado comercial.
- `null`, campo ausente y valor vacio tienen semantica documentada; no son intercambiables implicitamente.
- Las respuestas nunca exponen columnas automaticamente ni permiten mass assignment.

## Metodos y estados

| Situacion | Respuesta |
|---|---|
| Lectura o actualizacion con representacion | `200 OK` |
| Creacion completa | `201 Created` con `Location` |
| Trabajo aceptado y pendiente | `202 Accepted` con recurso de operacion |
| Exito sin contenido | `204 No Content` |
| Sintaxis, JSON o parametros mal formados | `400 Bad Request` |
| Autenticacion ausente o invalida | `401 Unauthorized` |
| Principal autenticado sin permiso | `403 Forbidden` |
| Recurso inexistente o existencia protegida | `404 Not Found` |
| Conflicto con estado o idempotencia | `409 Conflict` |
| Precondicion `If-Match` fallida | `412 Precondition Failed` |
| Contenido mayor al limite | `413 Content Too Large` |
| Entrada valida sintacticamente pero invalida para el dominio | `422 Unprocessable Content` |
| Limite excedido | `429 Too Many Requests` con `Retry-After` |
| Error inesperado | `500 Internal Server Error` |
| Dependencia fallida | `502 Bad Gateway` |
| Indisponibilidad temporal | `503 Service Unavailable` con `Retry-After` cuando aplique |

No se devuelve `200` para representar un error ni `500` para errores conocidos del cliente.

## Formato de respuesta

Los exitos usan un envelope estable:

```json
{
  "data": {},
  "meta": {},
  "links": {}
}
```

`meta` y `links` aparecen solo cuando aplican. Las respuestas sin contenido usan `204` y no envian un objeto vacio artificial.

Los errores usan `application/problem+json` conforme a RFC 9457:

```json
{
  "type": "https://docs.quantum/errors/validation",
  "title": "Solicitud invalida",
  "status": 422,
  "code": "validation_failed",
  "detail": "Uno o mas campos son invalidos",
  "correlationId": "01...",
  "errors": []
}
```

`code` es estable para maquinas; `title` y `detail` son seguros para personas. No se incluyen stack traces, SQL, rutas internas, secretos ni cuerpos de proveedores.

## Paginacion, filtros y orden

- Cursor opaco es el valor predeterminado para conversaciones, mensajes, contactos, oportunidades y auditoria.
- Offset se permite en busquedas, reportes o pantallas que necesiten saltar a una pagina.
- Toda coleccion tiene un orden estable y un identificador unico como desempate.
- El cursor queda ligado al perfil, filtros, orden y version del formato.
- `limit` tiene valor predeterminado y maximo documentados.
- `total` es opcional y solo se calcula cuando su costo y consistencia sean aceptables.
- Filtros, campos incluidos y ordenamientos usan listas permitidas por endpoint.
- No se incorpora inicialmente un lenguaje libre de consultas.

## Concurrencia

Los recursos editables que puedan sufrir actualizaciones perdidas devuelven `ETag`. El cliente envia `If-Match` al modificar o eliminar; una version obsoleta devuelve `412` sin aplicar el cambio.

Una transicion de dominio incompatible con el estado actual devuelve `409` con un problema que permita reconocer el conflicto. `ETag` no reemplaza las invariantes ni los bloqueos transaccionales del dominio.

## Idempotencia

`Idempotency-Key` es obligatoria para operaciones no idempotentes con efectos importantes, incluidas:

- Pagos y reembolsos.
- Reservas y movimientos de inventario sensibles.
- Envio de mensajes y documentos.
- Emision, aceptacion o conversion de documentos.
- Automatizaciones solicitadas externamente.
- Despliegues, restauraciones y migraciones.
- Solicitudes a agentes que puedan producir efectos.

La clave se almacena con perfil, principal, operacion, hash canonico de la solicitud, estado, resultado seguro y expiracion definida por el dominio.

Repetir clave y contenido devuelve el resultado original. Reutilizar la clave con otro contenido devuelve `409`. Una ejecucion aun en curso devuelve un estado documentado y recuperable. Las claves complementan restricciones unicas, inbox, outbox y consumidores idempotentes; no los sustituyen.

## Operaciones largas

Una solicitud que no puede completar su resultado dentro del tiempo HTTP normal devuelve `202`, `Location` y opcionalmente `Retry-After`:

```text
POST /api/v1/deployments
  -> 202 Accepted
  -> Location: /api/v1/operations/{operationId}
```

El recurso de operacion expone estado deseado y observado, progreso, timestamps, resultado seguro y problema final. SSE puede notificar cambios, pero `GET /operations/{id}` sigue siendo la fuente recuperable tras una desconexion.

## WebSocket y SSE

- WebSocket se usa para chat, presencia y eventos interactivos.
- SSE se usa para progreso administrativo unidireccional.
- Cada conexion autentica perfil y principal conforme a ADR-0004.
- Cada suscripcion y comando sensible vuelve a autorizar su recurso.
- Los mensajes incluyen `eventId`, tipo, version, timestamp y cursor cuando corresponda.
- La reconexion usa cursor o `Last-Event-ID`; si expiro, el cliente obtiene un snapshot autorizado.
- La entrega puede repetirse y el consumidor deduplica por `eventId`.
- Los comandos comerciales duraderos usan contratos e idempotencia; el socket no es la unica evidencia de su resultado.

## Eventos

Los eventos que cruzan procesos o salen de Quantum usan un envelope compatible con CloudEvents:

```text
specversion
id
source
type
subject
time
datacontenttype
tenantId
correlationId
causationId
data
```

El payload tiene esquema y version propios. Un cambio incompatible publica una nueva version de evento y mantiene consumidores pendientes durante la ventana de compatibilidad.

AsyncAPI documenta canales, operaciones y mensajes de WebSocket, eventos entre procesos y webhooks salientes. No se exige AsyncAPI para un evento de dominio que nunca abandona el proceso.

La entrega es al menos una vez salvo que un contrato establezca algo mas estricto. Los consumidores son idempotentes y no asumen orden global; un orden por agregado requiere secuencia explicita.

## Webhooks

- Los endpoints entrantes son especificos por proveedor o conexion registrada.
- Se verifica firma o autenticidad sobre el cuerpo original antes de parsear efectos.
- Se valida timestamp, tolerancia temporal, perfil, tipo y destino.
- El identificador del proveedor o hash estable se registra para deduplicar.
- Los eventos se persisten antes de confirmar cuando perderlos afectaria el negocio.
- Los webhooks salientes se firman con timestamp, identificador de clave y HMAC u otro mecanismo aprobado.
- Los secretos pueden rotarse con una ventana controlada.
- Los reintentos usan backoff con jitter, limite y destino de fallos visible.
- El receptor no debe depender de orden global y deduplica por ID de evento.

## Agentes LangGraph

Los agentes JavaScript y Python implementan el mismo contrato HTTP y JSON Schema:

- Entrada, salida, herramientas, errores y callbacks estan versionados.
- Una ejecucion corta puede responder sincronicamente.
- Una ejecucion larga devuelve `202` y se completa mediante operacion y callback autenticado.
- Los callbacks son idempotentes y validan perfil, ejecucion, conversacion y modo de atencion.
- Cada herramienta tiene nombre, version, schemas de argumentos y resultado y permisos requeridos.
- El agente no recibe rutas internas, entidades de dominio ni modelos Prisma.
- Un kit contractual comun valida implementaciones JavaScript y Python.

## Versionado y compatibilidad

- La version mayor HTTP vive en la ruta, comenzando con `/api/v1`.
- El documento de contrato tiene ademas version semantica.
- Agregar endpoints, campos de respuesta opcionales o parametros opcionales es compatible si no cambia la semantica existente.
- Quitar o renombrar campos, hacer obligatoria una entrada, cambiar tipo, semantica, autenticacion o URL requiere nueva version mayor.
- Agregar un valor de enum se trata como potencialmente incompatible hasta comprobar consumidores exhaustivos.
- Los clientes aplican lectura tolerante a campos nuevos, pero no ignoran errores de validacion en sus envios.
- Las versiones obsoletas anuncian `Deprecation`, documentacion relacionada y `Sunset` antes de retirarse.
- La ventana de compatibilidad contempla pestañas abiertas, workers anteriores, callbacks, webhooks y trabajos pendientes.

No se promete una duracion fija antes de conocer compromisos externos; cada contrato publicado registra soporte y fecha de retiro explicitos.

## Observabilidad y limites

- Se propagan `traceparent` y `tracestate` conforme a W3C Trace Context.
- Cada solicitud posee `correlationId`; un valor externo se valida o reemplaza y nunca concede confianza.
- Los eventos conservan correlacion y causacion.
- Los limites se aplican por perfil, principal, IP y operacion segun el riesgo.
- `429` incluye `Retry-After` cuando el servidor pueda indicarlo.
- Se limitan body, profundidad JSON, cantidad de campos, pagina, archivo y duracion.
- La telemetria no incluye tokens, firmas, secretos ni datos personales innecesarios.

## Automatizacion de calidad

CI ejecuta como minimo:

- Validacion sintactica de OpenAPI y AsyncAPI.
- Generacion reproducible sin diferencias pendientes.
- Deteccion de cambios incompatibles contra la version publicada.
- Validacion de ejemplos y fixtures contra schemas.
- Pruebas proveedor-consumidor para fronteras relevantes.
- Pruebas de autorizacion, aislamiento e idempotencia.
- Contrato comun para un agente JavaScript y uno Python.

Un cambio incompatible no se oculta actualizando silenciosamente snapshots o clientes generados; requiere version y plan de migracion.

## Alternativas consideradas

### GraphQL como API principal

Se rechaza inicialmente porque agrega complejidad de autorizacion por campo, limites de costo, cache y consultas N+1 antes de demostrar la necesidad de consultas arbitrarias.

### tRPC como unico contrato

Se rechaza porque acopla consumidores externos y agentes Python a TypeScript. Puede usarse internamente solo si no crea una segunda API ni elude OpenAPI.

### Versionado solo mediante headers

Se rechaza porque es menos visible en logs, rutas, pruebas y operacion de varias versiones.

### Offset para todas las colecciones

Se rechaza por rendimiento e inconsistencia en listas con inserciones frecuentes.

### WebSocket para todos los comandos

Se rechaza porque dificulta reintentos, auditoria, recuperacion y semantica HTTP de operaciones comerciales.

### DTO manuales por aplicacion

Se rechaza porque frontend, backend, documentacion y agentes terminarian describiendo contratos distintos.

## Consecuencias positivas

- Un contrato sirve a TypeScript, JavaScript y Python.
- Los errores, reintentos y operaciones largas tienen semantica uniforme.
- Los cambios incompatibles se detectan antes de publicar.
- WebSocket, SSE, eventos y webhooks conservan trazabilidad y recuperacion.
- Los consumidores pueden generar clientes y pruebas desde artefactos estables.

## Costos y riesgos

- La generacion y comparacion de contratos agrega herramientas a CI.
- Mantener compatibilidad exige soportar temporalmente mas de una version.
- Cursores, idempotencia y operaciones requieren almacenamiento y limpieza.
- AsyncAPI y CloudEvents agregan convenciones que deben enseñarse y probarse.
- Una mala clasificacion de cambio compatible puede romper consumidores; la revision humana sigue siendo necesaria.

## Validacion

La decision se considera aplicada cuando:

- Una API minima genera OpenAPI 3.1.x desde sus schemas runtime.
- Un cambio incompatible es rechazado por CI.
- Los ejemplos de exito y RFC 9457 se validan automaticamente.
- Un recurso concurrente rechaza una version obsoleta mediante `If-Match`.
- Repetir pagos, mensajes, callbacks y despliegues no duplica efectos.
- Una operacion `202` sobrevive a desconexion y reinicio del cliente.
- WebSocket y SSE recuperan o reconstruyen estado desde un cursor.
- Un webhook duplicado, alterado o vencido se rechaza o deduplica correctamente.
- Un agente JavaScript y uno Python superan la misma suite contractual.
- Ningun contrato permite cruzar perfiles ni eludir ADR-0004.

## Referencias

- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9745: Deprecation HTTP Response Header](https://www.rfc-editor.org/rfc/rfc9745.html)
- [CloudEvents](https://cloudevents.io/)
- [AsyncAPI 3](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)

Se revisa esta decision si aparecen consumidores que necesiten GraphQL, streaming binario, requisitos de orden mas estrictos o un gateway externo que cambie versionado y publicacion.
