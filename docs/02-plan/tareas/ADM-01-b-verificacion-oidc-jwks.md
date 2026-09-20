# ADM-01-b - Verificacion OIDC y JWKS de plataforma

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-01`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a`, ADR-0004 y ADR-0008
- Bloquea a: sesion administrativa, BFF de `admin-web` y rutas protegidas de `admin-api`
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0008, reglas de seguridad, configuracion y monorepo

## Resultado esperado

`admin-api` dispone de configuracion OIDC fail-closed y de un adaptador que verifica criptograficamente access tokens con las claves publicas JWKS del realm exclusivo de plataforma. Solo acepta `RS256`, issuer, audiencia, vigencia, antiguedad maxima, tipo Bearer, principal humano y ACR de MFA exactos antes de producir `VerifiedOidcIdentity`.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado, ficha previa y evidencia en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, `OIDC`, `JWKS`, `issuer`, `audience`, `acr`, `admin-api`, `processDefinitions`, `VerifiedOidcIdentity` y dependencias criptograficas.
- Codigo o documentacion encontrados: `ADM-01-a` define el puerto `OidcAccessTokenVerifier` y la denegacion por MFA; `packages/config` valida por proceso; no existe adaptador JWT, configuracion OIDC ni infraestructura Keycloak versionada.
- Pruebas e historial encontrados: la identidad simulada, membresia y permisos ya tienen matriz negativa; aun no se ha verificado firma, algoritmo, expiracion ni obtencion JWKS.
- Decision de reutilizacion, extension o reemplazo: implementar el puerto existente con `jose` 6.2.12 fijado, derivar el endpoint JWKS del issuer Keycloak confiable y extender exclusivamente la configuracion de `admin-api`.
- Referencias primarias revisadas: endpoints OIDC y certificados de Keycloak, LoA/ACR de Keycloak, `jwtVerify`, `createRemoteJWKSet` y recomendaciones de seguridad de `jose`.

## Alcance

### Incluido

- Schema OIDC tipado y validado para `admin-api`.
- Endpoint JWKS derivado del issuer configurado, nunca de headers o claims del token.
- Verificacion JWT asimetrica con algoritmo allowlist, issuer, audience, tiempo y tipo.
- Validacion de `qcrm_principal_type=human` y ACR MFA configurado.
- Cache, cooldown y timeout acotados para JWKS remoto.
- Pruebas criptograficas con claves RSA sinteticas y servidor JWKS desechable.
- Ejemplo no secreto y variables Compose de plataforma.

### No incluido

- Instalar o aprovisionar Keycloak en el VPS.
- Realm export, usuarios, factores MFA o flujo LoA de Keycloak.
- Authorization Code con PKCE, intercambio de codigo, client secret o refresh tokens.
- Cookies, almacen de sesiones, CSRF, endpoints HTTP o interfaz de login.
- Marcar `ADM-01` completo.

## Impacto tecnico

| Area                       | Impacto previsto                                                |
| -------------------------- | --------------------------------------------------------------- |
| Aplicaciones y modulos     | `packages/config`, `packages/auth` y manifiestos de `admin-api` |
| Contratos y eventos        | Implementacion del puerto interno OIDC; sin API publica nueva   |
| Datos y migraciones        | Ninguno                                                         |
| Permisos y aislamiento     | Realm/audience de plataforma y MFA exactos                      |
| Configuracion y secretos   | Variables publicas OIDC; ningun secreto ni token persistido     |
| Observabilidad y operacion | Errores uniformes; timeout y cache JWKS acotados                |
| Documentacion              | Ejemplo de `admin-api`, infraestructura, ficha y estado         |

## Plan de implementacion

- [x] Modelar y probar configuracion OIDC exclusiva de `admin-api`.
- [x] Implementar verificador JWT/JWKS con `jose` fijado.
- [x] Probar firma, algoritmo, issuer, audience, tiempos, tipo, principal y ACR.
- [x] Probar JWKS remoto confiable, rotacion por `kid` y rechazo de URL indicada por el token.
- [x] Actualizar ejemplos y Compose sin secretos.
- [x] Ejecutar configuracion, pruebas, arquitectura y CI completa en el VPS.
- [x] Registrar evidencia sin cerrar `ADM-01`.

## Riesgos y mitigaciones

| Riesgo                               | Mitigacion                                                        | Verificacion                     |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------- |
| Algoritmo debil o confusion de clave | Allowlist exclusiva `RS256` y `jwtVerify`                         | Tokens HS256/algoritmo distinto  |
| SSRF mediante `jku` o issuer         | JWKS derivado de configuracion validada; nunca del token          | Token con `jku` hostil           |
| Token CRM aceptado en plataforma     | Issuer y audience exactos dentro de la verificacion criptografica | Token firmado con claims CRM     |
| MFA aparente pero insuficiente       | ACR exacto configurado y principal humano requerido               | ACR inferior y principal service |
| Falla o abuso del endpoint JWKS      | HTTPS protegido, timeout, cooldown y cache con limites            | Servidor remoto desechable       |
| Filtracion de token o claims         | `SecretValue`, errores uniformes y salida minima                  | Canario ausente de errores       |

## Criterios de aceptacion

- [x] Configuracion incompleta, insegura o incoherente impide iniciar `admin-api`.
- [x] Solo un JWT `RS256` firmado por el JWKS confiable produce identidad verificada.
- [x] Issuer, audience, expiracion, antiguedad, Bearer, human y ACR son obligatorios.
- [x] Un `jku`, `jwk` o JWKS indicado por entrada no cambia la fuente de confianza.
- [x] El adaptador no conserva ni expone el token.
- [x] Los manifiestos y ejemplos contienen solo configuracion publica sintetica.
- [x] CI y prueba JWKS real aprueban en el VPS.

## Plan de verificacion

- Pruebas unitarias: parser OIDC y matriz completa de JWT firmados con RSA sintetica.
- Pruebas de integracion o contratos: servidor HTTP JWKS desechable, cache y seleccion por `kid`.
- Pruebas E2E: no aplica hasta integrar Keycloak y la sesion web.
- Comprobacion manual: el endpoint JWKS coincide exactamente con el issuer Keycloak configurado.
- Seguridad, permisos y aislamiento: algoritmo, realm/audience CRM, ACR inferior, tipo service, expiracion y headers remotos hostiles se rechazan.
- Idempotencia, concurrencia y recuperacion: el cache JWKS admite solicitudes repetidas; retirar el adaptador revierte el codigo sin tocar datos.
- Comandos que deben aprobar: `pnpm config:check`, pruebas de `auth`, integracion JWKS, `pnpm test:architecture` y `pnpm run ci`.

## Recuperacion

- Compatibilidad o migracion: no hay cambios de datos ni contrato publicado.
- Rollback de aplicacion: volver al commit anterior y retirar las variables OIDC; no existe estado persistente que revertir.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos y commits: `6a80c9a` planifica la rebanada; `1e611ad` implementa configuracion, verificador, composicion, ejemplos y pruebas; `2b40a06` permite resolver los tipos fuente de `auth` durante el typecheck limpio del monorepo. No existe remoto configurado, por lo que no hay PR ni push.
- Verificacion local: 35 pruebas focalizadas aprobadas; lint, 9 pruebas de arquitectura, formato y `git diff --check` aprobados.
- Verificacion reproducible en VPS sobre `2b40a06d0ed5`, dentro de `node:24-bookworm`: `pnpm run ci` aprobado con 31 pruebas de configuracion, 93 pruebas unitarias, 9 pruebas de arquitectura, typecheck y build de los 17 workspaces aplicables.
- Integracion focalizada en VPS: `tests/integration/oidc-remote-jwks.test.ts`, 1/1 aprobada contra un servidor HTTP JWKS desechable; dos verificaciones consecutivas hicieron una sola consulta por cache.
- Manifiestos en VPS: `docker compose ... config --quiet` aprobado para `infra/compose/local.yaml` y `infra/compose/platform.yaml` con UUID, archivos secretos y digests sinteticos.
- Documentacion actualizada: ejemplo de entorno `admin-api`, variables y limites OIDC en `infra/README.md`, ficha y estado oficial.
- Desviaciones del plan: ninguna funcional. La suite de integracion global tambien fue invocada sin sus secretos ni PostgreSQL desechable y, como estaba previsto, los tres archivos ajenos a esta rebanada rechazaron la configuracion ausente; la integracion OIDC incluida aprobo tanto en esa ejecucion como de forma focalizada.
- Pendientes: realm Keycloak real, flujo LoA/MFA, cliente confidencial, PKCE, sesiones opacas, endpoints HTTP y guardas permanecen en `ADM-01`; esta ficha no acredita acceso administrativo completo.
