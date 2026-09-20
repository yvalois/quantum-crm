# ADM-01-a - Identidad y autorizacion base de plataforma

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `ADM-02`, `OPS-04`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: ADR-0002, ADR-0003, ADR-0004, ADR-0006 y `ADM-02-a`
- Bloquea a: sesiones administrativas, APIs de plataforma y casos de uso autorizados de `ADM-02` a `ADM-20`
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0006, reglas de seguridad, persistencia, contratos y monorepo

## Resultado esperado

Quantum dispone de un nucleo tipado de identidad y autorizacion administrativa que solo crea contexto para una identidad OIDC previamente verificada, perteneciente al issuer y audiencia exclusivos de plataforma, con MFA y membresia activa. Los permisos de plataforma son un catalogo cerrado, se deniegan por defecto y la membresia se conserva en un schema propietario con privilegios separados.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, `AuthContext`, `platform-iam`, OIDC, MFA, Keycloak, sesiones, issuer, audience y permisos en codigo, pruebas, infraestructura, fichas e historial.
- Codigo o documentacion encontrados: `admin-web` y `admin-api` existen solo como bootstrap; `packages/auth` contiene un marcador; ADR-0004 define Keycloak, sesiones opacas, MFA y autorizacion hibrida; la historia Prisma `platform` ya existe.
- Pruebas e historial encontrados: health y limites arquitectonicos estan cubiertos, pero no existen membresias, permisos, verificacion de identidad ni pruebas de denegacion administrativa.
- Decision de reutilizacion, extension o reemplazo: extender `packages/auth`, crear el modulo propietario `platform-iam` en `platform-domain` y agregar una migracion a la historia `platform`; no crear login, contrasenas ni roles de plataforma en el frontend.

## Alcance

### Incluido

- Contexto autenticado inmutable para operadores humanos de Quantum.
- Comprobacion fail-closed de issuer, audiencia, tipo de principal, MFA, membresia activa y permiso solicitado.
- Catalogo cerrado de permisos administrativos iniciales.
- Agregado de membresia de operador en el modulo `platform-iam`.
- Schema y migracion de membresias y permisos con roles migrador/runtime separados.
- Pruebas unitarias, arquitectonicas y PostgreSQL real.

### No incluido

- Validacion criptografica JWT/JWKS, discovery o conexion real con Keycloak.
- Authorization Code con PKCE, callbacks, cookies, CSRF, almacen de sesiones o logout.
- Pantalla de login o administracion de operadores.
- Repositorios y endpoints de `admin-api`.
- Marcar `ADM-01` completo o afirmar acceso administrativo extremo a extremo.

## Impacto tecnico

| Area                       | Impacto previsto                                                        |
| -------------------------- | ----------------------------------------------------------------------- |
| Aplicaciones y modulos     | `auth` y nuevo modulo `platform-domain/platform-iam`                    |
| Contratos y eventos        | Tipos internos; ningun contrato HTTP publico                            |
| Datos y migraciones        | Schema `platform_iam`, membresias y permisos en la historia `platform`  |
| Permisos y aislamiento     | Catalogo cerrado, MFA obligatorio y rechazo de identidades CRM          |
| Configuracion y secretos   | Ningun secreto nuevo; issuer/audience se reciben como politica validada |
| Observabilidad y operacion | Errores tipados sin claims, tokens ni datos sensibles                   |
| Documentacion              | Ficha y estado; checklist funcional permanece abierto                   |

## Plan de implementacion

- [x] Modelar membresia y catalogo de permisos en `platform-iam`.
- [x] Implementar contexto autenticado y autorizacion fail-closed en `auth`.
- [x] Crear schema y migracion Prisma de plataforma.
- [x] Probar denegaciones de issuer, audiencia, MFA, membresia y permiso.
- [x] Probar migracion, restricciones y privilegios en PostgreSQL 18.
- [x] Ejecutar `db:check` y CI completa en el VPS.
- [x] Registrar evidencia sin cerrar `ADM-01`.

## Riesgos y mitigaciones

| Riesgo                                    | Mitigacion                                                                                      | Verificacion                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| Tratar claims sin firma como autenticados | La API exige el tipo `VerifiedOidcIdentity`; el adaptador real queda como dependencia explicita | Pruebas y nombres de frontera |
| Aceptar un token de CRM en plataforma     | Comparar issuer y audiencia exactos antes de consultar permisos                                 | Casos negativos unitarios     |
| Omitir MFA                                | Requerir evidencia multifactor para todo operador humano                                        | Caso sin MFA rechazado        |
| Permiso desconocido o ausente             | Catalogo cerrado y denegacion por defecto                                                       | Matriz de autorizacion        |
| Runtime altera permisos o schema          | Grants DML explicitos y runtime sin DDL                                                         | Integracion PostgreSQL        |

## Criterios de aceptacion

- [x] Ningun contexto se crea con issuer o audiencia de CRM.
- [x] Un operador sin MFA, suspendido o sin permiso es rechazado.
- [x] Solo permisos conocidos pueden persistirse y autorizarse.
- [x] El contexto conserva subject, membresia, revision y correlacion sin tokens.
- [x] Runtime opera membresias y permisos pero no cambia el schema.
- [x] La migracion es idempotente, forward-only y no presenta deriva.
- [x] CI y prueba PostgreSQL real aprueban en el VPS.

## Plan de verificacion

- Pruebas unitarias: invariantes de membresia, catalogo, construccion de contexto y matriz de denegacion.
- Pruebas de integracion o contratos: migracion desde cero, restricciones, unicidad, claves foraneas y grants.
- Pruebas E2E: no aplica hasta integrar Keycloak, sesion BFF y rutas administrativas.
- Comprobacion manual: no se almacenan tokens, correos ni roles del proveedor como autoridad.
- Seguridad, permisos y aislamiento: token CRM simulado, ausencia de MFA, membresia suspendida y permiso ausente se rechazan.
- Idempotencia, concurrencia y recuperacion: migracion aplicada una vez; cambios posteriores son forward-only.
- Comandos que deben aprobar: `pnpm db:check`, `pnpm test`, `pnpm test:architecture`, integracion PostgreSQL y `pnpm run ci`.

## Recuperacion

- Compatibilidad o migracion: tablas nuevas sin consumidor desplegado; no cambia contratos publicados.
- Rollback de aplicacion: el codigo anterior ignora el schema; no se revierte automaticamente una migracion aplicada.
- Recuperacion de datos, si aplica: no aplica a la base sintetica de prueba.

## Evidencia de cierre

- Archivos, commits o PR: nucleo de autenticacion en `packages/auth`, agregado y catalogo cerrado en `packages/platform-domain/src/platform-iam`, schema y migracion en la historia Prisma `platform`, y prueba PostgreSQL en `tests/integration`. Commits locales `ae70244`, `cb4e05a` y `26d253a` en `feat/ADM-01-platform-iam`, sin remoto ni PR.
- Comandos y resultados: `pnpm db:check` valido el schema y genero Prisma Client 7.10.0. `pnpm run ci` aprobo en el VPS con Node 24.21.0 fijado por digest: formato, lint, typecheck y build de 17 workspaces, 21 pruebas de configuracion, 68 pruebas generales y 9 pruebas de arquitectura.
- Migracion e integracion: PostgreSQL 18 fijado por digest aplico desde cero las dos migraciones de plataforma; la repeticion informo `No pending migrations` y `prisma migrate diff` informo `No difference detected`. Las 6 pruebas de integracion de plataforma aprobaron; 3 verificaron membresias, permisos cerrados, restricciones, cascada, DML de runtime y rechazo de DDL. La comprobacion final confirmo PostgreSQL 18, migrador sin superusuario y runtime sin `CREATE` en `tenants` ni `platform_iam`.
- Seguridad verificada: issuer o audience de CRM, principal no humano, salida malformada del verificador, ausencia de MFA, membresia inexistente/pendiente/suspendida y permisos fuera del catalogo se rechazan sin conservar ni exponer el token.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`; `docs/02-plan/trabajo.md` permanece abierto porque aun no existe acceso administrativo extremo a extremo.
- Desviaciones del plan: ninguna material; la politica recibe explicitamente el catalogo permitido para impedir que un adaptador defectuoso introduzca permisos arbitrarios.
- Pendientes o decisiones nuevas: `ADM-01` sigue `EN_CURSO`. La siguiente rebanada debe implementar configuracion y adaptador criptografico OIDC/JWKS contra Keycloak; despues corresponden sesiones opacas, PKCE, CSRF, endpoints y UI.
