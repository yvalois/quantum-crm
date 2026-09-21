# Infraestructura declarativa

Esta carpeta contiene el bootstrap de contenedores de Quantum CRM. No acredita un despliegue productivo ni reemplaza el inventario pendiente del VPS (`OPS-02`).

## Matriz actual

| Proyecto                                                   | Servicios                                                  | Proposito                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `local.yaml` / `quantum-local`                             | ocho aplicaciones                                          | Desarrollo integrado en el VPS de pruebas, con puertos publicados solo en loopback    |
| `test.yaml` / `quantum-test`                               | `crm-web` y `api`                                          | Smoke desechable de ambos tipos de imagen                                             |
| `platform-foundation.yaml` / `quantum-platform-foundation` | PostgreSQL, Redis, Keycloak y migrador bajo perfil `tools` | Dependencias persistentes de plataforma con redes privadas y volumenes independientes |
| `platform.yaml` / `quantum-platform`                       | `admin-web`, `admin-api`, `deploy-executor`                | Procesos centrales sin puertos publicos directos                                      |
| `edge.yaml` / `quantum-edge`                               | Caddy                                                      | Unica entrada HTTP/HTTPS; sitios existentes, identidad y administrador                |
| `tenant.yaml` / `-p qcrm-t-<uuid>`                         | `crm-web`, `portal-web`, `api`, `worker`, `agent-runtime`  | Plantilla repetible por perfil, con nombre de proyecto validado por el ejecutor       |

La fundacion persistente separa el ciclo de vida de PostgreSQL, Redis y Keycloak del ciclo de releases de las aplicaciones. Sus volumenes nunca se eliminan como parte de un rollback de aplicacion. Archivos y telemetria se agregaran en sus requisitos propios. El `deploy-executor` no recibe el socket Docker en este incremento.

## Entrada HTTPS

`edge.yaml` publica exclusivamente Caddy en 80/443 y persiste su estado ACME. Los sitios estaticos preexistentes se montan desde `/var/www` en solo lectura; `admin-web` y Keycloak se alcanzan por `platform-edge`. La red interna `platform-oidc` une solo Caddy y `admin-api` y registra el host publico de identidad como alias de Caddy, de modo que la API obtiene JWKS por HTTPS con el issuer exacto sin recibir acceso general a Internet. La imagen personalizada conserva la version oficial fijada por digest y ejecuta Caddy sin privilegios, con solo `NET_BIND_SERVICE`.

La primera migracion desde Nginx es una operacion excepcional de bootstrap. `infra/caddy/migrate-from-nginx.sh` valida DNS, Nginx, Compose y Caddy antes de liberar los puertos; si falla cualquier comprobacion posterior, detiene Caddy y reactiva Nginx y Certbot. `infra/caddy/rollback-to-nginx.sh` permite la recuperacion explicita. Ambos requieren un checkout inmutable bajo `/opt/quantum/builds/` y un archivo de configuracion no secreto bajo `/opt/quantum/config/`. Los cambios posteriores de ingreso pertenecen al flujo tipado de `deploy-executor`.

## Fundacion persistente de plataforma

`infra/compose/platform-foundation.yaml` declara los tres motores sin publicar puertos al host:

- PostgreSQL solo pertenece a `platform-database` y crea bases y roles separados para Keycloak, migracion y runtime.
- Redis solo pertenece a `platform-session`, exige ACL y limita las claves al namespace de sesiones administrativas.
- Keycloak pertenece a la red de entrada y a `platform-database`; usa PostgreSQL y el comando `start --optimized --import-realm`, nunca `start-dev`.
- `platform.yaml` conecta `admin-web` a entrada y sesiones. `admin-api` usa datos y la red interna OIDC dedicada; esta ultima solo permite obtener el JWKS HTTPS del issuer exacto a traves de Caddy.

El host instala `infra/redis/99-quantum-redis.conf` en `/etc/sysctl.d/99-quantum-redis.conf` y aplica `sysctl --system` antes de arrancar Redis. Esta configuracion permite que su persistencia en segundo plano funcione bajo presion de memoria.

Las cinco imagenes de fundacion se construyen o espejan por digest; PostgreSQL consume directamente `POSTGRES_PASSWORD_FILE`, Redis y Keycloak adaptan los archivos montados a sus interfaces nativas, y SeaweedFS lee su configuracion S3 desde un secreto fuera del checkout. `infra/platform/provision-secrets.sh` crea de forma reanudable los secretos ausentes y valida los existentes sin imprimirlos ni sustituirlos. Se ejecuta como `root` con `QCRM_SECRET_DIRECTORY=/opt/quantum/secrets/<entorno>/platform`.

Los archivos viven fuera del checkout bajo un directorio `0700`. Los usados por un solo UID usan `0400`; las dos credenciales compartidas por los UID 1000 y 999 usan propietario 1000, grupo 999 y modo `0440`. La fundacion consume los primeros ocho; los cuatro siguientes son conexiones derivadas para migracion, runtime, aprovisionamiento y sesion. `provision-secrets.sh` crea ademas `/opt/quantum/secrets/<entorno>/tenants` con propietario del UID del executor; `CREATE_SECRETS` solo escribe dentro de esa raiz y conserva referencias relativas en plataforma.

```text
postgres-admin-password
platform-migrator-password
platform-runtime-password
platform-provisioner-password
keycloak-database-password
keycloak-bootstrap-admin-password
platform-redis-password
admin-web-oidc-client-secret
platform-migration-database-url
platform-database-url
platform-provisioner-database-url
admin-web-session-redis-url
storage-s3-admin-access-key
storage-s3-admin-secret-key
seaweedfs-s3.json
```

El primer arranque de PostgreSQL ejecuta `infra/postgres/init-platform-databases.sh` desde la imagen inmutable. El servicio `platform-migrator`, activado explicitamente con el perfil `tools`, aplica las migraciones y despues concede al rol runtime solo uso de schemas y DML; las aplicaciones nunca ejecutan migraciones. El rol `qcrm_platform_provisioner` solo crea y reconcilia bases y roles de perfiles mediante el paso tipado `CREATE_DATABASE`; no es superusuario y no recibe el runtime. La importacion de Keycloak omite el realm si ya existe; no es un mecanismo de actualizacion ni de backup.

## Conexion PostgreSQL y secretos

- `api` y `worker` reciben la URL runtime de la base de su perfil.
- `admin-api` recibe la URL runtime de plataforma. `deploy-executor` recibe esa URL para el estado durable y una segunda URL administrativa, separada y montada por archivo, solo para `CREATE_DATABASE`; no se entrega a ningun otro proceso.
- Webs y `agent-runtime` no reciben credenciales PostgreSQL.
- El valor se monta como secret de solo lectura en `/run/secrets/qcrm_database_url`; `QCRM_DATABASE_URL_FILE` contiene solo esa referencia.
- `QCRM_TENANT_ID` identifica el perfil de `api` y `worker` mediante un UUID inmutable. No selecciona dinamicamente otra base.
- Las variables `QCRM_CRM_DATABASE_URL_SECRET_FILE` y `QCRM_PLATFORM_DATABASE_URL_SECRET_FILE` apuntan a archivos del host fuera del checkout. Nunca contienen la URL.
- `QCRM_PLATFORM_PROVISIONER_PASSWORD_FILE` y `QCRM_PLATFORM_PROVISIONER_DATABASE_URL_SECRET_FILE` apuntan a los archivos del rol administrativo limitado; nunca contienen valores en Compose o Git.
- `deploy-executor` recibe `QCRM_TENANT_SECRET_DIRECTORY=/run/tenant-secrets` y un bind mount de escritura cuyo origen se declara como `QCRM_TENANT_SECRET_BIND_SOURCE` fuera del checkout. Ningun servicio comercial monta esa raiz completa.
- `CREATE_SECRETS` instala `tenant/<uuid>/migrator-password` y `tenant/<uuid>/runtime-password` con modo `0400`; `WRITE_CONFIGURATION` derivara las URLs exactas para cada servicio posteriormente.

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
QCRM_TENANT_SECRET_BIND_SOURCE=/opt/quantum/secrets/staging/tenants
QCRM_PLATFORM_STORAGE_NETWORK=quantum-platform-storage
QCRM_PLATFORM_STORAGE_VOLUME=quantum-platform-storage-data
QCRM_STORAGE_S3_CONFIG_FILE=/opt/quantum/secrets/staging/platform/seaweedfs-s3.json
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
QCRM_SEAWEEDFS_IMAGE_DIGEST=<64 caracteres hexadecimales>
```

La red externa `QCRM_PLATFORM_STORAGE_NETWORK` se crea una sola vez en el VPS antes de levantar
`platform-foundation`, `platform` o un perfil de tenant. Solo los servicios que necesitan S3 se
unen a ella; no se publican puertos administrativos de SeaweedFS. El archivo referenciado por
`QCRM_STORAGE_S3_CONFIG_FILE` vive fuera del checkout y contiene las identidades S3 generadas por
el procedimiento de secretos, nunca valores dentro de Git.

El perfil se valida y ejecuta con un nombre derivado de un UUID registrado, nunca de entrada libre:

```bash
docker compose -p qcrm-t-00000000-0000-4000-8000-000000000000 -f infra/compose/tenant.yaml config --quiet
```

En staging y produccion no se usa `build`, no se monta el checkout y ninguna aplicacion publica puertos al host. La futura red externa conecta exclusivamente Caddy con los servicios que debe enrutar.
