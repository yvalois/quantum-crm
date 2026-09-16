# ADR 0011 Trabajos asincronos y automatizaciones durables

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-017, BASE-03 a BASE-06, CON-03, CON-10, PIPE-13, TAR-04, TAR-15, TAR-16, CAL-08, CAL-09, CAL-18, FORM-17, DOC-33 y OPS-16

## Contexto

Quantum ejecuta eventos de dominio, automatizaciones configurables, esperas, recordatorios, webhooks, mensajes, agentes y operaciones masivas. Esos trabajos deben sobrevivir reinicios y perdida de Redis, respetar permisos y modo de atencion vigentes, y tolerar que un mensaje se entregue o procese mas de una vez.

ADR-0001 adopta Redis y BullMQ para distribuir trabajos, mientras ADR-0006 establece PostgreSQL como fuente de verdad, outbox e inbox durables y entrega al menos una vez. Falta definir como se coordinan esas piezas, como se versionan los flujos y que puede hacer un operador ante fallos sin duplicar efectos ni editar estado arbitrariamente.

## Decision

PostgreSQL conserva el estado autoritativo de cada operacion comercial asincrona. BullMQ distribuye y acelera trabajo, pero una entrada de Redis nunca es la unica copia de una intencion, espera o resultado comercial.

El modulo `automation` posee definiciones, revisiones, ejecuciones y pasos de automatizacion. Cada modulo propietario conserva sus operaciones y valida de nuevo permisos e invariantes cuando recibe un comando. El worker coordina infraestructura y llama casos de uso publicos; no contiene reglas comerciales paralelas.

La entrega es al menos una vez. No se promete ejecucion exactamente una vez: inbox, claves idempotentes, restricciones unicas, estados condicionales y conciliacion hacen seguros los reintentos.

## Responsabilidades de PostgreSQL y BullMQ

### PostgreSQL

Conserva como minimo:

- outbox e inbox;
- definiciones y revisiones inmutables de automatizacion;
- ejecucion, paso actual y resultados permitidos;
- intentos, errores clasificados y proximo intento;
- esperas mediante `next_run_at`;
- lease autoritativo y version de concurrencia;
- solicitudes de pausa, cancelacion y reanudacion;
- claves de idempotencia y referencias a efectos externos;
- auditoria y resultado final.

### BullMQ y Redis

Se usan para:

- notificar que existe trabajo reclamable;
- distribuir trabajos entre procesos worker;
- aplicar concurrencia, prioridad y rate limit operativos;
- acelerar trabajos demorados y reintentos;
- exponer senales operativas de profundidad, antiguedad y fallos.

El payload de cola contiene identificadores, tipo y version contractual, perfil, correlacion y causacion. No contiene secretos ni snapshots comerciales completos. El worker vuelve a cargar desde PostgreSQL el estado vigente y el contexto autorizado antes de actuar.

Perder o vaciar Redis puede degradar y retrasar el procesamiento, pero un reconciliador debe reconstruir las notificaciones desde outbox, ejecuciones reclamables y esperas vencidas en PostgreSQL.

Los Job Schedulers, delayed jobs, deduplicacion y flows de BullMQ no son la autoridad de un calendario o flujo comercial. Pueden optimizar el despertar de trabajo, pero su estado se deriva de registros durables.

## Modelo de ejecucion

Cada definicion editable publica una revision inmutable. Una ejecucion fija `definition_id` y `revision_id` al comenzar; editar o pausar la definicion no reescribe silenciosamente ejecuciones anteriores.

Estados minimos de una ejecucion:

```text
pending -> running -> succeeded
              |  |
              |  +-> waiting -> pending
              +----> failed -> pending por reintento manual autorizado
              +----> paused -> pending

pending | running | waiting | paused -> cancelled al alcanzar un checkpoint seguro
```

- `pending`: lista para reclamar o pendiente de una notificacion de cola.
- `running`: un worker posee un lease vigente.
- `waiting`: conserva una condicion o `next_run_at` durable.
- `paused`: requiere una reanudacion autorizada o que se resuelva una condicion registrada.
- `succeeded`: todos los pasos requeridos terminaron con resultado persistido.
- `failed`: no quedan intentos automaticos o existe un fallo permanente.
- `cancelled`: se impide comenzar trabajo futuro; los efectos ya confirmados no se deshacen implicitamente.

Cada paso registra tipo, version, entrada referenciada, estado, intento, resultado permitido y timestamps. Los datos sensibles permanecen en el modulo propietario; la ejecucion guarda referencias o snapshots minimos cuando se necesita reproducibilidad.

Las transiciones usan version optimista o actualizacion condicional. Ningun estado se decide a partir de eventos efimeros de BullMQ sin confirmarlo en PostgreSQL.

## Publicacion, reclamacion y leases

1. El caso de uso confirma el cambio comercial y su evento de outbox en una transaccion.
2. El publicador reclama outbox con `FOR UPDATE SKIP LOCKED` y lease recuperable.
3. Publica un trabajo con identificador determinista o deduplicacion operativa.
4. El consumidor registra inbox o reclama la ejecucion mediante una actualizacion condicional.
5. El worker renueva el lease mientras progresa y persiste checkpoints entre pasos.
6. Al terminar persiste el resultado antes de reconocer el trabajo cuando el mecanismo lo permita.

El lease de PostgreSQL es la autoridad para ejecuciones comerciales. El lock de BullMQ evita concurrencia normal en la cola, pero no sustituye idempotencia ni impide que un trabajo detenido vuelva a procesarse.

Un lease contiene propietario tecnico, inicio, vencimiento y version. Al expirar, otro worker puede reclamar la ejecucion desde el ultimo checkpoint confirmado. Un worker que perdio el lease no puede publicar un resultado posterior.

El tiempo de lease y su renovacion se configuran por clase de trabajo con limites. No se aumenta indefinidamente para ocultar bloqueo del event loop o trabajos sin checkpoints.

## Orden, concurrencia y prioridades

- Los pasos de una misma ejecucion se procesan de forma serial salvo paralelismo explicitamente modelado y reunido.
- Una conversacion conserva orden mediante su version, secuencia y mecanismo de exclusion aprobado; una cola FIFO por si sola no protege la invariante.
- Reservas, inventario, pagos y documentos usan constraints y actualizaciones condicionales del modulo propietario.
- Las prioridades pertenecen a una lista pequena y estable, no a numeros elegidos libremente por clientes.
- Se separan clases operativas como interaccion inmediata, trabajo normal, programado y masivo cuando tengan SLO o limites diferentes.
- Cada perfil tiene limites de concurrencia, rate limit y presupuesto; un trabajo masivo no puede agotar los workers de interaccion.
- No se crea una cola por usuario, contacto o automatizacion.

El orden global no se promete. Solo se garantiza el orden que una invariante identifica mediante agregado, conversacion, ejecucion o clave de particion.

## Esperas y programacion

Una espera comercial registra en PostgreSQL:

- instante siguiente en UTC y zona horaria de origen cuando sea relevante;
- condicion de reanudacion;
- revision del flujo;
- estado y version de la ejecucion;
- politica ante horario no laborable, cambio de zona o retraso;
- eventos que pueden cancelarla.

Un planificador reclama filas vencidas por lotes y crea o reactiva el trabajo de forma idempotente. Un delayed job puede reducir polling, pero el reconciliador vuelve a encolar cualquier espera vencida que no tenga progreso confirmado.

Los calendarios recurrentes calculan y guardan la siguiente ocurrencia. No dependen exclusivamente de cron en memoria ni de una entrada repetible de Redis. El cambio de una regla recurrente crea una nueva revision y define explicitamente que ocurre con instancias futuras ya programadas.

## Reintentos y clasificacion de errores

Cada tipo de trabajo declara:

- timeout por intento y deadline total;
- numero maximo de intentos;
- backoff exponencial con jitter y tope;
- codigos transitorios y permanentes;
- requisito de idempotencia o conciliacion;
- estado de agotamiento y procedimiento de recuperacion.

Se reintentan fallos transitorios como timeout, limitacion temporal o indisponibilidad. No se reintentan automaticamente validaciones, permisos denegados, configuracion ausente, contrato incompatible ni invariantes comerciales fallidas.

Solo una capa es propietaria del reintento. Un adaptador no multiplica intentos ocultos dentro de un job que BullMQ tambien reintenta. `Retry-After` se respeta solo dentro del presupuesto total.

Cuando el resultado externo es desconocido, el sistema consulta o concilia antes de repetir una operacion que pueda cobrar, reservar, enviar o emitir. Agotar intentos deja un fallo visible y durable; no elimina el trabajo ni confirma exito.

## Idempotencia y efectos externos

- Inbox usa una clave unica de consumidor, fuente e ID de mensaje.
- Cada ejecucion y paso tiene un identificador estable independiente del `job_id` de BullMQ.
- Un comando critico usa una clave idempotente derivada de la intencion, no del numero de intento.
- El adaptador envia la misma clave al proveedor cuando este la soporte.
- El resultado externo y su identificador se persisten antes de avanzar al siguiente paso.
- Si el proveedor no ofrece idempotencia, se usa consulta, conciliacion, constraint o estado intermedio que impida confirmar dos veces.
- Deduplicar la notificacion en BullMQ optimiza; no acredita que el efecto comercial sea unico.

## Pausa, cancelacion y toma humana

Pausar una definicion impide nuevas ejecuciones, pero no cambia por si solo las ya activas. Pausar una ejecucion evita reclamar el siguiente paso despues del checkpoint actual.

La cancelacion es cooperativa:

- registra solicitud, actor, motivo y timestamp;
- se verifica antes de cada paso y efecto externo;
- no interrumpe una transaccion en un punto inseguro;
- no afirma deshacer efectos ya confirmados;
- termina como `cancelled` solo al alcanzar un punto seguro.

La toma humana en conversaciones invalida o bloquea respuestas y seguimientos pendientes conforme a BASE-03 y TAR-16. Justo antes de enviar, el worker vuelve a comprobar modo de atencion, revision y permiso; un estado observado al encolar no autoriza un envio posterior.

## Compensacion

No existe rollback generico de automatizaciones. Una compensacion es un comando comercial explicito, autorizado e idempotente, por ejemplo liberar una reserva o anular una operacion cuando el dominio lo permita.

- Cada paso declara si posee compensacion y sus precondiciones.
- Compensar no borra auditoria ni el resultado original.
- Pagos, facturas, mensajes y efectos legales siguen sus reglas propias.
- Una compensacion destructiva o ambigua requiere intervencion humana.
- El fallo de compensacion queda en un estado visible con runbook; no inicia un bucle infinito.

## Operacion manual

La interfaz operativa permite acciones tipadas:

- pausar o reanudar una definicion;
- pausar, cancelar o reanudar una ejecucion cuando su estado lo admita;
- reintentar desde el ultimo checkpoint seguro;
- conciliar un resultado externo desconocido;
- omitir o compensar un paso solo cuando el contrato de ese tipo lo permita;
- inspeccionar historial saneado, intentos y correlacion.

No permite editar payloads persistidos, cambiar el perfil, saltar permisos, marcar exito sin evidencia ni ejecutar codigo arbitrario. Toda accion manual exige permiso, motivo, version esperada y auditoria.

## Compatibilidad y despliegues

Los nombres de jobs, eventos y payloads son contratos versionados. Durante un despliegue pueden coexistir producers y workers de releases compatibles.

- Un worker rechaza de forma segura una version que no entiende.
- La release declara las versiones de trabajos que puede producir y consumir.
- Los cambios incompatibles publican una version nueva y conservan consumidores antiguos hasta vaciar o migrar trabajo pendiente.
- Un despliegue no retira un worker mientras existan trabajos que solo esa version pueda procesar.
- Backfills, migraciones y conversiones de payload guardan progreso y son reanudables.

## Observabilidad y retencion

Cada intento propaga `tenant_id`, `correlation_id`, `causation_id`, `execution_id`, `step_id` y `job_id` segun ADR-0010. Esos IDs se permiten en logs y trazas controlados, pero no como labels de metricas.

Se miden por cola o clase acotada:

- profundidad y antiguedad del trabajo pendiente;
- ejecuciones por estado;
- duracion e intentos;
- leases vencidos y trabajos detenidos;
- reintentos agotados;
- retraso del outbox, inbox y planificador;
- conciliaciones y compensaciones pendientes.

Los registros de BullMQ tienen retencion limitada. Limpiarlos no elimina la ejecucion durable ni su auditoria. La retencion comercial, de idempotencia y de diagnostico se define por tipo de dato y requisito legal, no por `removeOnComplete`.

## Alternativas consideradas

### BullMQ como motor y fuente unica

Se rechaza porque Redis no debe conservar la unica copia de esperas, ejecuciones o resultados comerciales. Tambien acoplaria versionado, auditoria y recuperacion del negocio a estados internos de la cola.

### PostgreSQL sin BullMQ

Se rechaza inicialmente porque polling y coordinacion de toda la carga en PostgreSQL aumentarian contencion y desperdiciarian la distribucion, prioridades y rate limiting del stack aprobado. PostgreSQL permanece como autoridad y puede recuperar la cola.

### Temporal, Restate u otro motor externo

Se difiere porque agrega otro plano operativo, persistencia, despliegue y modelo de programacion antes de medir la complejidad real. Se reconsidera si los flujos necesitan historial masivo, senales, timers de larga duracion o compensaciones que el modelo adoptado no pueda operar con seguridad.

### Ejecucion exactamente una vez

Se rechaza como promesa. Caidas entre un efecto externo y su confirmacion producen incertidumbre. La arquitectura usa al menos una vez, idempotencia, conciliacion y evidencia durable.

### Flujos completos mediante BullMQ FlowProducer

Se rechaza como autoridad comercial. Puede usarse internamente para un conjunto acotado de tareas tecnicas, pero las dependencias, pasos y resultados del CRM permanecen en PostgreSQL.

## Consecuencias positivas

- La perdida de Redis no elimina intenciones ni esperas comerciales.
- Reinicios y trabajos duplicados convergen sin repetir efectos conocidos.
- Las automatizaciones pueden auditarse, pausarse y reanudarse por revision.
- Los proveedores lentos o ambiguos se concilian antes de repetir operaciones criticas.
- Los perfiles comparten el motor sin compartir credenciales, estado ni presupuesto.

## Costos y riesgos

- Se mantienen estado durable y notificacion de cola, por lo que se necesita reconciliacion.
- Las maquinas de estado, leases y checkpoints aumentan el trabajo de implementacion y prueba.
- La idempotencia depende tambien de cada modulo y proveedor, no solo del motor.
- Una politica incorrecta de concurrencia puede retrasar interacciones o agotar recursos.
- La operacion manual requiere interfaz, permisos, auditoria y runbooks especificos.

## Validacion

La decision se considera aplicada cuando:

- una ejecucion sobrevive al reinicio del worker;
- vaciar Redis permite reconstruir trabajo pendiente desde PostgreSQL sin perder ni duplicar efectos;
- dos workers no completan simultaneamente la misma revision de un paso;
- un lease vencido permite continuar desde el ultimo checkpoint y rechaza el resultado tardio del propietario anterior;
- repetir un evento, job o callback no duplica mensajes, tareas, reservas, pagos ni movimientos;
- un timeout externo con resultado desconocido exige conciliacion antes de repetir;
- editar una automatizacion no cambia una ejecucion fijada a una revision anterior;
- pausa, cancelacion y toma humana impiden iniciar el siguiente efecto en un punto seguro;
- un fallo permanente no consume reintentos inutiles y uno transitorio usa backoff con jitter;
- un perfil con carga masiva no impide atender trabajo interactivo de otro perfil;
- un worker antiguo y uno nuevo procesan solo versiones compatibles durante una promocion;
- metricas, logs, trazas y auditoria permiten explicar cada intento sin exponer datos sensibles.

## Referencias

- [BullMQ: Stalled Jobs](https://docs.bullmq.io/guide/workers/stalled-jobs)
- [BullMQ: Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [BullMQ: Deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
- [BullMQ: Job Schedulers](https://docs.bullmq.io/guide/job-schedulers/)
- [NestJS: Queues](https://docs.nestjs.com/techniques/queues)

Se revisa esta decision si el volumen exige separar workers, Redis deja de cumplir la disponibilidad requerida, se adopta otro backend de cola o los flujos de larga duracion justifican un motor durable especializado.
