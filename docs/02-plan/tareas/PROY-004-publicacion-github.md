# PROY-004 - Publicacion y proteccion del repositorio en GitHub

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `PROY-004`
- Requisitos relacionados: `OPS-10` a `OPS-21`
- Fase del MVP: preparacion del proyecto
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex y propietario del repositorio
- Dependencias: repositorio privado vacio bajo la cuenta `yvalois` y autenticacion GitHub disponible
- Bloquea a: pull requests, checks protegidos, GHCR y entrega continua
- ADR, arquitectura o diseno aplicables: [`ADR-0009`](../../06-decisiones/ADR-0009-integracion-entrega-releases.md), [`05-git-y-github.md`](../../05-reglas/05-git-y-github.md) y [`09-ci-cd-y-releases.md`](../../05-reglas/09-ci-cd-y-releases.md)

## Resultado esperado

El historial local queda publicado sin secretos en el repositorio privado `yvalois/quantum-crm`; `main` queda protegida y el siguiente cambio se valida mediante una rama corta, checks sin privilegios y pull request.

## Lectura obligatoria aplicada

- [x] Requisito interno `PROY-004` en `docs/04-proceso/estado.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas y puertas operativas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas y decisiones de Git, GitHub y CI/CD pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg "PROY-004|primer push|ruleset|comprobaciones obligatorias|GitHub Actions" docs` y revision de `.github`, manifiestos, scripts y lockfile.
- Codigo o documentacion encontrados: historial local en `main`, plantilla de pull request y scripts reproducibles en el `package.json` raiz; no existia workflow de GitHub Actions ni remoto configurado.
- Pruebas e historial encontrados: 124 commits, 1917 objetos sueltos y 2.92 MiB de objetos Git antes de publicar.
- Decision de reutilizacion, extension o reemplazo: conservar el historial y los scripts actuales, publicar `main` una sola vez y extender `.github` con checks estables. No reescribir autores ni hashes existentes.

## Alcance

### Incluido

- Configurar identidad Git local y remoto `origin`.
- Inspeccionar el remoto y el historial completo antes del primer push.
- Publicar el historial local en el repositorio privado.
- Añadir CI inicial de pull request sin secretos ni acceso al VPS.
- Proteger `main` y comprobar el flujo con esta rama y su pull request.
- Actualizar la evidencia documental de `PROY-004`.

### No incluido

- Publicar imagenes, desplegar al VPS o configurar credenciales de produccion.
- Completar la cadena de releases, GHCR, SBOM, procedencia, staging o promocion de `OPS-10` a `OPS-21`.
- Reescribir los commits creados antes de configurar la identidad `yvalois`.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Ninguno |
| Contratos y eventos | Ninguno |
| Datos y migraciones | Ninguno |
| Permisos y aislamiento | GitHub Actions con `contents: read`, sin secretos ni acceso al VPS |
| Configuracion y secretos | Remoto privado; ninguna credencial versionada |
| Observabilidad y operacion | Checks estables visibles en pull requests y `main` |
| Documentacion | Estado, ficha de tarea y referencia vigente del remoto |

## Plan de implementacion

- [x] Confirmar que el remoto privado existe y esta vacio.
- [x] Configurar `yvalois <yeison.valopez@gmail.com>` solo para este repositorio.
- [x] Revisar nombres sensibles, firmas de secretos conocidas, la credencial del VPS y objetos grandes en todo el historial.
- [x] Publicar `main` una sola vez y verificar que local y remoto apuntan al mismo commit.
- [x] Incorporar los checks iniciales de CI en una rama corta.
- [ ] Configurar el ruleset de `main` sin bypass ordinario.
- [x] Abrir y validar el pull request de prueba.
- [ ] Integrar el pull request mediante el ruleset activo.
- [ ] Registrar evidencia final y cerrar `PROY-004`.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Publicar un secreto historico | Revisar nombres, contenido de parches y credencial conocida antes del push | Cero hallazgos de alta confianza y credencial del VPS ausente |
| Sobrescribir una historia remota | Exigir remoto sin ramas ni tags antes del primer push | `git ls-remote --heads --tags origin` sin resultados |
| Dejar `main` modificable directamente | Activar ruleset inmediatamente despues de disponer de checks | Intento posterior solo mediante rama y PR |
| Dar privilegios operativos a un PR | Permisos de solo lectura, sin secrets, SSH, VPS ni `pull_request_target` | Revision del workflow y ejecucion del PR |
| Bloquear `main` con un check inexistente | Crear y ejecutar primero nombres de check estables | Checks observados antes de hacerlos obligatorios |

## Criterios de aceptacion

- [x] `origin` es `https://github.com/yvalois/quantum-crm.git` y `main` sigue el remoto.
- [x] El commit remoto de `main` coincide con el commit local publicado.
- [x] La revision previa no encuentra secretos de alta confianza, la credencial conocida del VPS ni objetos mayores de 25 MiB.
- [x] Los checks configurados se ejecutan sin secretos ni permisos de escritura.
- [ ] `main` exige pull request, historial lineal, conversaciones resueltas y checks verdes; no permite force push ni eliminacion.
- [ ] La rama de esta tarea llega a `main` mediante un pull request aprobado por las reglas disponibles.
- [ ] La documentacion contiene la evidencia y no afirma completadas capacidades posteriores de release.

## Plan de verificacion

- Pruebas unitarias: `pnpm test` mediante el check `ci / unit`.
- Pruebas de integracion o contratos: `pnpm test:integration` y pruebas de `packages/contracts` en checks separados.
- Pruebas E2E: no aplica a esta configuracion; los E2E del producto conservan su requisito propietario.
- Comprobacion manual: comparar hashes de `main`, revisar la ejecucion del PR y los controles efectivos del ruleset.
- Seguridad, permisos y aislamiento: workflow con `permissions: contents: read`, sin secretos y escaneo del historial.
- Idempotencia, concurrencia y recuperacion: concurrencia cancela validaciones obsoletas de la misma rama; quitar el ruleset o revertir el workflow recupera la configuracion sin alterar datos.
- Comandos que deben aprobar: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:architecture`, pruebas contractuales y `pnpm build`.

## Recuperacion

- Compatibilidad o migracion: no hay cambios de datos ni contratos.
- Rollback de aplicacion: revertir el commit del workflow mediante otro pull request.
- Recuperacion de datos, si aplica: no aplica; no se reescribe ni elimina el historial publicado.

## Evidencia de cierre

- Archivos, commits o PR: [PR #1](https://github.com/yvalois/quantum-crm/pull/1), `.github/workflows/quality.yml`, `package.json`, `pnpm-lock.yaml`, esta ficha y `docs/04-proceso/estado.md`.
- Comandos y resultados: remoto vacio verificado; revision de 124 commits sin nombres sensibles, secretos de alta confianza, credencial conocida del VPS ni objetos mayores de 25 MiB; primer push de `main` en `21b3e75c7b14c9239256798436bc0fefa7b3b46d`. La ejecucion `35549032643` aprobo los siete checks: static, unit, integration con PostgreSQL 18 y Redis aislados, contracts, build, secrets y dependencies.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`; el repositorio privado permite solo squash merge y elimina la rama al integrar.
- Desviaciones del plan: GitHub rechazo crear el ruleset con HTTP 403 porque una cuenta personal requiere GitHub Pro para proteger un repositorio privado. El propietario decidio conservar GitHub Free y la visibilidad privada; no se relajo ningun check ni se cambio la visibilidad.
- Pendientes o decisiones nuevas: el ruleset queda como limitacion conocida y `PROY-004` no puede cerrarse como proteccion tecnica completa. Hasta que cambie el plan, cada integracion se controla por proceso: rama corta, PR, siete checks verdes, aviso expreso de Codex y squash manual del propietario. La entrega continua completa permanece bajo sus requisitos operativos.
