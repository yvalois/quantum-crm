# Quantum CRM

Este repositorio contiene el desarrollo de Quantum CRM y su sistema de seguimiento. La documentacion no se usa solo como referencia: define el alcance, el trabajo pendiente y la evidencia necesaria para considerar una funcion terminada.

## Estado actual

El proyecto se encuentra en bootstrap tecnico. Existe la fundacion del monorepo, pero todavia no hay una funcionalidad de producto implementada. El estado vigente se consulta en [docs/04-proceso/estado.md](docs/04-proceso/estado.md).

## Antes de trabajar

1. Leer [docs/README.md](docs/README.md).
2. Identificar el requisito que se va a implementar, por ejemplo `CHAT-17` o `ADM-04`.
3. Buscar el identificador en la documentacion, el codigo y las pruebas.
4. Registrar el trabajo en curso en `docs/04-proceso/estado.md`.
5. Cumplir la definicion de terminado antes de marcar una casilla.

El archivo [AGENTS.md](AGENTS.md) contiene las reglas obligatorias para cualquier persona o agente que modifique el proyecto.

La arquitectura aprobada y la estructura objetivo se consultan en [docs/08-arquitectura/](docs/08-arquitectura/README.md).

El alcance de la primera entrega se consulta en [MVP integral para cliente piloto](docs/02-plan/mvp-piloto.md).

## Desarrollo local

Requisitos fijados para el workspace:

- Node.js `24.21.0`.
- pnpm `9.13.2`, activado mediante Corepack.

Instalacion y comprobaciones iniciales:

```bash
corepack enable
corepack prepare pnpm@9.13.2 --activate
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm build
```

## Procesos disponibles

El bootstrap actual contiene ocho procesos ejecutables. Sus rutas de health solo acreditan que el proceso esta vivo y listo para recibir trabajo tecnico; no demuestran funciones comerciales.

| Proceso           |       Puerto predeterminado | Health                                  |
| ----------------- | --------------------------: | --------------------------------------- |
| `crm-web`         | definido al iniciar Next.js | `/api/health/live`, `/api/health/ready` |
| `portal-web`      | definido al iniciar Next.js | `/api/health/live`, `/api/health/ready` |
| `admin-web`       | definido al iniciar Next.js | `/api/health/live`, `/api/health/ready` |
| `api`             |                      `3001` | `/health/live`, `/health/ready`         |
| `admin-api`       |                      `3002` | `/health/live`, `/health/ready`         |
| `worker`          |                      `3101` | `/health/live`, `/health/ready`         |
| `deploy-executor` |                      `3102` | `/health/live`, `/health/ready`         |
| `agent-runtime`   |                      `3103` | `/health/live`, `/health/ready`         |

Los procesos Node validan `QCRM_HOST` y `QCRM_PORT` antes de declarar readiness. Los servicios internos usan `127.0.0.1` de forma predeterminada y las APIs usan `0.0.0.0` para permitir su futura conexion mediante la red privada de despliegue.

Todavia no hay funcionalidades `ADM`, `USR`, `CFG` ni comerciales implementadas. LangGraph, `/agent/v1`, bases de datos, Redis y servicios externos tampoco forman parte de este incremento.

## Contenedores

La base declarativa se encuentra en [infra/README.md](infra/README.md). Existen proyectos Compose separados para desarrollo, smoke de imagenes, plataforma central y perfiles de cliente. Las plantillas no locales exigen referencias OCI fijadas por digest y no publican puertos de aplicacion directamente al host.

En este equipo se editan el codigo y los manifiestos, pero no se inicia Docker Desktop, no se construyen imagenes y no se ejecuta Compose. La validacion real de contenedores se realiza directamente en el VPS de desarrollo o pruebas autorizado.

La presencia de Dockerfiles o manifiestos validos no demuestra que una imagen fue construida, escaneada, publicada o desplegada en el VPS.
