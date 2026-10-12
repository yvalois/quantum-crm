# CHAT-01-21 - Bandeja omnicanal y control de atencion

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `CHAT-01`
- Requisitos relacionados: `CHAT-02` a `CHAT-21`, `BASE-01` a `BASE-06`, `CON-08`, `CON-11`, `USR-07`, `USR-08`, `CFG-04`, `CFG-12` y `OPS-16`
- Fase del MVP: 5 - Interaccion inteligente
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: contactos, membresias, roles, permisos, alcance comercial y perfil activo existentes
- Bloquea a: correo y WhatsApp reales, agente conversacional, agenda desde chat, archivos adjuntos y reportes de conversaciones
- ADR, arquitectura o diseno aplicables: ADR-0002 a ADR-0014; `monorepo.md`, `mapa-del-sistema.md`, `frontends-experiencia-visual.md` y `agentes-mcp.md`

## Resultado esperado

Un usuario autorizado opera una bandeja real con conversaciones y mensajes persistidos: busca y filtra, asigna o transfiere, cambia estado, escribe notas internas, responde por el canal elegido y toma o devuelve la atencion al agente sin respuestas simultaneas. El modelo conserva IDs y estados de proveedor para conectar correo, WhatsApp y canales futuros sin duplicar el dominio.

## Lectura obligatoria aplicada

- [x] Requisitos `CHAT-01` a `CHAT-21` en `funcionalidades.md`.
- [x] Fase y dependencias en `mvp-piloto.md`.
- [x] Subtareas e integrada de chat en `trabajo.md`.
- [x] Estado, fichas y busqueda de implementacion existente.
- [x] Reglas de contratos, persistencia, permisos, trabajos, agentes, archivos, Git y verificaciones VPS; ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `CHAT-*`, `conversation`, `message`, `channel`, `assignment`, `human`, `agent`, `contact`, permisos, rutas BFF, migraciones y pruebas.
- Codigo o documentacion encontrados: contactos, IAM, equipos, permisos, alcance comercial, tareas, ventas, BFF CRM y shell visual ya existen. No existe modulo `conversations`, contrato, tablas, controlador ni bandeja funcional que pueda presentarse como implementado.
- Pruebas e historial encontrados: patrones reutilizables de contactos, tareas, membresias, errores RFC 9457, version optimista y repositorios PostgreSQL.
- Decision de reutilizacion, extension o reemplazo: crear el modulo propietario `conversations` y reutilizar AuthContext, membresias, contactos, paginacion, BFF y componentes visuales; los proveedores quedan detras de un puerto publico de canal.

## Alcance

### Incluido

- Conversaciones, participantes, mensajes, notas internas, asignaciones, historial, estado y modo humano/IA durables.
- Contratos v1, permisos y validacion server-side; cursores, filtros y ETag/If-Match.
- Creacion idempotente de mensajes entrantes y salientes con identificadores estables de canal y estados observados.
- Toma, transferencia y reactivacion controlada; invalidacion de respuestas pendientes mediante revision de conversacion.
- Respuestas rapidas y bandeja CRM responsive con lista, hilo, editor y panel de contacto.
- Puerto de canal y eventos/outbox necesarios para adaptadores de correo, WhatsApp y canales futuros.

### No incluido

- Afirmar entrega real por correo o WhatsApp sin credenciales y sandbox aprobados.
- Adjuntos disponibles antes del pipeline real de `files` y ClamAV.
- Resumen de IA o ejecucion LangGraph antes del runtime/MCP funcional; se conserva el contrato y estado requerido.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `api`, `crm-web`, `worker`; nuevo modulo `conversations` dentro de `domain` |
| Contratos y eventos | HTTP v1, estados de mensajes y eventos de conversacion versionados |
| Datos y migraciones | schema `conversations` con conversaciones, mensajes, asignaciones, respuestas rapidas e historial |
| Permisos y aislamiento | permisos de lectura, respuesta, asignacion y control de agente; alcance de datos aplicado en servidor |
| Configuracion y secretos | sin secretos de proveedor en esta rebanada base |
| Observabilidad y operacion | correlacion, fallos seguros, outbox y estado desconocido visible |
| Documentacion | ficha, estado, checklist y contratos afectados |

## Plan de implementacion

- [x] Crear contratos, dominio y permisos de conversaciones.
- [x] Añadir migracion y repositorio PostgreSQL con aislamiento, orden e idempotencia.
- [x] Componer API y BFF protegidos.
- [x] Implementar bandeja CRM completa y responsive.
- [x] Añadir pruebas proporcionales y validar el candidato exacto en el VPS.
- [x] Desplegar la rebanada y comprobar el recorrido autenticado.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Respuestas simultaneas de humano e IA | revision optimista y comprobacion del modo justo antes de publicar | carrera controlada y respuesta tardia rechazada |
| Mensaje duplicado por webhook o reintento | clave unica por perfil, canal e ID externo; idempotencia durable | mismo evento repetido converge |
| Acceso a conversaciones ajenas | AuthContext, alcance comercial y filtros server-side | dos perfiles y usuario fuera de alcance |
| Confundir nota interna con mensaje externo | tipos y comandos separados; el puerto de canal nunca recibe notas | prueba de contrato y API |
| Estado externo incierto | estado `UNKNOWN`/`FAILED` observable y conciliacion antes de repetir | prueba de fallo posterior al envio |

## Criterios de aceptacion

- [x] La bandeja lista conversaciones reales con filtros, responsable, estado, canal y no leidos.
- [x] El hilo conserva orden, autor, dirección, estado y notas internas diferenciadas.
- [x] Asignar, transferir, cerrar, tomar y reactivar exige permiso y version vigente.
- [ ] Una toma humana invalida respuestas pendientes del agente y bloquea seguimientos. La invalidacion por revision ya esta verificada; falta conectar el bloqueo con el programador de seguimientos.
- [x] Repetir el mismo comando saliente con la misma clave y payload no crea dos conversaciones ni mensajes.
- [x] Correo y WhatsApp pueden implementarse como adaptadores sin cambiar entidades o API de la bandeja.

## Plan de verificacion

- Pruebas unitarias: transiciones, permisos, modo, secuencia, idempotencia y respuestas rapidas.
- Pruebas de integracion o contratos: migracion/repo PostgreSQL, API/BFF, cursores y conflictos.
- Pruebas E2E: abrir bandeja, responder, tomar, transferir, cerrar y reactivar.
- Comprobacion manual: escritorio y movil contra el perfil sintetico del VPS.
- Seguridad, permisos y aislamiento: dos perfiles, dos alcances y nota no enviable.
- Idempotencia, concurrencia y recuperacion: duplicado, revision obsoleta y resultado externo incierto.
- Comandos que deben aprobar: comprobaciones afectadas en VPS y una matriz completa en GitHub.

## Recuperacion

- Compatibilidad o migracion: migracion forward-only y contratos v1 aditivos.
- Rollback de aplicacion: la version anterior ignora las tablas nuevas; no se eliminan datos.
- Recuperacion de datos, si aplica: mensajes e historial son append-only; reconciliacion reanuda entregas inciertas sin duplicar.

## Evidencia de cierre

### Canales completos CHAT-11 / CHAT-14 — 2026-10-11 (DESPLEGADO)

- Ampliacion aditiva exclusiva del filtro de consulta: Instagram, Messenger/Facebook, TikTok, Google Business, llamadas, formularios y registros sin canal identificado. No habilita canales nuevos de creacion o envio.
- La consulta SQL filtra con el mismo canal inferido que muestra la lista, conserva aliases del origen, permisos y paginacion. Iconos diferenciados y filtro directo en la bandeja.
- PR #132, candidato `827f4c9c` (runtime sin diferencias respecto a `7b7098c8`): cinco typechecks, formato/lint, 81 pruebas enfocadas y nueve PostgreSQL reales sobre perfiles sinteticos aprobados en VPS; siete checks CI verdes. Ocho Playwright aprobados: seis inicialmente y dos tras corregir un selector de prueba `getByLabel` por el nombre accesible del combobox. No era intermitencia ni un reintento automatico: solo se repitieron los dos casos afectados por la correccion del test; el resto de evidencia permanece vigente.
- Iconos Messenger y Google embebidos desde Simple Icons CC0, conservando estilo compacto y etiquetas accesibles; las marcas se comprueban en lista, cabecera y mensaje. Filtros combinados, cursor reiniciado, vacios, consulta nativa/historica y limpieza acreditados; no se amplia envio.
- API `sha256:c8845494b6c0724a140604a9fd4a3a8fb6b21f81c95c06dbc792861f3d5c8138` y CRM web `sha256:e252f2cf864c1ee97500374457ba68f3b7bf974559ee2bbe82eba14ee4a94644`, un build por imagen. Ambos saludables, predecesores `before-ghl-827f4c9caeb7` conservados y recibo privado `/opt/quantum/config/staging/candidates/827f4c9caeb7b6844734259fe061ade50815b7a8/interamerican-channel-filters.json`.
- Navegador autenticado: once opciones mas Todos; Facebook/Messenger devuelve 17 filas y 17 logos sin canales mezclados ni alertas; Todos restablece 30 filas. Sin migraciones, reimportaciones ni escrituras comerciales. Next de prueba detenido; capturas exclusivamente sinteticas fuera de Git. Cierre documental reutiliza evidencia y no provoca nuevos builds ni despliegues manuales.
- Pendientes de estabilizacion posterior: envio externo sigue diferido por el propietario; no se inventan canales para registros sin evidencia.

### Identidad visual propia CHAT-13 / CHAT-14 — 2026-10-11

- Ajuste acotado al frontend: marca TikTok en lista/hilo y textos neutrales en conversaciones, responsables y enlace desde Contactos. Se retiran badges del proveedor anterior; los placeholders exactos del importador se ocultan tambien en la vista previa, sin modificar asuntos ni mensajes escritos por clientes.
- Icono SVG embebido de [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/tiktok.svg), proyecto CC0; sin nueva dependencia ni llamadas externas para renderizarlo. Conserva etiqueta accesible TikTok.
- Procedencia tecnica, IDs, permisos, archivos, datos y restricciones de envio intactos. No requiere API, migraciones ni reimportacion.
- PR #131, `5eead687`: formato, ESLint, typecheck CRM y cuatro pruebas de canales aprobadas en VPS; seis Playwright sin reintentos (26 s), incluyendo TikTok en lista/hilo/mensaje, ausencia de marca del proveedor en UI y conservacion de un mensaje sintetico que la menciona. Siete checks CI verdes. No se repiten pruebas ni builds al registrar este cierre documental.
- CRM desplegado una vez: `sha256:1bd510fe6244387b5dd5d0ee7f87676c88aa82023582051f6abe31632a8e065a`, predecesor `before-ghl-5eead687f908` conservado. API intacta. Recibo privado `/opt/quantum/config/staging/candidates/5eead687f9080e8c0e64a7433f48cf9796c040cb/interamerican-neutral-branding.json`. Smoke autenticado confirma lista, mensajes y contexto sin marca del proveedor ni alertas. Pendientes de estabilizacion posterior sin cambios; envio externo sigue diferido por el propietario.

### Bandeja unica CHAT-11 / CHAT-13 / CHAT-14 — 2026-10-11

- Sustituye la separacion visual activa/GHL: `/inbox` consume `/api/v1/conversations/inbox`, mezcla ambos origenes en una lista y comparte seleccion y ficha. GHL solo identifica procedencia; no se fusionan hilos ni identidades ambiguas.
- Una consulta PostgreSQL paginada aplica permisos/alcance antes de ordenar globalmente; el cursor conserva microsegundos y desempates por origen/UUID. Busqueda por asunto/contenido, filtros compartidos y compatibilidad de enlaces `contactId`/`history=1`. Se reutilizan las APIs de detalle y archivos verificados.
- Candidato `e69763a1`: cinco typechecks, ESLint, 75 pruebas enfocadas (incluidas cuatro de arquitectura), ocho PostgreSQL sobre dos perfiles sinteticos y cinco Playwright aprobados en VPS, sin reintentos. E2E cubre escritorio/movil, fuentes mixtas, paginacion, busqueda, seleccion, customs, responsables, descarga y reproduccion real de medios sinteticos.
- Sin migracion, reimportacion ni escrituras comerciales para verificar. Envio externo sigue diferido expresamente; los controles nativos mantienen intencion durable/QUEUED sin afirmar entrega.
- PR #130, siete checks CI verdes en `c4bdcc0b`; su diferencia frente a `e69763a1` es exclusivamente documental y reutiliza evidencia. API y CRM publicados una vez por digest en InterAmerican, ambos healthy. Navegador autenticado confirma cero pestanas por origen, ficha y participantes originales, dos paginas de 30 filas sin duplicados, mensajes conservados al paginar, sin errores ni overflow horizontal. Sin capturas ni datos reales en Git.
- API: `sha256:849139a8e7de532dba9b5b17e9d694f913ef1ce1fe9f4fde4553d575f1b77abf`. CRM: `sha256:3ba37aaa47133f117df7a6e8cfc8a1707afd8f017a50a38812edc90cfa08b57a`. Recibo privado del despliegue: `/opt/quantum/config/staging/candidates/e69763a1cea6da76d56bbc74611eea0646d833ca/interamerican-deployment.json`; predecesores `before-ghl-e69763a1cea6` conservados.
- Recuperacion: componentes anteriores conservados; rollback de aplicacion sin restaurar ni modificar datos. Los requisitos completos CHAT-11/13/14 permanecen abiertos; este bloque acredita exclusivamente la bandeja unica.

### Identidad y ficha contextual del 2026-10-11

- PR #128, `d3eb5810`: contactos relacionados consultados por IDs acotados bajo permisos y alcance del actor, incluidos archivados. Nombres en listado e hilo y ficha compartida con correo, telefono, etiquetas y customs en bandeja activa e historial, escritorio/movil. Los filtros del historial no modifican asociaciones ni ocultan definitivamente los hilos sin contacto.
- Cinco typechecks, ESLint, 59 pruebas enfocadas, una integracion PostgreSQL de permisos/aislamiento/archivado y tres Playwright aprobados en VPS; siete checks CI verdes. API/CRM desplegados una vez por digest y healthy, sin migracion. Digests y recibo en `estado.md`.
- Revision autenticada real confirma nombres, ficha, valores personalizados y conservacion del historial sin correspondencia. Capturas sinteticas fuera de Git. Sin envio de mensajes ni cambios de datos reales para probar.
- Pendientes de estabilizacion posterior: datos de clientes ausentes en el artefacto de origen requieren recuperacion verificable desde la fuente; no se reconstruyen mediante coincidencias ambiguas.

### Ajuste visual acotado del 2026-10-11

- PR #127, candidato `e8656adb`: cabecera compacta, filtros horizontales, paneles lista/hilo/contexto y scroll independiente; historial GHL con presentacion coherente y mensajes entrantes/salientes diferenciados. Sin modificar envio, proveedores, contratos o identidad.
- VPS: formato/ESLint/typecheck afectados aprobados; suite `playwright.workspaces.config.ts` 3/3 sin reintentos, incluyendo inbox desktop/390px, borrador sin envio y descarga de adjunto sintetico autorizado. Siete checks CI aprobados; capturas solo sinteticas fuera de Git.
- CRM web publicado y healthy en InterAmerican; navegador autenticado confirma lista e hilo importado sin overflow horizontal. Digest/recibo en `estado.md`; API no reiniciada, sin migraciones ni cambios de datos.
- Pendientes de estabilizacion posterior: historial importado permanece de consulta; adaptadores externos y mayor paridad funcional no forman parte de este bloque visual.

### Extension YCloud para InterAmerican (`CHAT-14` / `CFG-06`, 2026-10-11)

- Canal autorizado: el numero terminado en 4370 queda ligado solo al perfil InterAmerican mediante archivo de secreto montado en su API. El webhook publico atraviesa CRM web sin sesion humana y verifica HMAC sobre el cuerpo original, antiguedad de la firma, WABA y numero antes de tocar datos.
- Eventos incluidos: entrantes, ecos enviados desde WhatsApp Business App e historial compartido que YCloud entregue. Contactos y conversaciones se resuelven por telefono dentro de la base aislada; el `wamid` y el hilo estable deduplican reintentos. No se genera outbox por mensajes ya enviados desde el telefono.
- Evidencia técnica: en el VPS aprobaron los typechecks afectados, 12 pruebas enfocadas, lint y builds de API, CRM web y deploy-host. El webhook y secreto se configuraron fuera de Git; se observó el mensaje real «Prueba Quantum» en la bandeja de InterAmerican. Tras integrar las mejoras de CRM y YCloud en el candidato `dbb9c480`, API y CRM web compilaron de nuevo, quedaron saludables y un POST firmado al endpoint público devolvió 201. Navegador autenticado confirmó hilo, ficha y bandeja única. Esta evidencia acredita recepción y visualización, no envío, adjuntos ni recuperación retroactiva.
- Pendientes de estabilizacion posterior: descarga de medios mediante `files` y ClamAV, adaptador saliente desde el CRM, y determinar si YCloud permite reemitir historial anterior al webhook. La suscripcion `whatsapp.smb.history` sola no garantiza recuperacion retroactiva.

- Archivos, commits o PR: contratos `conversations/v1`, servicio de dominio, repositorio PostgreSQL, migracion `20260930020000_chat_omnichannel_inbox`, controlador API, BFF y ruta visual `/inbox` en `feat/CHAT-01-21-omnichannel-inbox`.
- Comandos y resultados: Node 24 en el VPS aprobo Prettier y ESLint afectados, cinco typechecks, 8/8 pruebas nuevas, builds de `api` y `crm-web`; PostgreSQL 18.1 desechable aplico desde cero las 14 migraciones, creo seis tablas de conversaciones, sembro 13 permisos por rol y confirmo privilegios runtime.
- Recorrido real del 2026-10-04 en `quantum-demo-jueves`: se creo la conversacion `a01243c1-3ba5-47c2-88e0-bb62f3f0035f`, el reintento con la misma clave devolvio el mismo ID y una respuesta preparada con revision anterior fue rechazada despues de pasar de agente a atencion humana. El mensaje `3778701d-7583-4725-b161-feab5dfb8c2a` se reintento con la misma clave, conservo un solo registro y quedo honestamente `QUEUED`. La conversacion queda visible en `/inbox` hasta conectar un proveedor.
- Documentacion actualizada: alcance de plantillas `DOC-15`, checklist de trabajo, ficha y estado oficial.
- Desviaciones del plan: no se afirma entrega externa. Correo, WhatsApp, SMS y chat web registran intencion durable en outbox y muestran `QUEUED` hasta disponer de credenciales y adaptadores reales.
- Pendientes o decisiones nuevas: adaptadores reales de entrada/salida, deduplicacion de webhooks por ID externo, reintento/conciliacion del proveedor, adjuntos generales mediante `files` y resumen LangGraph/MCP. No se afirma entrega externa antes de configurar el proveedor.
