# ADR 0010 Observabilidad y manejo de fallos

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: OPS-15, OPS-16, OPS-17, OPS-22, ADM-06, ADM-12, ADM-15, ADM-19 y todos los recorridos con dependencias externas

> Actualizacion posterior: [ADR-0013](ADR-0013-archivos-almacenamiento-objetos.md) agrega estados y senales de archivos, scanner, reconciliacion, cuota y disco sin permitir nombres, contenido, URLs firmadas, object keys ni credenciales en telemetria.

## Contexto

Quantum combina solicitudes HTTP, WebSocket, SSE, trabajos asincronos, eventos, agentes, proveedores y despliegues por perfil. Un fallo puede atravesar varios procesos o quedar pendiente despues de responder al usuario. Sin convenciones comunes seria dificil distinguir errores esperados de defectos, seguir una operacion, detectar degradacion o investigar un cliente sin exponer sus datos.

El VPS y los objetivos SLO todavia no se conocen. La arquitectura debe permitir instrumentar el primer servicio sin comprometer un backend que luego no quepa en el servidor ni acoplar el dominio a un proveedor de monitoreo.

## Decision

Quantum instrumenta trazas y metricas con OpenTelemetry JavaScript y emite logs JSON con Pino. `packages/observability` configura los tres signos, la correlacion, la redaccion y los adaptadores comunes; el dominio permanece independiente de logging y telemetria.

Cada entorno operativo recibe telemetria a traves de un OpenTelemetry Collector Contrib interno usando OTLP. El backend puede cambiar sin modificar aplicaciones. El perfil de referencia es Grafana con Prometheus, Loki, Tempo y Alertmanager, pero solo se instala completo despues de validar capacidad; un servicio administrado compatible con OTLP es una alternativa operativa valida.

Los errores esperados son resultados tipados. Las excepciones representan fallos inesperados o de infraestructura que no pudieron traducirse. Todas las fronteras aplican clasificacion, timeout, reintentos limitados, respuesta segura y evidencia correlacionada.

## Fronteras y flujo de telemetria

```text
aplicaciones TypeScript
  |-- trazas y metricas OTLP ---------+
  |-- logs JSON en stdout ------------+--> Collector interno
                                           |-- filtros y redaccion
                                           |-- lotes y colas limitadas
                                           +--> backend OTLP/Prometheus compatible
```

- Las aplicaciones no incluyen SDKs propietarios de Grafana, Sentry u otro proveedor en dominio o casos de uso.
- El Collector escucha OTLP solo en la red interna y no acepta telemetria anonima desde Internet.
- Los logs de contenedor se leen mediante rutas restringidas y de solo lectura; el Collector no recibe el socket Docker ni permisos operativos del host.
- Los backends y el Collector usan imagenes fijadas por digest, limites de recursos y almacenamiento con cuotas.
- Local y test pueden usar exportadores de memoria o consola controlados. No requieren toda la plataforma de observabilidad.
- Staging prueba el pipeline real antes de promover una release.

OpenTelemetry JavaScript declara estables las trazas y metricas, pero mantiene el SDK de logs en desarrollo. Por eso los logs de aplicacion usan Pino JSON y se transforman fuera del proceso mientras esa frontera no sea estable.

## Identidad y correlacion

Se propagan `traceparent` y `tracestate` conforme a W3C Trace Context. Un contexto externo se valida, puede reiniciarse en una frontera de confianza y nunca aporta identidad, perfil ni autorizacion.

| Identificador | Proposito | Regla |
|---|---|---|
| `trace_id` y `span_id` | Relacionar ejecucion distribuida | Los administra OpenTelemetry |
| `correlation_id` | Relacionar una intencion comercial o administrativa | Se valida o genera en la entrada y sobrevive a asincronia |
| `causation_id` | Identificar el mensaje o accion causante | Obligatorio en eventos y trabajos derivados |
| `tenant_id` | Acotar investigacion al perfil | Se deriva del contexto verificado; no se acepta desde baggage |
| `operation_id` | Seguir una operacion larga | Es el recurso durable de la API |
| `job_id` | Seguir una ejecucion asincrona | No se reutiliza como clave de idempotencia |
| `deployment_id` y `release_id` | Relacionar cambios operativos | Se incluyen en despliegues y procesos desplegados |

- Baggage solo admite una lista vacia o atributos tecnicos de baja cardinalidad aprobados.
- Nunca transporta permisos, tokens, nombres, correos, telefonos, mensajes ni datos comerciales.
- Eventos, outbox, inbox, webhooks y trabajos conservan correlacion y causacion en metadatos versionados.
- Logs y trazas comparten los IDs activos; las metricas no usan IDs como labels.

## Logs estructurados

Cada linea es JSON valido con nombres estables. Campos base:

- `timestamp`, `severity`, `message` y `event_name`;
- `service.name`, `service.version` y `deployment.environment.name`;
- `module`, `operation`, `result` y `duration_ms` cuando apliquen;
- `trace_id`, `span_id`, `correlation_id` y los IDs operativos pertinentes;
- `tenant_id` solo dentro del limite autorizado;
- `error.code`, `error.type`, `error.kind` y `retryable` en fallos.

Reglas:

- Los mensajes son plantillas constantes; datos variables viven en campos controlados.
- `debug` y `trace` estan desactivados en produccion salvo una ventana diagnostica aprobada, acotada y auditada.
- Un mismo error se registra una vez en la frontera que decide su resultado; capas intermedias agregan contexto al error y no duplican stacks.
- Errores esperados de usuario no se registran como fallos del sistema.
- Stacks completos solo aparecen para fallos inesperados y se redactan antes de salir del proceso.
- No se registran bodies, headers completos, cookies, tokens, firmas, SQL con valores, archivos, prompts, mensajes de clientes ni respuestas completas de proveedores.
- Los campos sensibles conocidos se eliminan mediante la configuracion de redaccion de Pino; el Collector aplica una defensa adicional.
- Se limitan tamano, profundidad y cantidad de campos para impedir fuga o agotamiento por datos no confiables.

La redaccion es allowlist y estructural; buscar palabras como `password` no sustituye clasificar datos. Un valor canario prueba que logs, trazas, errores y artefactos no lo contienen.

## Metricas

Las metricas usan convenciones semanticas OpenTelemetry y nombres, unidades y labels compatibles con Prometheus.

Se instrumentan como minimo:

- tasa, errores y duracion de HTTP, WebSocket, SSE y dependencias externas;
- pool, latencia y errores de PostgreSQL y Redis;
- event loop, memoria, CPU, reinicios y uso de disco;
- profundidad y antiguedad del elemento mas viejo de cada cola;
- trabajos iniciados, completados, fallidos, reintentados y agotados;
- outbox e inbox pendientes, duplicados y latencia de publicacion;
- webhooks, agentes y proveedores por tipo de resultado;
- despliegues, backups, certificados y estado del Collector.

Labels permitidos son conjuntos pequenos y controlados como servicio, entorno, modulo, operacion, ruta templada, metodo, estado agrupado, tipo de dependencia y codigo de error acotado.

No se usan como labels `tenant_id`, `user_id`, `contact_id`, `conversation_id`, `job_id`, `operation_id`, URLs crudas, nombres, correos ni valores aportados por usuarios. La salud individual de perfiles se conserva como estado observado en la plataforma; para investigar se filtran logs o trazas autorizados.

Las trazas no sirven para contar solicitudes ni calcular disponibilidad exacta porque pueden muestrearse. Esas mediciones proceden de contadores e histogramas.

## Trazas y muestreo

- Se crean spans para HTTP, mensajeria, base de datos, proveedores, herramientas de agentes, trabajos y pasos de despliegue significativos.
- Los nombres usan rutas o operaciones templadas; nunca contienen IDs, queries, prompts o texto comercial.
- Los atributos siguen convenciones OpenTelemetry y una allowlist propia para `qcrm.*`.
- Staging conserva inicialmente el 100 % para validar recorridos.
- Produccion declara una tasa parent-based por entorno basada en volumen, presupuesto y capacidad medidos; no existe un valor oculto en codigo.
- Durante el piloto puede conservarse el 100 % mientras las cuotas y mediciones lo permitan.
- Errores y metricas permanecen visibles aunque una traza no haya sido muestreada.
- Tail sampling se difiere hasta que su beneficio justifique memoria y operacion adicionales.

La auto-instrumentacion del navegador se difiere porque OpenTelemetry JavaScript la mantiene experimental. Next.js servidor, BFF y APIs si quedan instrumentados; ADR-0014 decide la captura segura en cliente.

## Catalogo y tratamiento de errores

Cada modulo declara errores esperados como uniones discriminadas TypeScript. El catalogo contractual conserva:

- `code` publico estable en `snake_case`;
- `kind`: `validation`, `authentication`, `authorization`, `not_found`, `conflict`, `rate_limit`, `transient_dependency`, `permanent_dependency`, `invariant` o `unexpected`;
- estado HTTP o resultado asincrono aplicable;
- si es seguro mostrar detalle;
- si puede reintentarse y bajo que condicion;
- propietario y severidad operativa.

Las fronteras traducen el resultado a RFC 9457, resultado de trabajo o evento fallido. No se selecciona comportamiento comparando mensajes humanos.

| Clase | Tratamiento |
|---|---|
| Esperado por entrada o estado comercial | Resultado tipado, respuesta segura y sin stack |
| Autorizacion o aislamiento | Denegar, auditar cuando corresponda y no revelar existencia |
| Dependencia transitoria | Timeout, posible reintento acotado y estado visible |
| Dependencia permanente o configuracion | No reintentar; degradar o impedir readiness segun criticidad |
| Invariante o defecto inesperado | Registrar una vez, marcar error, alertar segun impacto y no ocultar |

Los errores inesperados expuestos por HTTP usan un `code` generico seguro y `correlationId`; la causa interna no cruza la frontera.

## Timeouts, reintentos y degradacion

- Toda llamada de red, espera de cola y operacion potencialmente larga tiene deadline y cancelacion.
- El timeout de cada intento cabe dentro del presupuesto total de la operacion.
- Solo se reintenta un fallo explicitamente transitorio y un efecto idempotente o deduplicado.
- Se usa backoff exponencial con jitter, maximo de intentos y tiempo total.
- La capa propietaria coordina reintentos; se evita multiplicarlos en HTTP, SDK, worker y proveedor simultaneamente.
- Se respeta `Retry-After` dentro del presupuesto y limites del sistema.
- Circuit breakers y bulkheads viven en adaptadores externos, tienen estados observables y no se agregan sin una dependencia y umbral concretos.
- Una funcionalidad opcional puede degradarse con estado visible; no se inventa una respuesta exitosa ni se confirma un efecto no observado.
- Los trabajos agotados llegan a un destino de fallo consultable y recuperable; ADR-0011 detalla su maquina de estados.

## Liveness, readiness y cierre

Cada proceso expone en red interna:

- `/health/live`: confirma que el proceso y event loop responden; no consulta dependencias.
- `/health/ready`: confirma configuracion, schema y dependencias indispensables para aceptar trabajo.
- `/health/startup`: protege una inicializacion prolongada cuando sea necesaria.

Cada aplicacion declara cuales dependencias son indispensables. Un proveedor opcional no vuelve indisponible todo el CRM; su degradacion aparece por separado. Las respuestas publicas contienen solo estado agregado; versiones, causas y dependencias requieren autorizacion operativa.

Ante `SIGTERM`, el proceso deja de estar ready, deja de aceptar trabajo, drena dentro de un plazo, cierra exportadores y termina. Ante una excepcion no capturada o rechazo no manejado registra de forma segura, deja de estar ready y termina con error; no intenta continuar en estado desconocido. Docker aplica una politica de reinicio acotada y observable.

## Alertas y objetivos

Los SLI iniciales son disponibilidad, tasa de exito, latencia, antiguedad de colas y exito de operaciones durables. Los valores SLO no se inventan: se registran antes de comprometer servicio usando datos de staging y piloto.

Cada alerta declara señal, consulta, umbral, duracion, severidad, propietario, destino, dashboard y runbook. Se agrupa y deduplica. Una alerta de pagina exige impacto o riesgo inmediato y una accion concreta; el resto crea advertencia o trabajo planificado.

Cobertura minima:

- error rate o latencia sostenida con impacto;
- proceso no ready o reinicios repetidos;
- cola sin progreso o elemento demasiado antiguo;
- worker, backup o despliegue detenido;
- disco, memoria o CPU cerca del limite;
- certificado proximo a vencer;
- Collector, exportador o backend descartando telemetria.

No se crea una alerta por cada excepcion ni por cada fluctuacion breve.

## Retencion y fallo de la telemetria

- Retencion, sampling y cuotas se definen por entorno despues de medir tasa y capacidad.
- Docker rota logs locales aunque exista exportacion.
- El Collector usa memory limiter, lotes, colas de envio limitadas y reintentos acotados.
- Si el backend es remoto, una cola persistente puede habilitarse con una cuota de disco medida.
- Si se llena una cola, se descarta telemetria y se incrementan metricas internas antes de poner en riesgo la aplicacion.
- La exportacion ocurre fuera de la ruta critica y una caida del Collector no falla una operacion comercial.
- La auditoria, outbox, inbox, estados de despliegue y resultados de trabajos son datos durables de negocio u operacion; no dependen de retencion de logs ni de muestreo.
- Un backend alojado en el mismo VPS no es evidencia disponible ante perdida total del servidor. [ADR-0015](ADR-0015-respaldo-restauracion-continuidad.md) define continuidad y copia externa necesaria.

## Perfil de backend

El perfil autocontenido de referencia usa:

- Prometheus para metricas y reglas;
- Loki para logs;
- Tempo para trazas;
- Grafana para consulta y dashboards;
- Alertmanager para enrutamiento y deduplicacion.

No se despliega por defecto hasta completar el inventario del VPS. La seleccion entre este perfil y un backend administrado registra costo, residencia de datos, autenticacion, retencion, limites, salida de datos y procedimiento de exportacion. Ambos deben aceptar protocolos abiertos desde el Collector.

## Alternativas consideradas

### Solo logs de texto y `docker logs`

Se rechaza porque no permite correlacion fiable, metricas, alertas ni consultas consistentes entre procesos.

### SDK propietario en cada aplicacion

Se rechaza porque acopla casos de uso, configuracion y contratos a un proveedor. Un exporter del Collector puede integrarlo sin contaminar la aplicacion.

### OpenTelemetry Logs SDK directamente

Se difiere mientras el componente JavaScript siga en desarrollo. Pino proporciona JSON, child loggers y redaccion con una frontera madura.

### Sentry como unica fuente

Se rechaza como solucion completa porque seguimiento de excepciones no sustituye metricas, colas, capacidad, despliegues ni trazas operativas. Puede conectarse despues como destino adicional.

### Instalar siempre todo el stack Grafana en el VPS

Se rechaza antes de medir recursos. Competir por RAM, CPU o disco con el CRM puede convertir la observabilidad en causa de la indisponibilidad.

### Usar logs como auditoria

Se rechaza porque los logs se muestrean, rotan y pueden descartarse. La auditoria conserva almacenamiento, permisos e integridad propios.

### Continuar despues de una excepcion no capturada

Se rechaza porque el proceso puede quedar en un estado desconocido. Se registra el fallo y un supervisor externo reinicia.

### Etiquetar metricas por perfil o usuario

Se rechaza por cardinalidad, costo y riesgo de exposicion. El estado por perfil se consulta en la plataforma y la investigacion usa señales correlacionadas.

### Reintentar cualquier error

Se rechaza porque agrava sobrecarga y puede duplicar pagos, mensajes, reservas o despliegues.

## Consecuencias positivas

- Un recorrido puede seguirse entre solicitudes, eventos, trabajos, proveedores y despliegues.
- El dominio no depende del proveedor de observabilidad.
- La cardinalidad y los datos sensibles tienen limites verificables.
- Los fallos esperados, transitorios y defectos reciben tratamientos distintos.
- La aplicacion conserva disponibilidad aunque el backend de telemetria falle.

## Costos y riesgos

- Instrumentacion, Collector, dashboards, alertas y runbooks requieren mantenimiento.
- Una redaccion incompleta puede filtrar datos; se mitiga con allowlists, pruebas canario y defensa en profundidad.
- El muestreo puede ocultar una traza individual; logs de error y metricas completas conservan deteccion.
- El backend local comparte el dominio de fallo del VPS y consume recursos.
- La independencia de proveedor exige limitarse a protocolos y atributos portables o documentar extensiones.

## Validacion

La decision se considera aplicada cuando:

- Una solicitud produce log, metrica y traza correlacionables sin que el dominio importe telemetria.
- Un evento y un trabajo conservan correlacion y causacion despues de reiniciar el worker.
- Un valor canario no aparece en ninguna señal, reporte o respuesta.
- Rutas e IDs dinamicos no crean nombres de span ni labels de alta cardinalidad.
- Un error esperado genera RFC 9457 seguro sin stack ni alerta falsa.
- Un timeout transitorio se reintenta dentro del presupuesto y un error permanente no se reintenta.
- La misma solicitud repetida no duplica el efecto por causa de un reintento.
- Liveness permanece saludable ante una dependencia opcional caida y readiness refleja dependencias indispensables.
- Una excepcion no capturada termina el proceso y Docker lo reinicia sin marcar exito falso.
- La caida o saturacion del Collector no bloquea una operacion y hace visible la perdida de telemetria.
- Dos perfiles pueden investigarse por separado sin convertirse en labels de metricas.
- Una alerta sintetica llega al destino correcto, se deduplica y enlaza su runbook.
- La retencion y el consumo real permanecen dentro del presupuesto medido.

## Referencias

- [OpenTelemetry JavaScript: estado de trazas, metricas y logs](https://opentelemetry.io/docs/languages/js/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- [OpenTelemetry Collector: resiliencia](https://opentelemetry.io/docs/collector/resiliency/)
- [OpenTelemetry: convenciones semanticas](https://opentelemetry.io/docs/specs/semconv/)
- [OpenTelemetry: seguridad](https://opentelemetry.io/docs/security/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Prometheus: nombres y labels](https://prometheus.io/docs/practices/naming/)
- [Prometheus: alertas](https://prometheus.io/docs/practices/alerting/)
- [Node.js: errores no capturados del proceso](https://nodejs.org/api/process.html)
- [Pino: API y redaccion](https://github.com/pinojs/pino/blob/main/docs/api.md)

Se revisa esta decision al seleccionar el backend productivo, agregar varios hosts o regiones, adoptar captura de navegador, necesitar tail sampling o establecer objetivos SLO contractuales.
