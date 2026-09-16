# Observabilidad y manejo de fallos

Estas reglas aplican a aplicaciones, jobs, eventos, integraciones y operacion. Desarrollan [ADR-0010](../06-decisiones/ADR-0010-observabilidad-manejo-fallos.md).

## Instrumentacion

- Usar `packages/observability` para configurar Pino, OpenTelemetry, propagacion y redaccion.
- No importar logging, metricas, tracing ni SDKs de proveedores dentro del dominio.
- Iniciar la instrumentacion antes de cargar NestJS, Next.js o clientes instrumentados.
- Identificar cada proceso mediante servicio, version, entorno e instancia.
- Propagar W3C Trace Context y los IDs contractuales a traves de HTTP, eventos y trabajos.
- No confiar en `traceparent`, `tracestate`, baggage o `correlation_id` para identidad, perfil o autorizacion.

## Logs

- Emitir una linea JSON por evento con campos estables y nivel correcto.
- Usar mensajes constantes y campos estructurados; no interpolar objetos o contenido de usuarios en el mensaje.
- Registrar un error una sola vez en la frontera que decide su resultado.
- Incluir correlacion, servicio, release, modulo, operacion y codigo de error cuando apliquen.
- No registrar bodies, headers completos, cookies, tokens, firmas, SQL con valores, archivos, prompts, mensajes o respuestas completas de proveedores.
- Aplicar allowlist, redaccion y limites de profundidad, campos y tamano.
- Probar la redaccion con valores canario.
- Habilitar detalle diagnostico en produccion solo con alcance, duracion, responsable y auditoria.

## Metricas y trazas

- Usar rutas y operaciones templadas; nunca IDs ni URLs crudas en nombres de spans o labels.
- Mantener labels en conjuntos pequenos y controlados.
- No usar perfiles, usuarios, contactos, conversaciones, jobs u operaciones como labels de metricas.
- Medir tasa, errores y duracion en fronteras sin duplicar la misma metrica en cada capa.
- Medir profundidad y antiguedad de colas, no solo cantidad de fallos.
- No calcular volumen exacto ni disponibilidad a partir de trazas muestreadas.
- Declarar la tasa de muestreo por entorno y cambiarla con evidencia de volumen y costo.
- No agregar atributos que no tengan una consulta, dashboard, alerta o diagnostico justificado.

## Errores

- Modelar resultados esperados como uniones discriminadas TypeScript.
- Reservar excepciones para infraestructura o fallos inesperados que no pudieron traducirse.
- Declarar cada codigo estable, clase, respuesta segura, retryability y propietario.
- No comparar mensajes humanos para decidir estados HTTP, reintentos o alertas.
- Traducir errores HTTP a RFC 9457 y devolver `correlationId` sin causa interna.
- No tratar validaciones, conflictos o recursos ausentes esperados como defectos del sistema.
- No ocultar una violacion de invariante tras un resultado exitoso o un `catch` vacio.

## Timeouts y reintentos

- Dar timeout y cancelacion a toda llamada externa o espera potencialmente indefinida.
- Mantener cada intento dentro del deadline total.
- Reintentar solo fallos transitorios y operaciones idempotentes o deduplicadas.
- Usar backoff exponencial con jitter, limite de intentos y limite temporal.
- Elegir una capa propietaria del reintento y evitar multiplicarlo en varias capas.
- Respetar `Retry-After` solo si cabe dentro del presupuesto.
- Hacer visible el agotamiento de reintentos y permitir recuperacion operativa.
- No confirmar un efecto externo hasta observar o conciliar su resultado.

## Salud y proceso

- Separar liveness, readiness y startup.
- Liveness no consulta base, Redis ni proveedores.
- Readiness comprueba solo dependencias indispensables declaradas por el proceso.
- No exponer detalles internos mediante un health check publico.
- Ante `SIGTERM`, retirar readiness, dejar de aceptar trabajo, drenar con plazo y cerrar recursos.
- Ante excepcion no capturada o rechazo no manejado, registrar de forma segura y terminar con error.
- No continuar un proceso que puede estar en estado desconocido.

## Alertas y operacion

- Alertar sobre sintomas accionables, impacto, saturacion y perdida de telemetria.
- Cada alerta tiene propietario, severidad, ventana, destino, dashboard y runbook.
- Una pagina exige accion inmediata; fluctuaciones o diagnosticos generan advertencia o tarea.
- Agrupar y deduplicar para evitar una notificacion por excepcion.
- Probar la ruta de alertas con una señal sintetica antes de depender de ella.
- No declarar un SLO sin fuente, ventana, objetivo y responsable aprobados.

## Telemetria y auditoria

- La exportacion de telemetria no forma parte de la transaccion comercial.
- Limitar memoria, disco, colas y reintentos del Collector; preferir perdida visible de telemetria a agotar la aplicacion.
- Monitorizar el Collector y sus descartes.
- Mantener auditoria, outbox, inbox, operaciones y resultados durables fuera de logs y trazas.
- Rotar logs locales y aplicar retencion y cuotas al backend.

## Evidencia minima

Un cambio que agrega una frontera o dependencia demuestra correlacion, campos permitidos, redaccion, metricas acotadas, timeout, clasificacion de errores y comportamiento de reintento. Un cambio operativo agrega dashboard, alerta o runbook cuando introduce una nueva condicion que requiera intervencion.
