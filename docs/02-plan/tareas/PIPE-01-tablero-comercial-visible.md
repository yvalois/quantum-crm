# PIPE-01 - Tablero comercial visible

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `PIPE-01`.
- Requisitos relacionados: `PIPE-03`, `PIPE-05` a `PIPE-07`, `PIPE-09` a `PIPE-12`, `PIPE-14`, `PIPE-15`, `CON-04`.
- Fase del MVP: 4 - Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: perfil piloto, OIDC CRM, permisos comerciales, contactos y persistencia de ventas ya desplegados.
- Bloquea a: cierre del nucleo comercial, historial, automatizaciones y acciones del agente sobre oportunidades.
- ADR, arquitectura o diseno aplicables: ADR-0002 a ADR-0007, ADR-0014, `monorepo.md` y `frontends-experiencia-visual.md`.

## Resultado esperado

Un usuario autorizado entra al CRM y opera un tablero Kanban real: selecciona un pipeline, ve sus etapas y oportunidades con contacto y valor, crea una oportunidad y la mueve de etapa con persistencia, control de version, permisos e idempotencia. La experiencia es presentable en escritorio y movil y no usa datos simulados.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: requisitos `PIPE-*`, historial Git, contratos y pruebas de `sales`, repositorio PostgreSQL, controlador NestJS, BFF y pantalla `/pipeline`.
- Codigo o documentacion encontrados: pipelines, etapas y oportunidades persistentes; permisos server-side; idempotencia de creacion y movimiento; control optimista; BFF y pantalla funcional basica.
- Pruebas e historial encontrados: pruebas de dominio de ventas y la rebanada integrada por PR #39; la release actual ya contiene la base comercial.
- Decision de reutilizacion, extension o reemplazo: conservar contratos, dominio, repositorio, API y BFF; reemplazar solo la composicion visual de `/pipeline` y extender respuestas publicas estrictamente cuando el tablero lo necesite.

## Alcance

### Incluido

- Tablero por etapas del pipeline seleccionado, con totales y estados vacios reales.
- Tarjetas con oportunidad, contacto, importe y moneda.
- Creacion de pipelines, etapas y oportunidades desde paneles contextuales.
- Movimiento accesible por seleccion de etapa con version e idempotencia existentes.
- Asignacion a un asesor activo, cierre comercial con motivo e historial visible.
- Filtros por pipeline, etapa, asesor, estado, etiqueta y fecha.
- Carga, error, sesion expirada, responsive y foco visible.

### No incluido

- Agente MCP y automatizaciones de cambio de etapa; conservan sus requisitos `PIPE-08` y `PIPE-13`.
- Datos ficticios precargados o cierres documentales de requisitos cuyas subtareas aun no se implementan.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `crm-web` y, solo si falta informacion publica, contratos/API de `sales` |
| Contratos y eventos | Reutilizacion de `Pipeline` y `Opportunity`; extension compatible si se expone nombre de contacto |
| Datos y migraciones | Estado comercial, cierre e historial aditivos sobre oportunidades existentes |
| Permisos y aislamiento | Se conservan `crm:sales:*` y el alcance comercial resuelto en servidor |
| Configuracion y secretos | Sin cambios |
| Observabilidad y operacion | Errores existentes, sin nueva infraestructura |
| Documentacion | Ficha, estado y evidencia final |

## Plan de implementacion

- [ ] Consolidar la carga de pipeline, oportunidades y contactos reales.
- [ ] Construir el tablero Kanban y sus paneles de creacion/movimiento.
- [ ] Agregar pruebas afectadas de comportamiento y contratos cuando cambien.
- [ ] Validar una vez el commit candidato en el VPS y publicar un unico PR.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Mostrar oportunidades en etapa incorrecta | Agrupar por `stageId` dentro del pipeline seleccionado | Prueba de render y recorrido real |
| Perder cambios concurrentes al mover | Reutilizar `If-Match` y version de la oportunidad | Caso de conflicto `412` existente/afectado |
| Exponer datos fuera del alcance | Mantener consultas y permisos del API; el BFF no acepta perfil | Prueba de autorizacion y smoke autenticado |
| Confundir una mejora visual con cierre total | Marcar solo subtareas demostradas y dejar pendientes explicitos | Revision de checklist y estado |

## Criterios de aceptacion

- [ ] El tablero usa exclusivamente respuestas reales de API/BFF.
- [ ] Cada oportunidad aparece en una sola etapa del pipeline seleccionado.
- [ ] Crear y mover conserva idempotencia, version y pertenencia de etapa.
- [ ] El contacto y el valor son comprensibles sin exponer identificadores tecnicos.
- [ ] El recorrido funciona con estados vacio, carga, error y pantalla estrecha.

## Plan de verificacion

- Pruebas unitarias: agrupacion, seleccion de pipeline y formato monetario si se extraen como funciones.
- Pruebas de integracion o contratos: solo las afectadas si cambia un schema o endpoint.
- Pruebas E2E: login, crear pipeline/etapas/contacto/oportunidad y moverla.
- Comprobacion manual: tablero real en el VPS con viewport de escritorio y movil.
- Seguridad, permisos y aislamiento: denegacion server-side y ausencia de `tenant_id` cliente.
- Idempotencia, concurrencia y recuperacion: reutilizar pruebas vigentes; nueva evidencia solo si cambia esa ruta.
- Comandos que deben aprobar: comprobaciones afectadas en VPS y matriz unica de GitHub.

## Recuperacion

- Compatibilidad o migracion: cambio aditivo de interfaz; no cambia datos en el alcance inicial.
- Rollback de aplicacion: desplegar el digest anterior; los datos comerciales permanecen compatibles.
- Recuperacion de datos, si aplica: no aplica porque no hay cambio destructivo.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: ficha y `estado.md` al inicio.
- Desviaciones del plan: ninguna al inicio.
- Pendientes o decisiones nuevas: `PIPE-08` y `PIPE-13` se implementaran en bloques propietarios posteriores.
