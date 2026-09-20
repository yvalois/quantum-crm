# Inventario del VPS de Quantum CRM

> Este archivo contiene solo metadatos operativos no secretos. Contraseñas, claves privadas y valores de credenciales no se guardan en el repositorio.

- Requisito propietario: `OPS-02`
- Ultima comprobacion: 2026-09-19
- Estado: acceso SSH por clave verificado; inventario inicial en curso

## Identidad y acceso

| Dato | Valor observado |
|---|---|
| IPv4 publica | `2.25.172.119` |
| Hostname | `srv1959250` |
| Usuario operativo actual | `root` |
| Puerto SSH | `22` |
| Autenticacion reutilizable | Clave dedicada local mediante alias SSH `quantum-crm-vps` |
| Huella ED25519 verificada | `SHA256:ee/NiWqYWbKKk5Bu0gtpXNx5AZ7bkstM1XhadsUhbtY` |
| Proveedor | Pendiente de identificar documentalmente |

La contraseña inicial no se conserva en Git ni en archivos de configuracion. Como fue compartida en una conversacion, debe rotarse o deshabilitarse antes de alojar datos reales, despues de crear un usuario operativo con privilegios limitados y validar su recuperacion.

## Sistema y capacidad observada

| Dato | Valor observado |
|---|---|
| Sistema operativo | Ubuntu 26.04 |
| Kernel | `7.0.0-30-generic` |
| Virtualizacion | KVM |
| Arquitectura | `x86_64` |
| CPU | 1 vCPU |
| RAM | 4,003,916 KiB, aproximadamente 3.82 GiB |
| Disco raiz | 50,839,412,736 bytes, aproximadamente 47.35 GiB |
| Disponible al inventariar | 47,841,140,736 bytes, aproximadamente 44.56 GiB |
| Filesystem raiz | ext4 sobre `/dev/sda1` |
| Zona horaria | UTC |
| Sincronizacion NTP | activa |

La capacidad no autoriza todavia un numero de perfiles. Un solo vCPU obliga a construir y probar imagenes secuencialmente y a medir API, worker, PostgreSQL, Redis, identidad, archivos y candidato antes de fijar concurrencia o prometer blue/green.

## Docker

| Dato | Valor observado |
|---|---|
| Docker Engine | 29.8.0, servicio activo |
| Docker Compose | v5.5.1 |
| Storage driver | overlayfs |
| Cgroups | v2 |
| Docker root | `/var/lib/docker` |
| Contenedores activos | 0 |
| Imagenes presentes | 0 |

## Servicios y puertos existentes

| Puerto o servicio | Estado observado | Regla de preservacion |
|---|---|---|
| SSH `22/tcp` | publicado por OpenSSH | No cambiar acceso hasta validar usuario operativo y recuperacion |
| Nginx `80/443` | activo y publicado en IPv4/IPv6 | No detener, reemplazar ni tomar los puertos sin plan de migracion |
| `mr-business.2-25-172-119.nip.io` | sitio Nginx con raiz `/var/www/mr-business` y Certbot | Preservar |
| `2-25-172-119.nip.io` | sitio Nginx con raiz `/var/www/quantum` y Certbot | Preservar |
| Monarx `127.0.0.1:65529` | agente local | No publicar ni interferir |
| UFW | inactivo | Revisar firewall del proveedor y politica del host antes de publicar servicios nuevos |

Caddy permanece inactivo. La arquitectura aprobada lo contempla como proxy, pero el VPS ya usa Nginx y Certbot. La convivencia o migracion requiere una decision explicita; ningun build o smoke de Quantum usara 80/443 mientras tanto.

## Builds y smoke aislados

La validacion del 2026-09-19 uso el commit `e2389a81e71eaf054a3e00bac7283206161505d4`, transferido a `/opt/quantum/builds/e2389a81e71eaf054a3e00bac7283206161505d4`. Las pruebas no modificaron Nginx ni publicaron servicios hacia Internet.

| Evidencia | `crm-web` | `api` |
|---|---|---|
| Imagen local del VPS | `quantum-crm/crm-web:e2389a81e71e` | `quantum-crm/api:e2389a81e71e` |
| ID de imagen | `sha256:cfae50ac9f208664a0ba372eea27060043d6c6b075cd6c05b0eaa926bce2e0a2` | `sha256:ee29aed81bfb2e953b459f5a1a615ccf832b1f369f26cd6f59004b16215185ea` |
| Tamano reportado por Docker | 411,590,733 bytes | 364,251,132 bytes |
| Usuario final | `node` | `node` |
| Health live y ready | `status: ok` | `status: ok` |
| Puerto temporal | `127.0.0.1:13000` | `127.0.0.1:13001` |
| Memoria ociosa observada | 39.05 MiB | 49.85 MiB |
| CPU durante la muestra | 0.00 % | 0.00 % |

Ambos contenedores se ejecutaron con raiz de solo lectura, `cap_drop: ALL`, `no-new-privileges` y un `tmpfs` acotado en `/tmp`. Las cuatro rutas live/ready respondieron correctamente. Los contenedores temporales fueron eliminados despues de la prueba; las imagenes permanecen como evidencia local. Nginx siguio activo y el disco quedo con aproximadamente 42 GiB disponibles.

La medicion es una muestra en reposo de dos procesos, no un dimensionamiento del sistema completo. Aun faltan PostgreSQL, Redis, identidad, archivos, scan, workers, observabilidad, carga concurrente y margen de despliegue.

El primer build revelo que la web no construia sus dependencias workspace; el commit `4d0fa22` corrigio el orden. El primer arranque posterior revelo que se habia aplanado incorrectamente el standalone de Next.js; `e2389a8` preservo su estructura. Ambos defectos quedaron cubiertos por la prueba de arquitectura y por el smoke final.

## Pendientes de `OPS-02`

- Identificar proveedor, plan contratado y limites externos de red o snapshots.
- Confirmar firewall del proveedor y definir politica UFW sin cortar SSH ni los sitios actuales.
- Medir la plataforma completa y carga concurrente antes de fijar limites definitivos.
- Reservar margen para bases, objetos, respaldos, migraciones y candidatos.
- Definir destino de respaldo cifrado fuera del VPS.
- Crear usuario operativo de minimo privilegio, rotar la contraseña expuesta y revisar login root.
