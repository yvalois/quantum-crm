# OPS-10-a - Cadena de release inmutable en GHCR

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificación

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `OPS-12`, `OPS-14`, `ADM-04`, `ADM-06`, `ADM-09` y `ADM-20`.
- Fase del MVP: Bootstrap técnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `PROY-004` integrado, siete checks de calidad existentes y catálogo durable de `ADM-09`.
- Bloquea a: release validada, aprovisionamiento real de `ADM-04-i`, promoción por perfil y comprobación HTTPS externa.
- ADR, arquitectura o diseño aplicables: `ADR-0009`, `ADR-0008`, `ADR-0018`, `ADR-0020`, `05-git-y-github.md`, `09-ci-cd-y-releases.md`, `15-ejecucion-verificaciones-vps.md`, `monorepo.md` y `mapa-del-sistema.md`.

## Resultado esperado

Cada merge aceptado en `main` genera una única release candidata: ocho imágenes OCI por digest, SBOM, procedencia, resultados de escaneo y manifiesto versionado. El VPS recibe solo referencias por digest y credenciales de lectura; ningún workflow de PR obtiene secretos ni acceso al VPS. La promoción posterior seguirá siendo una operación tipada de plataforma, no SSH ni comandos libres desde GitHub.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `GHCR`, `publish`, `release`, `manifest`, `deploy`, `OPS-10`, `OPS-11` y workflows.
- Código o documentación encontrados: `.github/workflows/quality.yml` ejecuta los siete checks de PR y `ADM-09-a` conserva releases/digests, pero no existe workflow de build/publicación, SBOM, procedencia, manifiesto ni despliegue por digest.
- Pruebas e historial encontrados: PR #24 integró la reconciliación HTTPS y aprobó los siete checks; el VPS mantiene imágenes locales previas, el servidor está `UNAVAILABLE` y el catálogo de releases está vacío.
- Decisión de reutilización, extensión o reemplazo: extender `quality.yml` con un workflow de `main` separado y de privilegio mínimo; reutilizar Dockerfiles, contratos y catálogo existentes. No reconstruir manualmente en el VPS ni crear otra autoridad de releases.

## Alcance

### Incluido

- Workflow separado de `main`, con concurrencia por entorno y permisos mínimos.
- Buildx de los ocho procesos por arquitectura admitida, publicación GHCR por digest, SBOM y procedencia.
- Manifiesto validable con commit, lockfile, ocho artefactos, contratos, migraciones, compatibilidad, resultados y estrategia de rollback.
- Escaneo del candidato y artefactos redactados; bloqueo de vulnerabilidades según la política aprobada.
- Registro autenticado y tipado de la candidata en el catálogo de `ADM-09` mediante el principal OIDC de `ADR-0020`, sin crear perfiles ni ejecutar Docker en el VPS.
- Documentación operativa para la credencial de solo lectura del VPS, sin guardar su valor en Git.

### No incluido

- Desplegar automáticamente a producción, usar SSH desde GitHub o ejecutar comandos arbitrarios.
- Crear o activar un perfil piloto, alterar reservas/capacidad, emitir certificados o marcar `ADM-04` terminado.
- Volver público el repositorio, el paquete GHCR o almacenar tokens en GitHub Actions de pull request.

## Impacto técnico

| Área | Impacto previsto |
| --- | --- |
| Aplicaciones y módulos | Dockerfiles y manifiestos de release de los ocho procesos; catálogo `ADM-09` mediante contrato público. |
| Contratos y eventos | Contrato de manifiesto/release candidato versionado; sin shell ni payloads libres. |
| Datos y migraciones | Registro aditivo de candidato por el API existente; no se inventan digests ni datos de perfil. |
| Permisos y aislamiento | PR con solo lectura; publicación limitada a `main`; VPS con lectura de paquetes y sin credenciales de escritura. |
| Configuración y secretos | Variables públicas de build; credencial GHCR del VPS fuera de Git mediante archivo `*_FILE`. |
| Observabilidad y operación | Artefactos, digests, SBOM, procedencia, escaneo y vínculo commit→release visibles y trazables. |
| Documentación | Ficha, estado, runbook y evidencia de la primera candidata. |

## Plan de implementación

- [ ] Definir el schema y validador del manifiesto de release, con ocho artefactos por digest.
- [ ] Añadir workflow de `main` que construya una vez, publique en GHCR y genere SBOM/procedencia (implementado en la rama; pendiente de CI y de observar la primera publicación).
- [ ] Escanear el candidato y bloquear hallazgos según la política aprobada.
- [ ] Registrar únicamente una candidata completa y autenticada mediante el contrato de `ADM-09`.
- [ ] Preparar el VPS para extraer digests con una credencial de solo lectura por archivo.
- [ ] Ejecutar una candidata de `main`, conservar su manifiesto y comprobar que no despliega tráfico ni crea perfiles.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
| --- | --- | --- |
| Un PR publica o lee secretos | Eventos y permisos separados; ningún secreto ni environment en PR | Revisión de permisos y ejecución de PR. |
| Un tag mutable llega al VPS | El manifiesto acepta solo ocho digests OCI | Pruebas del validador y revisión del manifiesto. |
| Se reconstruye para promover | El workflow produce una vez en `main`; promoción solo referencia digests | Misma identidad entre artefacto y candidata. |
| Falla una publicación parcialmente | Candidata se registra solo tras reunir los ocho artefactos y evidencia | Reintento no duplica release ni cambia digests. |
| El VPS recibe credencial de escritura | Token de lectura mínimo montado por archivo fuera de Git | Inspección de permisos y mount, sin revelar valores. |

## Criterios de aceptación

- [ ] Un PR no recibe permisos de paquetes, attestations, secretos ni acceso al VPS.
- [ ] Un merge a `main` publica exactamente ocho artefactos identificados por digest, sin `latest`.
- [ ] Cada artefacto tiene SBOM y procedencia vinculadas al digest.
- [ ] El manifiesto liga commit, lockfile, digests, contratos, migraciones, compatibilidad y resultados.
- [ ] La candidata incompleta, vulnerable o con digest mutable no se registra como utilizable.
- [ ] El VPS puede obtener el digest exacto con identidad de solo lectura, sin ejecutar todavía una promoción.

## Plan de verificación

- Pruebas unitarias: schema y validación del manifiesto, nombres/digests exactos e identidad de la candidata.
- Pruebas de integración o contratos: registro idempotente mediante el contrato de `ADM-09`.
- Pruebas E2E: no aplica hasta que exista una candidata que pueda desplegarse en staging.
- Comprobación manual: revisar permisos del workflow, artefactos GHCR, attestations, manifiesto y credencial de lectura montada en el VPS.
- Seguridad, permisos y aislamiento: `pull_request` sin escritura; `main` con permisos mínimos por job; secretos solo en entornos protegidos o archivos del VPS.
- Idempotencia, concurrencia y recuperación: grupo de concurrencia por entorno, registro único por commit y reintento que conserva los mismos digests.
- Comandos que deben aprobar: matriz CI existente una vez por commit candidato, build/publicación del workflow y smoke de extracción por digest en el VPS.

## Recuperación

- Compatibilidad o migración: artefactos y manifiestos son aditivos; las releases existentes no se modifican.
- Rollback de aplicación: una promoción futura selecciona el manifiesto/digest compatible anterior; no se reconstruye.
- Recuperación de datos, si aplica: no aplica; esta rebanada no despliega ni muta datos comerciales.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: auditoría inicial del 2026-09-22: PR #24 integrada y verde; VPS con imágenes anteriores, sin `tenant-routes`, servidor `UNAVAILABLE`, catálogo vacío y sin workflow de release.
- Documentación actualizada: esta ficha y estado oficial.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: obtener una credencial de solo lectura de GHCR para el VPS solo cuando exista el primer digest; la cadena no concede a GitHub acceso directo al host.
