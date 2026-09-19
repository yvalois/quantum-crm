# ADR 0001 Stack base de Quantum CRM

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-002, OPS-01, OPS-03, OPS-10, OPS-11 y BASE-01

> Actualizacion posterior: [ADR-0012](ADR-0012-integracion-agentes-langgraph-mcp.md) incorpora `agent-runtime` como septima aplicacion desplegable y reemplaza la caracterizacion del agente oficial como servicio externo. La compatibilidad con agentes personalizados JavaScript o Python se conserva.

> Actualizacion posterior: [ADR-0014](ADR-0014-arquitectura-frontends-sistema-visual.md) separa la experiencia web en `crm-web`, `portal-web` y `admin-web`, por lo que el monorepo pasa a ocho aplicaciones desplegables.

## Contexto

Quantum CRM requiere interfaces web, una API transaccional, workers, tiempo real, administración central, despliegues por cliente e integración con agentes LangGraph. El proyecto comienza sin código y necesita compartir contratos y reglas sin asumir prematuramente la complejidad operativa de microservicios o Kubernetes.

## Decisión

Quantum CRM se implementa como un monorepo TypeScript con un monolito modular desplegado mediante procesos separados.

El stack base es:

- Node.js 24 LTS como runtime.
- TypeScript en modo estricto para todo el código propio del producto.
- pnpm Workspaces para administrar el monorepo.
- Next.js 16 y React para `crm-web` y `admin-web`.
- NestJS 11 para `api`, `worker`, `admin-api` y `deploy-executor`.
- REST y OpenAPI 3.1 para contratos HTTP.
- WebSocket para chat y SSE para progreso de operaciones administrativas.
- PostgreSQL 18 como fuente principal de datos.
- Prisma 7 estable como acceso general a datos, con SQL explícito para consultas que lo necesiten.
- Outbox transaccional en PostgreSQL para conservar eventos comerciales.
- Redis y BullMQ para colas, caché y distribución de trabajos.
- Keycloak mediante OpenID Connect para autenticación.
- Almacenamiento compatible con S3 para archivos.
- Docker y Docker Compose para ejecución y despliegue inicial.
- Caddy como proxy y terminación HTTPS.
- GitHub Actions y GHCR para CI/CD e imágenes.
- OpenTelemetry y logs JSON para observabilidad.
- Vitest, Playwright y pruebas de integración con servicios reales aislados.

> Actualizacion posterior: [ADR-0013](ADR-0013-archivos-almacenamiento-objetos.md) selecciona SeaweedFS dentro del VPS, buckets privados por perfil, cuarentena con ClamAV y un adaptador S3 propiedad del modulo `files`.

Las versiones menores y de parche se fijan en el lockfile, las imágenes y los manifiestos de release; no se dejan rangos abiertos en producción.

## Agentes LangGraph (decision original sustituida parcialmente)

Esta decision trataba inicialmente todos los agentes como servicios externos al nucleo de Quantum. [ADR-0012](ADR-0012-integracion-agentes-langgraph-mcp.md) la sustituye para el agente oficial, que ahora es una aplicacion TypeScript nativa y separada. Los agentes personalizados JavaScript o Python conservan una frontera externa y deben implementar los contratos versionados y superar las mismas pruebas de contrato.

Los agentes:

- No acceden directamente a PostgreSQL, Redis ni archivos internos.
- Invocan herramientas autorizadas de Quantum mediante contratos validados.
- Reciben solo el contexto permitido para el cliente y la conversación.
- Devuelven mensajes, acciones solicitadas, estado y escalamiento usando el formato común.
- Utilizan callbacks autenticados e idempotentes cuando la ejecución sea asíncrona.

## Estructura inicial

```text
apps/
  crm-web/
  admin-web/
  api/
  worker/
  admin-api/
  deploy-executor/

packages/
  domain/
  contracts/
  database/
  auth/
  ui/
  config/
  observability/
  testing/
```

## Reglas arquitectónicas

- `domain` no depende de Next.js, NestJS, Prisma ni Redis.
- Los módulos no consultan directamente las tablas privadas de otros módulos.
- PostgreSQL es la fuente de verdad; Redis no conserva la única copia de una operación comercial.
- Cada cliente usa base, rol, configuración y espacio de archivos separados.
- Todos los clientes ejecutan las mismas imágenes versionadas; no existen copias de código por cliente.
- Las migraciones se ejecutan mediante un proceso controlado, no al iniciar todas las réplicas.
- TypeScript estricto, validación en runtime y pruebas de contrato se usan conjuntamente; el tipado estático no sustituye la validación de entradas externas.

## Alternativas consideradas

### Microservicios y Kubernetes desde el inicio

Se rechazan inicialmente porque agregan consistencia distribuida, redes y operación multi-servicio antes de conocer la carga real. Los límites modulares permiten extraer servicios cuando exista evidencia.

### Next.js como frontend y backend completo

Se rechaza porque el producto requiere workers, WebSockets, automatizaciones y operaciones administrativas largas. NestJS mantiene esos procesos separados de la interfaz.

### Python como lenguaje principal del CRM

Se rechaza para el nucleo porque TypeScript permite compartir contratos entre frontend, API y workers. Python permanece soportado para agentes LangGraph personalizados externos.

### MongoDB como base principal

Se rechaza porque inventario, reservas, pagos, auditoría y reportes necesitan relaciones y transacciones fuertes. PostgreSQL conserva flexibilidad mediante JSONB donde sea apropiado.

## Consecuencias

### Beneficios

- Un lenguaje y contratos compartidos para la mayor parte del producto.
- Menor complejidad operativa que una arquitectura de microservicios.
- Separación clara entre interfaces, API, workers, administración y despliegues.
- Posibilidad de extraer servicios sin perder los límites del dominio.
- Agentes JavaScript y Python compatibles sin cambiar el núcleo.

### Costos y riesgos

- El monorepo necesita reglas que impidan dependencias circulares.
- Keycloak, Redis y PostgreSQL agregan componentes operativos.
- Prisma no cubrirá todas las consultas de reportes y requerirá SQL revisado.
- Cada perfil desplegado consumirá memoria adicional en el VPS.
- Docker Compose no ofrece alta disponibilidad ante la pérdida completa del servidor.

## Validación

Antes de considerar validada la arquitectura, un esqueleto técnico debe demostrar:

- Compilación estricta de todas las aplicaciones y paquetes.
- Contratos compartidos sin dependencias de infraestructura dentro de `domain`.
- Health y readiness de API y workers.
- Migración reproducible y aislamiento de dos bases de clientes.
- Publicación y consumo idempotente de un trabajo desde un outbox.
- Comunicación WebSocket básica y reconexión.
- Autenticación OIDC.
- Un agente JavaScript y uno Python superando la misma prueba de contrato.
- Construcción de imágenes Docker y CI con tipos, lint y pruebas.
- Logs con `tenant_id` y `correlation_id`.

## Revisión de la decisión

Se crea un ADR sustituto si las mediciones exigen despliegues independientes por módulo, varios hosts con alta disponibilidad, otro motor de búsqueda o reportes, otra cola, o un proveedor administrado que reemplace un componente principal.
