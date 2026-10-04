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
- Decision: crear una operacion propietaria de actualizacion, sin reutilizar la operacion de alta ni mutar `tenant_profiles.release_id` desde la interfaz.

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

- [ ] Modelar operacion, estados, pasos e invariantes.
- [ ] Crear migracion forward-only y repositorio idempotente.
- [ ] Publicar contrato y endpoint protegido.
- [ ] Conectar BFF y accion del panel.
- [ ] Integrar ejecucion tipada y lock por perfil.
- [ ] Verificar en VPS y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Dos releases sobreescriben un perfil | Indice unico de operacion abierta y lock de fila | Prueba concurrente |
| Release candidata o incompatible | Validacion server-side contra catalogo | Solicitud con `CANDIDATE` rechazada |
| Perfil queda apuntando a imagen no verificada | Actualizar referencia solo despues de `VERIFY` | Integracion de ejecutor |
| Migracion irreversible falla | Mantener release anterior y estado fallido durable | Prueba de fallo/reanudacion |

## Criterios de aceptacion

- [ ] La solicitud exige release `VALIDATED`, `If-Match` e `Idempotency-Key`.
- [ ] Una operacion activa impide otra promocion del mismo perfil.
- [ ] El perfil conserva la release anterior hasta la activacion observada.
- [ ] El operador ve estado y error saneado sin secretos.
- [ ] El ejecutor no acepta comandos, rutas ni digests enviados por el navegador.

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

- Archivos, commits o PR: pendiente de implementacion.
- Comandos y resultados: pendiente de validacion en VPS.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: la UI actual no tenia ruta de promocion; se incorpora como operacion explicita.
- Pendientes o decisiones nuevas: el perfil `ACTIVE` no se mutara directamente; la operacion debe completar verificacion antes de activar la release nueva.
