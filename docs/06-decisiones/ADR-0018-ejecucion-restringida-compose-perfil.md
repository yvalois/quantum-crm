# ADR 0018 Ejecución restringida de Compose por perfil

- Estado: aceptado
- Fecha: 2026-09-21
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, ADM-06, ADM-12, ADM-20, OPS-01, OPS-14 y OPS-23

## Contexto

`WRITE_CONFIGURATION` deja preparado el manifiesto privado, pero `START_CONTAINERS` debe reconciliar los procesos de un perfil con Docker Compose. El `admin-api` no puede ejecutar comandos de host y el contenedor actual de `deploy-executor` no recibe el socket Docker. Entregar ese socket directamente al proceso de aplicación equivaldría a conceder control total del host y permitiría escapar de las operaciones tipadas.

## Decision

1. `deploy-executor` conservará su límite de aplicación y se comunicará mediante un socket Unix privado con un adaptador de host versionado (`qcrm-deploy-host`). El adaptador será el único proceso que verá el socket del motor Docker.
2. El adaptador aceptará únicamente acciones tipadas y allowlisted: reconciliar, observar y detener el proyecto de un perfil. Cada solicitud incluirá `operationId`, `tenantId`, release, manifiesto, digests y fencing; nunca recibirá shell, una ruta arbitraria ni texto Compose desde HTTP.
3. El proyecto Compose se derivará exclusivamente del UUID del perfil y se resolverá contra la plantilla versionada `infra/compose/tenant.yaml`. Los mounts, redes, nombres de servicio, límites y puertos permitidos se validarán antes de llamar al motor.
4. El socket Unix tendrá propietario y grupo dedicados, permisos mínimos y no se publicará por TCP. El adaptador registrará resultados estructurados sin secretos y rechazará solicitudes tardías, repetidas o de otro perfil.
5. `START_CONTAINERS` solo avanzará cuando el adaptador observe los contenedores esperados, sus digests, mounts, redes y readiness. Un resultado incierto queda pendiente para reconciliación; no se ejecuta `down --volumes` como rollback automático.

## Alternativas consideradas

### Montar `/var/run/docker.sock` en `deploy-executor`

Rechazada: el socket concede control equivalente a root al proceso de aplicación y rompe la frontera que protege el VPS.

### Permitir shell o Compose recibido desde `admin-api`

Rechazada: convierte datos administrativos en comandos de host y no ofrece una allowlist auditable.

### Ejecutar cada perfil en un runner externo

Rechazada para el MVP: añade una dependencia y una superficie de red innecesarias en un solo VPS. Se podrá revisar al adoptar varios hosts.

## Consecuencias

- Se añade un adaptador de host pequeño y versionado, con su propio contrato y healthcheck.
- `deploy-executor` no obtiene el socket Docker ni credenciales de otros perfiles.
- El despliegue exige una plantilla Compose canónica, validación de digests y observación durable de recursos.
- El adaptador debe instalarse y actualizarse como parte del bootstrap del VPS, con rollback de aplicación separado de la recuperación de datos.

## Validación

- Una petición válida crea únicamente el proyecto derivado del UUID y conserva los digests exactos.
- Dos peticiones concurrentes o un resultado tardío no duplican ni sustituyen otro proyecto.
- Una solicitud con tenant, release, manifest, path, puerto o digest no allowlisted se rechaza antes de tocar Docker.
- El contenedor `deploy-executor` no puede abrir el socket Docker; solo puede abrir el socket privado del adaptador.
- La decisión se revisará al introducir varios hosts, Kubernetes o un mecanismo de despliegue distinto.
