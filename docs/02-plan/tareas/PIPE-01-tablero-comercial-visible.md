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
- Cambio entre vistas Kanban y tabla sobre la misma respuesta real, conservando movimiento y gestion.
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

- [x] Consolidar la carga de pipeline, oportunidades y contactos reales.
- [x] Construir el tablero Kanban, la vista tabular y sus paneles de creacion/movimiento.
- [x] Agregar pruebas afectadas de comportamiento y contratos cuando cambien.
- [x] Validar una vez el commit candidato en el VPS y publicar un unico PR.

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

- Archivos, commits o PR: candidato `96bfb871be6cccb4e997f72f2ab1da1e49927b94` integrado mediante PR #67 como `43c53089f75163b30664123347e7ac162775a004`; ajuste de vistas Stitch validado sobre `bf3c01ebaa6e7b3f4339df4e72f05d7a3c309438` en `feat/PIPE-01-stitch-views`.
- Comandos y resultados en el VPS: el candidato integrado aprobo Prettier, ESLint, typecheck de cinco paquetes, 17/17 pruebas afectadas y builds de API/CRM web; GitHub aprobo las siete puertas y genero la candidata `60da35d0-d350-522d-b35a-50f832aa9255` con sus diez artefactos. Para el ajuste visual, Prettier y ESLint afectados, typecheck recursivo de `crm-web` y build de sus cuatro consumidores aprobaron en Node 24; no se repitieron pruebas comerciales porque no cambiaron contratos, dominio, datos ni rutas.
- Documentacion actualizada: ficha y `estado.md`; el checklist oficial no se cierra hasta desplegar y recorrer el piloto autenticado.
- Desviaciones del plan: el bloque incorporo asignacion, estados de cierre, motivos, historial y filtros porque son parte del recorrido comercial visible requerido por el piloto.
- Pendientes o decisiones nuevas: publicar el PR del ajuste, promover la release con aprobacion MFA y ejecutar el smoke autenticado. La recomendacion visual del agente no se simula: `PIPE-08` y `PIPE-13` se implementaran en bloques propietarios posteriores.
