# OPS-01-c - Imagenes y proyectos Compose base

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-01`
- Requisitos relacionados: `OPS-03`, `OPS-04`, `OPS-07`, `OPS-10`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `OPS-01-a`, `OPS-01-b`, Node.js 24 y procesos health ejecutables
- Bloquea a: CI de imagenes, despliegue local integrado y plantillas operativas por perfil
- ADR, arquitectura o diseno aplicables: ADR-0001, ADR-0003, ADR-0008, ADR-0009, ADR-0010, `monorepo.md` y `mapa-del-sistema.md`

## Resultado esperado

El repositorio define imagenes multi-stage sin privilegios para los procesos web y Node, separa Compose local, pruebas, plataforma y perfil, y valida que produccion solo admita referencias OCI completas fijadas por digest. Este incremento no instala el VPS ni acredita `OPS-03` completo.

## Auditoria del trabajo existente

- Busquedas realizadas: `infra/`, Dockerfiles, Compose, scripts, aplicaciones, health, reglas OPS y decisiones de release.
- Codigo o documentacion encontrados: no existia `infra/`; los ocho procesos y sus health fueron aprobados en `OPS-01-b`.
- Pruebas e historial encontrados: commits `71b20d7` y `bed1de0`; 21 pruebas, arquitectura, builds y smoke aprobados.
- Decision de reutilizacion, extension o reemplazo: reutilizar los builds y health existentes; agregar infraestructura declarativa sin introducir dependencias comerciales ni servicios aun no implementados.

## Alcance

### Incluido

- Dockerfiles multi-stage separados para Next.js standalone y procesos Node compilados.
- Imagen base Node exacta por tag y digest, pnpm exacto y usuario sin privilegios.
- Contexto de build protegido mediante `.dockerignore`.
- Compose local para los ocho procesos con puertos limitados a loopback.
- Compose de plataforma y plantilla de perfil con imagenes externas obligatoriamente fijadas por digest.
- Proyecto Compose de pruebas para smoke de las imagenes construidas.
- Redes separadas, filesystem de solo lectura, capacidades eliminadas y healthchecks.
- Pruebas estaticas y validacion con `docker compose config`.

### No incluido

- Instalar o modificar Docker en el VPS, que depende de `OPS-02`.
- Publicar imagenes, generar SBOM/procedencia o desplegar una release real.
- Montar el socket Docker o conceder permisos de host al `deploy-executor`.
- Agregar PostgreSQL, Redis, Keycloak, Caddy, SeaweedFS, ClamAV o secretos reales.
- Declarar terminado `OPS-01`, `OPS-03`, `OPS-04` o una funcion de producto.

## Plan de implementacion

- [x] Registrar la matriz de procesos, imagenes, redes y puertos.
- [x] Crear Dockerfiles reproducibles y endurecidos.
- [x] Crear Compose local, test, plataforma y perfil.
- [x] Exigir referencias por digest en plantillas no locales.
- [x] Agregar pruebas de estructura y comandos de validacion.
- [x] Validar formato, lint, tipos, pruebas y configuraciones Compose.
- [x] Registrar evidencia y pendientes sin cerrar requisitos mayores.

## Criterios de aceptacion

- [x] Las imagenes usan Node 24.21.0 fijado por digest, pnpm 9.13.2 y usuario no root.
- [x] Las imagenes finales no reciben secretos, toolchain ni codigo montado.
- [x] Las tres webs usan salida standalone y los cinco procesos Node usan artefactos desplegados de su workspace.
- [x] Local publica puertos solo en `127.0.0.1`; plataforma y perfil no publican puertos directamente.
- [x] Los archivos no locales rechazan imagenes ausentes o no fijadas por digest.
- [x] Los servicios tienen healthcheck, filesystem de solo lectura, `no-new-privileges` y `cap_drop: ALL`.
- [x] `docker compose config` y las puertas de codigo aplicables pasan.
- [x] La falta de daemon Docker se documenta y no se presenta una imagen no construida como verificada.

## Riesgos y mitigaciones

| Riesgo                                               | Mitigacion                                                   | Verificacion                                 |
| ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| Incluir secretos o artefactos locales en el contexto | `.dockerignore` con denegacion explicita                     | Prueba estatica y revision del contexto      |
| Ejecutar como root                                   | Usuario `node`, capacidades eliminadas y `no-new-privileges` | Inspeccion del Dockerfile y Compose          |
| Desplegar tags mutables                              | Variables de imagen completas y validador `@sha256:`         | Configuraciones sinteticas y prueba negativa |
| Confundir scaffold con produccion lista              | Alcance y README explicitos; no cerrar OPS-03                | Estado y evidencia                           |
| Duplicar configuracion de procesos                   | Matriz comun y convenciones equivalentes                     | Prueba de inventario de ocho servicios       |

## Plan de verificacion

- Pruebas unitarias/arquitectura: manifiestos, imagen base, usuario, digests, redes, puertos y hardening.
- Integracion: `docker compose config` para local, test, plataforma y perfil con referencias sinteticas.
- Build/ejecucion: sujeto a disponibilidad del daemon; no se sustituye con validacion estatica.
- Seguridad: escaneo local de secretos y comprobacion de archivos excluidos del contexto.
- Recuperacion: revertir los commits de esta ficha; no existen datos ni volumenes creados.

## Evidencia de cierre

- Archivos, commits o PR: `.dockerignore`, `infra/docker/`, `infra/compose/`, `infra/README.md`, pruebas de manifiestos y commit `d108a97`.
- Comandos y resultados: instalacion offline congelada aprobada; formato, lint y typecheck de 17 workspaces aprobados; 22 pruebas de codigo y 5 de arquitectura aprobadas; builds de nueve paquetes y ocho aplicaciones aprobados; `pnpm deploy` de `api` produjo `dist/main.js` con dependencias de produccion.
- Compose: `config --quiet` aprobo local, test, plataforma y perfil; plataforma sin variables de digest fallo de forma esperada.
- Seguridad local: cero coincidencias de credenciales en los archivos del incremento; el contexto excluye secretos, entornos locales, dependencias y artefactos de build.
- Documentacion actualizada: `README.md`, `infra/README.md`, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/04-proceso/estado.md`.
- Desviaciones del plan: Docker CLI 28.1.1 y Compose 2.35.1 estan instalados, pero el daemon Docker no esta activo; no se construyeron ni ejecutaron imagenes y no se presentan como verificadas.
- Pendientes o decisiones nuevas: construir y escanear imagenes cuando exista daemon; publicar solo mediante CI con SBOM, procedencia y digest; agregar datos, identidad, proxy, archivos, telemetria y secretos en sus requisitos propietarios.
