# CAL-03/12/16 - Agenda por asesor y tipos de cita

> Plan derivado; la autoridad funcional sigue en `funcionalidades.md` y `trabajo.md`.

## Identificación

- Requisito principal: `CAL-03`; relacionados: `CAL-12`, `CAL-16`, `USR-05`.
- Fase del MVP: 6, agenda y captura; depende de miembros, roles, calendarios y eventos existentes.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- ADR aplicables: 0002, 0003, 0004, 0005, 0006, 0007, 0009 y 0014.

## Resultado esperado

Un asesor ve y opera sus citas asignadas. Una persona con `crm:calendar:read-all` consulta todas las citas del perfil y filtra por asesor. Un administrador con `crm:calendar:configure` crea tipos de cita reutilizables y estos se seleccionan al agendar.

## Lectura y auditoría

- Se leyeron los requisitos `CAL-03/12/16`, fase 6, checklist, estado, reglas y ADR pertinentes.
- El módulo `calendar` ya ofrece agenda, calendario, disponibilidad, eventos y reserva pública (PR #75). Se extiende; no se reimplementa.
- Hallazgo: el alcance `ASSIGNED` en PostgreSQL incluye `created_by_member_id`, el filtro de asesor se aplica solo en React y las categorías `APPOINTMENT/MEETING/EVENT` no son tipos configurables.

## Alcance

- Incluido: permiso de lectura global, consulta/historial y mutaciones acotadas por asesor, filtro server-side, capacidades web, catálogo de tipos con nombre y duración, selección al crear cita, migración aditiva, pruebas y despliegue.
- No incluido: cambios al enlace público de reserva, sincronización externa `CAL-19`, envío de recordatorios por canal ni eliminación destructiva de tipos.

## Impacto y compatibilidad

| Área | Cambio |
| --- | --- |
| Contratos | Campos opcionales/aditivos y catálogo `crm:calendar:read-all` |
| Dominio/API | Autorización por recurso y casos de uso de tipos |
| Persistencia | Tabla `calendar.appointment_types` y FK nullable en eventos; migración forward-only |
| CRM web | Filtro y acciones condicionados por capacidades; selector y creación administrativa |
| Recuperación | Rollback de imagen conserva columnas aditivas; no borra citas ni tipos |

## Plan de implementación

- [ ] Cambiar contratos, permisos y migración aditiva sin ampliar acceso por defecto.
- [ ] Aplicar alcance en todos los endpoints internos de calendario y evitar autoasignación ajena.
- [ ] Crear/listar tipos y vincularlos a citas con idempotencia.
- [ ] Adaptar calendario web y filtros al permiso real.
- [ ] Probar denegaciones, aislamiento, migración, flujo web y despliegue en VPS.

## Riesgos y verificación

- Riesgo de fuga por ruta secundaria: probar lista, disponibilidad, configuración e historial como asesor y como lector global.
- Riesgo de pérdida de datos: FK nullable y sin backfill; conservar eventos anteriores sin tipo específico.
- Riesgo de duplicado: clave de idempotencia y nombre único por perfil para crear tipo.
- Validar formato, lint, tipos, pruebas afectadas, migración PostgreSQL y builds únicamente en VPS; después CI y smoke autenticado.

## Evidencia de cierre

Pendiente de registrar sin declarar terminado antes de la comprobación extremo a extremo.
