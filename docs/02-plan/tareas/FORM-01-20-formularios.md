# FORM-01 a FORM-20 - Formularios funcionales

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `FORM-01`.
- Requisitos relacionados: `FORM-02` a `FORM-20`, `CON-04`, `CHAT-06`, `AUTO-01`, `DOC-14`.
- Fase del MVP: fase 6, Calendario y formularios.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: identidad y permisos, contactos, archivos, chat y automatizaciones.
- Bloquea a: captura publica de prospectos, respuestas consultables por el agente y automatizaciones disparadas por formularios.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009 y arquitectura del monorepo.

## Resultado esperado

El usuario del CRM puede crear y editar formularios visuales, publicarlos mediante un enlace, recibir respuestas validadas desde una pagina publica, consultar y exportar los resultados y cerrar la recepcion. Las versiones publicadas son inmutables y cada respuesta conserva la version contestada.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: identificadores `FORM-01` a `FORM-20`, rutas `forms`, `survey` y `questionnaire` en aplicaciones, paquetes, pruebas y migraciones.
- Codigo o documentacion encontrados: requisitos y checklist completos; no existe modulo, contrato, persistencia, API ni interfaz funcional de formularios.
- Pruebas e historial encontrados: no existen pruebas de formularios. Se reutilizan los patrones aprobados de Calendario, Contactos, Documentos, autorizacion y BFF.
- Decision de reutilizacion, extension o reemplazo: crear el modulo propietario `forms` y extender los bordes existentes sin duplicar infraestructura, identidad, contactos, archivos ni comunicaciones.

## Alcance

### Incluido en esta rebanada funcional

- Constructor con secciones, orden estable, todos los tipos de pregunta de `FORM-03`, obligatoriedad, limites y condiciones.
- Personalizacion visual, mensaje final, borrador, vista previa, publicacion versionada y cierre manual o programado.
- Enlace publico, respuesta anonima o asociada mediante referencia explicita, validacion completa en servidor e idempotencia.
- Listado, detalle, filtros basicos y exportacion CSV de respuestas desde el CRM.
- Permisos, aislamiento por perfil, auditoria y evento outbox de respuesta recibida.

### No incluido en esta rebanada

- Adaptadores de correo, WhatsApp u otros proveedores externos.
- Mutacion automatica de contactos, oportunidades o cotizaciones, consumidores de automatizacion y tool MCP; se conectaran desde sus modulos propietarios sin cambiar el contrato de respuestas.
- Carga publica de archivos y contenido multimedia nuevo; se integrara con el modulo `files` sin acceso directo a S3.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `api`, `crm-web`, `contracts`, `domain`, `database` y nuevo modulo propietario `forms` |
| Contratos y eventos | contratos HTTP v1 y evento durable `forms.response.submitted.v1` |
| Datos y migraciones | esquema `forms`, borradores, versiones publicadas, respuestas e idempotencia |
| Permisos y aislamiento | permisos de lectura, escritura, publicacion y respuestas; base aislada por perfil |
| Configuracion y secretos | ninguno |
| Observabilidad y operacion | errores tipados, correlacion existente y outbox transaccional |
| Documentacion | estado, ficha y checklist solo para criterios realmente satisfechos |

## Plan de implementacion

- [x] Definir contratos runtime y permisos.
- [x] Implementar dominio, validacion condicional e idempotencia.
- [x] Crear migracion y repositorio PostgreSQL.
- [x] Exponer API privada y publica.
- [x] Implementar BFF, constructor CRM y pagina publica.
- [x] Validar el candidato en el VPS y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Respuestas incompatibles tras editar | snapshot inmutable por publicacion | prueba de respuesta contra dos versiones |
| Campos ocultos obligatorios bloquean envio | evaluar visibilidad antes de validar | prueba unitaria condicional |
| Duplicados por reintento | clave idempotente durable por formulario | prueba concurrente/integracion |
| Lectura cruzada | repositorio de la base aislada y permisos server-side | prueba de autorizacion y migracion |

## Criterios de aceptacion

- [ ] Un usuario autorizado crea, edita, previsualiza y publica un formulario.
- [ ] El enlace publico permite enviar una respuesta valida sin iniciar sesion.
- [x] Una misma clave idempotente no genera dos respuestas.
- [x] El servidor rechaza campos requeridos visibles ausentes y tipos invalidos.
- [ ] El CRM lista, abre y exporta respuestas con su version publicada.
- [ ] Un formulario cerrado rechaza nuevas respuestas y presenta su mensaje de cierre.

## Plan de verificacion

- Pruebas unitarias: contratos, condiciones, tipos de respuesta, publicacion y cierre.
- Pruebas de integracion o contratos: migracion, persistencia versionada, idempotencia y outbox.
- Pruebas E2E: crear, publicar, responder por enlace y consultar desde CRM.
- Comprobacion manual: constructor y pagina publica en escritorio y movil.
- Seguridad, permisos y aislamiento: operaciones privadas denegadas sin permiso; ruta publica limitada al slug publicado.
- Idempotencia, concurrencia y recuperacion: reenvio de la misma respuesta devuelve el mismo recurso.
- Comandos que deben aprobar: formato afectado, lint afectado, typecheck de paquetes/aplicaciones, pruebas focalizadas, builds de `api` y `crm-web`, migracion sobre PostgreSQL efimero; todo en el VPS.

## Recuperacion

- Compatibilidad o migracion: migracion forward-only aditiva.
- Rollback de aplicacion: version anterior ignora el esquema nuevo.
- Recuperacion de datos, si aplica: los datos creados se conservan; una correccion posterior es forward-only.

## Evidencia de cierre

- Archivos, commits o PR: candidato `9d7903a` en `feat/FORM-01-20-formularios`; PR pendiente de publicacion.
- Comandos y resultados: en el VPS aprobaron Prettier y ESLint afectados; cinco typechecks; seis pruebas focalizadas; builds de contratos, dominio, plataforma, base de datos, autenticacion, API y CRM web; las 19 migraciones CRM sobre PostgreSQL 18; y smoke create/publicar/consultar/enviar/reintentar/listar con una sola respuesta durable.
- Documentacion actualizada: ficha y estado oficial.
- Desviaciones del plan: las integraciones con proveedores externos se excluyeron por decision explicita del propietario.
- Pendientes o decisiones nuevas: CI, integracion, release y smoke autenticado en la interfaz desplegada; archivos publicos, contacto, chat, agente y consumidores de automatizacion permanecen en sus bloques propietarios.
