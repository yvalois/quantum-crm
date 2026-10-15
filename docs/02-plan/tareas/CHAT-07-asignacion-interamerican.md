# CHAT-07 — Asignación del agente InterAmerican

> Ficha del bloque InterAmerican, no cierre de todos los requisitos CHAT-07, CHAT-02 ni PIPE-06 del MVP.

## Identificación

- Requisito principal: `CHAT-07`.
- Relacionados: `CHAT-02`, `PIPE-06`.
- Fases: 4 (núcleo comercial) y 5 (interacción inteligente) de `mvp-piloto.md`.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Dependencias: canal YCloud, agente InterAmerican, contacto, oportunidad, miembros IAM y pipeline importado.
- Reglas: ADR-0003, ADR-0004, ADR-0006, ADR-0011 y ADR-0012; `docs/05-reglas/12-agentes-langgraph-mcp.md`.

## Resultado y alcance

El agente mantiene la conversación sin asignar desde el primer mensaje. Cuando el cliente completa los datos del servicio y se confirma el pase interno, el worker elige entre Carlos Mejía y Julio Rafael, conserva al asesor elegible previo o alterna mediante turno durable, asigna chat/contacto/oportunidad y cambia la atención a humana. La activación privada solo corresponde a InterAmerican. No se copian Sheets, tareas ni otras funciones del export n8n.

## Auditoría y decisión

Se revisaron V54.62 y V54.84, el loop del agente y los repositorios comerciales existentes. El primer intento de asignación temprana fue descartado sin desplegar. La primera prueba real detectó que el caso sin clasificación particular/corporativa no hacía el pase al completar vehículo y período; el prompt y salida estructurada se corrigieron conforme al flujo V54.84. La decisión reutiliza propietarios, oportunidades, estados y outbox existentes; la nueva persistencia solo reserva el turno y el recibo de asignación idempotente.

## Impacto técnico

| Área | Cambio |
|---|---|
| Runtime y worker | Propuesta estructurada de pase, validación, selección de asesor y pausa humana. |
| API | Webhook recibe el mensaje; no asigna asesor antes de la calificación. |
| Datos | Migración aditiva `20261015020000_chat_07_advisor_routing`. |
| Aislamiento | Worker ligado al perfil y política en archivo secreto del perfil; sin ID de perfil libre. |
| Operación | Imágenes por digest, migrador controlado, candidata directa temporal autorizada. |

## Verificación y evidencia

- [x] Sin asignación con datos incompletos en el chat real.
- [x] Pase con vehículo y período completos para cliente sin clasificar.
- [x] Chat, contacto y oportunidad GTQ con el mismo asesor; modo humano/escalado.
- [x] Mensaje recibido por el propietario; no se reenvió ante timeout de YCloud.
- [x] Pruebas enfocadas, tipos, lint, formato, migración y contenedores saludables en VPS.
- [x] Siete checks CI de la revisión corregida del PR #161.
- [ ] Integración del PR #161.

La evidencia precisa de commits, resultados, digests y prueba real está en [`estado.md`](../../04-proceso/estado.md). No se marcaron casillas globales de `trabajo.md`: las variantes manuales, demás perfiles y la totalidad de CHAT-02/PIPE-06 conservan alcance propio.

## Recuperación y pendientes

El esquema es aditivo y la política puede desactivarse retirando `advisorRouting` del binding privado y recreando el worker. El rollback de imagen no restaura datos. Pendientes de estabilización posterior: promoción registrada y respaldo cifrado externo/restauración verificada, pospuestos para el entorno de desarrollo por decisión del propietario.

## Corrección de vinculación por conversación (2026-10-15)

Se detectó una ambigüedad: el pase automático toma la oportunidad abierta más reciente del contacto. Si hay varias, esa heurística no identifica la oportunidad de este chat. La corrección añade una referencia opcional y única a la conversación en la oportunidad, propiedad de `sales`. Al primer pase se reutiliza una sola oportunidad abierta sin vínculo; si hay varias, se crea una nueva para evitar escoger una arbitraria. Los reintentos consultan primero el vínculo estable. La migración es aditiva y forward-only; el índice único impide duplicar el vínculo. Se comprobarán reintento, varios leads del contacto y alcance de asesor en VPS. No se aplica a InterAmerican sin el respaldo externo y la restauración verificada requeridos.
