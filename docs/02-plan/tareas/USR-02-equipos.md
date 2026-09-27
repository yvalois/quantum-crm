# USR-02 - Crear equipos y asignar sus integrantes

> Plan derivado de `USR-02`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `USR-02`
- Requisitos relacionados: `USR-01`, `USR-03`, `USR-05`, `USR-06`, `USR-08`, `USR-11`
- Fase del MVP: Fase 3 — Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: miembros IAM y permisos base integrados; tablas de equipos creadas por `USR-06`.
- Bloquea a: visibilidad `TEAM`, transferencias y administración de accesos por recurso.
- ADR, arquitectura o diseño aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0005 y ADR-0006.

## Resultado esperado

Un administrador autorizado puede listar y crear equipos dentro del perfil CRM y agregar o retirar miembros activos. Los cambios son transaccionales, incrementan la revisión de autorización de los miembros afectados y se reflejan inmediatamente en las consultas comerciales con alcance `TEAM`. Ningún identificador de perfil, equipo o permiso enviado por el cliente sustituye la identidad autenticada.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Búsquedas realizadas: `rg` sobre `USR-02`, `team_members`, `commercialScope`, permisos IAM y predicados de visibilidad.
- Código o documentación encontrados: `USR-06` ya crea `iam.teams` e `iam.team_members`, aplica el predicado `TEAM` y eleva `authorization_revision` mediante trigger; no existía servicio ni API para administrarlos.
- Pruebas e historial encontrados: pruebas de filtros y persistencia de alcance; no había casos de creación de equipos ni alta/baja de integrantes.
- Decisión de reutilización, extensión o reemplazo: reutilizar tablas, trigger y predicado existentes; añadir puerto IAM, servicio, contratos, rutas y panel sin duplicar datos comerciales.

## Alcance

### Incluido

- Listar equipos y sus integrantes activos del perfil autenticado.
- Crear un equipo con nombre normalizado y único.
- Agregar un miembro activo a un equipo y retirar su membresía.
- Aplicar permisos en servidor, concurrencia e idempotencia de alta/baja.
- Reflejar membresías en el panel administrativo del CRM.

### No incluido

- Transferencia de contactos, oportunidades o conversaciones (`USR-08`).
- Reasignación al desactivar usuarios (`USR-10`).
- Auditoría funcional completa (`USR-11`), aunque la revisión de autorización queda durable.
- Equipos de plataforma central o acceso entre perfiles.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `iam`, `api`, `crm-web` y adaptadores de `database`. |
| Contratos y eventos | Schemas de equipos e integrantes bajo `/api/v1/teams`; sin evento externo en este bloque. |
| Datos y migraciones | Reutiliza `iam.teams` y `iam.team_members` de `USR-06`; no crea tablas duplicadas. |
| Permisos y aislamiento | Permisos IAM dedicados; todas las consultas quedan limitadas por la conexión del perfil. |
| Configuración y secretos | Sin nuevos secretos. |
| Observabilidad y operación | Errores RFC 9457 y correlación existentes; revisión de autorización observable. |
| Documentación | Checklist, estado, esta ficha y contratos afectados. |

## Plan de implementación

- [x] Registrar `USR-02` como `EN_CURSO` y conservar trazabilidad de la rama.
- [ ] Definir contratos de equipos y operaciones de integrantes.
- [ ] Implementar servicio IAM y repositorio transaccional.
- [ ] Exponer rutas protegidas y conectarlas al módulo Nest.
- [ ] Añadir gestión visible en `crm-web`.
- [ ] Añadir pruebas de permisos, unicidad, concurrencia, aislamiento y visibilidad `TEAM`.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Alta repetida de un integrante | Clave primaria `(team_id, member_id)` y resultado idempotente. | Repetir `POST` y comprobar una sola relación. |
| Retirar una membresía deja permisos cacheados | Trigger incrementa la revisión de cada miembro afectado. | Leer revisión antes y después del cambio. |
| Agregar miembros de otro perfil | La conexión y las FK viven en la base aislada del perfil. | Prueba de conexión cruzada denegada. |
| Equipo vacío o nombre ambiguo | Validación trim, longitud y unicidad en servidor y base. | Casos de schema y constraint. |

## Criterios de aceptación

- [ ] Un actor con permiso puede crear y listar equipos de su perfil.
- [ ] Un actor con permiso puede agregar y retirar miembros activos sin duplicados.
- [ ] Un actor sin permiso recibe `403` y no cambia datos.
- [ ] La membresía cambia la visibilidad `TEAM` y eleva la revisión de autorización.
- [ ] Dos perfiles no pueden observar ni modificar equipos o integrantes del otro.

## Plan de verificación

- Pruebas unitarias: validación de nombre, permisos, idempotencia y errores tipados.
- Pruebas de integración o contratos: rutas, schemas y operaciones PostgreSQL sobre equipos.
- Pruebas E2E: creación y administración desde el panel CRM.
- Comprobación manual: miembro incluido, retirado y con alcance `TEAM`.
- Seguridad, permisos y aislamiento: denegación por permiso y conexión cruzada.
- Idempotencia, concurrencia y recuperación: alta repetida y dos altas simultáneas.
- Comandos que deben aprobar: Prettier afectado, typecheck de consumidores y pruebas afectadas en el VPS; CI ejecutará la matriz completa.

## Recuperación

- Compatibilidad o migración: se reutiliza la migración `USR-06`; no se modifican migraciones aplicadas.
- Rollback de aplicación: retirar las rutas y panel manteniendo las tablas y membresías existentes.
- Recuperación de datos, si aplica: restauración aislada validando equipos, integrantes y revisiones antes de sustituir datos.

## Evidencia de cierre

- Archivos, commits o PR: pendiente hasta completar implementación y validación.
- Comandos y resultados: pendiente; no se ejecuta software en el equipo local.
- Documentación actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: auditoría durable y transferencia siguen en sus requisitos propietarios.

