# USR-05 - Permisos por sección

> Plan derivado de `USR-05`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `USR-05`
- Requisitos relacionados: `USR-04`, `USR-06`
- Fase del MVP: Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: catálogo de permisos y roles personalizados de `USR-04`.
- Bloquea a: aplicación de alcances de datos (`USR-06`).
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005 y ADR-0006.

## Resultado esperado

Cada sección CRM expone permisos explícitos para consultar, crear, editar, eliminar y exportar. La matriz se guarda en el rol, el panel permite editarla y cada controlador/caso de uso comprueba el permiso en el servidor; una llamada directa sin permiso recibe `403`.

## Auditoria del trabajo existente

- Busquedas realizadas: `CrmPermissionCatalog`, `RequireCrmPermission`, servicios de contactos, ventas, tareas y panel de roles.
- Codigo encontrado: lectura, creación y edición ya tienen permisos separados y guardas servidor; el catálogo no tenía acciones uniformes de eliminar/exportar.
- Pruebas e historial encontrados: pruebas IAM/contratos y PR #45 (`USR-04`).
- Decision: conservar permisos existentes, ampliar el catálogo con acciones uniformes y validar el mismo catálogo en contratos, dominio, API y matriz visual.

## Alcance

### Incluido

- Catálogo estable de permisos por sección y acción para IAM, contactos, ventas y tareas.
- Validación de permisos en schemas y roles personalizados.
- Matriz visual agrupada por sección.
- Cobertura de autorización positiva y negativa para llamadas directas a API.

### No incluido

- Alcances de datos todos/equipo/asignados de `USR-06`.
- Nuevas operaciones comerciales que todavía no existen; al crearse deben declarar su permiso del mismo catálogo.
- Permisos de canales, calendarios o agentes hasta que sus módulos entren en construcción.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `contracts`, `domain`, `api`, `crm-web` |
| Contratos y eventos | catálogo `namespace:section:action` sin DTO paralelo |
| Datos y migraciones | constraint de permisos ampliada de forma forward-only |
| Permisos y aislamiento | autorización por servidor, perfil y principal; denegación por defecto |
| Configuracion y secretos | sin cambios |
| Observabilidad y operacion | `403` estructurado sin revelar permisos internos innecesarios |
| Documentacion | estado, checklist y ficha |

## Criterios de aceptacion

- [ ] Cada sección activa tiene consultar, crear, editar, eliminar y exportar explícitos.
- [ ] La matriz de rol solo admite valores del catálogo.
- [ ] Los controladores y servicios mantienen autorización servidor-side.
- [ ] Una llamada directa sin permiso devuelve `403` y no ejecuta el caso de uso.
- [ ] La UI agrupa y edita los permisos sin confiar en ella como barrera.

## Plan de verificacion

- Pruebas unitarias: catálogo, matriz y denegación en servicios.
- Pruebas de integración o contratos: schemas y migración de permisos.
- Pruebas E2E: actor autorizado y actor sin permiso contra endpoints activos.
- Comprobacion manual: matriz visual y respuesta `403`.
- Seguridad, permisos y aislamiento: permiso verificado en guard y caso de uso; perfil derivado de autenticación.
- Idempotencia, concurrencia y recuperacion: actualización de rol conserva transacción y revisión de miembros.
- Comandos que deben aprobar: typecheck de `contracts`, `domain`, `database`, `api`, `crm-web`; Prisma CRM validate/generate; pruebas IAM y autorización en VPS.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente de validación en VPS.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: ninguna.
