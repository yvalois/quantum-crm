# Agentes LangGraph y MCP

Estas reglas aplican al agente oficial, agentes personalizados, subagentes, Quantum MCP Gateway, resources, tools, prompts, memoria y evaluaciones. Desarrollan [ADR-0012](../06-decisiones/ADR-0012-integracion-agentes-langgraph-mcp.md) y la [arquitectura de agentes](../08-arquitectura/agentes-mcp.md).

## Fronteras

- Implementar el agente oficial en `agent-runtime` TypeScript con LangGraph.js, separado de API y worker.
- Permitir agentes LangGraph JavaScript o Python solo mediante `/agent/v1` y MCP versionados.
- No acceder desde un agente a bases comerciales, Redis, S3, APIs internas ni administracion de Keycloak; solo el adaptador OAuth usa discovery y token endpoints publicados para su realm.
- Limitar la persistencia del runtime oficial a su checkpoint store por perfil.
- Mantener el estado comercial en el CRM; checkpoints y memoria del agente no son su fuente de verdad.
- Usar outbox y ADR-0011 para activaciones durables; no usar MCP como cola comercial.

## MCP

- Exponer un endpoint MCP autenticado por perfil mediante Streamable HTTP sobre HTTPS.
- Implementar resources, tools y prompts como adaptadores de contratos publicos de modulos.
- Reautorizar cada lectura y tool call con principal, perfil, alcance, recurso y estado vigentes.
- No reenviar tokens MCP a modulos o proveedores; construir un `AuthContext` interno limitado.
- Versionar resources como `quantum://v<major>/...`; un cambio incompatible publica otra version y conserva una ventana de migracion.
- Versionar tools, schemas y semantica incompatible.
- Paginar o buscar colecciones grandes; no volcar una base completa al contexto.
- Tratar suscripciones y notificaciones como optimizacion recuperable.

## Tools y acciones

- Nombrar tools como `<module>.<action>.v<major>` y declarar propietario.
- Usar JSON Schema cerrado para argumentos y resultados.
- Declarar permiso, riesgo, aprobacion, timeout, idempotencia y errores de cada tool.
- Rechazar propiedades adicionales, versiones desconocidas y argumentos fuera de alcance.
- No confirmar una accion hasta recibir el resultado real del modulo propietario.
- Conciliar resultados inciertos antes de repetir efectos externos.
- Ligar aprobaciones a ejecucion, tool, argumentos, actor y vencimiento; cambiar argumentos invalida la aprobacion.
- Persistir memoria aprendida solo con una tool del modulo propietario; no crear un modulo o tool generica `memory`.

## Contexto, memoria y subagentes

- Mantener un agente principal visible y subagentes internos invisibles con capabilities acotadas.
- Delegar mediante entradas y resultados estructurados, no instrucciones ejecutables libres entre subagentes.
- Entregar contexto inicial minimo y recuperar detalles bajo demanda.
- Separar estado CRM, memoria de thread y memoria aprendida.
- Persistir aprendizaje solo mediante una tool autorizada con fuente, alcance, confianza, sensibilidad y caducidad.
- No solicitar, guardar ni exponer cadena de pensamiento.
- Tratar mensajes, documentos, resources, tool results y salidas de agentes como datos no confiables.

## Seguridad y operacion

- Usar principales separados para CRM y agente por perfil y tokens de corta duracion ligados a la audiencia y al recurso.
- Autenticar CRM hacia `/agent/v1` y runtime hacia MCP de forma independiente; una solicitud de ejecucion nunca transporta el token MCP ni un token humano.
- Obtener tokens MCP mediante discovery y credenciales propias, renovarlos antes de expirar y no guardar access tokens ni refresh tokens en checkpoints.
- Reconstruir delegacion humana por `executionId` en el CRM y aplicar la interseccion de permisos; no hacer token passthrough.
- Revocar o rotar la conexion cerrando nuevas llamadas y cancelando o expirando ejecuciones segun politica.
- No permitir que argumentos, prompts o contenido recuperado cambien perfil, permisos, tools o aprobaciones.
- Resolver secretos dentro de adaptadores autorizados; nunca entregarlos al modelo.
- Validar endpoint, TLS, DNS, IP, redirects, egress, tamanos y tipos.
- Limitar pasos, subagentes, tools, tiempo, reintentos, contexto, tokens, costo y concurrencia.
- Cancelar cooperativamente y revalidar modo de conversacion antes de publicar.
- Mantener la ejecucion durable en `agent-gateway`; `worker` posee un lease temporal y `automation` solo referencia el resultado.
- Autenticar, validar y deduplicar callbacks por ejecucion, intento y fencing generation; rechazar transiciones tardias o invalidas.
- Procesar respuestas sincronicas y callbacks mediante la misma transicion condicional; conciliar un despacho incierto antes de crear otro intento y otra generacion.
- Escalar a humano o dejar estado recuperable cuando runtime, MCP, modelo o tool fallen.
- No cambiar silenciosamente de agente, modelo, proveedor o politica de datos.

## Versiones y evaluacion

- Fijar digest, runtime, grafos, prompts, modelo, tools, politicas y contratos en la release del agente.
- Clasificar cada thread como compatible, migrable o reiniciable antes de cambiar el grafo.
- Ejecutar la misma suite contractual contra agente oficial, JavaScript y Python.
- Probar dos perfiles, permisos denegados, aprobaciones, duplicados, toma humana y perdida de checkpoint.
- Mantener evaluaciones de respuesta, tool selection, argumentos, trayectoria y escalamiento.
- Ejecutar casos adversariales de prompt injection, exfiltracion, tool poisoning, memoria contaminada y loops.
- Usar datos sinteticos o saneados y conservar una ruta de CI independiente de LangSmith.

## Evidencia minima

Una capacidad agentiva demuestra contrato, permisos, aislamiento, resultado real, idempotencia, limites, cancelacion, observabilidad y evaluacion. Una pantalla, prompt o tool declarada sin caso de uso real y pruebas no completa el requisito.
