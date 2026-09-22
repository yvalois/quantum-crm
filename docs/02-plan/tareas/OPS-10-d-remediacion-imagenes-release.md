# OPS-10-d - Remediacion de imagenes bloqueadas por la politica de release

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `ADM-09`, `ADM-20` y `ADM-04`.
- Fase del MVP: Bootstrap tecnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `OPS-10-a`, `OPS-10-b` y `OPS-10-c` integradas; las ocho imagenes del commit `e90a1620cc2f8cfd60ab812f338dc8bb4da92605` publicadas y rechazadas por politica, con sus reportes conservados.
- Bloquea a: manifiesto admisible, registro OIDC de candidatas, despliegue por digest y validacion verificable de `ADM-04-i`.
- ADR, arquitectura o diseno aplicables: `ADR-0007`, `ADR-0009`, reglas 02, 05, 09 y 15, `monorepo.md`, `mapa-del-sistema.md` e `infra/README.md`.

## Resultado esperado

Las imagenes finales Node de Quantum quedan basadas en Node 24.21.0 sobre Debian Trixie, con digest OCI fijado, usuario no root y sin npm ni Corepack en tiempo de ejecucion. La siguiente release construida una unica vez por un commit nuevo conserva SBOM, procedencia y reportes Grype, y solo produce manifiesto si la politica `quantum-image-security/v1` no encuentra hallazgos altos o criticos.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `release-candidate`, `grype`, `bookworm`, `NODE_IMAGE`, `NODE_RUNTIME_IMAGE`, `Dockerfile.node`, `Dockerfile.web`, `Dockerfile.migrator` y `npm`.
- Codigo o documentacion encontrados: las ocho imagenes de release comparten `node:24.21.0-bookworm-slim` fijada por digest; el migrador comparte la variante completa. Las imagenes finales no requieren npm, npx ni Corepack para ejecutar sus comandos.
- Pruebas e historial encontrados: el workflow `release-candidate` 35766034546 publico los ocho digests del commit `e90a162`, actualizo la base Grype y guardo los reportes. Cada imagen tuvo 7 hallazgos criticos y 57 altos, todos procedentes de paquetes Debian Bookworm o de npm incluido por la imagen base; no se genero manifiesto ni candidata.
- Decision de reutilizacion, extension o reemplazo: conservar BuildKit, el workflow, Grype y la politica de bloqueo. Sustituir solamente la base final comun por Node oficial Trixie fijada por digest y retirar administradores de paquetes no necesarios del runtime. No se crea una excepcion ni se ocultan reportes.

## Alcance

### Incluido

- Actualizar las bases Node de los Dockerfiles de aplicaciones y migrador a Node 24.21.0 Trixie fijado por digest.
- Eliminar npm, npx y Corepack de las capas finales despues de completar la construccion.
- Proteger estas condiciones con la prueba arquitectonica existente de manifests.
- Conservar como evidencia el rechazo del candidato `e90a162` y verificar el nuevo commit mediante la matriz CI y el workflow de release ya existente.

### No incluido

- Reducir, desactivar o exceptuar la politica de escaneo.
- Reejecutar, reconstruir, registrar, desplegar o promover el commit rechazado.
- Cambiar contratos, datos, migraciones, secretos, permisos, VPS o trafico.

## Impacto tecnico

| Area | Impacto previsto |
| --- | --- |
| Aplicaciones y modulos | Ocho procesos Node y el migrador conservan su entrypoint; cambia solo su base de runtime. |
| Contratos y eventos | Ninguno. |
| Datos y migraciones | Ninguna migracion; el migrador conserva el mismo comando y solo reduce su superficie. |
| Permisos y aislamiento | Mantiene `USER node` y no incorpora permisos ni accesos. |
| Configuracion y secretos | Ninguno. |
| Observabilidad y operacion | La evidencia de Grype se conserva y la release futura usa el mismo escaner y politica. |
| Documentacion | Ficha, estado y prueba de arquitectura actualizados. |

## Plan de implementacion

- [ ] Fijar las dos bases oficiales Node 24.21.0 Trixie por digest en los Dockerfiles afectados.
- [ ] Retirar npm, npx y Corepack solo de las capas finales tras el build o instalacion necesarios.
- [ ] Actualizar la prueba que protege los Dockerfiles y su superficie de runtime.
- [ ] Abrir PR y usar su matriz unica como evidencia del cambio.
- [ ] Tras el merge, inspeccionar la unica ejecucion de release del nuevo commit; registrar el resultado sin repetirla.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Un proceso depende de npm en runtime | Solo se retiran binarios tras `pnpm install` y se conservan los entrypoints `node` y Prisma local. | Build y smoke afectados en CI. |
| Una imagen mutable vuelve a entrar | Referencias completas por digest y asercion arquitectonica. | Prueba de manifests. |
| Un hallazgo se oculta para publicar | La politica y el scanner no cambian; reportes se cargan aun cuando falle el job. | Artefacto de release y ausencia de manifiesto ante hallazgo. |
| Trixie altera una dependencia nativa | Toolchain y runtime usan la misma familia Trixie y el CI construye los ocho consumidores. | Build y checks completos del commit candidato. |

## Criterios de aceptacion

- [ ] Los Dockerfiles de aplicaciones y migrador usan Node 24.21.0 Trixie con digests completos, sin `latest`.
- [ ] Las capas finales no exponen npm, npx ni Corepack y todos los procesos siguen sin root.
- [ ] La prueba arquitectonica evita regresar a Bookworm o reintroducir los administradores de paquetes en runtime.
- [ ] CI aprueba el commit; su unica release posterior conserva reportes y no produce candidata si persiste algun alto o critico.

## Plan de verificacion

- Pruebas unitarias: no aplica; la condicion es declarativa en Dockerfiles.
- Pruebas de integracion o contratos: prueba arquitectonica de manifests y build de consumidores en CI.
- Pruebas E2E: los smokes aplicables de la matriz CI, sin repetirlos manualmente.
- Comprobacion manual: comparar los reportes Grype del nuevo commit con el artefacto ya conservado del commit rechazado.
- Seguridad, permisos y aislamiento: confirmar digest, `USER node`, ausencia de gestores de paquetes y bloqueo ante high/critical.
- Idempotencia, concurrencia y recuperacion: la release sigue construyendo una vez por commit; no se relanza el commit rechazado ni se cambia trafico.
- Comandos que deben aprobar: matriz CI de GitHub para el commit del PR y workflow `release-candidate` de `main` tras el merge.

## Recuperacion

- Compatibilidad o migracion: no cambia contratos ni datos; los digests anteriores permanecen como evidencia rechazada, no como candidata.
- Rollback de aplicacion: revertir el cambio de Dockerfile crea un commit nuevo, no reutiliza ni promueve el commit bloqueado.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente; se reutilizara la evidencia de CI y release del commit correspondiente.
- Documentacion actualizada: ficha y estado al inicio.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: si el nuevo reporte aun contiene high o critical, se abrira una remediacion por paquete; no se aceptara una excepcion automatica.
