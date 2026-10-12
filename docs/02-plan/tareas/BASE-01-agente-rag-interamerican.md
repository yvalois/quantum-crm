# BASE-01 — Primer agente RAG de InterAmerican

> Bloque funcional de prueba conversacional por WhatsApp para InterAmerican. No sustituye el alcance completo de BASE-01.

## Identificacion

- Requisito principal: `BASE-01`.
- Requisitos relacionados: `CHAT-02`, `CHAT-03`, `CHAT-14`, `CHAT-15`, `CHAT-17`, `BASE-02`, `BASE-06`, `ADM-18`.
- Fase del MVP: 5, interaccion inteligente.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Quantum CRM.
- Dependencias: archivos `AVAILABLE`, identidad de perfil, credencial OpenAI fuera de Git y API por perfil.
- Bloquea a: activacion conversacional posterior del agente.
- ADR, arquitectura o diseno aplicables: ADR-0012, ADR-0013, ADR-0004, `docs/08-arquitectura/agentes-mcp.md`.

## Resultado esperado

Un mensaje de WhatsApp recibido por el canal YCloud autorizado inicia una consulta LangGraph sobre los catalogos individual o corporativo en toda conversacion nueva no historica. Los hilos ya existentes conservan su modo actual. La respuesta sustentada se envia por ese mismo canal y queda en la bandeja; un humano puede detener la atencion automatica. Los reintentos no duplican respuestas ni envios.

## Lectura obligatoria aplicada

- [x] Requisito, fase y subtareas de `BASE-01` y `CHAT-03` revisados.
- [x] Estado y evidencia previa revisados: `agent-runtime` actual solo expone salud.
- [x] ADR-0012, arquitectura de agentes y reglas de archivos, identidad, secretos y VPS revisadas.

## Auditoria del trabajo existente

- Export n8n: 201 nodos; solo se reutiliza la separacion de dos herramientas RAG por tipo de catalogo y su criterio de no inventar datos. Los nodos de imagen, audio, seguimiento y escalamiento no se trasladan.
- Catalogos: dos PDF de 33 paginas con texto extraible; no se incorporan a Git ni a fixtures.
- Codigo: `apps/agent-runtime` solo tiene health; no hay MCP ni indice RAG implementados. Se reutilizan sesion CRM, Files y la API aislada por perfil.

## Alcance

### Incluido

- Recepcion de WhatsApp, control agente/humano, consulta RAG y respuesta por YCloud para InterAmerican.
- Dos fuentes separadas, individual y corporativa, cargadas y procesadas tras validacion de Files.
- LangGraph TypeScript con recuperacion obligatoria y respuesta basada en fuentes.
- Contratos, permisos, aislamiento, limites, idempotencia de consulta y evidencia operativa.

### No incluido

- Imagenes, audio, envio de PDF, follow-ups, asignacion y migracion literal del prompt n8n.
- Completar todos los requisitos BASE-01 a BASE-03 o todos los tools MCP.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | API por perfil, worker de mensajes, `agent-runtime`, Files y gateway MCP de lectura |
| Contratos y eventos | Consulta de fuentes, ejecucion de agente y salida WhatsApp |
| Datos y migraciones | Fuentes e indice por perfil; intento y salida durables, migraciones aditivas e idempotentes |
| Permisos y aislamiento | Administrador CRM y principal de agente limitados al perfil |
| Configuracion y secretos | Credencial OpenAI montada via `*_FILE`; nada en Git o logs. El propietario decidio usar la clave ya compartida sin rotarla durante esta prueba. |
| Observabilidad y operacion | Resultado y fallo tipados, timeout y limites; sin contenido sensible en logs |
| Documentacion | Estado, evidencia, pendientes y procedimiento de carga/rotacion |

## Plan de implementacion

- [ ] Preparar fuente de catalogos por Files con scan y revision fija.
- [ ] Implementar recuperacion por catalogo y gateway de lectura autorizado.
- [ ] Implementar grafo LangGraph y contrato de consulta de prueba.
- [ ] Conectar recepcion YCloud con ejecucion LangGraph: modo agente automatico en hilos nuevos no historicos y control humano en los existentes.
- [ ] Persistir salida, despacharla por YCloud y conciliar su resultado sin duplicados.
- [x] Cargar la credencial directamente en el VPS como archivo secreto; permisos `600` y OpenAI `/v1/models` `HTTP 200` sin transmitir el valor en comandos o salidas.
- [ ] Validar consultas con fuentes reales, Files y aislamiento.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Mezclar precios o condiciones de ambos catalogos | Seleccion y filtro deterministas por catalogo | Preguntas cruzadas y ausencia de resultados |
| Instrucciones maliciosas dentro de PDF | Tratar fragmentos como datos, sin tools de escritura | Evaluacion de prompt injection |
| Exponer credencial o contenido | Archivo secreto, logs redactados, originales fuera de Git; riesgo residual de clave previamente expuesta aceptado por el propietario para esta prueba | Scan de secretos y revision de diff |
| Respuesta sin respaldo | Evidencia por pagina y abstencion | Preguntas conocidas y desconocidas |

## Criterios de aceptacion

- [ ] Mensajes reales en InterAmerican reciben respuesta sustentada en WhatsApp y visible en la bandeja para ambos catalogos.
- [ ] No se puede consultar otro perfil ni usar fuentes no disponibles.
- [ ] Solo responde en modo agente, asignado automaticamente a hilos nuevos no historicos; no procesa imagenes/audio ni ejecuta otras escrituras comerciales.
- [ ] Runtime, API y CRM saludables en VPS; comprobacion enfocada y CI verde.

## Plan de verificacion

- Unitarias: clasificacion, limites, abstencion y formato de referencias.
- Integracion: dos perfiles sinteticos, permisos y seleccion de fuente.
- E2E: mensaje real por WhatsApp pregunta a ambos catalogos y observa respuesta/citas en telefono y bandeja; modo humano detiene respuestas.
- Seguridad: token de servicio, archivos `AVAILABLE`, secreto montado y ausencia de fuga en logs.
- Recuperacion: migracion aditiva, reindexacion idempotente y rollback del runtime sin modificar fuentes.

## Evidencia de cierre

- El canal entrante y el secreto de firma se verificaron con un mensaje real. La clave de envio YCloud se guardo como archivo privado del perfil y la API de lectura del proveedor respondio `HTTP 200`.
- Despacho de texto, lease durable, limite de reintentos, estado de entrega y red de salida preparados en la rama; typecheck, lint y pruebas enfocadas aprobados en el VPS de desarrollo. No se marca envio completado sin publicacion y prueba real.
- El candidato agrega cola de ejecucion con lease, MCP de solo lectura autorizado, cliente OAuth aislado y compuerta que exige ambos catalogos `AVAILABLE` y activos. En VPS: 31 pruebas enfocadas, validacion Prisma, typecheck y builds afectados aprobados. Los hilos entrantes nuevos no historicos quedan en modo agente; los historicos y existentes no se cambian.
- Pendientes de implementacion y validacion: carga de los catalogos por Files, busqueda MCP, identidad de servicio, ejecucion LangGraph y respuesta real en WhatsApp. No se marca terminado.
