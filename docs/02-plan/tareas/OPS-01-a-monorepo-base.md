# OPS-01-a - Fundacion reproducible del monorepo

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-01`
- Requisitos relacionados: `OPS-07`, `OPS-10`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: ADR-0001 a ADR-0015 aceptados y especificacion del monorepo aprobada
- Bloquea a: configuracion, contratos, persistencia, autenticacion, aplicaciones y CI ejecutable
- ADR, arquitectura o diseno aplicables: ADR-0001, ADR-0002, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0012, ADR-0013, ADR-0014 y `docs/08-arquitectura/monorepo.md`

## Resultado esperado

El repositorio instala una unica grafica de dependencias reproducible y expone una estructura TypeScript estricta para las ocho aplicaciones y los nueve paquetes aprobados, con comandos raiz reales de formato, lint, tipos, pruebas, arquitectura y build.

## Lectura obligatoria aplicada

- [x] `OPS-01` en `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas de desarrollo, pruebas, Git, configuracion, CI/CD y observabilidad.
- [x] ADR y arquitectura del monorepo pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg "OPS-01|Bootstrap tecnico|Criterios de bootstrap" docs` y revision del arbol Git.
- Codigo o documentacion encontrados: documentacion y decisiones completas; no existe codigo, manifiesto de paquetes, workspace ni lockfile.
- Pruebas e historial encontrados: solo verificaciones documentales de `PROY-001` a `PROY-022`.
- Decision de reutilizacion, extension o reemplazo: implementar la estructura aprobada sin generar otra arquitectura ni inventar modulos comerciales.

## Alcance

### Incluido

- Fijar Node.js 24 y una version exacta de pnpm compatible.
- Crear manifiesto raiz, workspace y configuraciones TypeScript compartidas.
- Crear las ocho aplicaciones y los nueve paquetes aprobados con puntos de entrada TypeScript minimos.
- Configurar formato, ESLint, Vitest y reglas iniciales de dependencias.
- Crear scripts raiz funcionales para instalar, comprobar tipos, probar y construir.
- Agregar pruebas de humo que acrediten la configuracion y los limites iniciales.
- Generar y versionar un unico `pnpm-lock.yaml`.

### No incluido

- Implementar funcionalidades `ADM`, `USR`, `CFG` o comerciales.
- Conectar bases, Keycloak, Redis, SeaweedFS, ClamAV o proveedores.
- Crear imagenes productivas, Compose, despliegues o GitHub Actions completos.
- Presentar aplicaciones vacias como funciones terminadas del MVP.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Esqueletos compilables de ocho aplicaciones; sin comportamiento de producto |
| Contratos y eventos | Paquete preparado, sin contratos comerciales inventados |
| Datos y migraciones | Paquete preparado, sin schema ni migraciones |
| Permisos y aislamiento | Sin comportamiento; se preservan fronteras por dependencias |
| Configuracion y secretos | Configuracion raiz sin secretos; ningun valor productivo |
| Observabilidad y operacion | Paquete preparado, sin backend ni telemetria falsa |
| Documentacion | Ficha, estado y README de desarrollo si los comandos lo requieren |

## Plan de implementacion

- [x] Verificar versiones oficiales compatibles y fijar toolchain.
- [x] Crear raiz pnpm y configuraciones TypeScript estrictas.
- [x] Crear manifiestos y fuentes minimas de aplicaciones y paquetes.
- [x] Incorporar formato, lint, pruebas y comprobaciones de arquitectura.
- [x] Instalar dependencias y generar el lockfile reproducible.
- [x] Ejecutar todas las puertas aplicables y corregir hallazgos.
- [x] Registrar evidencia y commit sin marcar `OPS-01` completo prematuramente.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Versiones incompatibles | Consultar fuentes oficiales y fijar versiones exactas | Instalacion limpia, typecheck y build |
| Esqueletos que aparenten funciones | Nombres y documentacion explicitos; no cerrar requisitos comerciales | Estado y checklist permanecen pendientes |
| Dependencias cruzadas incorrectas | Exports publicos y prueba de arquitectura desde el inicio | `pnpm test:architecture` |
| Configuracion copiada entre aplicaciones | Configuraciones base extendidas por tipo de proceso | Typecheck de los ocho workspaces |
| Cambios demasiado grandes | Limitar esta ficha a la fundacion; Compose, servicios y CI quedan en fichas posteriores | Diff contra el alcance de esta ficha |

## Criterios de aceptacion

- [x] Existe un unico workspace y lockfile reproducible.
- [x] Las ocho aplicaciones y nueve paquetes son reconocidos por pnpm.
- [x] TypeScript estricto compila todos los puntos de entrada.
- [x] Formato, lint, unitarias, arquitectura y build se ejecutan desde la raiz.
- [x] Una prueba impide dependencias prohibidas basicas.
- [x] No existen secretos, datos reales, binarios ni artefactos generados impropios.
- [x] Ningun requisito funcional u operativo completo se marca por crear esqueletos.

## Plan de verificacion

- Pruebas unitarias: prueba de humo de los paquetes con logica de configuracion propia.
- Pruebas de integracion o contratos: no aplican todavia; no existen servicios ni contratos comerciales.
- Pruebas E2E: no aplican a esqueletos sin comportamiento.
- Comprobacion manual: inventario exacto de ocho aplicaciones y nueve paquetes.
- Seguridad, permisos y aislamiento: escaneo de secretos y prueba de imports prohibidos.
- Idempotencia, concurrencia y recuperacion: no aplican a esta fundacion sin efectos.
- Comandos que deben aprobar: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:architecture` y `pnpm build`.

## Recuperacion

- Compatibilidad o migracion: no existen consumidores ni datos previos.
- Rollback de aplicacion: revertir el commit de bootstrap antes de que otros trabajos dependan de el.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: `package.json`, `pnpm-lock.yaml`, configuraciones raiz, `apps/*`, `packages/*`, `tests/unit/workspace-inventory.test.ts`, `tests/architecture/import-boundaries.test.ts`, `README.md` y esta ficha; rama local `chore/OPS-01-monorepo-base`, sin remoto ni PR.
- Comandos y resultados: Node.js `24.21.0`; `pnpm install --offline --frozen-lockfile`, formato y lint aprobados; typecheck y build aprobados en 17 workspaces; una suite unitaria con 2 pruebas y una suite de arquitectura con 1 prueba aprobadas.
- Documentacion actualizada: instrucciones locales en `README.md`, ficha y registro de estado.
- Desviaciones del plan: se fijo pnpm `9.13.2`, disponible y compatible con Node 24, porque el Corepack global no reconoce la firma de pnpm 12. Node 24 se ejecuto de forma temporal sin sustituir el Node 20 global del equipo.
- Pendientes o decisiones nuevas: `OPS-01` permanece abierto. Los procesos reales Next.js/NestJS, Compose, servicios, imagenes, CI y operacion se implementaran en fichas posteriores; ningun requisito de producto se considera terminado.
