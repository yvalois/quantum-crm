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

- [ ] Modelar operacion, estados, pasos e invariantes.
- [ ] Crear migracion forward-only y privilegios minimos.
- [ ] Implementar repositorio transaccional e idempotente.
- [ ] Publicar contrato y endpoint protegido.
- [ ] Verificar, migrar y desplegar por digest en el VPS.
- [ ] Registrar evidencia sin cerrar `ADM-04`.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Solicitudes repetidas duplican recursos | Clave idempotente unica y comparacion del payload | Prueba de repeticion y conflicto |
| Dos altas compiten por un perfil | Lock de fila y version esperada | Prueba concurrente/condicional |
| La UI ejecuta host directamente | API solo registra; ejecutor separado | Prueba de arquitectura y revision de imports |
| Perfil queda activo sin comprobaciones | Solo se mueve a `PROVISIONING` | Integracion y contrato |

## Criterios de aceptacion

- [ ] La misma solicitud devuelve la misma operacion sin incrementar otra vez la version.
- [ ] Reutilizar la clave con otro payload produce conflicto.
- [ ] Perfil y operacion se persisten juntos o ninguno se persiste.
- [ ] Estados no elegibles y versiones obsoletas se rechazan.
- [ ] No existe campo de shell, ruta, Compose ni secreto en el contrato.

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

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
