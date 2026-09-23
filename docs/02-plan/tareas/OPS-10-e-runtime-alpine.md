# OPS-10-e - Remediacion Alpine de imagenes finales

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `ADM-09`, `ADM-20` y `ADM-04`.
- Fase del MVP: Bootstrap tecnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `OPS-10-a`, `OPS-10-b` y `OPS-10-c` integradas; `OPS-10-d` integrada en `main` mediante PR #35. El workflow de release 35873367350 publico los ocho artefactos del commit `46f5eb5eeb9533ddd94f0c18f05e3746595940b7`, pero rechazo su manifiesto por hallazgos altos de paquetes Debian Trixie sin version reparada en el reporte.
- Bloquea a: manifiesto admisible, registro OIDC de candidatas, despliegue por digest y validacion verificable de `ADM-04-i`.
- ADR, arquitectura o diseno aplicables: `ADR-0007`, `ADR-0009`, reglas 02, 05, 09 y 15, `monorepo.md`, `mapa-del-sistema.md` e `infra/README.md`.

## Resultado esperado

Las imagenes Node de Quantum usan la imagen oficial `node:24.21.0-alpine` fijada al indice OCI `sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`. Las etapas de toolchain y runtime usan la misma familia Alpine, conservan el usuario no root y no exponen npm ni Corepack en runtime. La siguiente release se construye una sola vez desde un commit nuevo y solo genera manifiesto si Grype no detecta hallazgos altos ni criticos.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `release-candidate`, `grype`, `trixie`, `alpine`, `NODE_IMAGE`, `NODE_RUNTIME_IMAGE`, `Dockerfile.node`, `Dockerfile.web`, `Dockerfile.migrator` y `npm`.
- Codigo o documentacion encontrados: `OPS-10-d` fijo Node 24.21.0 Trixie y retiro gestores de paquetes del runtime. Los Dockerfiles separan toolchain y runtime en `Dockerfile.node`, reutilizan la misma imagen en `Dockerfile.web` y ejecutan el migrador con una unica imagen Node.
- Pruebas e historial encontrados: la matriz de PR #35 aprobo todos sus checks. El workflow 35873367350 publico los ocho digests, conservo SBOM, procedencia y reportes, y bloqueo el manifiesto porque los paquetes Trixie del runtime tenian hallazgos altos sin version reparada.
- Decision de reutilizacion, extension o reemplazo: conservar BuildKit, Grype, la politica de bloqueo, digests, usuario `node` y la eliminacion de gestores de paquetes. Sustituir solo la base Node oficial por Alpine en todas las etapas que comparten binarios. No se crea excepcion ni se oculta evidencia.

## Alcance

### Incluido

- Fijar la base oficial Node 24.21.0 Alpine por digest en los Dockerfiles de aplicaciones y migrador.
- Usar la misma base Alpine para toolchain y runtime cuando comparten dependencias nativas.
- Actualizar la prueba arquitectonica que protege los Dockerfiles.
- Conservar la politica de release y comprobar una sola vez el commit nuevo con CI y el workflow de release posterior al merge.

### No incluido

- Reducir, desactivar o exceptuar la politica de escaneo.
- Reejecutar, reconstruir, registrar, desplegar o promover el commit rechazado.
- Cambiar contratos, datos, migraciones, secretos, permisos, VPS o trafico.

## Impacto tecnico

| Area | Impacto previsto |
| --- | --- |
| Aplicaciones y modulos | Los ocho procesos Node y el migrador conservan entrypoint; cambia la base de compilacion y runtime. |
| Contratos y eventos | Ninguno. |
| Datos y migraciones | Ninguna migracion; el migrador conserva el comando y solo cambia su base de ejecucion. |
| Permisos y aislamiento | Mantiene `USER node` y no agrega accesos ni permisos. |
| Configuracion y secretos | Ninguno. |
| Observabilidad y operacion | Se conservan SBOM, procedencia, reportes y bloqueo por vulnerabilidades. |
| Documentacion | Ficha, estado y prueba arquitectonica actualizados. |

## Plan de implementacion

- [x] Fijar el indice oficial Node 24.21.0 Alpine en las etapas de toolchain y runtime afectadas.
- [x] Actualizar la prueba de manifests para impedir el regreso a Debian o una referencia mutable.
- [x] Abrir PR y usar una unica matriz CI como evidencia del cambio.
- [x] Tras el merge, inspeccionar una sola ejecucion de release del commit nuevo y registrar el resultado sin repetirla.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Dependencia nativa incompatible con musl | Toolchain y runtime usan la misma imagen Alpine; CI construye los ocho consumidores. | Build y checks completos de CI. |
| Imagen mutable o base Debian vuelve a entrar | Digest de indice completo y asercion arquitectonica explicita. | Prueba de manifests. |
| Un hallazgo se oculta para publicar | Scanner y politica no cambian; los reportes se conservan tambien en fallo. | Artefacto de release y ausencia de manifiesto ante high/critical. |
| Un comando de runtime requiere npm | Se preservan `node` y dependencias desplegadas, y se retiran solo gestores de paquetes. | Build y smoke afectados en CI. |

## Criterios de aceptacion

- [ ] Los tres Dockerfiles usan Node 24.21.0 Alpine con digest de indice completo, sin `latest` ni base Debian.
- [ ] Toolchain y runtime de cada artefacto compatible usan Alpine; los runtimes no exponen npm, npx ni Corepack y siguen sin root.
- [ ] La prueba arquitectonica impide una regresion de familia base, digest o gestores de paquetes.
- [ ] CI aprueba el commit y su unica release posterior conserva reportes y solo genera candidata si no queda ningun hallazgo alto o critico.

## Plan de verificacion

- Pruebas unitarias: no aplica; la condicion es declarativa en Dockerfiles.
- Pruebas de integracion o contratos: prueba arquitectonica de manifests y build de consumidores en CI.
- Pruebas E2E: smokes aplicables de la matriz CI, sin repetirlos manualmente.
- Comprobacion manual: comparar el reporte Grype nuevo con el artefacto del workflow 35873367350.
- Seguridad, permisos y aislamiento: confirmar digest, `USER node`, ausencia de gestores de paquetes y bloqueo ante high/critical.
- Idempotencia, concurrencia y recuperacion: la release sigue construyendo una vez por commit; no se relanza el commit rechazado ni se cambia trafico.
- Comandos que deben aprobar: matriz CI de GitHub para el commit del PR y workflow `release-candidate` de `main` tras el merge.

## Recuperacion

- Compatibilidad o migracion: no cambia contratos ni datos; los digests anteriores permanecen como evidencia rechazada, no como candidata.
- Rollback de aplicacion: revertir el Dockerfile crea un commit nuevo, no reutiliza ni promueve un commit bloqueado.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: PR #36, merge `d34a136480713584a8027b25b1953b6f0b0cbb63`.
- Comandos y resultados: matriz CI 35875731543 aprobada; release 35875997635 publico los ocho digests y guardo ocho reportes, pero no genero manifiesto porque cada imagen tuvo un high (`CVE-2026-85091`, `zlib 1.3.2-r0`) y cero criticals.
- Documentacion actualizada: ficha, estado, `infra/README.md` y prueba de manifests.
- Desviaciones del plan: Alpine redujo 57 hallazgos altos y 7 criticos por imagen a un high, pero no satisface la politica.
- Pendientes o decisiones nuevas: [`OPS-10-f`](OPS-10-f-remover-zlib-runtime.md) elimina exclusivamente el paquete vulnerable, sin excepcion.
