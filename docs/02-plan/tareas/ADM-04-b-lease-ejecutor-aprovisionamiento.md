# ADM-04-b - Lease durable del ejecutor de aprovisionamiento

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-05`, `ADM-09`, `ADM-12`, `ADM-20`, `OPS-14`, `OPS-16`
- Fase del MVP: 2. Plataforma administrativa
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-04-a`
- Bloquea a: ejecucion reanudable de pasos y aprovisionamiento real del perfil
- ADR, arquitectura o diseno aplicables: ADR-0006, ADR-0009, ADR-0010 y ADR-0011

## Resultado esperado

El ejecutor puede conectarse con una identidad runtime a PostgreSQL de plataforma y reclamar como maximo una operacion pendiente mediante un lease durable y acotado. Dos replicas no obtienen la misma operacion; un lease vencido permite recuperacion y un propietario obsoleto no puede renovarlo.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y ficha anterior revisados.
- [x] Reglas de persistencia, CI/CD, observabilidad y trabajos asincronos revisadas.
- [x] ADR de persistencia, releases, fallos y leases revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `deploy-executor`, `provisioning_operations`, `lease`, `claim` y `SKIP LOCKED`.
- Codigo o documentacion encontrados: operacion durable pendiente, repositorio PostgreSQL compartido, proceso `deploy-executor` con health interno pero sin base de datos ni consumidor.
- Pruebas e historial encontrados: solicitud atomica e idempotente, migracion desde cero e integracion PostgreSQL de `ADM-04-a`.
- Decision de reutilizacion, extension o reemplazo: extender el agregado y el repositorio existentes; conectar el ejecutor a la base sin otorgarle acceso a Docker ni ejecutar efectos de host en esta rebanada.

## Alcance

### Incluido

- Campos de lease, propietario tecnico y vencimiento en la operacion durable.
- Reclamacion por orden estable con `FOR UPDATE SKIP LOCKED` y recuperacion de lease vencido.
- Renovacion con fencing por propietario, version y lease vigente.
- Conexion de `deploy-executor` a PostgreSQL de plataforma y readiness dependiente de la base.
- Pruebas unitarias, de arquitectura e integracion PostgreSQL.

### No incluido

- Ejecutar Docker, Compose, migraciones de perfiles, secretos, buckets, Caddy o Keycloak.
- Avanzar pasos sin comprobaciones reales de `ADM-05` y `ADM-09`.
- Marcar una operacion como exitosa o activar un perfil.
- Marcar `ADM-04` terminado.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `deploy-executor`, `platform-domain`, `database` |
| Contratos y eventos | Contrato interno de lease; sin cambio al API HTTP v1 |
| Datos y migraciones | Columnas aditivas de lease e indice de reclamacion |
| Permisos y aislamiento | Identidad runtime de plataforma, sin secretos de host ni socket Docker |
| Configuracion y secretos | `deploy-executor` recibe solo el archivo secreto de conexion a plataforma |
| Observabilidad y operacion | Readiness falla si PostgreSQL no esta disponible |
| Documentacion | Ficha, estado e inventario si se despliega |

## Plan de implementacion

- [x] Generalizar el agregado para estados y leases observados.
- [x] Agregar migracion forward-only e indice de reclamacion.
- [x] Implementar claim y renovacion con fencing.
- [x] Conectar `deploy-executor` a PostgreSQL y a readiness.
- [x] Verificar migracion, concurrencia, vencimiento y configuracion.
- [x] Registrar evidencia sin ejecutar efectos de host.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Dos ejecutores reclaman la misma operacion | `SKIP LOCKED` y actualizacion dentro de la misma sentencia | Integracion con reclamos concurrentes |
| Worker obsoleto escribe despues de perder el lease | Propietario, version y vigencia como fencing | Renovacion obsoleta devuelve conflicto |
| Operacion queda abandonada tras reinicio | Lease con vencimiento reclamable | Prueba de recuperacion |
| Executor obtiene privilegios prematuros | Solo URL runtime de plataforma; sin socket ni comandos | Manifiestos y prueba de arquitectura |

## Criterios de aceptacion

- [x] Un reclamo cambia `PENDING` a `RUNNING`, incrementa intento y fija lease.
- [x] Dos reclamos simultaneos no devuelven la misma operacion.
- [x] Una operacion con lease vencido puede ser reclamada por otro propietario.
- [x] Solo el propietario vigente con la version esperada puede renovar.
- [x] `deploy-executor` no queda ready sin PostgreSQL y no recibe acceso a Docker.

## Plan de verificacion

- Pruebas unitarias: hidratacion e invariantes de lease.
- Pruebas de integracion o contratos: claim concurrente, lease vencido y fencing en PostgreSQL 18 desechable.
- Pruebas E2E: no aplica hasta existir un paso con efecto real.
- Comprobacion manual: health del ejecutor y ausencia de socket Docker al desplegar.
- Seguridad, permisos y aislamiento: usuario runtime sin DDL y secreto por archivo exacto.
- Idempotencia, concurrencia y recuperacion: `SKIP LOCKED`, version y vencimiento.
- Comandos que deben aprobar: CI completa y migraciones desde cero en el VPS.

## Recuperacion

- Compatibilidad o migracion: columnas aditivas y nulas cuando no existe lease.
- Rollback de aplicacion: el digest anterior ignora las columnas nuevas.
- Recuperacion de datos, si aplica: un lease vencido se recupera; no se elimina ni se marca exito manualmente.

## Evidencia de cierre

- Archivos, commits o PR: commit `69e6c694657893d722e585796d2eb384e40caa71`; agregado en `packages/platform-domain/src/deployments/`, persistencia en `packages/database`, conexion en `apps/deploy-executor` y migracion `20260920233000_adm_04_add_provisioning_leases`.
- Comandos y resultados: formato, lint y tipos aprobados; 41 pruebas de configuracion, 181 generales y 19 de arquitectura aprobadas; los 17 builds finalizaron. PostgreSQL 18 desechable aplico cuatro migraciones desde cero y aprobo 7/7 pruebas de integracion, incluida competencia entre dos reclamos, fencing y recuperacion vencida. Staging aplico la cuarta migracion; `admin-api` y `deploy-executor` quedaron saludables por digest.
- Documentacion actualizada: esta ficha, `docs/04-proceso/estado.md`, `docs/03-operaciones/inventario-vps.md` e `infra/README.md`.
- Desviaciones del plan: la primera comprobacion de arquitectura reflejaba la frontera anterior que prohibia base de datos al ejecutor; se actualizo para permitirle exclusivamente el paquete de persistencia de plataforma. El primer intento de despliegue se revirtio automaticamente por un error del chequeo auxiliar de mounts; el segundo uso una comprobacion corregida y aprobo.
- Pendientes o decisiones nuevas: el proceso aun no reclama automaticamente porque no existe un handler que pueda confirmar capacidad y release reales. La proxima rebanada debe implementar el paso `VALIDATE` contra `ADM-05` y `ADM-09` antes de iniciar el loop; no se ejecutan efectos de host ni se marca `ADM-04` terminado.
