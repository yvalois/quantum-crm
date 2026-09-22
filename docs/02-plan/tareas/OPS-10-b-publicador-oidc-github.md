# OPS-10-b - Publicador OIDC de GitHub para candidatas

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificación

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `ADM-09`, `ADM-20` y `ADM-04`.
- Fase del MVP: Bootstrap técnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: [OPS-10-a](OPS-10-a-cadena-release-ghcr.md) integrada y primera publicación GHCR aprobada para `c7b498db75e5f460948a7acd6e802e9de890736a`; catálogo durable de `ADM-09`; [ADR-0020](../../06-decisiones/ADR-0020-identidad-oidc-github-actions-releases.md).
- Bloquea a: registro automático de candidatas completas, validación de staging y aprovisionamiento verificable de `ADM-04-i`.
- ADR, arquitectura o diseño aplicables: `ADR-0005`, `ADR-0008`, `ADR-0009`, `ADR-0020`, reglas 05, 06, 08, 09 y 15, `monorepo.md` y `mapa-del-sistema.md`.

## Resultado esperado

Tras publicar los ocho digests de un commit integrado de `main`, solo el job `release-candidate` autorizado registra de forma idempotente una candidata completa en `ADM-09`. El token de GitHub es efímero, no se persiste y se valida contra issuer, audience, repositorio privado, rama, evento, workflow, SHA y subject exactos. No puede usar rutas humanas, perfiles, executor, secretos ni VPS.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `OPS-10`, `ADM-09`, `release-candidate`, `PlatformRelease`, `OIDC_ACCESS_TOKEN_VERIFIER`, `PublicRoute`, `process.env`, Caddy y Compose.
- Código o documentación encontrados: `ReleasesController` reutiliza `CreatePlatformReleaseSchema` y `PlatformReleaseService`; las guardas globales autentican solo operadores humanos de Keycloak. `admin-api` solo alcanza el JWKS de Keycloak por alias interno de Caddy; no tiene salida general a Internet. La primera publicación de ocho artefactos GHCR, SBOM y procedencia terminó correctamente en la ejecución 35759155797.
- Pruebas e historial encontrados: pruebas del verificador Keycloak y del límite HTTP administrativo; PR #25 fue fusionado como `c7b498d` con checks y publicación aprobados.
- Decisión de reutilización, extensión o reemplazo: extender con un verificador separado para GitHub y una guarda/endpoint exclusivos. Se reutilizan el contrato y caso de uso de releases; no se debilita ni reutiliza la sesión humana ni se inserta en base desde CI.

## Alcance

### Incluido

- Configuración pública, estricta y tipada de issuer, audience, repositorio, workflow, ref y JWKS de GitHub Actions.
- Ruta fija de Caddy exclusivamente hacia discovery/JWKS de `token.actions.githubusercontent.com`, accesible solo por `admin-api` mediante una red interna dedicada; sin proxy genérico ni salida directa.
- Verificación RS256 de JWT OIDC de GitHub con claims requeridos y rechazo por defecto.
- Endpoint separado de las rutas de operador, con schema existente, igualdad SHA claim-cuerpo y persistencia idempotente.
- Pruebas proporcionales y actualización del workflow para obtener token y registrar solo después de publicar todos los artefactos.

### No incluido

- Validar, promover, retirar o desplegar releases; crear perfiles; ejecutar Docker; modificar Caddy en el VPS actual; otorgar secretos, PAT o acceso SSH a GitHub.
- Incluir tokens OIDC, manifiestos sensibles o credenciales en Git, logs, base de datos o navegador.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `admin-api`, `auth`, `config` y borde Caddy; `releases` conserva su caso de uso público. |
| Contratos y eventos | Reutiliza `CreatePlatformReleaseSchema`; agrega un límite HTTP de CI sin ampliar contratos humanos. |
| Datos y migraciones | Sin migración; alta idempotente en el catálogo existente. |
| Permisos y aislamiento | Principal de workload separado, con alcance único de alta candidata; sin permisos humanos u operativos. |
| Configuración y secretos | Política pública; no se crea secreto. |
| Observabilidad y operación | Auditoría estructurada sin JWT; ruta JWKS restringida. |
| Documentación | Ficha, estado y evidencia CI actualizados al terminar. |

## Plan de implementación

- [ ] Definir y validar la política de GitHub Actions en `packages/config`.
- [ ] Implementar el verificador OIDC aislado, con JWKS fijado y claims estrictos.
- [ ] Agregar ruta privada Caddy y redes/configuración declaradas, sin egress general desde `admin-api`.
- [ ] Añadir la guarda y el endpoint exclusivo de publicador que reutilizan `PlatformReleaseService`.
- [ ] Generar el manifiesto determinista con ocho digests y registrar la candidata solo tras la publicación completa.
- [ ] Ejecutar comprobaciones afectadas en el VPS una vez y la matriz CI de GitHub sobre el PR candidato.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| JWT de otro repositorio o PR crea una release | Allowlist exacta de issuer, audience, repo privado, ref, evento, workflow, SHA y subject | Pruebas negativas de claims y endpoint 401/403. |
| El endpoint de CI adquiere permisos de operador | Guarda y ruta separadas; no construye `PlatformAuthContext` humano | Prueba de acceso denegado a rutas administrativas. |
| El API obtiene salida libre | Caddy solo reenvía discovery/JWKS de host fijo en red dedicada | Revisión de Caddy, Compose y configuración. |
| Publicación parcial crea candidata | Registro posterior a ocho builds y schema de ocho digests | Prueba de manifiesto y ejecución CI. |
| Se repite un evento | ID de release determinista y conflicto idempotente | Prueba de repetición. |

## Criterios de aceptación

- [ ] Un JWT válido del workflow permitido de `main` registra una sola candidata completa y exacta.
- [ ] JWT expirados, de PR, otro repositorio, audience/ref/workflow/SHA/subject incorrectos o claims ausentes se rechazan antes de persistir.
- [ ] El publicador de CI no puede usar endpoints humanos, de perfiles, capacidad ni despliegue.
- [ ] El `admin-api` no obtiene salida general y Caddy no acepta destinos o paths controlados por solicitudes.
- [ ] No se guarda ni registra el JWT, valores sensibles ni credenciales persistentes.

## Plan de verificación

- Pruebas unitarias: parser de política y verificador JWT con JWK local; casos negativos de cada claim de confianza.
- Pruebas de integración o contratos: guarda y endpoint de publicador con alta repetida y schema de ocho artefactos.
- Pruebas E2E: no aplica hasta que la candidata pueda desplegarse en staging.
- Comprobación manual: revisar permisos del workflow, configuración Caddy/Compose y candidata registrada por ejecución autorizada.
- Seguridad, permisos y aislamiento: PR sin `id-token: write`, `packages: write`, secretos ni VPS.
- Idempotencia, concurrencia y recuperación: misma release dos veces no duplica registro; fallo previo no crea candidata parcial.
- Comandos que deben aprobar: comprobaciones afectadas en VPS y matriz CI única para el commit del PR.

## Recuperación

- Compatibilidad o migración: cambio aditivo, sin migraciones y sin modificar releases existentes.
- Rollback de aplicación: retirar endpoint/política en una release posterior; no cambia tráfico ni datos comerciales.
- Recuperación de datos: no aplica; una candidata errónea se trata por el flujo de estados, nunca con borrado directo.

## Evidencia de cierre

- Archivos, commits o PR: PR #26 integrada como `fd767e99fd577c12fe53f750baf02d55bafec288`; implementación en `7ce100167c209d437194c4b38d9d9735435a2901`.
- Comandos y resultados: ejecución GHCR 35759155797 aprobada, ocho jobs publicados por `c7b498db75e5f460948a7acd6e802e9de890736a`; matriz de PR 35762747794 aprobó contratos, estático, unitarias, integración, build, dependencias y secretos.
- Documentación actualizada: ficha y estado oficial actualizados al iniciar `OPS-10-c`.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: el incremento quedó integrado; `OPS-10-c` debe producir el manifiesto completo antes de desplegar por digest el `admin-api` que contiene el verificador y registrar candidatas reales en el VPS.
