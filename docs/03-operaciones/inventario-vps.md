# Inventario del VPS de Quantum CRM

> Este archivo contiene solo metadatos operativos no secretos. Contraseñas, claves privadas y valores de credenciales no se guardan en el repositorio.

- Requisito propietario: `OPS-02`
- Ultima comprobacion: 2026-09-20
- Estado: acceso operativo SSH por clave endurecido; inventario y dimensionamiento en curso

## Identidad y acceso

| Dato                              | Valor observado                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| IPv4 publica                      | `2.25.172.119`                                                                                                             |
| IPv6 publica                      | `2a02:4780:75:82b9::1/48`                                                                                                  |
| Hostname                          | `srv1959250`                                                                                                               |
| Proveedor de red                  | Hostinger, bloque RIPE `HOSTINGER-HOSTING`; plan y region contractual pendientes                                           |
| Usuario operativo normal          | `quantum-ops`, contrasena bloqueada, acceso solo por clave                                                                 |
| Recuperacion SSH temporal         | `root` solo por clave mediante alias explicito `quantum-crm-vps-root`                                                      |
| Puerto SSH                        | `22`                                                                                                                       |
| Autenticacion reutilizable        | Clave operativa dedicada local mediante alias SSH `quantum-crm-vps`                                                        |
| Politica SSH efectiva             | `PasswordAuthentication no`, `PermitRootLogin prohibit-password`, `MaxAuthTries 3`, `LoginGraceTime 30`, X11 deshabilitado |
| Huella ED25519 verificada         | `SHA256:ee/NiWqYWbKKk5Bu0gtpXNx5AZ7bkstM1XhadsUhbtY`                                                                       |
| Fingerprint de la clave operativa | `SHA256:4/JzJ66lWKFIokZ6z8d8NMwWiy9sV3YdT+cK+nPKvGg`                                                                       |

La contrasena inicial no se conserva en Git ni en archivos de configuracion y ya no es aceptada por SSH. Como fue compartida en una conversacion, aun debe resetearse desde el panel de Hostinger o bloquearse definitivamente despues de comprobar la consola de recuperacion. El acceso root por clave tambien debe retirarse cuando exista esa recuperacion verificada.

`quantum-ops` tiene `sudo` no interactivo completo durante el bootstrap. Esto mejora atribucion y elimina el login normal como root, pero sigue siendo privilegio equivalente a root; no es el modelo final. Debe reducirse cuando `deploy-executor` y las operaciones tipadas puedan asumir Docker, configuracion y despliegues.

## Sistema y capacidad observada

| Dato                      | Valor observado                                 |
| ------------------------- | ----------------------------------------------- |
| Sistema operativo         | Ubuntu 26.04                                    |
| Kernel                    | `7.0.0-30-generic`                              |
| Virtualizacion            | KVM                                             |
| Arquitectura              | `x86_64`                                        |
| CPU                       | 1 vCPU                                          |
| RAM                       | 4,003,916 KiB, aproximadamente 3.82 GiB         |
| Disco raiz                | 50,839,412,736 bytes, aproximadamente 47.35 GiB |
| Disponible al inventariar | 47,841,140,736 bytes, aproximadamente 44.56 GiB |
| Filesystem raiz           | ext4 sobre `/dev/sda1`                          |
| Zona horaria              | UTC                                             |
| Sincronizacion NTP        | activa                                          |

La capacidad no autoriza todavia un numero de perfiles. Un solo vCPU obliga a construir y probar imagenes secuencialmente y a medir API, worker, PostgreSQL, Redis, identidad, archivos y candidato antes de fijar concurrencia o prometer blue/green.

## Docker

| Dato                 | Valor observado                    |
| -------------------- | ---------------------------------- |
| Docker Engine        | 29.8.0, servicio activo            |
| Docker Compose       | v5.5.1                             |
| Storage driver       | overlayfs                          |
| Cgroups              | v2                                 |
| Docker root          | `/var/lib/docker`                  |
| Contenedores activos | 7 persistentes y saludables        |
| Imagenes presentes   | 16; 7 usadas por servicios activos |

## Servicios y puertos existentes

| Puerto o servicio                 | Estado observado                               | Regla de preservacion                                                                 |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| SSH `22/tcp`                      | publicado por OpenSSH                          | No cambiar acceso hasta validar usuario operativo y recuperacion                      |
| Caddy `80/443`                    | activo y saludable por digest en IPv4/IPv6     | Unica entrada publica; conservar volumenes ACME y configuracion versionada            |
| Nginx y Certbot                   | instalados, inactivos y deshabilitados         | Recuperacion ensayada; no eliminar configuracion ni certificados anteriores           |
| `mr-business.2-25-172-119.nip.io` | servido por Caddy desde `/var/www/mr-business` | Hash `35517498...9e56` preservado antes, durante y despues del rollback               |
| `2-25-172-119.nip.io`             | servido por Caddy desde `/var/www/quantum`     | Hash `40e2b151...30b` preservado antes, durante y despues del rollback                |
| `admin.2-25-172-119.nip.io`       | `admin-web` por HTTPS                          | TLS valido, CSP con nonce, headers seguros y sesion host-only                         |
| `identity.2-25-172-119.nip.io`    | Keycloak de plataforma por HTTPS               | Discovery y JWKS publicados; administracion interna no expuesta                       |
| Monarx `127.0.0.1:65529`          | agente local                                   | No publicar ni interferir                                                             |
| UFW                               | inactivo                                       | Revisar firewall del proveedor y politica del host antes de publicar servicios nuevos |
| Actualizaciones automaticas       | `unattended-upgrades` activo y habilitado      | Mantener y observar reinicios o actualizaciones pendientes                            |
| Herramientas de backup            | `restic`, `borg` y `rclone` ausentes           | Elegir destino y herramienta antes de datos reales                                    |

Caddy reemplazo a Nginx como frontera el 2026-09-20 mediante el procedimiento reversible de `ADM-01-h`. Solo Caddy publica 80/443; PostgreSQL, Redis, Keycloak, `admin-web` y `admin-api` no publican puertos del host. La recuperacion a Nginx fue ejecutada y la migracion se repitio conservando ambos sitios y el volumen ACME.

El 2026-09-20 el filesystem raiz llego a 79 % de uso. La inspeccion atribuyo el consumo a checkouts de build con `node_modules`, `.next`, `dist` y `.pnpm-store`, imagenes historicas e intermedias y cache de Docker; los volumenes persistentes no eran la causa. Se eliminaron solo artefactos reproducibles bajo `/opt/quantum/builds`, imagenes no usadas y cache sin referencias. Se conservaron los fuentes del build vigente, las imagenes activas y el rollback inmediato. Tras construir y desplegar `ADM-05-a`, retirar dos checkouts de prueba, el store local de pnpm y cache reproducible, quedaron 14 GiB usados y 34 GiB libres, 29 % de uso, con siete contenedores saludables. `.dockerignore` excluye ahora `.pnpm-store` para que no vuelva a inflar el contexto de imagen. No se tocaron bases, volumenes persistentes, secretos ni respaldos.

## Plataforma administrativa desplegada

| Servicio          | Imagen o estado inmutable                               | Estado verificado |
| ----------------- | ------------------------------------------------------- | ----------------- |
| Caddy             | `qcrm-edge/caddy@sha256:e9c93188...66448`               | `healthy`         |
| `admin-web`       | `qcrm-platform/admin-web@sha256:abc03081...5590e`       | `healthy`         |
| `admin-api`       | `qcrm-platform/admin-api@sha256:8b2e42a3...66690c`      | `healthy`         |
| `deploy-executor` | `qcrm-platform/deploy-executor@sha256:ea57e9c1...808bc` | `healthy`         |
| Keycloak          | persistente, realm `quantum-platform`                   | `healthy`         |
| PostgreSQL        | persistente, base y roles de plataforma                 | `healthy`         |
| Redis             | persistente, ACL exclusiva de sesiones                  | `healthy`         |

Las redes `platform-database`, `platform-session`, `platform-internal` y `platform-oidc` son internas. La ultima contiene solo Caddy y `admin-api` y permite resolver el JWKS HTTPS del issuer exacto sin habilitar salida general a Internet. El operador inicial queda en estado de entrega y debe definir su propia contrasena y TOTP; el secreto inicial permanece fuera de Git con modo `0400`, y las cuentas administrativas temporales de Keycloak fueron retiradas.

El 2026-09-20, `ADM-02-b` actualizo exclusivamente `admin-api` desde el build persistente `248c4d56426c8aa00bbae40654c98b9551be30f4`. El servicio expone internamente la API v1 protegida de perfiles de cliente. El archivo `platform.env.before-ADM-02-248c4d5` conserva el digest anterior para rollback de aplicacion sin tocar los perfiles persistidos.

Ese mismo dia, `ADM-02-c` actualizo exclusivamente `admin-web` desde el build persistente `7ce09af36261b0b2eb0a578c2c20078061ebebe9`. El BFF publica rutas fijas para listar, crear, obtener y editar perfiles, conserva los tokens en servidor y exige Origin, CSRF y `If-Match` donde corresponde. El digest anterior permanece registrado en `platform.env.before-adm02c-font-7ce09af`; el smoke HTTPS confirmo raiz `200`, redireccion del dashboard privado, BFF anonimo `401` y contenedor saludable.

`ADM-03-a` actualizo exclusivamente `admin-api` desde el build persistente `dc555e9cb4658199b8fc284b705bc4d9bd4de9f0`. El contrato de edicion general ya no acepta cambios de estado y el dominio concentra la matriz de transiciones futura. El archivo `platform.env.before-adm03a-dc555e9` conserva el digest anterior; el contenedor nuevo quedo saludable por digest, los otros cinco servicios no se recrearon y el disco quedo en 20 % tras retirar dependencias y cache reproducibles.

`ADM-04-a` aplico la migracion aditiva `20260920220000_adm_04_create_provisioning_operations` y actualizo exclusivamente `admin-api` desde el build persistente `c8da78d9a13aa37c879018230e5d3d0665a587d8`. El endpoint interno registra una operacion durable con actor, correlacion, servidor, release, control optimista e idempotencia; no ejecuta Docker ni acepta comandos libres. PostgreSQL 18 desechable aprobo las tres migraciones desde cero y 6/6 pruebas de integracion antes del despliegue. El archivo `platform.env.before-adm04a-c8da78d` conserva el digest anterior; los otros cinco servicios no se recrearon y la ruta nueva nego una solicitud anonima con `401`.

`ADM-04-b` aplico `20260920233000_adm_04_add_provisioning_leases` y desplego `admin-api` y `deploy-executor` desde el commit `69e6c694657893d722e585796d2eb384e40caa71`. Dos reclamos concurrentes sobre PostgreSQL desechable devolvieron una sola operacion; tambien aprobaron renovacion con fencing y recuperacion del lease vencido. El ejecutor usa la URL runtime de plataforma montada como archivo, su readiness depende de PostgreSQL, no recibe el socket Docker y aun no reclama automaticamente ni ejecuta efectos de host. Los respaldos `platform.env.before-adm04b-69e6c69` y `platform.env.before-adm04b-api-69e6c69` conservan las configuraciones previas correspondientes.

`ADM-05-a` aplico `20260921010000_adm_05_create_infrastructure_servers` y desplego `admin-api` desde el commit `593077e86d8b0b88347c5cc8a09a782ab84f8708`. El registro `staging-primary` conserva la IPv4 `2.25.172.119`, Hostinger, Ubuntu 26.04.1 LTS, `x86_64`, 1000 millicores, 3910 MiB de RAM y 48 484 MiB de almacenamiento; la referencia de acceso se reduce a un indicador booleano en la API. La region contractual continua sin confirmar. El servidor queda deliberadamente `UNAVAILABLE`, con reserva cero, hasta medir el consumo base y enlazar reservas por perfil: la capacidad fisica calculada no autoriza aun un alta. El respaldo `platform.env.before-adm05a-593077e` conserva el digest anterior de aplicacion.

`ADM-05-b` aplico `20260921030000_adm_05_capacity_reservations` y desplego `admin-api` desde el commit `c3e0d6f9af045000aaf7bb7bcdc7347c1141487b`, con digest `sha256:ffebb9c50dd5c67038709413fd2554aeb1adf24b046359042677f1ed547db518`. El migrador `sha256:323be25f62cf02eac7b6b1044cd7104e3bda35d4c85b73f43df84dba7d1fac8f` confirmo seis migraciones y ninguna pendiente. El servicio quedo saludable y el respaldo `platform.env.before-adm05b-c3e0d6f` conserva el digest anterior. `staging-primary` continua `UNAVAILABLE`, con reservas cero y sin perfiles admitidos: la entrega instala la garantia atomica, pero no inventa capacidad operativa ni activa al cliente piloto antes de medirla.

`ADM-09-a` aplico `20260921160000_adm_09_release_catalog` y desplego exclusivamente `admin-api` desde el commit `aaa1b1ee04d710e215c7c6655774052ef85a243b`, con digest `sha256:8b2e42a31d3b362a0ade684cc7d32c1aa8ad1bc9eb36c0f6a0dcd8252c66690c`. El migrador inmutable `sha256:e843657d1a0b21e5cbbc8c3ee7b50cedd31530a16979f7047ef3fe64a582de03` aplico la septima migracion y concedio los permisos runtime fuera del SQL estructural. El catalogo quedo deliberadamente vacio: no se inventaron releases ni digests. Readiness respondio `200`, la ruta protegida `/api/v1/releases` respondio `401` sin identidad, los otros cinco servicios siguieron saludables y `platform.env.before-adm09a-aaa1b1e` conserva el digest anterior. El laboratorio PostgreSQL 18, su red, secretos sinteticos y dos checkouts intermedios fueron retirados; el filesystem raiz quedo en 61 %.

`ADM-04-c` aplico `20260921170000_adm_04_validation_executor` y desplego exclusivamente `deploy-executor` desde el commit `2747572d7993728f7fe503264f897c7668d1575e`, con digest `sha256:ea57e9c1a3b9f5b95267befacdd63c06d7dde881b9fa7e5556f35b06894808bc`. El migrador inmutable `sha256:1e40964da345015d331c60ce36bceeb2559f42f33ace301b1b90bd3ba04e4068` aplico la octava migracion. El proceso reclama automaticamente solo `VALIDATE`, persiste un resultado por intento y usa lease, version y propietario como fencing; una validacion correcta avanza a `CREATE_DATABASE` y un fallo permanente libera la reserva una sola vez. PostgreSQL 18 desechable aprobo ocho migraciones desde cero y 13/13 pruebas de integracion. Staging conservo cero perfiles, operaciones y resultados sinteticos, los siete servicios quedaron saludables y el ejecutor sigue sin socket Docker ni secretos de host. `platform.env.before-adm04c-2747572` conserva el digest anterior. Tras retirar cache e imagenes sin referencia, el filesystem raiz quedo en 66 %, con 17 GiB libres.

`ADM-04-f` aplicó `20260921220000_adm_04_create_tenant_storage` desde `dba1d75c8ac56e31f709e6558961c8515cab9305`. En el VPS se construyeron `deploy-executor` (`sha256:0b7c252f73c6ae97c6ffa0b51b370eada492c7bc06b308e009c6265b431197f2`) y `platform-migrator` (`sha256:3c86bb5bf3822f83aa5ef8b5f68d68955e0fa4d09a2e3f6fefa7035aac37a805`); SeaweedFS 4.47 quedó fijado al digest `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882` en la red y volumen privados de staging. La migración se aplicó correctamente, `platform-storage`, PostgreSQL, `admin-api`, `admin-web`, Keycloak, Redis y `deploy-executor` quedaron saludables, y `platform.env.before-adm04f-dba1d75` conserva la configuración anterior. No se crearon perfiles sintéticos: la prueba funcional de creación, reintento y aislamiento queda pendiente del perfil piloto autorizado.

`ADM-04-g` aplicó `20260921230000_adm_04_write_configuration` desde el commit `a6235198dd8f664740dd382fa2a9e268a3e464a7` (PR #9). En el VPS se construyeron una vez `deploy-executor` (`sha256:ff0ce711c4e90759ba484666afa35a3a13a0f40c9dba06889eb9b020090b4c87`) y `platform-migrator` (`sha256:80d61a6b82306dbc157dfe1b04fad529ee833c2f89365fa72d1a8493175baf89`); se fijó el migrador con el mismo digest bajo el registro `qcrm-foundation`. La migración se aplicó correctamente y `deploy-executor` se recreó con el bind mount privado `/opt/quantum/config/staging/tenants`, modo `0700`, UID/GID `1000:1000`, separado del árbol de secretos. Los ocho servicios de staging quedaron saludables y la comprobación operativa confirmó que el proceso puede escribir en el montaje. No se crearon perfiles sintéticos: la materialización real, el reintento y el aislamiento quedan pendientes del perfil piloto autorizado.

## Builds y smoke aislados

La validacion del 2026-09-19 uso el commit `e2389a81e71eaf054a3e00bac7283206161505d4`, transferido a `/opt/quantum/builds/e2389a81e71eaf054a3e00bac7283206161505d4`. Las pruebas no modificaron Nginx ni publicaron servicios hacia Internet.

| Evidencia                   | `crm-web`                                                                 | `api`                                                                     |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Imagen local del VPS        | `quantum-crm/crm-web:e2389a81e71e`                                        | `quantum-crm/api:e2389a81e71e`                                            |
| ID de imagen                | `sha256:cfae50ac9f208664a0ba372eea27060043d6c6b075cd6c05b0eaa926bce2e0a2` | `sha256:ee29aed81bfb2e953b459f5a1a615ccf832b1f369f26cd6f59004b16215185ea` |
| Tamano reportado por Docker | 411,590,733 bytes                                                         | 364,251,132 bytes                                                         |
| Usuario final               | `node`                                                                    | `node`                                                                    |
| Health live y ready         | `status: ok`                                                              | `status: ok`                                                              |
| Puerto temporal             | `127.0.0.1:13000`                                                         | `127.0.0.1:13001`                                                         |
| Memoria ociosa observada    | 39.05 MiB                                                                 | 49.85 MiB                                                                 |
| CPU durante la muestra      | 0.00 %                                                                    | 0.00 %                                                                    |

Ambos contenedores se ejecutaron con raiz de solo lectura, `cap_drop: ALL`, `no-new-privileges` y un `tmpfs` acotado en `/tmp`. Las cuatro rutas live/ready respondieron correctamente. Los contenedores temporales se eliminaron despues de la prueba. Las imagenes de esa validacion se conservaron inicialmente y fueron retiradas durante la limpieza segura del 2026-09-20 porque ya no estaban en uso; la evidencia inmutable permanece en esta tabla y en el commit indicado. Nginx siguio activo durante la prueba.

La medicion es una muestra en reposo de dos procesos, no un dimensionamiento del sistema completo. Aun faltan PostgreSQL, Redis, identidad, archivos, scan, workers, observabilidad, carga concurrente y margen de despliegue.

El primer build revelo que la web no construia sus dependencias workspace; el commit `4d0fa22` corrigio el orden. El primer arranque posterior revelo que se habia aplanado incorrectamente el standalone de Next.js; `e2389a8` preservo su estructura. Ambos defectos quedaron cubiertos por la prueba de arquitectura y por el smoke final.

## Pendientes de `OPS-02`

- Confirmar en el panel de Hostinger el plan contratado, region, firewall, consola y snapshots disponibles.
- Confirmar firewall del proveedor y definir politica UFW sin cortar SSH ni los sitios actuales.
- Medir la plataforma completa y carga concurrente antes de fijar limites definitivos.
- Reservar margen para bases, objetos, respaldos, migraciones y candidatos.
- Definir destino de respaldo cifrado fuera del VPS.
- Comprobar la consola de Hostinger, resetear o bloquear la contrasena expuesta, retirar el fallback root por clave y reducir el `sudo` humano cuando exista el ejecutor tipado.
