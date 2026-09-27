# USR-04 - Roles personalizados

> Plan derivado de `USR-04`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `USR-04`
- Requisitos relacionados: `USR-03`, `USR-05`
- Fase del MVP: Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `USR-03` integrado en `main`; catálogo de permisos CRM existente.
- Bloquea a: configuración detallada de permisos (`USR-05`).
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005 y ADR-0006.

## Resultado esperado

Un administrador autorizado puede listar, crear y editar roles personalizados con una matriz de permisos válida. Los miembros invitados o existentes pueden usar un rol personalizado mediante su referencia estable; al editar el rol, los usuarios vinculados reciben inmediatamente el nuevo conjunto de permisos en su siguiente autorización.

## Auditoria del trabajo existente

- Busquedas realizadas: `IamRole`, `IamRolePermission`, `member_roles`, `InitialRoleCode`, `iam:members:roles`.
- Codigo encontrado: tablas IAM y roles iniciales ya existen; servicio y contratos solo aceptan tres códigos fijos.
- Pruebas e historial encontrados: cobertura de roles iniciales en dominio, contratos, migración `20260927020000_usr_03_role_management` y PR #43.
- Decision: extender la frontera IAM existente; no duplicar tablas ni crear un segundo sistema de autorización.

## Alcance

### Incluido

- Código estable para roles personalizados y validación contra el catálogo CRM.
- API autenticada para listar, crear y actualizar roles no sistema.
- Asignación de un rol personalizado al invitar o editar un miembro.
- Migración compatible para códigos `CUSTOM_*` y pruebas proporcionales.

### No incluido

- La matriz avanzada por alcance de datos, canales o automatizaciones de `USR-05` a `USR-09`.
- Eliminación física de roles o modificación de roles sistema.
- Interfaz administrativa completa fuera de la superficie necesaria para consumir la API.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `domain` IAM, `contracts`, `database`, `api` y BFF CRM |
| Contratos y eventos | Schemas de rol y selección `roleId` versionados |
| Datos y migraciones | Ampliar constraint de código; conservar roles sistema |
| Permisos y aislamiento | Solo `iam:members:roles`; autorización siempre en servidor y base CRM del perfil |
| Configuracion y secretos | Sin cambios |
| Observabilidad y operacion | Errores RFC 9457 existentes; sin secretos en respuestas |
| Documentacion | Estado, checklist y esta ficha |

## Criterios de aceptacion

- [ ] Se puede crear un rol personalizado con nombre y permisos del catálogo.
- [ ] No se pueden incluir permisos desconocidos ni modificar roles sistema.
- [ ] Listar y editar roles exige `iam:members:roles`.
- [ ] Invitar o editar un miembro admite una referencia de rol válida.
- [ ] La edición de un rol se refleja en la autorización de los miembros vinculados.
- [ ] La migración es forward-only y conserva los tres roles iniciales.

## Plan de verificacion

- Pruebas unitarias: validación de código, permisos, autorización y servicio.
- Pruebas de integración o contratos: schemas y repositorio SQL con transacción.
- Pruebas E2E: crear/editar/listar rol y asignarlo a un miembro.
- Comprobacion manual: endpoint autenticado como administrador y como asesor.
- Seguridad, permisos y aislamiento: denegar roles a actores sin `iam:members:roles` y no aceptar `tenant_id` del cuerpo.
- Idempotencia, concurrencia y recuperacion: actualización condicional por versión y transacción corta.
- Comandos que deben aprobar: typecheck de `contracts`, `domain`, `database`, `api`; validación/generación Prisma CRM; pruebas IAM afectadas en VPS.

## Recuperacion

- Compatibilidad o migracion: constraint ampliada de forma compatible; roles existentes no cambian.
- Rollback de aplicacion: volver al digest anterior deja intactos roles y miembros.
- Recuperacion de datos: restauración estándar del perfil si la migración falla; no se borra ningún rol.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente de validación en VPS.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: ninguna.
