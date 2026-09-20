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

## Pendientes de `OPS-02`

- Identificar proveedor, plan contratado y limites externos de red o snapshots.
- Confirmar firewall del proveedor y definir politica UFW sin cortar SSH ni los sitios actuales.
- Medir consumo de las imagenes y dependencias reales antes de fijar limites.
- Reservar margen para bases, objetos, respaldos, migraciones y candidatos.
- Definir destino de respaldo cifrado fuera del VPS.
- Crear usuario operativo de minimo privilegio, rotar la contraseña expuesta y revisar login root.
