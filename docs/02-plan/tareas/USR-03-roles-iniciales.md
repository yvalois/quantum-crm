# USR-03 - Roles iniciales del CRM

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificación

- Requisito principal: `USR-03`
- Requisitos relacionados: `USR-01`, `USR-04`, `USR-05`, `USR-06` y `USR-07`
- Fase del MVP: Fase 3 — Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: Historia CRM `iam` iniciada por `USR-01`.
- Bloquea a: autorización de sesión y administración de miembros de `USR-01`.
- ADR, arquitectura o diseño aplicables: `ADR-0002`, `ADR-0003`, `ADR-0004`, `ADR-0005`, `ADR-0006` y `monorepo.md`.

## Resultado esperado

El CRM conserva tres roles iniciales —administrador, supervisor y asesor— con códigos estables, permisos explícitos y asignaciones de miembros. La autorización consulta permisos, no nombres de rol, y la creación del administrador inicial queda idempotente por perfil.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `USR-03`, `role`, `permission`, `membership`, `authorizationRevision` e `iam`.
- Código o documentación encontrados: solo existe el rol del operador de plataforma; no se puede reutilizar porque el CRM vive en otra base y realm. `USR-01` ya inicia el módulo propietario `iam`.
- Pruebas e historial encontrados: las pruebas de autorización actuales son exclusivas de plataforma.
- Decisión de reutilización, extensión o reemplazo: usar códigos de permiso tipados de `iam`, tablas de roles y asignaciones propias del CRM; no copiar permisos de plataforma ni usar roles de Keycloak como autorización comercial.

## Alcance

### Incluido

- Roles fijos iniciales, sus permisos explícitos y asignación a membresías.
- Permiso de administración de miembros requerido por `USR-01`.
- Incremento de revisión de autorización al cambiar una asignación.

### No incluido

- Editor de roles personalizados (`USR-04`), matriz configurable (`USR-05`) y alcance de datos (`USR-06`).

## Plan de implementación

- [x] Añadir roles, permisos y asignaciones a la historia `crm` del módulo `iam`.
- [x] Definir el catálogo versionado y las tres plantillas iniciales.
- [x] Resolver permisos efectivos para la autenticación CRM.
- [x] Asignar de manera atómica el rol elegido al invitar; el administrador inicial continúa ligado al aprovisionamiento de realm.
- [x] Permitir que un administrador cambie el rol de una membresía mediante un permiso dedicado y aumentar la revisión de autorización.
- [ ] Probar denegación por defecto y el incremento de revisión en VPS y CI.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Un rol de Keycloak decide acceso comercial | Los roles del proveedor no se leen como autorización CRM | Token válido sin membresía/permiso recibe denegación |
| Cambio de rol mantiene privilegios en caché | Revisión de autorización y revocación de sesión | Sesión existente pierde acción tras el cambio |

## Criterios de aceptación

- [ ] Administrador, supervisor y asesor tienen permisos explícitos y distintos.
- [ ] Las condiciones comerciales usan permisos estables, no el nombre del rol.
- [ ] Asignar o retirar un rol modifica la revisión de autorización del miembro.

## Plan de verificación

- Pruebas unitarias: catálogo, permisos efectivos y denegación.
- Pruebas de integración o contratos: roles y asignaciones CRM aisladas por perfil.
- Pruebas E2E: administrar miembros con permisos permitidos y rechazados.
- Comandos que deben aprobar: verificación afectada en VPS y matriz final de GitHub Actions.

## Recuperación

- Compatibilidad o migración: migración CRM aditiva y forward-only.
- Rollback de aplicación: conserva roles y asignaciones; una versión anterior deniega acciones desconocidas.
- Recuperación de datos, si aplica: restauración CRM aislada y aprobada.

## Evidencia de cierre

- Archivos, commits o PR: `packages/contracts/src/iam/v1/member.ts`, `packages/domain/src/iam/application/member-service.ts`, `packages/domain/src/iam/application/member-repository.ts`, `packages/database/src/crm-postgres-database.ts` y la migración `20260927020000_usr_03_role_management` en el PR #43; el commit candidato `90ce1d6` incorpora la resolución de conflictos con `main`.
- Comandos y resultados: en el VPS, `vitest` ejecutó 11 pruebas en `packages/contracts/src/iam/v1/member.test.ts` y `packages/domain/src/iam/application/member-service.test.ts` (11/11); `tsc --noEmit` pasó para `contracts`, `domain`, `database` y `api`; Prisma `validate` y `generate` pasaron para `platform` y `crm`. No se ejecutaron comprobaciones técnicas locales. La matriz CI queda pendiente.
- Documentación actualizada: ficha creada antes de modificar roles y actualizada con el avance real.
- Desviaciones del plan: ninguna; la resolución conservó el contrato de asignación de rol y la prueba de permiso dedicado de la rama.
- Pendientes o decisiones nuevas: completar la matriz CI y verificar el resultado en el PR #43; `USR-04` a `USR-07` quedan abiertos.
