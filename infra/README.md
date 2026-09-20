# Infraestructura declarativa

Esta carpeta contiene el bootstrap de contenedores de Quantum CRM. No acredita un despliegue productivo ni reemplaza el inventario pendiente del VPS (`OPS-02`).

## Matriz actual

| Proyecto                                                   | Servicios                                                 | Proposito                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `local.yaml` / `quantum-local`                             | ocho aplicaciones                                         | Desarrollo integrado en el VPS de pruebas, con puertos publicados solo en loopback    |
| `test.yaml` / `quantum-test`                               | `crm-web` y `api`                                         | Smoke desechable de ambos tipos de imagen                                             |
| `platform-foundation.yaml` / `quantum-platform-foundation` | PostgreSQL, Redis y Keycloak                              | Dependencias persistentes de plataforma con redes privadas y volumenes independientes |
| `platform.yaml` / `quantum-platform`                       | `admin-web`, `admin-api`, `deploy-executor`               | Procesos centrales sin puertos publicos directos                                      |
| `tenant.yaml` / `-p qcrm-t-<uuid>`                         | `crm-web`, `portal-web`, `api`, `worker`, `agent-runtime` | Plantilla repetible por perfil, con nombre de proyecto validado por el ejecutor       |

La fundacion persistente separa el ciclo de vida de PostgreSQL, Redis y Keycloak del ciclo de releases de las aplicaciones. Sus volumenes nunca se eliminan como parte de un rollback de aplicacion. Archivos, proxy y telemetria se agregaran en sus requisitos propios. El `deploy-executor` no recibe el socket Docker en este incremento.

## Fundacion persistente de plataforma

`infra/compose/platform-foundation.yaml` declara los tres motores sin publicar puertos al host:

- PostgreSQL solo pertenece a `platform-database` y crea bases y roles separados para Keycloak, migracion y runtime.
- Redis solo pertenece a `platform-session`, exige ACL y limita las claves al namespace de sesiones administrativas.
- Keycloak pertenece a la red de entrada y a `platform-database`; usa PostgreSQL y el comando `start --optimized --import-realm`, nunca `start-dev`.
- `platform.yaml` conecta `admin-web` unicamente a la red de sesiones y `admin-api` unicamente a la red de datos.

Las tres imagenes de fundacion se construyen desde los Dockerfiles fijados por digest en `infra/docker/`. PostgreSQL consume directamente `POSTGRES_PASSWORD_FILE`; los wrappers de Redis y Keycloak adaptan los archivos montados a sus interfaces nativas sin colocar valores en Compose ni en argumentos. Los siete archivos requeridos viven fuera del checkout con permisos `0600` y son:

```text
postgres-admin-password
platform-migrator-password
platform-runtime-password
keycloak-database-password
keycloak-bootstrap-admin-password
platform-redis-password
admin-web-oidc-client-secret
```

El primer arranque de PostgreSQL ejecuta `infra/postgres/init-platform-databases.sh` desde la imagen inmutable. La importacion de Keycloak omite el realm si ya existe; no es un mecanismo de actualizacion ni de backup. El procedimiento de aprovisionamiento valida dos ejecuciones y una recreacion sin usar `docker compose down -v`.

## Conexion PostgreSQL y secretos

- `api` y `worker` reciben la URL runtime de la base de su perfil.
- `admin-api` recibe una URL distinta para la base de plataforma.
- Webs, `agent-runtime` y `deploy-executor` no reciben credenciales PostgreSQL.
- El valor se monta como secret de solo lectura en `/run/secrets/qcrm_database_url`; `QCRM_DATABASE_URL_FILE` contiene solo esa referencia.
- `QCRM_TENANT_ID` identifica el perfil de `api` y `worker` mediante un UUID inmutable. No selecciona dinamicamente otra base.
- Las variables `QCRM_CRM_DATABASE_URL_SECRET_FILE` y `QCRM_PLATFORM_DATABASE_URL_SECRET_FILE` apuntan a archivos del host fuera del checkout. Nunca contienen la URL.

Las plantillas esperan que PostgreSQL ya haya sido aprovisionado con una base y un rol runtime distintos por perfil, `PUBLIC CONNECT` revocado y un rol migrador separado. Ese aprovisionamiento dinamico pertenece a `OPS-14`; las plantillas actuales no lo simulan ni lo presentan como terminado.

## Identidad OIDC de plataforma

- Solo `admin-api` recibe issuer, audience, ACR MFA y antiguedad maxima del access token.
- El issuer identifica el realm Keycloak exclusivo `quantum-platform`; en staging y produccion debe usar HTTPS.
- El endpoint JWKS se deriva como `<issuer>/protocol/openid-connect/certs`. Ningun header o claim del token puede elegir otra URL.
- La audience es exclusiva de `admin-api`; una audience de CRM no es valida para plataforma.
- `QCRM_OIDC_REQUIRED_ACR` debe coincidir con el LoA configurado para MFA en Keycloak. El valor inicial documentado es `2`.
- Estas variables no son secretos. Tokens, client secrets y credenciales no se guardan en Compose ni en Git.
- `infra/config/admin-api.env.example` contiene un ejemplo local sintetico. La instalacion y el realm reales de Keycloak siguen pendientes dentro de `ADM-01`.

La definicion importable inicial vive en `infra/keycloak/quantum-platform-realm.json`. No contiene usuarios, contrasenas, semillas OTP ni client secrets. Antes de importarla, el entorno debe definir `QCRM_ADMIN_WEB_ORIGIN` con el origen HTTPS exacto de `admin-web`; el redirect permitido se limita a `/api/auth/callback/keycloak`. El cliente confidencial recibe su credencial fuera de Git durante el aprovisionamiento y `admin-api` continua rechazando cualquier token que no pruebe ACR 2.

`bash infra/keycloak/validate-realm.sh` ejecuta la prueba repetible solo en el VPS autorizado. Arranca un Keycloak 26.7.4 desechable por digest, importa el realm con datos sinteticos, inspecciona discovery, JWKS, cliente, grants, PKCE, mappers y flujo OTP mediante la Admin API y elimina el contenedor y sus datos al terminar. No instala ni modifica la identidad persistente.

## Sesion administrativa

`admin-web` usa un cliente OIDC confidencial y conserva transacciones y sesiones opacas en Redis. Recibe el client secret y la URL de Redis mediante los archivos exactos `/run/secrets/qcrm_oidc_client_secret` y `/run/secrets/qcrm_session_redis_url`; ningun token OIDC se entrega al navegador. La plantilla no instala un Redis persistente: su aprovisionamiento, aislamiento y respaldo pertenecen al despliegue de plataforma.

`bash infra/redis/validate-platform-session.sh` se ejecuta solo en el VPS autorizado. Crea una red interna y un Redis 8.2.1 desechable fijado por digest, monta una URL sintetica como archivo secreto, valida consumo unico, lectura, renovacion e invalidacion y elimina contenedor, red, secreto e imagen de prueba al terminar.

## Imagenes

- `infra/docker/Dockerfile.web`: genera la salida standalone de una de las tres aplicaciones Next.js.
- `infra/docker/Dockerfile.node`: compila y despliega un workspace entre `api`, `admin-api`, `worker`, `deploy-executor` y `agent-runtime`.
- Ambas usan Node.js `24.21.0-bookworm-slim` fijado por digest, pnpm `9.13.2`, build multi-stage y usuario `node` sin privilegios.
- Los argumentos `APP` tienen allowlist; un nombre desconocido detiene el build.

## Lugar de ejecucion

Estos archivos se conservan en Git, pero no se ejecutan en el equipo local del propietario. Docker Desktop debe permanecer apagado. Los builds, healthchecks y pruebas Compose se realizan en el VPS de desarrollo o pruebas autorizado, con datos sinteticos y sin afectar produccion.

## Validacion en el VPS

```bash
docker compose -f infra/compose/local.yaml config --quiet
docker compose -f infra/compose/test.yaml config --quiet
```

Ambos comandos requieren rutas a archivos sinteticos existentes y un UUID de prueba:

```text
QCRM_TENANT_ID=00000000-0000-4000-8000-000000000001
QCRM_CRM_DATABASE_URL_SECRET_FILE=/ruta/fuera/del/repositorio/crm-database-url
QCRM_PLATFORM_DATABASE_URL_SECRET_FILE=/ruta/fuera/del/repositorio/platform-database-url
QCRM_PLATFORM_OIDC_ISSUER=https://identity.example.test/realms/quantum-platform
QCRM_PLATFORM_OIDC_AUDIENCE=quantum-admin-api
QCRM_PLATFORM_OIDC_REQUIRED_ACR=2
QCRM_PLATFORM_OIDC_MAX_TOKEN_AGE_SECONDS=300
```

La validacion real de roles usa `tests/integration/fixtures/postgres-bootstrap.sql` exclusivamente contra PostgreSQL 18 desechable en el VPS autorizado. Las contrasenas de ese fixture son marcadores sinteticos y no se reutilizan en ningun entorno persistente.

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
