# CON-04-a - Rebanada CRM visible de desarrollo

> Esta ficha agrupa una ruta visible bajo un solo resultado. No sustituye las casillas de `CON-04`, `PIPE-*`, `TAR-*`, `USR-01`, `USR-03` ni `ADM-04`, que se cierran por separado cuando cumplan todo su alcance.

## Identificacion

- Requisito principal: `CON-04`.
- Requisitos relacionados: `ADM-04`, `USR-01`, `USR-03`, `CON-04`, `PIPE-01`, `PIPE-03`, `PIPE-05`, `PIPE-07`, `PIPE-09`, `TAR-01`, `TAR-02`, `TAR-03` y `TAR-06`.
- Fase del MVP: Base del CRM / Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex; roles coordinados de orquestacion, desarrollo y testeo conforme a `PROY-024`.
- Dependencias: release admisible, perfil aislado, `iam` y BFF CRM existentes; `ADM-04-j`, `USR-01` y `USR-03` siguen abiertos.
- Bloquea a: recorrido comercial visible y las extensiones de contactos, ventas y tareas.
- ADR, arquitectura o diseno aplicables: `ADR-0002` a `ADR-0009`, `ADR-0014`, `ADR-0016` a `ADR-0018`, `ADR-0021`, `ADR-0022`, `ADR-0023`, `monorepo.md`, `mapa-del-sistema.md` y `frontends-experiencia-visual.md`.

## Resultado esperado

Un perfil de desarrollo aislado puede iniciar con su administrador inicial y usar `crm-web` para gestionar miembros, contactos, oportunidades y tareas reales: los datos persisten en su base CRM, la API aplica permisos de servidor y las pantallas tienen rutas, carga, vacio, error y denegacion reales. Es un hito de desarrollo visible, no el MVP ni una habilitacion para datos reales.

## Lectura obligatoria aplicada

- [x] Requisitos y subtareas en `funcionalidades.md` y `trabajo.md`.
- [x] Fase y limites de rebanada en `mvp-piloto.md`.
- [x] Estado, fichas `ADM-04-j`, `USR-01`, `USR-03` y busquedas de codigo, pruebas e historial.
- [x] Reglas de Git, pruebas, ejecucion VPS y ADR/arquitectura aplicables.

## Auditoria del trabajo existente

- Encontrado y reutilizado: sesion OIDC CRM con PKCE, cookie opaca, CSRF, BFF restringido, `iam`, migracion CRM, roles iniciales, API protegida y panel real de miembros.
- Ausente: migracion CRM dentro del aprovisionamiento de perfil, administrador inicial/activacion segura, catalogo de permisos comerciales y modulos propietarios de contactos, ventas y tareas.
- Evidencia: la release `35881518779` del commit `de4abc4` aprobo; no hay evidencia tecnica vigente para el commit que implemente esta rebanada. La unica validacion VPS y la unica CI se ejecutan cuando el cambio completo este consolidado.
- Decision: extender puertos, guardas, contratos y BFF existentes. No crear usuario manual, token fijo, mock, proxy generico, roles de Keycloak como autorizacion comercial ni acceso cruzado entre modulos.

## Alcance

### Incluido

- Completar el camino tipado de perfil de desarrollo necesario: migrar la historia CRM, crear el administrador inicial de forma idempotente, entregar su activacion por el componente interno autorizado de un solo uso y activar solo despues de verificar. SMTP queda como adaptador posterior, no como requisito de este hito.
- Extender el catalogo `iam` con permisos tipados para contactos, ventas y tareas; conservar denegacion por defecto y revision de autorizacion.
- Implementar los modulos propietarios `contacts`, `sales` y `tasks` con contratos Zod, migraciones forward-only, API protegida, BFF explicito y pantallas CRM reales.
- Contacto: crear, editar, listar y ver detalle basico; nombre obligatorio y correo o telefono opcionales.
- Ventas: pipeline, etapas ordenadas, oportunidad asociada a contacto, valor no negativo en unidades menores con moneda ISO y movimiento validado de etapa.
- Tareas: crear y asignar tarea vinculada a contacto u oportunidad con titulo, descripcion, prioridad, vencimiento con fecha-hora y zona, y estado. El asignado debe ser un miembro activo.
- Sustituir la navegacion inerte por rutas reales de Equipo, Contactos, Pipeline y Tareas, segun la referencia de Stitch.

### Contrato minimo de esta rebanada

- `ADMINISTRATOR` gestiona miembros y todos los recursos. `SUPERVISOR` opera contactos, oportunidades y tareas del perfil, sin administrar miembros ni configurar pipelines. `ADVISOR` opera solo los contactos y oportunidades propios y las tareas propias o asignadas. El servidor fija propietario/creador y no acepta ese alcance libremente. La futura asignacion comercial sigue abierta en `CON-06` y `PIPE-06`.
- Solo un administrador configura pipelines y etapas; no se crean defaults ni datos simulados. Una oportunidad requiere contacto, pipeline y etapa de ese pipeline. Sus actualizaciones y movimientos llevan version esperada.
- Una tarea se vincula exactamente a un contacto o a una oportunidad; conversaciones siguen fuera de esta rebanada. `dueAt` es RFC 3339 con offset y se conserva en UTC. No se puede asignar una nueva tarea a un miembro inactivo; las relaciones historicas no se borran.
- Correo y telefono no son unicos en este hito: deteccion y combinacion de duplicados pertenecen a `CON-09`. Cada comando que crea o mueve usa `Idempotency-Key`: igual actor, perfil, comando y payload canonico reproduce la respuesta; misma clave con otro payload falla con `409`.

### No incluido

- Importacion, etiquetas, campos personalizados, filtros avanzados, deduplicacion, acciones masivas, automatizaciones, chat, agentes, recordatorios, comentarios, historial completo, roles configurables ni integraciones externas.
- Datos reales, perfil piloto, backup externo, carga, SLO o una declaracion de MVP terminado.

## Plan de implementacion

- [ ] Desarrollo y testeo intercambian el inventario de contratos reutilizados y criterios de aceptacion antes de modificar codigo.
- [ ] El desarrollo completa el perfil de desarrollo sin una via manual y extiende la autorizacion comercial existente.
- [ ] El desarrollo implementa los tres modulos y sus rutas visuales dentro de la misma rama, con migraciones y contratos propietarios.
- [ ] Testeo revisa el cambio contra permisos, aislamiento, idempotencia, errores y no duplicacion antes del unico push.
- [ ] Ejecutar una sola comprobacion afectada en VPS y una sola matriz CI del PR; tras el merge, una sola release por digest y smoke aplicable.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Presentar una pantalla sin perfil real | El aprovisionamiento/migracion/administrador ocurre antes del uso CRM. | Un perfil de desarrollo activo recorre los recursos persistidos. |
| Rol o token cruza perfiles | Permisos del CRM, sesion y base derivan del perfil; API deniega por defecto. | A y B rechazan token, sesion y recurso cruzados. |
| Reintento duplica administrador, oportunidad o tarea | Claves idempotentes y transiciones condicionales en los propietarios. | Repetir el mismo comando no crea un segundo efecto. |
| La rebanada aplaza controles esenciales | Solo se difieren refinamientos globales; persisten permisos, aislamiento, validacion, errores y migraciones. | Revision de testeo y evidencia final. |

## Criterios de aceptacion

- [ ] No existe bypass manual: el perfil activo tiene base CRM migrada y administrador inicial creado/activado por operaciones tipadas.
- [ ] Un administrador autorizado usa rutas reales de Equipo, Contactos, Pipeline y Tareas; cada accion persiste y se lee desde API/BFF.
- [ ] Servidor rechaza identidad, perfil, permiso, recurso o idempotency key invalidos; la interfaz muestra estados seguros.
- [ ] Contacto, oportunidad y tarea permanecen en modulos propietarios y se relacionan solo mediante contratos o IDs estables.
- [ ] La evidencia final corresponde a un solo commit candidato, una comprobacion VPS, una CI y una release, sin repeticiones.

## Plan de verificacion

- Pruebas unitarias: permisos, transiciones, validacion e idempotencia de los tres modulos.
- Pruebas de integracion/contratos: migracion CRM y API/BFF con PostgreSQL, Redis y Keycloak desechables; dos perfiles aislados.
- Prueba E2E: administrador inicia sesion y crea/edita contacto, oportunidad y tarea; permiso denegado no produce mutacion.
- Comprobacion VPS: una sesion aislada del commit candidato con servicios reales, migracion, perfil de desarrollo y recorrido Chromium.
- Comandos que deben aprobar: solo la comprobacion VPS afectada, la matriz `quality` del PR y la release automatica posterior al merge.

## Recuperacion

- Migraciones aditivas y forward-only; no se eliminan datos al revertir aplicacion.
- Un fallo deja perfil/operacion en estado durable y no cambia trafico ni activa un perfil incompleto.
- Un rollback de aplicacion no sustituye restauracion de datos o identidad.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente; se registraran una sola vez para el commit candidato.
- Documentacion actualizada: `PROY-024`, estado y esta ficha al inicio.
- Desviaciones: ninguna al inicio.
- Pendientes: los requisitos relacionados permanecen abiertos hasta completar todas sus subtareas canonicas.
