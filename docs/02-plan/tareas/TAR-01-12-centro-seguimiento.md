# TAR-01-12 - Centro de tareas y seguimiento

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `TAR-01`.
- Requisitos relacionados: `TAR-02`, `TAR-03`, `TAR-05`, `TAR-06`, `TAR-09`, `TAR-10`, `TAR-11` y `TAR-12`.
- Fase del MVP: 4 - Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: miembros activos, contactos, oportunidades, alcance comercial y tareas basicas persistentes.
- Bloquea a: recordatorios, recurrencia, automatizaciones, herramientas del agente y seguimiento desde conversaciones.
- ADR, arquitectura o diseno aplicables: ADR-0002 a ADR-0007, ADR-0011, ADR-0014, `monorepo.md` y `frontends-experiencia-visual.md`.

## Resultado esperado

Un usuario autorizado puede operar un centro de tareas real: crear seguimientos vinculados, asignarlos y reasignarlos, editar sus datos, distinguir tipo, prioridad, vencimiento y estado, filtrar el trabajo, comentar y consultar su historial sin perder concurrencia, alcance ni enlaces comerciales.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: requisitos `TAR-*`, contratos, dominio, repositorio PostgreSQL, controlador, BFF, pantalla `/tasks`, contacto y oportunidades.
- Codigo o documentacion encontrados: creacion idempotente vinculada a contacto u oportunidad, asignacion inicial, prioridad, vencimiento derivado, cuatro transiciones persistentes, control optimista, permisos server-side y pantalla funcional basica.
- Pruebas e historial encontrados: contratos y servicio de tareas cubren relacion exclusiva, idempotencia, vencimiento, transiciones y version; la rebanada comercial fue integrada por PR #39.
- Decision de reutilizacion, extension o reemplazo: extender el propietario `tasks` y su contrato v1 de forma aditiva; conservar permisos, alcance, idempotencia y version; reemplazar la composicion visual basica por el sistema aprobado en Stitch.

## Alcance

### Incluido

- Tipo de tarea: llamada, mensaje, reunion, cotizacion, cobro u otra.
- Edicion de titulo, descripcion, prioridad, vencimiento, tipo y responsable activo.
- Cierre con actor y fecha; vencimiento calculado sin persistir un estado ficticio.
- Filtros combinables por responsable, estado, prioridad, tipo y fecha.
- Comentarios internos con autor y fecha e historial durable de cambios.
- Enlaces navegables a contacto u oportunidad y tareas abiertas en la ficha del contacto.
- Centro responsive con estados reales, panel de creacion y detalle.

### No incluido

- Recordatorios y preferencias (`TAR-07`).
- Recurrencia (`TAR-08`).
- Herramientas del agente y automatizaciones (`TAR-13` a `TAR-16`).
- Relacion con conversaciones hasta existir el modulo propietario de chat.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `crm-web`, `api` y modulo propietario `tasks` |
| Contratos y eventos | Extensiones aditivas de Task, query, actualizacion, comentarios e historial |
| Datos y migraciones | Columnas aditivas, comentarios e historial propietario con indices acotados |
| Permisos y aislamiento | Reutiliza `crm:tasks:*`; alcance y relacion se verifican en servidor |
| Configuracion y secretos | Sin cambios |
| Observabilidad y operacion | Sin infraestructura nueva; errores RFC 9457 existentes |
| Documentacion | Ficha, estado y evidencia |

## Plan de implementacion

- [x] Extender contrato, dominio y migracion forward-only.
- [x] Implementar repositorio, servicio y API/BFF con filtros, edicion, comentarios e historial.
- [x] Construir centro visual y relacion desde contacto.
- [x] Agregar pruebas proporcionales de contratos, dominio, SQL y rutas.
- [ ] Validar una vez el candidato en VPS, publicar un PR y desplegar sus digests.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Reasignar a un usuario inactivo | Validar membresia activa en el servicio | Prueba negativa |
| Perder una edicion concurrente | `If-Match`, version e idempotencia en cada mutacion | Conflicto `412` y replay |
| Exponer comentarios o tareas ajenas | Aplicar el mismo alcance SQL a tarea, comentario e historial | Dos actores y denegacion |
| Mezclar vencida con estado persistido | Derivar `EXPIRED` solo al leer tareas abiertas | Reloj controlado |
| Duplicar historial por reintento | Escribir cambio e historial dentro de una transaccion idempotente | Replay sin fila adicional |

## Criterios de aceptacion

- [ ] Crear, editar, reasignar y cambiar estado conserva version e idempotencia.
- [ ] Tipo, prioridad, responsable, vencimiento y relacion son visibles y filtrables.
- [ ] Comentarios e historial muestran autor y fecha sin cruzar alcance.
- [ ] Una tarea completada o cancelada conserva cierre y no vuelve a abrirse.
- [ ] La ficha de contacto muestra sus tareas abiertas con enlaces navegables.
- [ ] La experiencia funciona en escritorio y pantalla estrecha sin datos simulados.

## Plan de verificacion

- Pruebas unitarias: transiciones, edicion, filtros y cierre.
- Pruebas de integracion o contratos: migracion, SQL real, idempotencia, comentarios, historial y API/BFF.
- Pruebas E2E: crear, reasignar, comentar, filtrar y completar desde el CRM.
- Comprobacion manual: recorrido autenticado en el perfil piloto y referencia visual de Stitch.
- Seguridad, permisos y aislamiento: actor sin permiso y recurso fuera de alcance.
- Idempotencia, concurrencia y recuperacion: replay y version obsoleta sin duplicar historia.
- Comandos que deben aprobar: comprobaciones afectadas en VPS y matriz unica de GitHub.

## Recuperacion

- Compatibilidad o migracion: cambio aditivo y valores por defecto para tareas existentes.
- Rollback de aplicacion: la version anterior ignora columnas y tablas nuevas.
- Recuperacion de datos, si aplica: no se eliminan datos; migracion forward-only.

## Evidencia de cierre

- Archivos, commits o PR: candidato `d2de9de` en `feat/TAR-01-12-task-center`; PR pendiente de publicacion.
- Comandos y resultados: en `/opt/quantum/builds/tar01-5152b19` del VPS aprobaron Prettier y ESLint afectados, typecheck de `contracts`, `domain`, `database`, `api` y `crm-web`, 38 casos afectados, validacion Prisma CRM y builds de `database`, `api` y `crm-web` en Node 24.21.0. Una expectativa del doble SQL se corrigio antes del cierre; no hubo defecto productivo asociado.
- Documentacion actualizada: ficha y `estado.md`; checklist oficial permanece abierto hasta despliegue y recorrido autenticado.
- Desviaciones del plan: la relacion con contacto se resolvio dentro de la misma ficha mediante consulta filtrada server-side; no se agregaron recordatorios, recurrencia ni integraciones simuladas.
- Pendientes o decisiones nuevas: recordatorios, recurrencia, chat, agente y automatizaciones conservan sus requisitos propietarios.
