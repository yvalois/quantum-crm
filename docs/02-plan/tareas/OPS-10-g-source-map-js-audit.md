# OPS-10-g - Remediar source-map-js en la cadena de release

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`
- Requisitos relacionados: `OPS-11`, `ADM-04`
- Fase del MVP: 1 - Fundacion tecnica
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: lockfile reproducible y auditoria de dependencias de GitHub Actions
- Bloquea a: release y despliegue de Quantum Admin para aprovisionar `InterAmerican`
- ADR, arquitectura o diseno aplicables: ADR-0007, ADR-0009 y `docs/05-reglas/09-ci-cd-y-releases.md`

## Resultado esperado

La cadena de `main` deja de incluir la version vulnerable de `source-map-js`, la auditoria de severidad alta vuelve a aprobar y se publica una candidata desplegable del commit integrado.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: workflow `quality`, `pnpm audit`, `source-map-js` y overrides del workspace.
- Codigo o documentacion encontrados: `main` `08d02b5` aprobo todas las puertas salvo `security / dependencies`; el advisory exige `source-map-js >=1.2.2` y el lockfile fija `1.2.1` por PostCSS.
- Pruebas e historial encontrados: el PR #94 aprobo siete puertas; el fallo posterior es exclusivamente el advisory nuevo consultado durante el push a `main`.
- Decision de reutilizacion, extension o reemplazo: fijar la version corregida mediante el mecanismo de overrides ya usado por el monorepo y regenerar solo el lockfile.

## Alcance

### Incluido

- Override exacto de `source-map-js` a la primera version corregida.
- Lockfile congelado actualizado y auditoria de produccion.
- Publicacion de la candidata desbloqueada.

### No incluido

- Cambios funcionales a CRM o Admin.
- Desactivar, ignorar o reducir el nivel de la auditoria.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | dependencia transitiva compartida |
| Contratos y eventos | ninguno |
| Datos y migraciones | ninguno |
| Permisos y aislamiento | ninguno |
| Configuracion y secretos | ninguno |
| Observabilidad y operacion | recupera la cadena de release |
| Documentacion | ficha y estado |

## Plan de implementacion

- [x] Fijar `source-map-js` corregido y actualizar lockfile.
- [x] Validar instalacion congelada, auditoria y build afectado en el VPS.
- [ ] Publicar PR, integrar y confirmar candidata registrada.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Incompatibilidad con PostCSS | conservar misma linea semantica 1.2.x | build de frontends |
| Ocultar otra vulnerabilidad | ejecutar auditoria real sin exclusiones | `pnpm audit --audit-level=high --prod` |

## Criterios de aceptacion

- [x] No queda `source-map-js <1.2.2` en el lockfile.
- [x] Auditoria de produccion y puertas obligatorias afectadas aprueban en el VPS.
- [ ] La release candidata del commit integrado se registra.

## Plan de verificacion

- Pruebas unitarias: no aplica; no cambia logica propia.
- Pruebas de integracion o contratos: no aplica.
- Pruebas E2E: smoke posterior al despliegue de Admin.
- Comprobacion manual: candidata registrada y Admin saludable.
- Seguridad, permisos y aislamiento: auditoria de produccion sin excepciones.
- Idempotencia, concurrencia y recuperacion: no aplica al cambio de dependencia.
- Comandos que deben aprobar: instalacion congelada, auditoria y builds consumidores en VPS; matriz GitHub una vez.

## Recuperacion

- Compatibilidad o migracion: actualizacion patch transitiva, sin datos.
- Rollback de aplicacion: volver al digest anterior; no reintroducir la dependencia vulnerable en una release nueva.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: candidato `b9d00ac` en `fix/OPS-10-source-map-audit`.
- Comandos y resultados: instalacion congelada aprobada; auditoria sin hallazgos altos o criticos y con un aviso moderado; build completo de los 19 proyectos construibles aprobado en el VPS.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: PR, matriz GitHub y candidata registrada.
