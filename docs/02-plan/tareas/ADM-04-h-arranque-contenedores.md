# ADM-04-h - Arrancar contenedores aislados del perfil

> Ficha derivada para completar el paso `START_CONTAINERS` del aprovisionamiento. No sustituye el alcance, el estado ni la definición de terminado.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-03`, `ADM-05`, `ADM-06`, `ADM-12`, `ADM-20`, `OPS-01`, `OPS-04`, `OPS-05`, `OPS-14` y `OPS-23`
- Fase del MVP: Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-04-g` integrado; release validada, manifiesto y referencias de base, secretos y storage disponibles.
- Bloquea a: `CONFIGURE_HTTPS`, `CREATE_ADMINISTRATOR`, `VERIFY` y `ACTIVATE` de `ADM-04`.
- ADR, arquitectura o diseño aplicables: `ADR-0002`, `ADR-0003`, `ADR-0008`, `ADR-0009`, `ADR-0015`, `ADR-0018`, `monorepo.md` y `mapa-del-sistema.md`.

## Resultado esperado

El ejecutor reconcilia de forma idempotente el proyecto Compose privado de un perfil usando la plantilla versionada y los digests aprobados. Los cinco procesos esperados arrancan con sus mounts exactos, redes internas, límites y configuración derivada; no se publican puertos al host. El estado observado y la generación del intento quedan registrados antes de avanzar al siguiente paso.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md` y `docs/02-plan/trabajo.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `START_CONTAINERS`, `tenant.yaml`, `qcrm-t-`, `deploy-executor`, Compose, mounts, digests y readiness.
- Codigo o documentación encontrados: existe la plantilla `infra/compose/tenant.yaml`, el paso tipado y el adaptador `apps/deploy-host`; el transporte Unix y su allowlist ya están integrados, pero el reconciliador fijo de Compose todavía no opera Docker.
- Pruebas e historial encontrados: CI de los PR #12, #13 y #14 acredita contratos, persistencia, cliente y transporte del adaptador, no un proyecto de tenant real.
- Decision de reutilizacion, extension o reemplazo: extender el flujo tipado y usar el adaptador privado definido en `ADR-0018`; no montar el socket Docker ni crear un orquestador paralelo.

## Alcance

### Incluido

- Contrato tipado de reconciliación, observación y finalización de `START_CONTAINERS`.
- Adaptador de host Unix privado con allowlist de acciones y validación de plantilla, UUID, release, digests, mounts, redes y puertos.
- Proyecto Compose por perfil con `crm-web`, `portal-web`, `api`, `worker` y `agent-runtime`, sin puertos públicos y con secretos exactos.
- Persistencia durable de recursos observados, fencing, idempotencia y estados pendiente/error/listo.

### No incluido

- HTTPS/Caddy, administrador inicial, migraciones comerciales, activación o tráfico real.
- Socket Docker en `deploy-executor`, shell remoto, Compose libre o creación de perfiles ficticios en staging.

## Impacto tecnico

| Area                       | Impacto previsto                                                           |
| -------------------------- | -------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `deploy-executor`, `platform-domain`, `database` y adaptador de host       |
| Contratos y eventos        | Puerto tipado de acciones de host y resultado observado por generación     |
| Datos y migraciones        | Recursos Compose por perfil, digests y estado observado                    |
| Permisos y aislamiento     | Socket Unix privado; proyecto, redes, mounts y secretos derivados del UUID |
| Configuracion y secretos   | Consume manifestos y archivos exactos; no serializa valores                |
| Observabilidad y operacion | Readiness por servicio, resultados durables, reconciliación y límites      |
| Documentacion              | Ficha, estado, ADR, mapa e inventario del VPS                              |

## Plan de implementacion

- [x] Añadir contrato y validadores de acciones de host.
- [x] Implementar el adaptador cliente Unix privado y su allowlist contractual de respuesta.
- [x] Persistir observación, fencing y transición a `CONFIGURE_HTTPS`.
- [x] Conectar `START_CONTAINERS` al ejecutor sin entregar el socket Docker.
- [x] Implementar el reconciliador fijo de Compose con manifiesto de release, digests y observación de los cinco servicios.
- [ ] Cubrir idempotencia, concurrencia, rechazo de entradas y readiness en CI y VPS.
- [ ] Desplegar una vez en el VPS autorizado y registrar evidencia sin datos sintéticos en staging.

## Riesgos y mitigaciones

| Riesgo                                    | Mitigacion                                           | Verificacion                                    |
| ----------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| El adaptador se convierte en shell remoto | Acciones cerradas y plantilla canónica               | Solicitud con comando/path arbitrario rechazada |
| Un perfil ve recursos ajenos              | Nombres, mounts, redes y secretos derivados del UUID | Intento cruzado y revisión de mounts            |
| Reintento duplica contenedores            | Proyecto determinista y reconciliación por digest    | Dos ejecuciones concurrentes                    |
| Readiness incierta confirma un despliegue | Observación por servicio y estado pendiente          | Reinicio durante `up` y reconciliación          |

## Criterios de aceptacion

- [ ] Solo se crea el proyecto Compose derivado del UUID y con los cinco servicios esperados.
- [ ] Ningún puerto del perfil se publica al host ni se comparte un secreto de otro perfil.
- [ ] Repetir o concurrir no duplica proyectos, mounts, redes ni resultados.
- [ ] Un digest, manifest, path, puerto o servicio no allowlisted falla cerrado.
- [ ] El paso solo avanza con readiness y observación durables.

## Plan de verificacion

- Pruebas unitarias: UUID, proyecto, plantilla, digests, mounts, redes, puertos y errores tipados.
- Pruebas de integracion o contratos: adaptador privado, Compose desechable y persistencia/fencing.
- Pruebas E2E: alta vertical con el perfil piloto autorizado, sin presentar una demo parcial como MVP.
- Comprobacion manual: proyecto, contenedores, redes, mounts, digests y readiness en el VPS.
- Seguridad, permisos y aislamiento: socket no accesible desde el executor, secrets exactos y sin exposición pública.
- Idempotencia, concurrencia y recuperacion: leases, resultado tardío, reinicio y reconciliación.
- Comandos que deben aprobar: puertas CI y verificación afectada del VPS según `15-ejecucion-verificaciones-vps.md`.

## Recuperacion

- Compatibilidad o migracion: migración aditiva; un executor anterior deja `START_CONTAINERS` pendiente.
- Rollback de aplicacion: detener o volver a los digests compatibles sin borrar volúmenes persistentes ni datos.
- Recuperacion de datos, si aplica: restauración coordinada separada; `down --volumes` no es rollback.

## Evidencia de cierre

- Archivos, commits o PR: contrato y cliente en PR #12 (`7026c41`), persistencia y conexión de `START_CONTAINERS` en PR #13 (`a36709a`), adaptador Unix privado y allowlist en PR #14 (`521ae6d`), manifiesto de release en PR #16 (`ca5e565`), política Compose en PR #17 (`5051867`) y runner actual en la rama `feat/ADM-04-h-compose-runner-impl`.
- Comandos y resultados: PR #18 (`38b465c`) pasó `static`, `unit`, `integration`, `contracts`, `build`, `security/dependencies` y `security/secrets`. En el VPS autorizado, `docker compose -f /tmp/qcrm-tenant-runner.yaml config --quiet` pasó con UUID, redes, digests y secreto sintéticos; no se levantaron contenedores ni se ejecutaron pruebas o builds en el equipo local.
- Documentacion actualizada: estado del proyecto, mapa del sistema y esta ficha.
- Desviaciones del plan: el runner ya no es un placeholder; permanece sin promover hasta que CI y la validación dirigida del VPS acrediten el proyecto real, sus redes, mounts, digests y readiness.
- Pendientes o decisiones nuevas: cubrir concurrencia/readiness con Compose desechable y ejecutar el alta vertical del perfil piloto cuando existan sus datos autorizados; confirmar que el bind de secretos del executor coincide con la raíz visible para `deploy-host`.
