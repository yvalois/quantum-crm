# CHAT-20 — Saludo y reinicio del agente de InterAmerican

> Plan derivado para la prueba de WhatsApp; no cierra todo CHAT-20 ni BASE-02.

## Identificacion

- Requisito principal: `CHAT-20`.
- Relacionados: `BASE-02`, `CHAT-17`.
- Fase: interacción inteligente del MVP.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Dependencias: agente RAG y canal YCloud ya activos en InterAmerican.

## Resultado esperado

«Hola» como primera entrada o primera entrada tras reinicio recibe el saludo y menú de Alex del flujo aportado. El CRM ofrece un botón de reinicio del agente dentro del hilo: conserva el historial, cancela trabajos pendientes, registra el evento y no reenvía mensajes anteriores. Solo un nuevo mensaje del cliente dispara la respuesta. Otros hilos y perfiles no se modifican.

## Auditoria del trabajo existente

- El runtime actual solo selecciona catálogos y contesta una aclaración genérica ante «Hola».
- Existe control agente/humano, endpoint PATCH con versión/idempotencia, cola `agent_requests`, historial y autorización `crm:conversations:control-agent`; se extienden.
- La prueba real recibió respuesta, pero el estado de entrega del proveedor quedó incierto; no se reintenta.

## Impacto y plan

- Contrato PATCH aditivo `resetAgent`, validado y autorizado en servidor.
- Migración aditiva por perfil: marca de reinicio y evento de historial; sin borrar contenido.
- Repositorio cancela leases, actualiza marca e historial en la misma transacción; el despachador distingue primera respuesta de sesión.
- Runtime reproduce el saludo provisto solo en primera entrada y mantiene RAG para preguntas de catálogo.
- UI muestra control contextual de reinicio, con explicación de que conserva historial.
- Verificación enfocada de contrato, permisos, reintento/lease, saludo, migración y ruta real en el VPS.

## Recuperacion

El cambio de datos es aditivo. Una versión anterior ignora la nueva columna y el evento se conserva; no se revierte ni se reenvían respuestas de entrega incierta.

## Limpieza visible puntual del chat de prueba (2026-10-15)

El propietario autorizo ocultar tambien el historial visible del chat del numero terminado en 1482. Esta operacion puntual no cambia el boton general «Reiniciar conversacion», que sigue conservando el historial. La migracion aditiva `20261015190000_chat_20_visible_history_reset` filtra mensajes e historial de lectura por corte de secuencia y fecha sin destruir archivos, registros de entrega ni auditoria. En InterAmerican se aplico exactamente a un hilo: corte visible y de memoria 46, cero mensajes anteriores visibles, cero solicitudes pendientes y modo agente intacto. La fecha y el corte quedan persistidos. Pruebas del repositorio y del saludo tras reinicio aprobadas en VPS; quedan pendientes el siguiente turno real y un recorrido autenticado del boton.

## Evidencia de cierre

El candidato `992e3f4f` del PR #169 pone «Reiniciar conversación» en la cabecera del chat WhatsApp y lo muestra segun `crm:conversations:control-agent`; el servidor vuelve a exigir ese permiso. Admite reiniciar memoria aun si un humano atiende, sin cambiar modo ni borrar mensajes. La operación transaccional existente conserva historial, corta contexto por secuencia y cancela respuestas pendientes; la prueba de dominio cubre modo humano/escalado. En VPS aprobaron 30 pruebas enfocadas y builds; API y web quedaron saludables por digest en InterAmerican. Falta clic autenticado y siguiente turno real para cerrar la comprobacion E2E.
