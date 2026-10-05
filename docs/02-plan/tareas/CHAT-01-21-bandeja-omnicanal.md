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

- Archivos, commits o PR: contratos `conversations/v1`, servicio de dominio, repositorio PostgreSQL, migracion `20260930020000_chat_omnichannel_inbox`, controlador API, BFF y ruta visual `/inbox` en `feat/CHAT-01-21-omnichannel-inbox`.
- Comandos y resultados: Node 24 en el VPS aprobo Prettier y ESLint afectados, cinco typechecks, 8/8 pruebas nuevas, builds de `api` y `crm-web`; PostgreSQL 18.1 desechable aplico desde cero las 14 migraciones, creo seis tablas de conversaciones, sembro 13 permisos por rol y confirmo privilegios runtime.
- Recorrido real del 2026-10-04 en `quantum-demo-jueves`: se creo la conversacion `a01243c1-3ba5-47c2-88e0-bb62f3f0035f`, el reintento con la misma clave devolvio el mismo ID y una respuesta preparada con revision anterior fue rechazada despues de pasar de agente a atencion humana. El mensaje `3778701d-7583-4725-b161-feab5dfb8c2a` se reintento con la misma clave, conservo un solo registro y quedo honestamente `QUEUED`. La conversacion queda visible en `/inbox` hasta conectar un proveedor.
- Documentacion actualizada: alcance de plantillas `DOC-15`, checklist de trabajo, ficha y estado oficial.
- Desviaciones del plan: no se afirma entrega externa. Correo, WhatsApp, SMS y chat web registran intencion durable en outbox y muestran `QUEUED` hasta disponer de credenciales y adaptadores reales.
- Pendientes o decisiones nuevas: adaptadores reales de entrada/salida, deduplicacion de webhooks por ID externo, reintento/conciliacion del proveedor, adjuntos generales mediante `files` y resumen LangGraph/MCP. No se afirma entrega externa antes de configurar el proveedor.
