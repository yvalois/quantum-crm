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

Los directorios `apps/` y `packages/` contienen por ahora esqueletos compilables. Su existencia no acredita ninguna funcion `ADM`, `USR`, `CFG` ni comercial.
