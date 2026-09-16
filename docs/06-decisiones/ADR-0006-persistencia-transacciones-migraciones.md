# ADR 0006 Persistencia, transacciones y evolucion de datos

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: OPS-04, OPS-10, OPS-15, OPS-19, OPS-20, OPS-21 y todos los modulos persistentes

## Contexto

Quantum debe preservar contactos, mensajes, inventario, reservas, documentos, pagos y operaciones administrativas aun cuando existan concurrencia, reintentos, despliegues o fallos parciales. Cada cliente tiene una base PostgreSQL separada y cada modulo es propietario de sus tablas, pero falta precisar tipos, transacciones, eventos duraderos y evolucion del esquema.

Prisma simplifica el acceso habitual, aunque varias capacidades necesarias de PostgreSQL requieren SQL explicito. Las migraciones deben poder ejecutarse por perfil sin depender del arranque de aplicaciones y sin confundir rollback de codigo con restauracion de datos.

## Decision

PostgreSQL 18 es la fuente de verdad. Prisma 7 es la herramienta principal de acceso y migraciones; SQL parametrizado y revisado complementa a Prisma para consultas, constraints, indices, bloqueos y funciones que este no represente adecuadamente.

Las transacciones son cortas, los efectos externos ocurren despues del commit mediante outbox y las migraciones de produccion son forward-only, inmutables y compatibles mediante expand-contract.

## Organizacion y propiedad

- Cada base de cliente usa schemas PostgreSQL por modulo cuando sea viable.
- Cada tabla tiene un unico modulo propietario conforme a ADR-0002.
- La plataforma central utiliza otra base y otro historial de migraciones.
- Los modelos Prisma viven en infraestructura y no atraviesan contratos publicos.
- El rol de runtime solo accede a objetos necesarios para operar.
- El rol migrador es independiente y no se entrega a API ni workers.
- Se revocan privilegios heredados que permitan acceder a otras bases o schemas no autorizados.

Prisma 7 soporta multiples schemas PostgreSQL. Mover un modelo entre schemas se revisa como migracion destructiva y no se acepta automaticamente como eliminar y recrear.

## Convenciones de esquema

- Tablas, columnas, indices y constraints usan `snake_case`.
- Modelos y propiedades TypeScript usan `PascalCase` y `camelCase` mediante mapeos explicitos.
- Toda tabla persistente tiene clave primaria.
- Las entidades y agregados expuestos usan UUIDv7 generado por PostgreSQL 18.
- `bigint` se reserva para secuencias tecnicas, orden de outbox o tablas internas de gran volumen; no se expone como identificador comercial predecible.
- Fechas absolutas usan `timestamptz`; fechas civiles sin instante usan `date` y las horas locales requieren zona horaria asociada.
- Dinero usa `numeric` con precision y escala definidas por el dominio mas moneda ISO 4217 separada.
- Cantidades y porcentajes declaran precision, escala, unidad y redondeo.
- Texto general usa `text`; longitudes funcionales se validan y documentan.
- JSONB se limita a configuracion, snapshots o atributos dinamicos y no oculta relaciones ni campos consultados habitualmente.
- `null`, ausencia y valor vacio conservan significados diferentes y documentados.

Los estados configurables por clientes viven en tablas. No se usan enums rigidos de PostgreSQL para valores comerciales que deban crearse, renombrarse o retirarse.

## Integridad

Las invariantes se protegen en la base cuando PostgreSQL puede expresarlas mediante:

- `NOT NULL`.
- `UNIQUE`.
- `CHECK` sobre la fila.
- Foreign keys.
- Constraints de exclusion para rangos y reservas cuando apliquen.
- Indices unicos parciales para registros activos.
- Precision, escala y tipos correctos.

Las foreign keys no crean automaticamente indices en las columnas que referencian, por lo que cada relacion revisa su patron de consulta y borrado. No se crean cascadas de eliminacion entre modulos. Dentro de un agregado solo se permite `ON DELETE CASCADE` cuando el hijo no tiene ciclo de vida independiente ni retencion propia.

## Repositorios y SQL

- Los casos de uso dependen de puertos de repositorio.
- Prisma implementa operaciones comunes tipadas.
- SQL explicito usa parametros o tagged templates; queda prohibida la concatenacion de entrada externa.
- Toda consulta SQL identifica su modulo, motivo y pruebas.
- Reportes complejos agregan en PostgreSQL o en modelos de lectura; no cargan colecciones masivas para agregarlas en Node.js.
- Consultas de lectura no obtienen acceso de escritura por comodidad.
- Ninguna interfaz HTTP, WebSocket o worker accede directamente a Prisma fuera de un adaptador de infraestructura.

## Limites transaccionales

Una transaccion cubre un caso de uso cuyas escrituras deben confirmarse o fallar juntas:

```text
autorizacion
  -> iniciar transaccion
  -> comprobar version o adquirir bloqueo
  -> cambiar agregado
  -> registrar auditoria
  -> insertar outbox
  -> commit
```

Reglas obligatorias:

- No ejecutar HTTP, pagos, correo, S3, agentes ni otros proveedores dentro de una transaccion.
- Pasar el contexto transaccional a helpers y repositorios; no abrir transacciones independientes ocultas.
- No devolver iteradores o recursos que dependan de una transaccion ya cerrada.
- Configurar limites de consulta, espera de lock, inactividad y duracion transaccional.
- Registrar transacciones lentas sin incluir datos sensibles.

El nivel predeterminado es `READ COMMITTED`. `SERIALIZABLE` se usa solo cuando constraints, locks o actualizaciones condicionales no protegen la invariante. Deadlocks y fallos de serializacion admiten reintentos limitados con backoff y jitter solo si aun no ocurrio un efecto externo.

## Concurrencia

Se selecciona el mecanismo mas pequeno que proteja la invariante:

- Version numerica para concurrencia optimista en recursos editables.
- Actualizacion condicional para stock, cupos, saldos y transiciones.
- `SELECT ... FOR UPDATE` para coordinar filas existentes durante una transaccion breve.
- Constraint de exclusion para solapamientos temporales cuando el modelo lo permita.
- Advisory locks solo con clave, orden, timeout y alcance documentados cuando no exista una fila adecuada.

El `ETag` publico de ADR-0005 se deriva de la version persistida. Una version obsoleta no sobrescribe cambios ni se resuelve con ultimo escritor gana de forma silenciosa.

## Outbox

El cambio comercial y su evento se insertan en la misma transaccion. Cada registro de outbox contiene como minimo:

- ID tecnico ordenable.
- ID, tipo y version del evento.
- Modulo, agregado y version del agregado.
- `tenant_id`, `correlation_id` y `causation_id`.
- Payload validado y fecha de ocurrencia.
- Estado, intentos, proximo intento, lease y resultado de publicacion.

Los workers reclaman lotes con `FOR UPDATE SKIP LOCKED`, un lease recuperable y limites. `SKIP LOCKED` se usa para tablas de cola, no para lecturas comerciales generales. Publicar no elimina inmediatamente el evento: su retencion y limpieza son observables y configuradas.

## Inbox e idempotencia

Cada consumidor durable registra una clave unica de consumidor, fuente e ID de evento antes de confirmar el efecto. Una repeticion devuelve o conserva el resultado previo sin duplicar la operacion.

La entrega es al menos una vez. Restricciones unicas, inbox, claves idempotentes de API y reglas de dominio se complementan. Los mensajes agotados pasan a un estado de fallo visible con diagnostico seguro y posibilidad de reanudacion; no se descartan silenciosamente.

## Auditoria

La auditoria es append-only y se escribe en la misma transaccion que el cambio relevante. Registra:

- Actor y tipo de principal.
- Perfil, modulo, accion y recurso.
- Resultado, timestamp y correlacion.
- Valores anteriores y posteriores permitidos o diferencias seguras cuando sean necesarios.

No registra tokens, secretos, cuerpos sensibles completos ni archivos. No sustituye al estado comercial ni implementa event sourcing. Las correcciones se representan con una nueva entrada; no se edita el historial.

## Borrado y retencion

No se aplica soft delete universal.

- `deleted_at` se usa cuando exista restauracion, desactivacion o historial funcional.
- La unicidad de registros activos usa indices unicos parciales cuando corresponda.
- Pagos, facturas, aceptaciones y auditoria siguen su politica legal y comercial.
- Sesiones, idempotencia, inbox, outbox y datos temporales tienen trabajos de retencion controlados.
- La eliminacion de una persona sigue un workflow de exportacion, anonimización, retencion y borrado fisico autorizado.
- Desactivar o eliminar una raiz no borra silenciosamente datos regulatorios o propiedad de otro modulo.
- Los respaldos expiran por su politica; no se reescriben manualmente para aparentar borrado inmediato.

## Migraciones

- Todo cambio de esquema usa una migracion versionada.
- `prisma migrate dev` se limita a desarrollo.
- `prisma migrate deploy` se ejecuta en pruebas, staging y produccion mediante un migrador controlado.
- `prisma db push` se limita a prototipos locales descartables.
- La carpeta completa de migraciones se versiona en Git.
- Una migracion aplicada nunca se edita, renombra ni elimina.
- El SQL generado se inspecciona antes de integrar.
- SQL personalizado implementa indices concurrentes, constraints, funciones y otras capacidades no representadas.
- Schema y backfill de datos usan operaciones separadas.
- Cada migracion identifica el modulo, compatibilidad, locks esperados y reversibilidad.
- Un unico migrador adquiere un lock por perfil; API y workers no migran al arrancar.
- Una migracion fallida no actualiza el estado observado del perfil.

Las migraciones de produccion son forward-only. Una correccion usa una nueva migracion. Un archivo `down` puede ayudar en desarrollo, pero no autoriza perder datos ni reemplaza el procedimiento de recuperacion.

## Expand-contract

Los cambios incompatibles siguen fases separadas:

1. Expandir con estructuras compatibles.
2. Publicar codigo que tolere estructura anterior y nueva.
3. Ejecutar backfill reanudable por lotes.
4. Verificar conteos, checks e invariantes.
5. Cambiar lectores y dejar de escribir lo anterior.
6. Contraer en una release y migracion posteriores.

Los backfills guardan cursor y progreso, limitan lote y duracion y pueden detenerse sin reiniciar desde cero. Los indices grandes se crean concurrentemente cuando sea necesario. Los constraints costosos pueden agregarse y validarse en fases soportadas por PostgreSQL.

Una migracion destructiva declara si necesita pausa de escrituras, respaldo previo y ventana de compatibilidad. Rollback de aplicacion y restauracion de base son procedimientos distintos.

## Indices y rendimiento

- Todo listado tiene limite y orden determinista.
- Los indices nacen de consultas e invariantes conocidas, no de especulacion.
- Las columnas de igualdad preceden a rangos en indices compuestos cuando ese sea el patron real.
- Se consideran indices parciales, covering, GIN o BRIN solo con consulta y medicion justificadas.
- Se evita N+1 en caminos normales.
- Consultas sensibles se revisan con `EXPLAIN (ANALYZE, BUFFERS)` sobre datos representativos.
- `pg_stat_statements` registra tendencias de consultas.
- Se observan foreign keys sin indice, queries lentas, bloat, vacuum, locks y conexiones.
- Cada proceso y perfil tiene presupuesto de conexiones acorde con la capacidad medida.

## Datos iniciales

- Las semillas contienen catalogos tecnicos o configuracion inicial, no datos comerciales de ejemplo en produccion.
- Son idempotentes y no sobrescriben personalizaciones.
- Nuevas plantillas globales se publican como revisiones adoptables.
- Las pruebas crean datos sinteticos mediante factories y no copian produccion.

## Alternativas consideradas

### Usar solamente Prisma

Se rechaza porque no representa todas las constraints, locks, indices, migraciones y consultas avanzadas necesarias.

### Usar SQL manual para todo

Se rechaza porque perderia tipado, productividad y consistencia en operaciones comunes sin aportar valor a cada consulta.

### Event sourcing como fuente principal

Se rechaza inicialmente por el costo de reconstruccion, versionado y proyecciones. El outbox conserva integracion durable sin reemplazar el estado relacional.

### Ejecutar migraciones al arrancar

Se rechaza porque replicas y perfiles podrian competir, bloquearse o servir con un esquema parcialmente actualizado.

### Revertir migraciones destructivas con down

Se rechaza porque retirar schema no recupera los datos perdidos. Se avanza con otra migracion o se restaura mediante un procedimiento explicito.

### Soft delete para todas las tablas

Se rechaza porque complica unicidad, consultas y retencion aun cuando no existe necesidad funcional de restauracion.

## Consecuencias positivas

- Las invariantes criticas no dependen solo del codigo de aplicacion.
- Los reintentos y fallos parciales no pierden eventos ni duplican efectos conocidos.
- Los perfiles pueden migrarse y restaurarse por separado.
- Prisma conserva productividad mientras PostgreSQL mantiene sus capacidades nativas.
- Las releases pueden convivir durante cambios expand-contract.

## Costos y riesgos

- Outbox, inbox, auditoria e idempotencia agregan tablas y tareas de limpieza.
- Las migraciones por perfil requieren orquestacion y observabilidad.
- SQL explicito necesita revision y pruebas especializadas.
- La compatibilidad temporal puede duplicar lecturas o escrituras durante una migracion.
- Compartir motor PostgreSQL conserva riesgos de capacidad aunque las bases esten separadas.

## Validacion

La decision se considera aplicada cuando:

- Una base vacia se reconstruye desde todo el historial.
- Una base de la release anterior migra conservando datos.
- Dos perfiles se migran independientemente.
- Un cambio expand-contract permite convivencia entre versiones.
- Dos operaciones concurrentes no pierden actualizaciones ni rompen stock o reservas.
- Repetir un pago, mensaje o evento no duplica su efecto.
- Outbox e inbox se recuperan tras reiniciar workers.
- Un backfill grande se pausa y continua desde su progreso.
- Una migracion fallida no marca el perfil como actualizado.
- Auditoria y borrado cumplen sus politicas sin exponer secretos.
- Un restore aislado conserva referencias entre base y archivos.

## Referencias

- [PostgreSQL 18: funciones UUID](https://www.postgresql.org/docs/18/functions-uuid.html)
- [PostgreSQL 18: constraints](https://www.postgresql.org/docs/18/ddl-constraints.html)
- [Prisma ORM 7: multi-schema](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema)
- [Prisma ORM 7: historial de migraciones](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/migration-histories)
- [Prisma ORM 7: migrate deploy](https://www.prisma.io/docs/cli/v7/migrate/deploy)

Se revisa esta decision si el volumen exige particionado, replicas de lectura, otro almacen analitico o separacion de servicios con sus propias bases.
