# Trabajos asincronos y automatizaciones

Estas reglas aplican a outbox, inbox, BullMQ, workers, automatizaciones, esperas, reintentos y efectos externos. Desarrollan [ADR-0011](../06-decisiones/ADR-0011-trabajos-asincronos-automatizaciones.md).

## Estado durable

- Guardar en PostgreSQL toda intencion, espera, ejecucion, checkpoint y resultado comercial que deba sobrevivir.
- Usar Redis y BullMQ para distribuir o acelerar; nunca como unica copia de una operacion comercial.
- Encolar identificadores y metadatos minimos; recargar estado, perfil y autorizacion vigentes antes de ejecutar.
- Fijar una revision inmutable de la definicion para cada ejecucion.
- Persistir el resultado antes de avanzar o reconocer trabajo cuando el protocolo lo permita.
- Reconstruir desde PostgreSQL las notificaciones perdidas o vencidas de Redis.

## Entrega e idempotencia

- Disenar todo consumidor para entrega al menos una vez.
- Usar inbox unico por consumidor, fuente e ID de mensaje.
- Mantener identificadores estables de ejecucion y paso; no usar `job_id` como clave comercial de idempotencia.
- Derivar la clave idempotente de la intencion y conservarla entre intentos.
- Revalidar invariantes en el modulo propietario; la deduplicacion de cola no demuestra unicidad comercial.
- Conciliar un resultado externo desconocido antes de repetir pagos, reservas, mensajes, emisiones o movimientos.

## Leases y concurrencia

- Reclamar trabajo durable mediante version o actualizacion condicional y lease con vencimiento.
- Renovar el lease solo mientras exista progreso y persistir checkpoints entre pasos.
- Rechazar el resultado de un worker que perdio el lease.
- Serializar cada ejecucion salvo paralelismo modelado explicitamente.
- Proteger el orden con versiones, secuencias, locks o constraints del dominio; no confiar solo en FIFO.
- Aplicar concurrencia y rate limit por perfil y clase de trabajo.
- No crear colas por usuario, contacto o automatizacion.

## Esperas y programacion

- Guardar `next_run_at`, zona horaria relevante, condicion y revision en PostgreSQL.
- Usar delayed jobs o schedulers solo como aceleradores recuperables.
- Reconciliar periodicamente esperas vencidas y trabajos sin progreso.
- Calcular y persistir la siguiente ocurrencia de una regla recurrente.
- Definir que ocurre con instancias futuras cuando cambia una recurrencia.

## Reintentos

- Declarar timeout, deadline, intentos, backoff con jitter y codigos retryables por tipo de trabajo.
- Reintentar solo fallos transitorios y efectos idempotentes o conciliables.
- No reintentar automaticamente errores de validacion, permisos, configuracion o contrato incompatible.
- Elegir una sola capa propietaria del reintento.
- Hacer visible el agotamiento y conservar una recuperacion tipada.
- No marcar exito ni descartar trabajo cuando el resultado sea incierto.

## Pausa, cancelacion y compensacion

- Comprobar pausa, cancelacion, permiso y modo de atencion antes de cada efecto externo.
- Cancelar cooperativamente en checkpoints seguros; no afirmar que se deshicieron efectos confirmados.
- Modelar compensaciones como comandos comerciales autorizados e idempotentes.
- No ofrecer rollback generico de una automatizacion.
- Registrar actor, motivo, version y resultado de toda intervencion manual.
- No permitir editar payloads, cambiar perfil, saltar pasos incompatibles ni marcar exito sin evidencia.

## Compatibilidad y operacion

- Versionar nombres y payloads de jobs, eventos y callbacks.
- Declarar en la release que versiones produce y consume cada worker.
- Mantener consumidores compatibles mientras exista trabajo antiguo.
- Propagar correlacion, causacion, ejecucion y paso sin usar IDs como labels de metricas.
- Medir profundidad, antiguedad, leases vencidos, intentos agotados y retraso del planificador.
- Limpiar datos efimeros de BullMQ sin eliminar estado durable ni auditoria.

## Evidencia minima

Un cambio asincrono demuestra reinicio seguro, duplicado, lease vencido, reintento transitorio, fallo permanente, aislamiento por perfil y ausencia de doble efecto. Una automatizacion demuestra revision fijada, espera recuperable, pausa o cancelacion segura y trazabilidad de cada paso.
