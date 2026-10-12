# BASE-01 — Primer agente RAG de InterAmerican

> Plan derivado para una capacidad de prueba manual. No sustituye el alcance completo de BASE-01 ni acredita envio automatico.

## Identificacion

- Requisito principal: `BASE-01`.
- Requisitos relacionados: `CHAT-03`, `BASE-02`, `BASE-06`, `ADM-18`.
- Fase del MVP: 5, interaccion inteligente.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Quantum CRM.
- Dependencias: archivos `AVAILABLE`, identidad de perfil, credencial OpenAI fuera de Git y API por perfil.
- Bloquea a: activacion conversacional posterior del agente.
- ADR, arquitectura o diseno aplicables: ADR-0012, ADR-0013, ADR-0004, `docs/08-arquitectura/agentes-mcp.md`.

## Resultado esperado

Un administrador de InterAmerican puede consultar manualmente al primer agente LangGraph desde CRM. El agente recupera solo texto pertinente del catalogo individual o corporativo, responde en espanol con referencias comprobables y reconoce cuando la fuente no respalda una afirmacion. No envia mensajes ni ejecuta acciones comerciales.

## Lectura obligatoria aplicada

- [x] Requisito, fase y subtareas de `BASE-01` y `CHAT-03` revisados.
- [x] Estado y evidencia previa revisados: `agent-runtime` actual solo expone salud.
- [x] ADR-0012, arquitectura de agentes y reglas de archivos, identidad, secretos y VPS revisadas.

## Auditoria del trabajo existente

- Export n8n: 201 nodos; solo se reutiliza la separacion de dos herramientas RAG por tipo de catalogo y su criterio de no inventar datos. Los nodos de imagen, audio, envio, seguimiento y escalamiento no se trasladan.
- Catalogos: dos PDF de 33 paginas con texto extraible; no se incorporan a Git ni a fixtures.
- Codigo: `apps/agent-runtime` solo tiene health; no hay MCP ni indice RAG implementados. Se reutilizan sesion CRM, Files y la API aislada por perfil.

## Alcance

### Incluido

- Consulta manual del agente desde CRM para InterAmerican.
- Dos fuentes separadas, individual y corporativa, cargadas y procesadas tras validacion de Files.
- LangGraph TypeScript con recuperacion obligatoria y respuesta basada en fuentes.
- Contratos, permisos, aislamiento, limites, idempotencia de consulta y evidencia operativa.

### No incluido

- Imagenes, audio, envio de PDF, WhatsApp automatico, follow-ups, asignacion, escritura CRM o migracion literal del prompt n8n.
- Completar todos los requisitos BASE-01 a BASE-03 o todos los tools MCP.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | CRM web, API por perfil, `agent-runtime`, Files y gateway de lectura |
| Contratos y eventos | Contratos de consulta, fuentes y resultado; sin eventos salientes |
| Datos y migraciones | Fuentes y revision del indice por perfil, migracion aditiva e idempotente |
| Permisos y aislamiento | Administrador CRM y principal de agente limitados al perfil |
| Configuracion y secretos | Credencial OpenAI montada via `*_FILE`; nada en Git o logs. El propietario decidio usar la clave ya compartida sin rotarla durante esta prueba. |
| Observabilidad y operacion | Resultado y fallo tipados, timeout y limites; sin contenido sensible en logs |
| Documentacion | Estado, evidencia, pendientes y procedimiento de carga/rotacion |

## Plan de implementacion

- [ ] Preparar fuente de catalogos por Files con scan y revision fija.
- [ ] Implementar recuperacion por catalogo y gateway de lectura autorizado.
- [ ] Implementar grafo LangGraph y contrato de consulta de prueba.
- [ ] Exponer prueba manual en CRM, sin canal saliente.
- [ ] Validar con fuentes reales solo despues de cargar la credencial directamente en el VPS como archivo secreto, sin volver a transmitirla por chat.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Mezclar precios o condiciones de ambos catalogos | Seleccion y filtro deterministas por catalogo | Preguntas cruzadas y ausencia de resultados |
| Instrucciones maliciosas dentro de PDF | Tratar fragmentos como datos, sin tools de escritura | Evaluacion de prompt injection |
| Exponer credencial o contenido | Archivo secreto, logs redactados, originales fuera de Git; riesgo residual de clave previamente expuesta aceptado por el propietario para esta prueba | Scan de secretos y revision de diff |
| Respuesta sin respaldo | Evidencia por pagina y abstencion | Preguntas conocidas y desconocidas |

## Criterios de aceptacion

- [ ] Consultas manuales en InterAmerican devuelven respuesta sustentada y paginas de origen para ambos catalogos.
- [ ] No se puede consultar otro perfil ni usar fuentes no disponibles.
- [ ] No hay envio automatico, imagenes, audio ni escrituras comerciales.
- [ ] Runtime, API y CRM saludables en VPS; comprobacion enfocada y CI verde.

## Plan de verificacion

- Unitarias: clasificacion, limites, abstencion y formato de referencias.
- Integracion: dos perfiles sinteticos, permisos y seleccion de fuente.
- E2E: usuario autorizado pregunta a ambos catalogos y observa respuesta/citas; usuario sin permiso es denegado.
- Seguridad: token de servicio, archivos `AVAILABLE`, secreto montado y ausencia de fuga en logs.
- Recuperacion: migracion aditiva, reindexacion idempotente y rollback del runtime sin modificar fuentes.

## Evidencia de cierre

- Pendiente de implementacion y validacion; no se marca terminado.
