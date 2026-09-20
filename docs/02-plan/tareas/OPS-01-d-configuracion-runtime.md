# OPS-01-d - Configuracion runtime tipada por proceso

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-01`
- Requisitos relacionados: `OPS-03`, `OPS-07`, `OPS-10`, `OPS-12`, `OPS-23`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `OPS-01-a`, `OPS-01-b`, ADR-0008 y paquete `packages/config` existente
- Bloquea a: conexiones de datos, identidad, archivos, colas, agentes y configuracion segura por entorno
- ADR, arquitectura o diseno aplicables: ADR-0008, `docs/05-reglas/08-entornos-configuracion-secretos.md` y `docs/08-arquitectura/monorepo.md`

## Resultado esperado

Los cinco procesos Node desplegables cargan una definicion central por servicio, rechazan claves `QCRM_*` desconocidas y configuracion invalida antes de iniciar dependencias, exigen host y puerto explicitos fuera de local/test y exponen una puerta `config:check` reproducible. La configuracion publica runtime de las tres webs queda separada para su ficha de frontend/BFF.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `packages/config`, cinco composition roots Node, `.env.example`, Compose, scripts de raiz y prueba de limites de imports.
- Codigo o documentacion encontrados: parser comun con entorno, host, puerto y timeout; cada aplicacion duplica su nombre y defaults; ya existe una regla que impide `process.env` fuera de `packages/config`.
- Pruebas e historial encontrados: cuatro pruebas unitarias del parser, builds y smoke de `api`; ADR-0008 exige schema por aplicacion, claves desconocidas rechazadas y `config:check`.
- Decision de reutilizacion, extension o reemplazo: extender el parser y centralizar el inventario de servicios sin agregar dependencias ni secretos reales.

## Alcance

### Incluido

- Definiciones tipadas y exhaustivas para `api`, `admin-api`, `worker`, `deploy-executor` y `agent-runtime`.
- API `loadServiceConfig` para eliminar definiciones duplicadas en composition roots.
- Defaults solo en `local` y `test`; host y puerto obligatorios en `preview`, `staging` y `production`.
- Rechazo de valores vacios, placeholders y claves `QCRM_*` desconocidas sin revelar valores.
- Objeto de configuracion inmutable y version de schema no secreta.
- Pruebas unitarias, arquitectura y validacion de `.env.example`.
- Script contractual `pnpm config:check`.

### No incluido

- Leer secretos `*_FILE`, porque aun no existe un consumidor concreto ni su mount autorizado.
- URLs o credenciales de PostgreSQL, Redis, Keycloak, S3, MCP o proveedores.
- Configuracion publica runtime de `crm-web`, `portal-web` y `admin-web`.
- Instalar o ejecutar Docker localmente.

## Impacto tecnico

| Area                       | Impacto previsto                                            |
| -------------------------- | ----------------------------------------------------------- |
| Aplicaciones y modulos     | Cinco composition roots consumen una definicion central     |
| Contratos y eventos        | Ninguno                                                     |
| Datos y migraciones        | Ninguno                                                     |
| Permisos y aislamiento     | Falla cerrada ante configuracion inesperada                 |
| Configuracion y secretos   | Schema comun versionado; sin valores secretos nuevos        |
| Observabilidad y operacion | Error seguro identifica claves invalidas, nunca sus valores |
| Documentacion              | `.env.example`, estado y evidencia de esta ficha            |

## Plan de implementacion

- [x] Definir inventario tipado de servicios Node y `loadServiceConfig`.
- [x] Aplicar defaults por entorno, placeholders rechazados e inmutabilidad.
- [x] Migrar los cinco composition roots a la nueva API.
- [x] Agregar pruebas del inventario, entornos estrictos, redaccion y ejemplo.
- [x] Agregar `config:check` y actualizar `.env.example`.
- [x] Ejecutar formato, lint, tipos, pruebas, arquitectura y builds afectados.
- [x] Validar una imagen representativa y fallo cerrado en el VPS.
- [x] Registrar evidencia y pendientes sin cerrar `OPS-01`.

## Riesgos y mitigaciones

| Riesgo                                      | Mitigacion                                                   | Verificacion                               |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Arrancar produccion con defaults locales    | Exigir host y puerto en preview/staging/production           | Pruebas negativas por entorno              |
| Exponer valores en errores                  | Reportar solo nombres de claves                              | Prueba con canario sensible                |
| Divergencia entre aplicaciones y Compose    | Inventario unico con puertos y nombres exactos               | Prueba exhaustiva y builds de consumidores |
| Romper desarrollo simple                    | Mantener defaults seguros en local/test                      | Pruebas de defaults y `.env.example`       |
| Confundir esta ficha con secretos completos | Excluir `*_FILE` hasta tener consumidores y mounts concretos | Revision de alcance y docs                 |

## Criterios de aceptacion

- [x] Los cinco procesos usan `loadServiceConfig` y no duplican definiciones.
- [x] Todas las claves `QCRM_*` desconocidas fallan sin filtrar valores.
- [x] Preview, staging y produccion no aceptan host o puerto ausentes.
- [x] Local y test conservan defaults documentados.
- [x] La configuracion devuelta esta congelada y tiene version de schema.
- [x] `pnpm config:check` valida parser, inventario y `.env.example`.
- [x] Las puertas afectadas y el smoke en VPS aprueban.

## Plan de verificacion

- Pruebas unitarias: parser, servicios, entornos, placeholders, redaccion, inmutabilidad y ejemplo.
- Pruebas de integracion o contratos: `config:check` y build de consumidores.
- Pruebas E2E: arranque/health de `api` con configuracion valida en imagen y rechazo antes de escuchar con configuracion invalida.
- Comprobacion manual: ninguna lectura `process.env` fuera de `packages/config`.
- Seguridad, permisos y aislamiento: canario ausente del error; no agregar secretos ni paths reales.
- Idempotencia, concurrencia y recuperacion: cambio puro de bootstrap; rollback al commit anterior.
- Comandos que deben aprobar: `pnpm run ci`, `config:check` y la validacion de imagen en el VPS. Se usa `pnpm run ci` porque `pnpm ci` es un comando reservado del gestor y no ejecuta el script homonimo.

## Recuperacion

- Compatibilidad o migracion: local/test conservan defaults; entornos desplegables deben declarar host y puerto, como ya hacen los Compose.
- Rollback de aplicacion: volver al commit previo; no hay estado persistente.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: `packages/config/src/process-config.ts`, sus pruebas y exportaciones; cinco `apps/*/src/main.ts`; `.env.example`, `package.json`, `vitest.config.ts`, pruebas de arquitectura y documentacion. Commits locales `066aed9`, `5aff63e` y `10b7b27`; rama `feat/OPS-01-runtime-config`, sin remoto ni PR.
- Comandos y resultados: `pnpm run ci` aprobo en el VPS dentro de Node `24.21.0` fijado por digest: formato, lint, typecheck de 17 workspaces, 9 pruebas de configuracion, 19 pruebas generales, 8 pruebas de arquitectura y build de los 17 workspaces aplicables.
- Imagen y smoke en VPS: `quantum-crm/api:10b7b27affc6`, ID `sha256:46ec53b395a6ee5da043a79d43a2c5fdd797025a7bca465397bbf106ff47a952`; usuario `node`, raiz de solo lectura, `cap_drop: ALL` y `no-new-privileges`. Sin host/puerto en `production` termino con codigo 1 y solo `api failed to start`; con configuracion valida respondio `health/v1` en live/ready mediante `127.0.0.1:13002`, sin publicar en todas las interfaces, y Nginx permanecio activo.
- Documentacion actualizada: `.env.example`, `docs/08-arquitectura/monorepo.md`, esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones resueltas: `git archive` en Windows convertia dos archivos `.mjs` a CRLF; `.gitattributes` fija LF para texto y el archivo se verifico por bytes antes de transferirlo. El primer build concurrente excedio la memoria del VPS y termino con codigo 137; los builds se serializaron para la capacidad real de 1 vCPU/4 GB y la puerta completa aprobo.
- Pendientes o decisiones nuevas: la configuracion web publica y los secretos `*_FILE` se implementaran con consumidores y mounts concretos; esta rebanada no cierra `OPS-01` ni ningun requisito funcional.
