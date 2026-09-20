# Infraestructura declarativa

Esta carpeta contiene el bootstrap de contenedores de Quantum CRM. No acredita un despliegue productivo ni reemplaza el inventario pendiente del VPS (`OPS-02`).

## Matriz actual

| Proyecto                             | Servicios                                                 | Proposito                                                                       |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `local.yaml` / `quantum-local`       | ocho aplicaciones                                         | Desarrollo integrado con puertos publicados solo en `127.0.0.1`                 |
| `test.yaml` / `quantum-test`         | `crm-web` y `api`                                         | Smoke desechable de ambos tipos de imagen                                       |
| `platform.yaml` / `quantum-platform` | `admin-web`, `admin-api`, `deploy-executor`               | Plantilla de procesos centrales sin puertos publicos directos                   |
| `tenant.yaml` / `-p qcrm-t-<uuid>`   | `crm-web`, `portal-web`, `api`, `worker`, `agent-runtime` | Plantilla repetible por perfil, con nombre de proyecto validado por el ejecutor |

Las dependencias de datos, identidad, archivos, proxy y telemetria se agregaran en sus requisitos propios. El `deploy-executor` no recibe el socket Docker en este incremento.

## Imagenes

- `infra/docker/Dockerfile.web`: genera la salida standalone de una de las tres aplicaciones Next.js.
- `infra/docker/Dockerfile.node`: compila y despliega un workspace entre `api`, `admin-api`, `worker`, `deploy-executor` y `agent-runtime`.
- Ambas usan Node.js `24.21.0-bookworm-slim` fijado por digest, pnpm `9.13.2`, build multi-stage y usuario `node` sin privilegios.
- Los argumentos `APP` tienen allowlist; un nombre desconocido detiene el build.

## Validacion local

```bash
docker compose -f infra/compose/local.yaml config --quiet
docker compose -f infra/compose/test.yaml config --quiet
```

Las plantillas de plataforma y perfil requieren valores sinteticos o referencias reales. `QCRM_IMAGE_REGISTRY` no lleva tag; cada variable `*_DIGEST` contiene solo los 64 caracteres hexadecimales del SHA-256. Ejemplo de forma, no de una release existente:

```text
QCRM_IMAGE_REGISTRY=ghcr.io/example/quantum-crm
QCRM_API_DIGEST=<64 caracteres hexadecimales>
```

El perfil se valida y ejecuta con un nombre derivado de un UUID registrado, nunca de entrada libre:

```bash
docker compose -p qcrm-t-00000000-0000-4000-8000-000000000000 -f infra/compose/tenant.yaml config --quiet
```

En staging y produccion no se usa `build`, no se monta el checkout y ninguna aplicacion publica puertos al host. La futura red externa conecta exclusivamente Caddy con los servicios que debe enrutar.
