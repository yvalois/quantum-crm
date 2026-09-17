# ADR 0012 Integracion nativa de agentes LangGraph mediante MCP

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-018, BASE-01 a BASE-03, BASE-06, ADM-18, USR-09, CFG-06, CFG-08, CFG-13, CFG-14, CHAT-17 a CHAT-21, OPS-12, OPS-16 y todas las funciones que permiten consultas o acciones del agente
- Sustituye parcialmente: la estructura de seis aplicaciones de ADR-0001 y el conteo de seis procesos desplegables de ADR-0009; las demas decisiones de esos ADR permanecen vigentes

## Contexto

Quantum no necesita un bot tercero conectado de forma superficial. El producto debe comportarse como un CRM agentivo: un agente principal conoce el entorno autorizado de la empresa, coordina subagentes especializados invisibles, responde conversaciones y actua proactivamente ante eventos aprobados.

El agente debe implementarse completamente con LangGraph y permitir implementaciones JavaScript o Python. Al mismo tiempo, la conciencia del CRM no puede convertirse en acceso directo a bases, secretos o permisos globales, y la integracion no debe depender de detalles internos de un grafo o proveedor.

## Decision

Quantum incorpora `agent-runtime` como septima aplicacion desplegable y capacidad nativa del producto. La implementacion oficial usa TypeScript y LangGraph.js; agentes alternativos LangGraph JavaScript o Python pueden sustituirla si cumplen los mismos contratos y evaluaciones.

Cada perfil expone un Quantum MCP Gateway autenticado en su API. `agent-runtime` actua como host agentivo y cliente MCP: obtiene contexto mediante resources, ejecuta capacidades mediante tools y consume prompts versionados. El gateway llama casos de uso publicos de los modulos y nunca ofrece acceso directo a persistencia o credenciales.

`/agent/v1` gobierna el ciclo de una ejecucion entre CRM y runtime. MCP estandariza el acceso del agente al entorno. Outbox, automatizaciones y ADR-0011 siguen siendo la autoridad de activaciones proactivas, esperas, reintentos e idempotencia.

## Agente principal y subagentes

El usuario observa un agente principal unico por empresa. LangGraph coordina subgrafos internos para conversacion, ventas, tareas, agenda, catalogo, documentos, cobros y reportes.

- Los subagentes no aparecen como identidades independientes.
- La delegacion usa entradas y resultados estructurados.
- Cada subagente recibe solo resources y tools necesarios.
- Autorizacion, aislamiento, aprobaciones e idempotencia son controles deterministas del CRM, no decisiones de otro agente.
- El agente puede reaccionar a mensajes, ordenes y eventos previamente configurados; no crea autonomamente nuevos disparadores o permisos.

## Fronteras de protocolo

### Contrato de ejecucion

`/agent/v1` define inicio, aceptacion asincrona, resultado, interrupcion, cancelacion, callback y escalamiento. Cada ejecucion fija:

- perfil, conversacion, thread y execution ID;
- version del contrato, runtime, grafo, prompts y politica de tools;
- contexto inicial minimo y referencias autorizadas;
- clave idempotente, correlacion, deadline y presupuestos;
- estado durable conforme a ADR-0011.

`agent-gateway` es propietario de la ejecucion durable y de sus transiciones `PENDING`, `DISPATCHING`, `RETRY_WAIT`, `RUNNING`, `WAITING_APPROVAL`, `CANCEL_REQUESTED` y terminales. Guarda la ejecucion y su outbox atomico; `worker` reclama el despacho con lease y fencing generation. El runtime expone `/agent/v1`; tanto el oficial como uno personalizado reciben las llamadas del CRM.

Las ejecuciones aceptadas con `202` completan contra `POST /agent/v1/executions/{executionId}/callbacks` en el host CRM. El callback tiene schema versionado, identidad de carga con audiencia del CRM, `Idempotency-Key`, `attempt` y `generation` obligatorios. `agent-gateway` rechaza transiciones invalidas, duplicados con contenido distinto y resultados de un lease, intento, perfil o modo vencidos. `automation` puede originar y esperar una ejecucion, pero no posee su lease ni su estado.

Un fallo de despacho transitorio entra en espera de reintento; el agotamiento termina en fallo o timeout. Un envio de resultado incierto se concilia antes de crear otro intento, que recibe nueva generacion. Una respuesta terminal sincronica usa `runId`, intento y generacion y atraviesa la misma transicion condicional que un callback.

### Quantum MCP Gateway

El endpoint MCP por perfil usa Streamable HTTP sobre HTTPS y negociacion de capacidades. Publica:

- resources para contexto y datos consultables;
- tools para consultas y acciones versionadas;
- prompts para procedimientos aprobados y configurables;
- notificaciones o suscripciones como optimizacion, nunca como unica evidencia durable.

Las URIs, nombres de tools, schemas y resultados pertenecen a contratos versionados. El gateway compone modulos, pero cada operacion conserva su propietario y llama el mismo caso de uso autorizado que las otras interfaces.

Las URIs de resources incluyen version mayor, comenzando por `quantum://v1/...`. Un cambio incompatible publica otra version y mantiene la anterior durante la ventana declarada; el manifiesto fija el rango compatible.

## Contexto y memoria

Se separan tres autoridades:

1. El CRM conserva el estado comercial oficial.
2. LangGraph conserva checkpoints y memoria de trabajo por thread.
3. La memoria aprendida solo se vuelve durable mediante una tool MCP del modulo propietario con origen, alcance, confianza, caducidad y auditoria.

El agente recibe un panorama inicial compacto y consulta el resto bajo demanda. La base completa no se copia al prompt. `conversation_id` pertenece al CRM; la asociacion con `thread_id`, runtime y version se registra de forma estable.

El runtime oficial puede usar una base de checkpoints propia por perfil y un rol exclusivo. Esa credencial no permite acceder a la base comercial ni a la plataforma. Un agente personalizado opera su propia persistencia y no recibe cadenas de conexion de Quantum.

No existe un almacen comercial generico de memoria ni una tool `memory.*`. Una nota de contacto pertenece a `contacts`, una preferencia de empresa a `settings` y una nota conversacional a `conversations`; si ninguna frontera es propietaria, la deduccion no se persiste.

## Autonomia y tools

Las capacidades se clasifican como lectura, borrador, escritura reversible, efecto externo o accion sensible. La politica efectiva decide si una tool es automatica, requiere aprobacion o esta prohibida.

- Toda tool declara version, schemas, permiso, riesgo, timeout e idempotencia.
- El gateway reconstruye `AuthContext` y revalida accion, alcance, recurso y estado.
- Una aprobacion queda ligada a ejecucion, tool, argumentos, actor y vencimiento.
- Cambiar argumentos invalida la aprobacion.
- Pagos, reembolsos, emisiones, eliminaciones y otros efectos irreversibles requieren el control humano definido por el dominio.
- El agente nunca confirma una accion hasta recibir su resultado real.

## Seguridad

- Cada perfil y conexion usa un principal de agente independiente.
- CRM y runtime se autentican en ambas direcciones con principales de carga separados. Para `/agent/v1`, `agent-gateway` obtiene un token con audiencia del runtime registrado; para MCP, el runtime descubre los metadatos publicados y obtiene con sus propias credenciales un token corto ligado al recurso MCP.
- Una solicitud `/agent/v1` entrega endpoint, scopes y execution ID, nunca tokens humanos ni tokens MCP. La renovacion obtiene un token nuevo antes del vencimiento; access tokens y refresh tokens no se guardan en checkpoints.
- El adaptador OAuth del runtime solo usa discovery y token endpoints del realm asignado; no accede a administracion de Keycloak. Revocar el cliente o la conexion impide nuevas llamadas y fuerza cancelacion o expiracion conforme a politica.
- MCP remoto usa tokens de corta duracion, audiencia ligada al recurso y scopes minimos.
- El gateway no reenvia el token MCP a modulos o proveedores; crea un contexto interno limitado.
- La delegacion humana se reconstruye en el CRM mediante `executionId` y aplica la interseccion de permisos del agente, actor y perfil; ningun token humano atraviesa al runtime.
- Mensajes, documentos, recursos, tool results y salidas del modelo son entradas no confiables.
- Ningun prompt concede permisos, cambia de perfil, omite aprobaciones o revela secretos.
- El runtime no recibe credenciales de proveedores; las tools resuelven secretos dentro de adaptadores autorizados.
- Endpoints, redirects, tamanos, tipos y destinos se validan; una URL configurada no habilita egress arbitrario.
- No se solicita, persiste ni expone cadena de pensamiento. Solo se conservan resultados, decisiones estructuradas y trazabilidad permitida.

## Fallos y toma humana

Un timeout, tool fallida o resultado incierto nunca se presenta como exito. La ejecucion queda recuperable, conciliable o escalada conforme a ADR-0010 y ADR-0011.

Cuando un asesor toma una conversacion, el CRM cambia el modo durable, solicita cancelacion, invalida respuestas no publicadas y bloquea seguimientos. Una reactivacion crea o reanuda trabajo solo despues de reconstruir contexto y permisos vigentes.

Pasos, tools, tiempo, tokens, costo, tamano y concurrencia tienen presupuestos. Superarlos termina de forma segura o solicita intervencion; no existe recursion ilimitada ni cambio silencioso de modelo o proveedor.

## Versionado y evaluacion

La release del agente registra digest, lenguaje, runtime, grafo, subgrafos, prompts, modelo, proveedor, politica de tools, contratos, limites y evidencia de evaluacion. El manifiesto del CRM declara el rango compatible.

Una version debe superar:

- suite comun `/agent/v1` y MCP para el agente oficial y agentes de prueba JavaScript y Python;
- aislamiento de dos perfiles, permisos, aprobaciones e idempotencia;
- evaluaciones de respuesta final, tool selection, argumentos, trayectoria y escalamiento;
- prompt injection, exfiltracion, memoria contaminada, loops y callbacks alterados;
- toma humana, perdida de checkpoint, timeout, duplicado y cambio de version con thread activo.

LangSmith puede usarse como herramienta opcional. Los contratos, datasets sinteticos o saneados y criterios de aceptacion viven en el repositorio y pueden ejecutarse sin un proveedor de evaluacion.

## Alternativas consideradas

### Agente dentro de `worker`

Se rechaza porque mezcla carga agentiva con trabajos comerciales, impide escalar y desplegar por separado y dificulta agentes Python compatibles.

### API nativa de LangGraph como contrato del CRM

Se rechaza como unica frontera porque acopla Quantum a detalles del runtime. Puede existir detras del adaptador, pero `/agent/v1` y MCP son los contratos de producto.

### Agentes proporcionados exclusivamente por cada cliente

Se rechaza porque Quantum debe ofrecer una experiencia agentiva lista para usar. Los agentes personalizados permanecen como extension o sustitucion compatible.

### Acceso directo del agente a bases o API general

Se rechaza porque rompe propiedad modular, minimo privilegio, auditoria y aislamiento. El agente usa resources y tools MCP limitados.

### MCP como motor de eventos durable

Se rechaza. MCP aporta contexto y capacidades; outbox, PostgreSQL y ADR-0011 conservan activaciones y estado recuperable.

## Consecuencias positivas

- El agente es parte nativa de Quantum y dispone de contexto integral bajo demanda.
- Un agente oficial funciona sin exigir desarrollo al cliente.
- JavaScript y Python pueden interoperar sin modificar los modulos del CRM.
- Los subagentes evolucionan sin fragmentar la experiencia visible.
- Permisos, auditoria e idempotencia siguen siendo autoridad del CRM.

## Costos y riesgos

- Se agrega una septima aplicacion, persistencia de checkpoints y otro ciclo de release.
- MCP, el contrato de ejecucion y las evaluaciones requieren compatibilidad continua.
- El contexto amplio eleva riesgos de exfiltracion, prompt injection y costo; se limita por recursos, permisos y presupuestos.
- Hilos suspendidos pueden ser incompatibles con un grafo nuevo; la release debe conservar, migrar o reiniciar explicitamente.

## Validacion

La decision se considera aplicada cuando:

- el agente oficial TypeScript opera como aplicacion separada y usa solo `/agent/v1` y MCP para relacionarse con el CRM;
- un agente LangGraph Python y otro JavaScript superan la misma suite contractual;
- un agente puede comprender una empresa y completar un recorrido entre conversacion, contacto, oportunidad, agenda, catalogo y documento sin acceso directo a datos;
- dos perfiles no comparten threads, checkpoints, resources, tools, tokens ni memoria;
- tools denegadas, aprobaciones vencidas y argumentos alterados no producen efectos;
- un callback repetido produce una sola transicion y uno de un intento o generacion vencidos se rechaza;
- una toma humana invalida una respuesta pendiente y la reactivacion incorpora cambios del asesor;
- perder checkpoints permite reconstruir contexto oficial o escalar sin inventar continuidad;
- una version incompatible no reanuda silenciosamente threads antiguos;
- fallos, duplicados y resultados inciertos no generan confirmaciones ni efectos dobles.

## Referencias

- [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)
- [LangGraph JavaScript persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph JavaScript interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)

Se revisa esta decision si MCP cambia de transporte o autorizacion de forma incompatible, se adopta otro runtime agentivo, aparecen requisitos multiagente visibles o las mediciones justifican separar subagentes en servicios distintos.
