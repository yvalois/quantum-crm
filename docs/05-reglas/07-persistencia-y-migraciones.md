# Persistencia y migraciones

Estas reglas aplican a PostgreSQL, Prisma, SQL, transacciones, eventos duraderos y cambios de datos. La decision completa vive en `../06-decisiones/ADR-0006-persistencia-transacciones-migraciones.md`.

## Esquema y repositorios

- Mantener propiedad de tablas y schemas por modulo.
- Acceder a Prisma solo desde adaptadores de infraestructura.
- Usar UUIDv7 para entidades expuestas y `bigint` solo para orden tecnico interno.
- Usar `timestamptz`, `numeric`, moneda y unidades explicitas; no usar floats para dinero.
- Usar JSONB solo cuando la estructura sea realmente dinamica.
- Proteger invariantes con tipos, `NOT NULL`, `UNIQUE`, `CHECK`, foreign keys o constraints de exclusion cuando corresponda.
- Revisar indices del lado que referencia cada foreign key.
- Prohibir SQL construido concatenando entrada; parametrizar cada valor.

## Transacciones y concurrencia

- Mantener transacciones breves y sin llamadas de red o proveedores.
- Compartir el contexto transaccional con repositorios; no iniciar transacciones ocultas.
- Usar version optimista, actualizacion condicional, constraint o lock de fila segun la invariante.
- Aplicar timeouts de consulta, locks y transacciones.
- Reintentar serializacion o deadlocks solo con limite, backoff y sin efectos externos previos.
- Insertar auditoria y outbox en la misma transaccion del cambio.

## Outbox, inbox e idempotencia

- Publicar efectos externos desde outbox despues del commit.
- Reclamar trabajos mediante lotes y leases recuperables.
- Registrar inbox antes de confirmar un evento consumido.
- Deducir repetidos con claves unicas y conservar resultado observable.
- Enviar eventos agotados a un estado de fallo visible y reanudable.
- Aplicar politicas de retencion sin eliminar trabajo pendiente o evidencia requerida.

## Migraciones

- Crear una migracion por cada cambio; no modificar produccion manualmente.
- Revisar el SQL generado por Prisma antes de integrarlo.
- No editar, renombrar ni borrar una migracion aplicada.
- Usar `migrate dev` solo en desarrollo y `migrate deploy` mediante el migrador controlado.
- No usar `db push` en pruebas compartidas, staging ni produccion.
- Separar cambios de schema de backfills.
- Usar expand-contract para renombres, cambios de tipo y eliminaciones.
- Crear indices grandes concurrentemente y declarar operaciones fuera de transaccion cuando lo requieran.
- Ejecutar un solo migrador por perfil con lock y registrar version inicial, final y resultado.
- No ejecutar migraciones desde el arranque normal de API o workers.

## Backfills y cambios destructivos

- Procesar por lotes con cursor y progreso persistente.
- Hacer cada lote idempotente y reanudable.
- Medir locks, WAL, duracion y capacidad con volumen representativo.
- Verificar conteos e invariantes antes de cambiar lectores o retirar columnas.
- Documentar respaldo, pausa de escrituras y recuperacion antes de una operacion destructiva.
- No presentar un rollback de aplicacion como restauracion de datos.

## Consultas y rendimiento

- Limitar y ordenar toda coleccion.
- Evitar N+1 y agregaciones masivas en memoria.
- Justificar indices mediante consultas o invariantes reales.
- Revisar planes con datos representativos y conservar evidencia cuando el riesgo lo requiera.
- Observar queries lentas, locks, vacuum, bloat, conexiones e indices sin uso.

## Evidencia minima

- Migracion aplicada sobre una base vacia y una base de la version anterior.
- Prueba de constraints e invariantes afectadas.
- Prueba concurrente cuando haya stock, reserva, saldo o version.
- Prueba de repeticion para outbox, inbox o idempotencia.
- Plan y resultado de backfill si existe.
- Compatibilidad demostrada entre versiones que puedan convivir.
