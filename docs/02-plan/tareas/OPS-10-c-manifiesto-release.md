# OPS-10-c - Manifiesto determinista y evidencia de candidata

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `ADM-09`, `ADM-20` y `ADM-04`.
- Fase del MVP: Bootstrap tecnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `OPS-10-a` y `OPS-10-b` integradas; los ocho Dockerfiles y artefactos GHCR existentes; el contrato y catalogo durable de `ADM-09`.
- Bloquea a: registro OIDC de candidatas completas, despliegue de la plataforma por digest y validacion verificable de `ADM-04-i`.
- ADR, arquitectura o diseno aplicables: `ADR-0005`, `ADR-0007`, `ADR-0009`, `ADR-0018`, `ADR-0020`, reglas 02, 05, 06, 09 y 15, `monorepo.md` y `mapa-del-sistema.md`.

## Resultado esperado

Un contrato `release-manifest/v1` permite generar y validar de forma determinista una candidata de ocho artefactos OCI exactos. Une el commit, el hash del lockfile, los digests, compatibilidad, SBOM, procedencia y resultado de la politica de escaneo. El workflow solo podra solicitar el registro OIDC despues de producir y validar ese manifiesto completo. Esta rebanada no registra una candidata, no despliega ni cambia trafico.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `release-candidate`, `PlatformRelease`, `CreatePlatformReleaseSchema`, `manifest`, `digest`, `SBOM`, `provenance` y `scan`.
- Codigo o documentacion encontrados: `PlatformRelease` exige ocho nombres y digests, y `release-candidate.yml` publica ocho imagenes con SBOM y procedencia, pero no produce un manifiesto versionado ni evidencia de escaneo que pueda consumir el endpoint OIDC.
- Pruebas e historial encontrados: la publicacion inicial GHCR 35759155797 aprobo los ocho jobs; PR #26 integro el verificador OIDC y su matriz 35762747794 aprobo todos los checks.
- Decision de reutilizacion, extension o reemplazo: extender `packages/contracts` con un manifiesto independiente que reutiliza los nombres y reglas de digests de `ADM-09`; el workflow lo consumira sin convertir el contrato de operador ni guardar credenciales.

## Alcance

### Incluido

- Schema runtime y constructor determinista de manifiestos completos, con ocho artefactos y orden canonico.
- Hash de lockfile, commit, compatibilidad, referencias de SBOM/procedencia y resultado versionado de politica de escaneo.
- Rechazo de digests mutables, artefactos incompletos, evidencia faltante, hash o commit invalido y resultados no admisibles.
- Pruebas de contrato y casos negativos proporcionales.

### No incluido

- Ejecutar Grype, publicar una nueva imagen, registrar una candidata, crear perfiles, desplegar al VPS, permitir SSH desde GitHub o cambiar trafico.

## Impacto tecnico

| Area | Impacto previsto |
| --- | --- |
| Aplicaciones y modulos | Paquete compartido de contratos y futuro consumidor del workflow de release. |
| Contratos y eventos | Nuevo `release-manifest/v1`, aditivo y separado del recurso administrativo de release. |
| Datos y migraciones | Ninguna; el manifiesto no se persiste aun. |
| Permisos y aislamiento | No agrega principal, secreto ni permiso operativo. |
| Configuracion y secretos | Solo metadatos publicables y hashes; nunca valores secretos. |
| Observabilidad y operacion | Evidencia estructurada de procedencia, SBOM y politica, sin logs sensibles. |
| Documentacion | Ficha y estado; arquitectura/release si el contrato cambia su frontera. |

## Plan de implementacion

- [ ] Definir `release-manifest/v1` y sus invariantes de identidad, orden y completitud.
- [ ] Implementar constructor canonico que produzca exactamente el mismo manifiesto ante las mismas entradas.
- [ ] Declarar la evidencia exigida de SBOM, procedencia y politica de escaneo, sin ejecutar aun el scanner.
- [ ] Agregar pruebas de contrato positivas, de mutabilidad, completitud, duplicados y resultados rechazados.
- [ ] Actualizar el workflow solo cuando pueda consumir el contrato sin emitir una candidata incompleta.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Una etiqueta mutable se presenta como release | Solo se aceptan digests `sha256` exactos. | Pruebas de schema y constructor. |
| Dos ejecuciones forman manifiestos distintos | Orden canonico y sin reloj, run ID ni valores no deterministas. | Prueba de igualdad exacta con entradas iguales y orden distinto. |
| Se registra una candidata sin evidencia | Evidencia obligatoria por los ocho artefactos y politica admisible. | Pruebas negativas de cada omision. |
| El manifiesto filtra secretos | Schema de allowlist sin campos libres ni credenciales. | Prueba de claves desconocidas y revision de contrato. |

## Criterios de aceptacion

- [ ] El manifiesto completo contiene commit, hash de lockfile, ocho artefactos por digest, compatibilidad, SBOM, procedencia y politica de escaneo.
- [ ] Entradas equivalentes, aunque lleguen desordenadas, producen bytes canonicos iguales.
- [ ] Faltantes, duplicados, tags, hashes invalidos, versiones incompatibles, claves libres o politica no admisible se rechazan.
- [ ] El contrato es aditivo y no permite registrar ni desplegar nada por si solo.

## Plan de verificacion

- Pruebas unitarias: constructor, orden canonico, digests, hashes y politica de escaneo.
- Pruebas de integracion o contratos: schema exportado y compatibilidad con los ocho artefactos de `PlatformRelease`.
- Pruebas E2E: no aplica hasta que el workflow produzca y entregue una candidata en staging.
- Comprobacion manual: revisar que no haya identificadores de ejecucion, URLs mutables, secretos ni rutas operativas.
- Seguridad, permisos y aislamiento: contrato estricto, sin credenciales ni ampliacion de permisos.
- Idempotencia, concurrencia y recuperacion: la misma entrada produce el mismo manifiesto; fallar la validacion no persiste ni publica.
- Comandos que deben aprobar: comprobaciones afectadas en VPS y matriz CI unica del commit candidato.

## Recuperacion

- Compatibilidad o migracion: contrato aditivo con version propia; no migra releases existentes.
- Rollback de aplicacion: revertir el consumidor futuro del manifiesto no altera artefactos ni datos.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: ficha y estado al inicio.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: integrar la ejecucion fijada por checksum de la politica de escaneo y el registro OIDC solo tras desplegar el `admin-api` por digest.
