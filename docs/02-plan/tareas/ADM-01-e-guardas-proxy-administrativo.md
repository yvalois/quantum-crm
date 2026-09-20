# ADM-01-e - Guardas y proxy administrativo

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `ADM-02`, `OPS-01`, `OPS-04`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a` a `ADM-01-d`, ADR-0004, ADR-0005 y ADR-0008
- Bloquea a: consumo de casos de uso administrativos desde `admin-web`
- ADR, arquitectura o diseno aplicables: autenticacion, contratos, aislamiento, configuracion y monorepo

## Resultado esperado

`admin-api` deniega por defecto todas las rutas no publicas, verifica el access token OIDC, exige una membresia de plataforma activa y aplica permisos declarados. `admin-web` consume un endpoint fijo mediante un BFF same-origin que recupera el token exclusivamente desde la sesion Redis y nunca lo expone al navegador.

## Lectura obligatoria aplicada

- [x] Requisito, MVP, subtareas, estado y ficha anterior.
- [x] Reglas de seguridad, pruebas, contratos y Git.
- [x] ADR de autenticacion y contratos, arquitectura y referencias oficiales de Next.js y NestJS.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, guard, proxy, bearer, `admin-api`, membresia, permisos, access token y sesion.
- Codigo encontrado: verificador JWKS, autenticacion de operador, tabla de membresias, sesion Redis y BFF de autenticacion; `admin-api` solo expone health y no aplica guardas.
- Pruebas encontradas: identidad, permisos, JWKS, membresia PostgreSQL y sesion; no existe recorrido BFF a API.
- Decision: extender las fronteras existentes con un lector PostgreSQL tipado, guardas globales con health publico, contrato `platform-operator/v1` y un proxy de ruta fija; no aceptar destinos, headers ni tokens del navegador.

## Alcance

### Incluido

- Lector PostgreSQL de membresia y permisos de plataforma.
- Autenticacion global de `admin-api`, rutas publicas explicitas y permisos por metadata.
- Endpoint versionado `GET /api/v1/operators/me`.
- Proxy BFF fijo `GET /api/platform/operators/me` desde la sesion opaca.
- Configuracion tipada del origen interno de `admin-api`, timeout, errores RFC 9457 y no-cache.
- Pruebas unitarias, HTTP y de integracion afectadas, con CI en VPS.

### No incluido

- Listado o mutacion de clientes de `ADM-02`.
- Renovacion automatica de access tokens.
- Aprovisionamiento persistente de Keycloak, Redis, operador, DNS o TLS.
- Marcar `ADM-01` completo.

## Plan de implementacion

- [x] Registrar el contrato publico de operador autenticado.
- [x] Implementar lector PostgreSQL reutilizando el pool de plataforma.
- [x] Aplicar autenticacion global y permisos declarativos en `admin-api`.
- [x] Implementar el endpoint propio del operador y respuestas seguras.
- [x] Implementar el proxy fijo en `admin-web` sin exponer tokens.
- [x] Verificar denegaciones, permisos, fallo de dependencias y recorrido HTTP.
- [x] Ejecutar CI en VPS y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo                                  | Mitigacion                                                   | Verificacion                             |
| --------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Ruta administrativa publica por omision | Guardia global y decorador publico solo para health          | Ruta sin metadata devuelve 401           |
| Token filtrado al navegador             | Token recuperado server-side y respuesta validada por schema | Canario ausente en JSON y headers        |
| SSRF o proxy abierto                    | Origen configurado y ruta upstream constantes                | Entradas del navegador no eligen destino |
| Membresia suspendida o permiso ausente  | Consulta vigente por solicitud y denegacion por defecto      | Matriz 401/403                           |
| Caida de PostgreSQL, Redis o API        | Timeout y respuesta 503 uniforme                             | Fallos simulados                         |

## Criterios de aceptacion

- [x] Health permanece publico y el resto de `admin-api` queda protegido por defecto.
- [x] Token invalido, identidad de CRM, MFA ausente o membresia inactiva devuelve 401.
- [x] Permiso ausente devuelve 403 antes de ejecutar el controlador.
- [x] El endpoint propio responde un contrato estricto sin tokens ni secretos.
- [x] El BFF usa solo el destino fijo y el token server-side de la sesion.
- [x] Navegador sin sesion recibe 401 y dependencia no disponible recibe 503.
- [x] CI y pruebas afectadas aprueban en VPS.

## Recuperacion

- Rollback: retirar endpoint, proxy y guardas conjuntamente; no hay migracion nueva.
- Datos: solo lectura de membresias existentes, sin escritura ni recuperacion de datos.

## Evidencia de cierre

- Archivos, commits o PR: commits `5267d18`, `6faea1e`, `272dc66`, `5e690a2`, `2548d1e` y `2a235f0` sobre `feat/ADM-01-admin-guard-proxy`; implementacion en `admin-api`, `admin-web`, `packages/contracts`, `packages/database`, configuracion y Compose. No existe remoto configurado para push o PR.
- Comandos y resultados: `pnpm run ci` aprobo en el VPS sobre `2a235f0` con Node 24.21.0: formato, lint, typecheck de 17 workspaces, 41 pruebas de configuracion, 133 pruebas generales, 14 pruebas de arquitectura y build de los 17 workspaces aplicables. La integracion focalizada aprobo 3/3 escenarios contra PostgreSQL 18.1 real y desechable, incluido el lector usado por `admin-api`.
- Documentacion actualizada: ficha y estado oficial; ejemplos y manifiestos declaran el origen interno fijo de `admin-api` y asignan los secretos de sesion solo a `admin-web`.
- Desviaciones del plan: ninguna de alcance. La validacion en checkout limpio detecto y corrigio la resolucion del paquete de dominio, imports de Next.js y prerender del dashboard; PostgreSQL real detecto y corrigio el orden lexical de permisos.
- Pendientes: renovacion de tokens, aprovisionamiento persistente de identidad/Redis, operador inicial y E2E completo con OTP. `ADM-01` permanece abierto hasta acreditarlos.
