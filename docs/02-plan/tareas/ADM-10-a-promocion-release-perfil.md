# ADM-10-a - Promocion durable de release por perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificacion

- Requisito principal: `ADM-10`
- Requisitos relacionados: `ADM-09`, `ADM-12`, `ADM-20`, `OPS-11`, `OPS-12`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: catalogo de releases validado, perfil con servidor asignado, `deploy-executor` operativo
- Bloquea a: actualizacion controlada de perfiles desde `admin-web`
- ADR, arquitectura o diseno aplicables: ADR-0003, ADR-0005, ADR-0006, ADR-0009 y ADR-0011

## Resultado esperado

Un operador autorizado puede seleccionar una release `VALIDATED` y solicitar una operacion durable para un unico perfil. La operacion conserva actor, release anterior y nueva, idempotencia y correlacion; adquiere un lock por perfil y solo cambia el release observado despues de que el ejecutor confirme migracion, readiness y verificacion. Un perfil `ACTIVE` no se sobrescribe por un PATCH directo.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y evidencia previa revisados.
- [x] Reglas de API, persistencia, CI/CD y trabajos asincronos revisadas.
- [x] ADR y arquitectura de plataforma y ejecutor revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-10`, `OPS-12`, `provisioning_operations`, `platform_foundation_promotions`, `releaseId`, `deploy-executor`, locks y endpoints de perfiles.
- Codigo encontrado: aprovisionamiento durable para perfiles nuevos y promocion de la fundacion; no existe operacion de actualizacion de un perfil activo ni BFF/UI para solicitarla.
- Pruebas e historial encontrados: contratos y repositorios de aprovisionamiento; el flujo actual permite `PENDING`/`ERROR` y rechaza una sustitucion de release sobre `ACTIVE`.
- Defecto operativo encontrado el 2026-10-04: el `claimNext` desplegado no inicia porque su `RETURNING` resuelve dos columnas `id` visibles y PostgreSQL devuelve `column reference "id" is ambiguous`; el ejecutor sanea el error y reinicia.
- Segundo defecto operativo encontrado durante la misma promocion: los clientes del socket vencian a los 15/120 segundos mientras `deploy-host` permite hasta 180 segundos para migracion y reconciliacion; ambos presupuestos se alinean y el lease pasa a 240 segundos para impedir ejecuciones superpuestas antes de reintentar la operacion durable.
- Tercer defecto operativo encontrado: el manifiesto declaraba secretos `tenant/<perfil>/storage-*`, pero `deploy-host` eliminaba el segmento `tenant`; API y worker no recibian la configuracion S3 de `DOC-14`. La politica ahora valida manifiesto, buckets y referencias, conserva la ruta cerrada y exige el endpoint HTTPS publico.
- Cuarto defecto operativo encontrado: `advance` conservaba el lease hasta su vencimiento y `complete` enviaba parametros de fence no referenciados por el SQL final. La transicion ahora libera el lease entre pasos y la activacion conserva todos los fences en el `UPDATE` definitivo.
- Decision: crear una operacion propietaria de actualizacion, sin reutilizar la operacion de alta ni mutar `tenant_profiles.release_id` desde la interfaz; corregir el CTE con un alias no ambiguo antes de promover la release.

## Alcance

### Incluido

- Contrato versionado de solicitud y estado de promocion por perfil.
- Persistencia durable con release anterior/nueva, actor, idempotencia, version y lock unico por perfil.
- Endpoint protegido de `admin-api`, BFF y accion visible en `admin-web`.
- Integracion del ejecutor para migracion, reconciliacion de configuracion/contenedores, verificacion y activacion observada.
- Pruebas de permisos, idempotencia, concurrencia, release no validada y lock de perfil activo.

### No incluido

- Promocion global o por grupos (`ADM-11`).
- Rollback automatico de datos o restauracion (`ADM-14`/`ADM-15`).
- Cambios de Keycloak, identidad comercial o el contenido de una release.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-api`, `admin-web`, `deploy-executor`, `platform-domain`, `database` |
| Contratos y eventos | Nuevo contrato `tenant-release-promotion/v1` |
| Datos y migraciones | Tabla durable de operaciones de actualizacion y lock parcial por perfil |
| Permisos y aislamiento | `deployments:execute`; perfil y servidor se resuelven desde registros verificados |
| Configuracion y secretos | Reutiliza referencias existentes; no devuelve secretos |
| Observabilidad y operacion | Pasos, correlacion, lease y resultado observado |
| Documentacion | Ficha, estado, checklist y evidencia VPS |

## Plan de implementacion

- [x] Modelar operacion, estados, pasos e invariantes.
- [x] Crear migracion forward-only y repositorio idempotente.
- [x] Publicar contrato y endpoint protegido.
- [x] Conectar BFF y accion del panel.
- [x] Integrar ejecucion tipada y lock por perfil.
- [x] Corregir y verificar contra PostgreSQL real el reclamo durable del ejecutor.
- [x] Verificar en VPS y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Dos releases sobreescriben un perfil | Indice unico de operacion abierta y lock de fila | Prueba concurrente |
| Release candidata o incompatible | Validacion server-side contra catalogo | Solicitud con `CANDIDATE` rechazada |
| Perfil queda apuntando a imagen no verificada | Actualizar referencia solo despues de `VERIFY` | Integracion de ejecutor |
| Migracion irreversible falla | Mantener release anterior y estado fallido durable | Prueba de fallo/reanudacion |

## Criterios de aceptacion

- [x] La solicitud exige release `VALIDATED`, `If-Match` e `Idempotency-Key`.
- [x] Una operacion activa impide otra promocion del mismo perfil.
- [x] El perfil conserva la release anterior hasta la activacion observada.
- [x] El operador ve estado y error saneado sin secretos.
- [x] El ejecutor no acepta comandos, rutas ni digests enviados por el navegador.

## Plan de verificacion

- Pruebas unitarias: invariantes, transicion y lock.
- Pruebas de integracion o contratos: migracion, repositorio y controlador.
- Pruebas E2E: seleccionar release, solicitar operacion y observar resultado.
- Comprobacion manual: perfil activo conserva release anterior durante una operacion fallida.
- Seguridad, permisos y aislamiento: permiso `deployments:execute` y referencias server-side.
- Idempotencia, concurrencia y recuperacion: replay, payload conflictivo, lease vencido y reanudacion.
- Comandos que deben aprobar: formato, lint, typecheck, pruebas afectadas, migracion y build en VPS; matriz completa en GitHub.

## Recuperacion

- Compatibilidad o migracion: migracion aditiva y forward-only.
- Rollback de aplicacion: restaurar digest anterior; no borrar operacion ni revertir datos automaticamente.
- Recuperacion de datos, si aplica: operacion separada de restauracion, nunca implicita en promocion.

## Evidencia de cierre

- Archivos, commits o PR: `feat/ADM-10-ops-12-tenant-release-promotion`, candidato `8b3861e` (incluye `58d180d`, `4ef7b57`, `67469f6`, `dcde008` y `e2e6873`). PR pendiente de publicar tras el cierre de esta ficha.
- Comandos y resultados en VPS (Node `24.21.0` dentro de `node:24.21.0-alpine`): `prisma:platform:validate` aprobado; typecheck de `platform-domain`, `contracts`, `database`, `admin-api`, `admin-web`, `deploy-host` y `deploy-executor` aprobado; pruebas focalizadas `tenant-release-promotion.test.ts` y `tenant-release-promotion-executor.test.ts`: 2 archivos, 4 casos verdes.
- Correccion operativa `fix/ADM-10-claim-release`: formato aprobado; typecheck y build de `config`, `database`, `deploy-host` y `deploy-executor`; 25 pruebas afectadas iniciales, 9 de politica/ruta S3 y 5 de repositorio/ejecutor aprobadas en el VPS.
- Promocion real: operacion `55b1ef78-0862-4d3c-92c4-3725dc0fd56f` en `SUCCEEDED`; perfil `quantum-demo-jueves` activado sobre release `8706edd4-9cae-5723-8c97-4215263ff376`; `crm-web`, `portal-web`, `api`, `worker` y `agent-runtime` saludables; origen S3 publico responde `403` sin firma y el CRM responde con redireccion OIDC esperada.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: la UI actual no tenia ruta de promocion; se incorpora como operacion explicita.
- Pendientes o decisiones nuevas: publicar la correccion y pasar la matriz CI para sustituir las dos imagenes operativas temporales por digests oficiales. El perfil `ACTIVE` no se muta directamente: la operacion completo migracion, reconciliacion, verificacion y activacion transaccional.
