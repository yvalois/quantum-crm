# CON-03 - Activar automatizaciones desde contactos

> Plan derivado de `CON-03`; no sustituye el alcance de `funcionalidades.md`, el checklist ni el estado oficial.

## Identificacion

- Requisito principal: `CON-03`
- Requisitos relacionados: `BASE-04`, `BASE-05`, `TAR-01`
- Fase del MVP: Base comun y contactos, rebanada vertical
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: contactos visibles, tareas persistentes, permisos IAM y migraciones CRM
- Bloquea a: automatizaciones disparadas por eventos posteriores
- ADR, arquitectura o diseno aplicables: [ADR-0011](../../06-decisiones/ADR-0011-trabajos-asincronos-automatizaciones.md), [ADR-0002](../../06-decisiones/ADR-0002-limites-modulos-dependencias.md), [ADR-0005](../../06-decisiones/ADR-0005-diseno-contratos-api.md)

## Resultado esperado

Un usuario autorizado crea un flujo activo de tipo `CREATE_TASK`, selecciona uno o varios contactos visibles y lo activa desde Contactos. El servidor registra una ejecución durable por contacto, crea una tarea real para el propietario del contacto y devuelve el resultado individual. La misma clave de idempotencia devuelve el resultado anterior sin duplicar tareas.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg CON-03`, módulos `contacts`, `tasks`, permisos IAM, migraciones y rutas BFF.
- Codigo encontrado: repositorios PostgreSQL, autorización server-side, panel de Contactos y contratos Zod reutilizables.
- Pruebas e historial: CON-01/CON-02 y tareas existentes; no había módulo de automatizaciones ejecutable.
- Decision: añadir el módulo `automation` propietario y una primera acción real, sin declarar BASE-04/BASE-05 completas.

## Alcance

### Incluido

- Definiciones manuales `DRAFT`/`ACTIVE`/`PAUSED` con acción `CREATE_TASK`.
- Activación masiva acotada a 500 contactos visibles.
- Ejecuciones y claves idempotentes durables en PostgreSQL.
- API, BFF, controles de selección y formulario visible en Contactos.

### No incluido

- Condiciones, esperas, eventos automáticos, workers BullMQ o acciones externas; pertenecen a la ampliación de `BASE-04`/`BASE-05`.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | API, `crm-web`, dominio y repositorio comercial; `automation` posee sus tablas. |
| Contratos y eventos | Schemas versionados en `packages/contracts`; sin evento externo en esta rebanada. |
| Datos y migraciones | Esquema `automation`, definiciones, ejecuciones y command idempotency. |
| Permisos y aislamiento | Permisos de lectura/configuración/ejecución; visibilidad server-side por perfil/equipo/propietario. |
| Configuracion y secretos | Sin secretos ni proveedores nuevos. |
| Observabilidad y operacion | Resultados individuales, errores durables e idempotencia. |
| Documentacion | Estado, checklist y esta ficha. |

## Plan de implementacion

- [x] Registrar el trabajo y permisos.
- [x] Crear contrato, dominio, migración y repositorio.
- [x] Exponer API/BFF y panel de Contactos.
- [ ] Validar el commit candidato en el VPS y publicar PR.
- [ ] Integrar tras checks obligatorios verdes y actualizar evidencia.

## Criterios de aceptacion

- [ ] Se puede crear una automatización activa y verla en Contactos.
- [ ] La activación sobre uno o varios contactos crea una tarea real por contacto visible.
- [ ] Cada contacto tiene una ejecución individual con resultado y error explícitos.
- [ ] Una repetición con la misma clave no crea efectos duplicados.
- [ ] Un contacto fuera del alcance o un propietario inactivo no produce una tarea.

## Plan de verificacion

- Pruebas unitarias: contrato y servicio de automatización, permisos y deduplicación.
- Pruebas de integracion o contratos: API/BFF y migración en VPS.
- Pruebas E2E: selección en Contactos, creación de flujo y tarea resultante.
- Comprobacion manual: activar el flujo sobre dos contactos sintéticos del perfil piloto.
- Seguridad, permisos y aislamiento: denegar configuración/ejecución sin permiso y filtrar contactos en servidor.
- Idempotencia, concurrencia y recuperacion: repetir la clave y confirmar una sola tarea por contacto.
- Comandos que deben aprobar: Prettier afectado, typecheck afectado y pruebas afectadas ejecutadas una sola vez en el VPS.

## Recuperacion

- Compatibilidad o migracion: migración forward-only; no cambia tablas existentes.
- Rollback de aplicacion: retirar rutas/UI preservando filas durables.
- Recuperacion de datos: conservar definiciones y ejecuciones; restaurar con el procedimiento de ADR-0015 si aplica.

## Evidencia de cierre

- Archivos, commits o PR: commit candidato `695a795` en `feat/CON-03-contact-automations`; [PR #56](https://github.com/yvalois/quantum-crm/pull/56).
- Comandos y resultados: en el VPS se aprobaron Prettier afectado, typecheck de `contracts`, `domain`, `database`, `api` y `crm-web`, pruebas de contratos/dominio/BFF (14 casos), `prisma validate` y la migración `20260928110000_con_03_contact_automations` en el perfil sintético `01a0e50a-ab43-7c18-92ee-2f0a2567f292`. CI detectó y corrigió el alias de Vitest para `@quantum-crm/domain`; la matriz afectada volvió a quedar verde en el VPS.
- Documentacion actualizada: estado y esta ficha; falta registrar el resultado final de CI y el merge humano.
- Desviaciones del plan: ejecución síncrona durable de `CREATE_TASK` como primera rebanada; workers y esperas quedan para BASE.
- Pendientes o decisiones nuevas: ninguna.
