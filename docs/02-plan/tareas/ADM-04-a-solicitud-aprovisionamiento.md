# ADM-04-a - Solicitud durable de aprovisionamiento

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-03`, `ADM-05`, `ADM-09`, `ADM-12`, `ADM-19`, `ADM-20`, `OPS-14`
- Fase del MVP: 2. Plataforma administrativa
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-02-b`, `ADM-03-a`, autenticacion de `ADM-01`
- Bloquea a: ejecucion reanudable del alta, detalle de pasos y activacion final
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0005, ADR-0006, ADR-0009 y ADR-0011

## Resultado esperado

Una solicitud autorizada registra de forma atomica e idempotente la intencion de aprovisionar un perfil, fija servidor y release, conserva actor y correlacion, y mueve el perfil a `PROVISIONING` sin ejecutar shell ni efectos externos dentro de la transaccion.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y evidencia previa revisados.
- [x] Reglas de API, persistencia, CI/CD y trabajos asincronos revisadas.
- [x] ADR y arquitectura de plataforma y ejecutor revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `provision`, `operation`, `deploy-executor`, `outbox`, `serverId` y `releaseId`.
- Codigo o documentacion encontrados: perfil persistente, cinco estados, autenticacion de operador, permiso `deployments:execute`, PostgreSQL de plataforma y proceso vacio `deploy-executor`.
- Pruebas e historial encontrados: repositorio de perfiles, integracion PostgreSQL, contratos y CI de `ADM-02`/`ADM-03`.
- Decision de reutilizacion, extension o reemplazo: extender `platform-domain` y `database`; registrar primero la operacion durable y dejar los efectos de host exclusivamente al ejecutor.

## Alcance

### Incluido

- Agregado y contrato v1 de solicitud/operacion de aprovisionamiento.
- Tabla durable con actor, idempotencia, correlacion, servidor, release, paso y estado.
- Transaccion que crea la operacion y mueve el perfil a `PROVISIONING` con control optimista.
- Endpoint protegido con `deployments:execute`, `Idempotency-Key` e `If-Match`.
- Pruebas unitarias, contractuales e integracion PostgreSQL.

### No incluido

- Ejecutar Docker, migraciones, secretos, buckets, HTTPS o crear el administrador del cliente.
- Afirmar capacidad o compatibilidad antes de los registros reales de `ADM-05` y `ADM-09`.
- Marcar `ADM-04` terminado.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-api`, `platform-domain`; `deploy-executor` aun no ejecuta |
| Contratos y eventos | Nuevo contrato `tenant-provisioning-operation/v1` |
| Datos y migraciones | Schema `operations` y operacion durable con FK a perfil y operador |
| Permisos y aislamiento | Solo `deployments:execute`; IDs validados y sin secretos |
| Configuracion y secretos | Ninguno |
| Observabilidad y operacion | Correlacion durable; sin cuerpos o secretos en errores |
| Documentacion | Ficha, estado e inventario al desplegar |

## Plan de implementacion

- [x] Modelar operacion, estados, pasos e invariantes.
- [x] Crear migracion forward-only y privilegios minimos.
- [x] Implementar repositorio transaccional e idempotente.
- [x] Publicar contrato y endpoint protegido.
- [x] Verificar, migrar y desplegar por digest en el VPS.
- [x] Registrar evidencia sin cerrar `ADM-04`.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Solicitudes repetidas duplican recursos | Clave idempotente unica y comparacion del payload | Prueba de repeticion y conflicto |
| Dos altas compiten por un perfil | Lock de fila y version esperada | Prueba concurrente/condicional |
| La UI ejecuta host directamente | API solo registra; ejecutor separado | Prueba de arquitectura y revision de imports |
| Perfil queda activo sin comprobaciones | Solo se mueve a `PROVISIONING` | Integracion y contrato |

## Criterios de aceptacion

- [x] La misma solicitud devuelve la misma operacion sin incrementar otra vez la version.
- [x] Reutilizar la clave con otro payload produce conflicto.
- [x] Perfil y operacion se persisten juntos o ninguno se persiste.
- [x] Estados no elegibles y versiones obsoletas se rechazan.
- [x] No existe campo de shell, ruta, Compose ni secreto en el contrato.

## Plan de verificacion

- Pruebas unitarias: invariantes y servicio.
- Pruebas de integracion o contratos: schema Zod, transaccion PostgreSQL, idempotencia y permisos.
- Pruebas E2E: smoke HTTP autenticado cuando el endpoint este desplegado.
- Comprobacion manual: operacion pendiente y perfil aprovisionando visibles en base sin efectos de host.
- Seguridad, permisos y aislamiento: permiso `deployments:execute`, actor derivado de sesion y errores cerrados.
- Idempotencia, concurrencia y recuperacion: clave unica, lock y version optimista.
- Comandos que deben aprobar: CI completa del monorepo y migracion real del VPS.

## Recuperacion

- Compatibilidad o migracion: migracion aditiva; la tabla puede permanecer si se revierte aplicacion.
- Rollback de aplicacion: restaurar digest anterior de `admin-api`; no revertir migracion aplicada.
- Recuperacion de datos, si aplica: una operacion pendiente no ejecutada puede cancelarse posteriormente; no eliminar filas como rollback.

## Evidencia de cierre

- Archivos, commits o PR: commit `c8da78d9a13aa37c879018230e5d3d0665a587d8`; dominio y contratos en `packages/platform-domain/src/deployments/` y `packages/contracts/src/deployments/v1/`; persistencia en `packages/database`; endpoint en `apps/admin-api`; migracion `20260920220000_adm_04_create_provisioning_operations`.
- Comandos y resultados: CI completa en Node.js 24 aprobo formato, lint, tipos, 41 pruebas de configuracion, 178 pruebas generales, 19 de arquitectura y los 17 builds. En PostgreSQL 18 desechable se aplicaron desde cero las tres migraciones de plataforma y `platform-tenant-profile.test.ts` aprobo 6/6. La migracion se aplico despues al PostgreSQL persistente; `admin-api` quedo `healthy` con `qcrm-platform/admin-api@sha256:9bcf679e33d1f148c2b7ee8ba3caca416c365981e1c7d408fab6a7785eef27e1`. Un smoke interno a la ruta sin credenciales devolvio `401`.
- Documentacion actualizada: esta ficha, `docs/04-proceso/estado.md` y `docs/03-operaciones/inventario-vps.md`.
- Desviaciones del plan: no se uso la base persistente para pruebas destructivas; la integracion se ejecuto en PostgreSQL desechable con credenciales sinteticas. No se realizo un smoke HTTP con sesion humana; la autorizacion se cubrio mediante prueba de controlador y el smoke anonimo comprobo denegacion cerrada.
- Pendientes o decisiones nuevas: el ejecutor todavia debe reclamar la operacion, ejecutar los pasos tipados, persistir progreso y activar o marcar fallo. Los catalogos reales de servidor y release pertenecen a `ADM-05` y `ADM-09`; `ADM-04` permanece abierto.
