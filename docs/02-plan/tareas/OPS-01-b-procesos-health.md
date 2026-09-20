# OPS-01-b - Procesos ejecutables y health basico

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-01`
- Requisitos relacionados: `OPS-03`, `OPS-07`, `OPS-10`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: fundacion `OPS-01-a`, Node.js 24, pnpm workspace y limites del monorepo
- Bloquea a: Compose local, imagenes, autenticacion, contratos comerciales y CI de procesos
- ADR, arquitectura o diseno aplicables: ADR-0001, ADR-0002, ADR-0005, ADR-0007, ADR-0008, ADR-0010, ADR-0012, ADR-0014 y `docs/08-arquitectura/monorepo.md`

## Resultado esperado

Las ocho aplicaciones dejan de ser marcadores: las tres webs construyen con Next.js 16, las APIs arrancan con NestJS 11 y los procesos sin interfaz HTTP comercial tienen composition roots reales, liveness, readiness y cierre controlado sin afirmar funciones de producto inexistentes.

## Lectura obligatoria aplicada

- [x] `OPS-01`, `OPS-03`, `OPS-07` y `OPS-10` en `docs/03-operaciones/despliegues.md`.
- [x] Fase de bootstrap en `docs/02-plan/mvp-piloto.md`.
- [x] Ficha anterior y estado vigente.
- [x] Reglas de desarrollo, pruebas, API, configuracion, CI/CD y observabilidad.
- [x] ADR y arquitectura pertinentes.
- [x] Documentacion oficial de Next.js 16, App Router, Turbopack y ciclo de vida de NestJS.

## Auditoria del trabajo existente

- Busquedas realizadas: inventario de `apps/*`, `packages/*`, scripts raiz, pruebas y especificacion del monorepo.
- Codigo o documentacion encontrados: ocho manifiestos y puntos de entrada marcadores; configuraciones TypeScript y pruebas de arquitectura aprobadas.
- Pruebas e historial encontrados: commit `38f629d` y evidencia de `OPS-01-a`; 3 pruebas, typecheck y build de esqueletos aprobados.
- Decision de reutilizacion, extension o reemplazo: conservar el workspace y reemplazar cada marcador por el framework o proceso aprobado, reutilizando contratos, configuracion y health como paquetes con propietario.

## Alcance

### Incluido

- Crear tres aplicaciones App Router con Next.js 16 y Turbopack predeterminado.
- Crear `api` y `admin-api` con NestJS 11, rutas de liveness/readiness y cierre controlado.
- Crear `worker` y `deploy-executor` como contextos standalone de NestJS con health interno.
- Crear un proceso `agent-runtime` ejecutable con health interno; el grafo y `/agent/v1` permanecen fuera de esta ficha.
- Definir contrato runtime de health, configuracion validada por proceso y servidor interno reutilizable.
- Probar configuracion, health, inventario, dependencias y builds productivos.

### No incluido

- Implementar autenticacion, sesiones, WebSocket, SSE, colas, MCP, agentes o casos comerciales.
- Conectar bases, Redis, Keycloak, SeaweedFS, ClamAV o proveedores.
- Implementar `/agent/v1` o presentar el runtime como agente funcional.
- Crear contenedores o Compose; se realizaran en una ficha posterior.
- Aplicar el diseño visual de Stitch o implementar pantallas funcionales.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Ocho composition roots ejecutables, sin dominio comercial |
| Contratos y eventos | Contrato `health/v1` en `packages/contracts` |
| Datos y migraciones | Ninguno |
| Permisos y aislamiento | Sin sesiones ni datos; se preservan limites de imports |
| Configuracion y secretos | Schema runtime por proceso, sin secretos ni valores productivos |
| Observabilidad y operacion | Liveness, readiness, cierre y servidor health interno |
| Documentacion | README, ficha, estado y descripcion vigente del monorepo |

## Plan de implementacion

- [x] Fijar versiones compatibles de Next.js, React, NestJS, Zod y dependencias runtime.
- [x] Implementar contrato y configuracion de health con pruebas.
- [x] Implementar las tres aplicaciones Next.js y sus Route Handlers.
- [x] Implementar APIs NestJS con health y cierre controlado.
- [x] Implementar procesos standalone y health interno.
- [x] Ampliar pruebas de arquitectura para las nuevas fronteras.
- [x] Ejecutar instalacion congelada, formato, lint, tipos, pruebas y builds.
- [x] Registrar evidencia sin cerrar `OPS-01` ni requisitos de producto.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Health siempre verde pese a configuracion invalida | Validar configuracion antes de declarar readiness | Pruebas de config faltante y valores desconocidos |
| Mezclar audiencias web | Aplicaciones, nombres, puertos y metadata separados | Builds y pruebas por aplicacion |
| Exponer health interno publicamente | APIs publican rutas tipadas; procesos standalone enlazan host/puerto configurado para redes privadas futuras | Config y documentacion explicitas |
| Simular una funcion comercial | Pantallas indican bootstrap y no contienen acciones ficticias | Revision manual y estado sin casillas de producto |
| Imports prohibidos entre aplicaciones | Dependencias workspace declaradas y prueba de arquitectura ampliada | `pnpm test:architecture` |

## Criterios de aceptacion

- [x] Las tres webs generan builds productivos Next.js 16.
- [x] `api` y `admin-api` arrancan como aplicaciones NestJS reales.
- [x] `worker`, `deploy-executor` y `agent-runtime` arrancan como procesos separados.
- [x] Cada tipo de proceso responde liveness/readiness y puede cerrarse limpiamente.
- [x] Configuracion invalida falla antes de readiness sin revelar valores sensibles.
- [x] Contratos, configuracion y health tienen pruebas deterministas.
- [x] El lockfile permanece reproducible y las puertas aplicables pasan con Node 24.
- [x] Ningun requisito funcional ni `OPS-01` completo se marca por este bootstrap parcial.

## Plan de verificacion

- Pruebas unitarias: schemas, configuracion y respuestas health.
- Pruebas de integracion o contratos: servidor health real en puerto efimero y controladores NestJS.
- Pruebas E2E: smoke HTTP local por tipo de proceso cuando el build lo permita.
- Comprobacion manual: build de las tres webs y arranque/cierre de procesos.
- Seguridad, permisos y aislamiento: imports prohibidos, host interno configurable y escaneo de secretos.
- Idempotencia, concurrencia y recuperacion: cierre repetible sin efectos; no existen operaciones comerciales.
- Comandos que deben aprobar: instalacion congelada, formato, lint, typecheck, pruebas, arquitectura y build.

## Recuperacion

- Compatibilidad o migracion: no hay datos ni consumidores productivos.
- Rollback de aplicacion: revertir los commits de esta ficha conservando la fundacion `OPS-01-a`.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: composition roots en `apps/*`, contrato `health/v1`, configuracion validada, servidor health reutilizable, pruebas y commit `71b20d7`.
- Comandos y resultados: instalacion offline y congelada aprobada; formato y lint aprobados; typecheck aprobado en 17 workspaces; 12 archivos y 21 pruebas aprobados; prueba de arquitectura aprobada; builds aprobados para nueve paquetes y las ocho aplicaciones.
- Smoke operativo: `api`, `admin-api`, `worker`, `deploy-executor` y `agent-runtime` iniciaron como procesos separados y respondieron `live/ready`; los tres Route Handlers web se probaron directamente y sus builds Next.js 16 finalizaron correctamente.
- Seguridad local: el escaneo no encontro credenciales; la unica coincidencia fue el valor ficticio `must-not-pass` usado para demostrar que el schema rechaza campos secretos desconocidos.
- Documentacion actualizada: `README.md`, `.env.example`, `docs/08-arquitectura/monorepo.md` y `docs/04-proceso/estado.md`.
- Desviaciones del plan: ninguna funcional; el cierre por senal se cubre mediante el helper probado y los hooks compilados, sin afirmar una prueba E2E de todas las senales del sistema operativo.
- Pendientes o decisiones nuevas: `OPS-01` continua con Compose, imagenes reproducibles y mapa de procesos; LangGraph, `/agent/v1`, datos, Redis, identidad y servicios externos siguen fuera de esta ficha.
