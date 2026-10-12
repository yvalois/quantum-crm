# BASE-02 — Memoria conversacional de InterAmerican

> Bloque funcional de la prueba WhatsApp. No cierra todo BASE-02.

## Identificacion

- Requisito principal: `BASE-02`.
- Relacionados: `CHAT-02`, `CHAT-17`, `CHAT-20`, `BASE-01`.
- Fase del MVP: 5, interaccion inteligente.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Quantum CRM.
- Dependencias: YCloud, cola durable, MCP y agente RAG ya desplegados en InterAmerican.
- Bloquea a: demostracion del agente conversacional.
- ADR y reglas: ADR-0012, `docs/08-arquitectura/agentes-mcp.md`, `docs/05-reglas/12-agentes-langgraph-mcp.md`.

## Resultado esperado

Cada nuevo mensaje de WhatsApp recibe una respuesta que considera el contexto previo del mismo chat. El contexto persiste tras reinicios de procesos y nunca mezcla chats ni perfiles. «Reiniciar agente» hace que el siguiente turno ignore todo contexto anterior al reinicio sin borrar el historial visible. Un fallo de RAG no deja el mensaje sin respuesta ni confirma informacion no comprobada.

## Lectura obligatoria aplicada

- [x] Requisitos BASE-02 y CHAT-20, fase, subtareas y estado revisados.
- [x] Flujo n8n original y memoria Redis por sesion inspeccionados.
- [x] Reglas, ADR y arquitectura de agente/MCP revisados.

## Auditoria del trabajo existente

- n8n: `memoryRedisChat` enlazada al agente principal, clave por sesion, ventana de 100 mensajes y TTL 48 h; limpieza manual por sesion.
- Quantum: `agent-runtime` solo recibe `question` y `firstTurn`. El CRM ya conserva mensajes durables y `agent_reset_at`, pero no expone contexto autorizado al agente.
- Mensaje real «individual»: `agent_requests` termino `failed` tras cinco intentos `AGENT_UNAVAILABLE`; el modelo OpenAI y la consulta SQL de catalogo responden en una comprobacion aislada. No se reenvia el mensaje viejo tras el reinicio.

## Alcance

### Incluido

- Contexto reciente de texto desde el modulo `conversations` por MCP, ligado al `executionId` leased y a un unico chat.
- Ventana acotada de mensajes persistidos en CRM; historial humano y del agente, excluyendo notas internas.
- Reinicio real por corte `agent_reset_at`, sin borrar mensajes comerciales.
- Uso del contexto en LangGraph y en la respuesta RAG; saludo solo en primer turno.
- Fallo tipado y respuesta segura cuando la consulta RAG o el modelo no esten disponibles.
- Verificacion de permisos, aislamiento, reintentos, reset concurrente y WhatsApp real.

### No incluido

- Imagenes, audio, seguimientos, memoria aprendida o nuevas acciones comerciales.
- Copiar la base comercial al runtime ni dar acceso directo a PostgreSQL/Redis desde el agente.

## Impacto tecnico

| Area                       | Impacto previsto                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | API MCP, `conversations`, `agent-runtime`, worker y CRM web                                                             |
| Contratos y eventos        | Tool MCP de contexto versionada; sin cambio incompatible de `/agent/v1`                                                 |
| Datos y migraciones        | Reutilizar `messages` y agregar corte por secuencia al reinicio; migracion aditiva con backfill de reinicios existentes |
| Permisos y aislamiento     | Principal del agente, permiso de lectura acotado y lease valido del mismo perfil                                        |
| Configuracion y secretos   | Reutilizar credenciales existentes; ninguna clave en Git ni salida                                                      |
| Observabilidad y operacion | Codigo de fallo por etapa sin texto del cliente; reintentos seguros                                                     |
| Documentacion              | Estado, evidencia y pendientes al cerrar                                                                                |

## Plan de implementacion

- [ ] Exponer contexto de ejecucion como tool MCP, con contrato y pruebas de autorizacion.
- [ ] Integrar contexto y clasificacion conversacional en el grafo.
- [ ] Hacer que el reinicio corte el contexto y cancele respuestas en vuelo.
- [ ] Corregir la ruta que deja «individual» sin respuesta.
- [ ] Validar candidato en VPS, CI y un turno real de WhatsApp despues de reinicio.

## Riesgos y mitigaciones

| Riesgo                          | Mitigacion                                                       | Verificacion                        |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| Fuga entre chats o perfiles     | Resolver chat desde executionId leased, no desde argumento libre | Pruebas de ejecucion ajena/expirada |
| Respuesta tardia tras reset     | Fencing y cancelacion transaccional existente                    | Prueba de reset concurrente         |
| Exceso de contexto/costo        | Ultimos 100 mensajes y presupuesto de caracteres                 | Pruebas de limites                  |
| Salida falsa ante fallo externo | Mensaje seguro sin datos inventados y codigo de error            | Prueba de fallo MCP/OpenAI          |

## Criterios de aceptacion

- [ ] Dos mensajes sucesivos en el mismo chat muestran continuidad; otro chat no conoce ese contexto.
- [ ] Reiniciar elimina el contexto usado por el agente, conserva el historial visible y genera nuevo saludo solo al proximo inbound.
- [ ] «Individual» y una consulta de catalogo reciben respuesta o una degradacion explicita en WhatsApp, no silencio.
- [ ] Servicios sanos en InterAmerican y recorrido real comprobado.

## Plan de verificacion

- Unitarias y contrato: ventana, orden, reset, permisos y fallos.
- Integracion: PostgreSQL desechable en VPS, dos conversaciones y leases.
- E2E: mensaje real al canal InterAmerican, contexto antes/despues de reinicio y respuesta visible en telefono/CRM.
- Comandos: solo verificaciones afectadas en VPS; matriz de CI una vez sobre candidato.

## Recuperacion

- Migracion aditiva; la version anterior ignora la columna y la tool nueva.
- Revertir los digests de aplicacion compatibles si falla la promocion, sin restaurar datos.
- Nunca reintentar automaticamente un envio YCloud con resultado desconocido.

## Evidencia de cierre

Pendiente.
