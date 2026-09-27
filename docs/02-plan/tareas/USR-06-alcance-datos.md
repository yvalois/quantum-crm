# USR-06 - Alcance de datos por usuario

> Plan derivado de `USR-06`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `USR-06`
- Requisitos relacionados: `USR-02`, `USR-03`, `USR-04`, `USR-05`, `USR-08`, `USR-11`
- Fase del MVP: Fase 3 — Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `USR-04` y `USR-05` integrados; el alcance `team` requiere la base de equipos de `USR-02`.
- Bloquea a: filtrado seguro de las funciones comerciales y posteriores permisos por recurso.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0005 y ADR-0006.

## Resultado esperado

Cada membresía activa tiene un alcance comercial explícito —todos los registros del perfil, registros de sus equipos o únicamente registros asignados— y el servidor aplica esa decisión de forma uniforme a listados, búsquedas, detalles, modificaciones, exportaciones y reportes. La interfaz solo refleja el estado autorizado y nunca constituye la barrera de seguridad.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg` sobre `USR-06`, `scope`, `CommercialScope`, `commercialScope`, equipos y asignaciones.
- Codigo o documentacion encontrados: el CRM actual solo deriva `PROFILE` o `OWN` desde el rol; los repositorios de contactos, oportunidades y tareas filtran por propietario o asignado, sin equipos persistidos ni configuración por usuario.
- Pruebas e historial encontrados: existen pruebas de autorización e IAM y filtros de alcance `OWN`; no existe prueba de equipo ni de configuración persistida del alcance.
- Decision de reutilizacion, extension o reemplazo: extender el actor comercial y el repositorio IAM; conservar compatibilidad durante la migración y centralizar la condición de visibilidad para que los módulos propietarios no dupliquen reglas.

## Alcance

### Incluido

- Modelo persistente de equipos y membresías, reutilizable por `USR-02`.
- Configuración del alcance por membresía con valores `PROFILE` (todos), `TEAM` (equipos efectivos) y `ASSIGNED` (asignados); la representación heredada `OWN` se migra sin ampliar acceso.
- Aplicación server-side a consultas, detalles y mutaciones de contactos, oportunidades y tareas existentes.
- Contratos, API, interfaz administrativa, exportaciones y reportes preparados para consumir el mismo evaluador de alcance.
- Pruebas de denegación, aislamiento, cambio de equipo, concurrencia e idempotencia aplicables.

### No incluido

- Permisos de canales, bandejas, pipelines o calendarios de `USR-07`.
- Reglas de transferencia de `USR-08`.
- Auditoría funcional completa de `USR-11`, salvo los eventos necesarios para cambios de alcance.
- Reportes nuevos que todavía no existan; cuando se implementen deben llamar al contrato de alcance.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `iam`, `contacts`, `sales`, `tasks`, `api` y `crm-web`; `reporting` y exportadores consumirán el contrato público. |
| Contratos y eventos | Actor comercial y comandos de alcance versionados; evento de cambio de alcance para invalidar autorización. |
| Datos y migraciones | Tablas `iam.teams`, `iam.team_members` y configuración de alcance; migración forward-only con valores heredados seguros. |
| Permisos y aislamiento | Evaluación server-side de perfil, equipos efectivos y asignación; denegación por defecto. |
| Configuracion y secretos | Sin nuevos secretos. |
| Observabilidad y operacion | Auditoría de cambios y métricas acotadas de denegaciones, sin IDs de recursos como labels. |
| Documentacion | Checklist, estado, esta ficha y contratos afectados. |

## Plan de implementacion

- [ ] Registrar `USR-06` como `EN_CURSO` y conservar trazabilidad de la rama.
- [ ] Definir tipos y schemas públicos de alcance, equipo y membresía.
- [ ] Añadir persistencia de equipos, integrantes y alcance por usuario con restricciones e índices.
- [ ] Implementar el evaluador de alcance en `iam` y conectarlo mediante actor/puerto público a módulos propietarios.
- [ ] Aplicar el evaluador a contactos, oportunidades y tareas en listados, búsquedas, detalles y mutaciones.
- [ ] Añadir configuración en `crm-web` sin confiar en valores enviados por la interfaz.
- [ ] Conectar exportaciones y reportes existentes al mismo filtro cuando entren en el bloque funcional.
- [ ] Registrar auditoría, invalidación de revisión y eventos de cambio.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Interpretar `PROFILE` como permiso ilimitado | La acción y el alcance se validan por separado en servidor. | Matriz de autorización con permiso presente y ausente. |
| Miembro perteneciente a varios equipos | Resolver equipos efectivos en una consulta estable y deduplicada. | Prueba con dos equipos y cambio concurrente. |
| Registros sin propietario o asignación | Denegar a `TEAM`/`ASSIGNED` salvo relación explícita; `PROFILE` sigue siendo el único alcance global. | Casos de datos huérfanos. |
| Cambio de equipo deja caché amplia | Incrementar revisión de autorización e invalidar sesiones relacionadas. | Relectura posterior al cambio. |

## Criterios de aceptacion

- [ ] Un administrador autorizado configura el alcance de una membresía sin poder ampliar sus propios permisos accidentalmente.
- [ ] Un usuario `PROFILE` ve los registros autorizados del perfil.
- [ ] Un usuario `TEAM` ve únicamente registros vinculados a sus equipos efectivos.
- [ ] Un usuario `ASSIGNED` ve únicamente registros asignados a su identidad.
- [ ] Listados, búsquedas, detalles, actualizaciones, exportaciones y reportes aplican exactamente el mismo filtro server-side.
- [ ] Cambiar alcance o equipo invalida la autorización vigente y queda auditado.
- [ ] Dos perfiles no pueden observar ni modificar registros del otro.

## Plan de verificacion

- Pruebas unitarias: evaluador de alcance, normalización y transiciones.
- Pruebas de integracion o contratos: API de equipos y alcance, schemas y errores RFC 9457.
- Pruebas E2E: configuración administrativa y lectura de cada alcance.
- Comprobacion manual: matriz `PROFILE`/`TEAM`/`ASSIGNED` con registros cruzados.
- Seguridad, permisos y aislamiento: denegaciones, perfil incorrecto, miembro desactivado y equipo retirado.
- Idempotencia, concurrencia y recuperacion: reintento de asignación, cambio simultáneo y migración repetida.
- Comandos que deben aprobar: Prettier afectado, typecheck de paquetes consumidores, Prisma validate/generate y pruebas afectadas, ejecutados en el VPS según `docs/05-reglas/15-ejecucion-verificaciones-vps.md`.

## Recuperacion

- Compatibilidad o migracion: ampliar primero tablas y tipos; conservar lectura de `OWN` hasta completar el backfill y retirar solo en una migración posterior.
- Rollback de aplicacion: volver a la versión anterior manteniendo las columnas nuevas sin borrar datos.
- Recuperacion de datos, si aplica: restaurar la base del perfil en aislamiento y validar equipos, membresías, alcance y auditoría antes de sustituirla.

## Evidencia de cierre

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
