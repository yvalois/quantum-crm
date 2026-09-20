# ADM-01-c - Realm Keycloak de plataforma

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-01`, `OPS-06`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a`, `ADM-01-b`, ADR-0004 y ADR-0008
- Bloquea a: Authorization Code con PKCE, sesion opaca y login de `admin-web`
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0008 y reglas de seguridad, configuracion, despliegue y monorepo

## Resultado esperado

Existe una configuracion versionada e importable del realm exclusivo `quantum-platform`, sin usuarios ni secretos, que define un cliente administrativo confidencial, Authorization Code, PKCE `S256`, audiencia exclusiva de `admin-api` y un flujo de navegador que exige contrasena y OTP con LoA/ACR 2. La configuracion se valida contra Keycloak real y desechable en el VPS.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, Keycloak, realm, MFA, OTP, LoA, ACR, PKCE, clientes OIDC, secretos, Compose e integraciones.
- Codigo o documentacion encontrados: el mapa exige realms separados; `ADM-01-b` verifica tokens del issuer de plataforma con `RS256`, audiencia `quantum-admin-api`, principal `human` y ACR `2`; no existe realm importable ni instancia Keycloak declarada.
- Pruebas e historial encontrados: el verificador y un JWKS desechable estan probados; no se ha arrancado Keycloak real ni validado su metadata, cliente o flujo.
- Decision de reutilizacion, extension o reemplazo: agregar una exportacion minima sin identidades ni secretos y validarla con la imagen oficial Keycloak 26.7.4 en el VPS; la instalacion persistente y la credencial del cliente se resolveran mediante secretos fuera de Git en la rebanada de despliegue/sesion.
- Referencias primarias revisadas: documentacion oficial de contenedores, importacion de realms, flujos de autenticacion, OTP y step-up/ACR de Keycloak.

## Alcance

### Incluido

- Realm `quantum-platform` endurecido y sin autorregistro.
- Cliente confidencial de `admin-web`, code flow y PKCE `S256`.
- Audience mapper y claim fijo de principal humano en access tokens.
- Flujo browser LoA 1 contrasena y LoA 2 OTP, con ACR minimo 2.
- Politicas acotadas de token, sesion, contrasena, OTP y fuerza bruta.
- Prueba de importacion e inspeccion contra Keycloak real desechable en el VPS.

### No incluido

- Usuario operador, contrasena, semilla OTP o client secret en Git.
- Instalacion persistente, DNS, Caddy, TLS o base Keycloak definitiva.
- BFF, callback OIDC, cookies, sesiones, CSRF, endpoints o interfaz de login.
- Marcar `ADM-01` completo.

## Impacto tecnico

| Area                       | Impacto previsto                                                      |
| -------------------------- | --------------------------------------------------------------------- |
| Aplicaciones y modulos     | Ningun cambio comercial; contrato futuro de `admin-web`               |
| Contratos y eventos        | Configuracion OIDC de proveedor, sin API de producto nueva            |
| Datos y migraciones        | Importacion de realm en base desechable; sin datos Quantum            |
| Permisos y aislamiento     | Realm y audiencia exclusivos de plataforma; MFA obligatorio           |
| Configuracion y secretos   | JSON sin secretos; redirects parametrizados y credencial fuera de Git |
| Observabilidad y operacion | Health de Keycloak e importacion fail-closed                          |
| Documentacion              | Realm, procedimiento de validacion, ficha y estado                    |

## Plan de implementacion

- [x] Versionar realm minimo sin usuarios ni credenciales.
- [x] Configurar cliente confidencial, PKCE, redirects y mappers.
- [x] Configurar flujo LoA 1/2 con OTP requerido y politicas de seguridad.
- [x] Crear prueba estructural para impedir relajaciones o secretos.
- [x] Importar y consultar la configuracion en Keycloak 26.7.4 desechable en el VPS.
- [x] Registrar evidencia sin cerrar `ADM-01`.

## Riesgos y mitigaciones

| Riesgo                      | Mitigacion                                                   | Verificacion                          |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| Realm acepta acceso sin MFA | Flujo LoA 2, minimum ACR 2 y verificacion ACR en `admin-api` | Inspeccion del flujo y cliente reales |
| Flujo inseguro              | Implicit, direct grant y service accounts deshabilitados     | Admin API de Keycloak                 |
| Redirect abierto            | URI exacta parametrizada y web origin exacto                 | Prueba estructural y realm importado  |
| Secretos o usuarios en Git  | Exportacion sin `users`, credenciales ni `secret`            | Test de invariantes y diff            |
| Configuracion incompatible  | Imagen Keycloak 26.7.4 y prueba de importacion real en VPS   | Arranque healthy y consultas admin    |

## Criterios de aceptacion

- [x] Keycloak importa y habilita `quantum-platform` sin configuracion invalida.
- [x] El cliente solo admite Authorization Code y exige PKCE `S256`.
- [x] El cliente exige ACR minimo 2 y el flujo asociado requiere OTP para LoA 2.
- [x] Los access tokens reciben audience `quantum-admin-api` y principal `human`.
- [x] El realm no contiene usuarios, secretos, redirects comodin ni autorregistro.
- [x] La validacion automatica local y la integracion real en VPS aprueban.

## Plan de verificacion

- Pruebas unitarias: parsear el JSON y comprobar invariantes de seguridad, mappers, tiempos y ausencia de material sensible.
- Pruebas de integracion o contratos: importar el realm en Keycloak 26.7.4 desechable y consultar metadata, cliente, mappers y flujo mediante Admin API.
- Pruebas E2E: el login humano con OTP se completara cuando exista un operador y el BFF de sesion.
- Comprobacion manual: discovery y JWKS del realm responden y declaran el issuer esperado.
- Seguridad, permisos y aislamiento: realm, audience, redirect, grants, PKCE, ACR y ausencia de usuarios/secretos.
- Idempotencia, concurrencia y recuperacion: la importacion de arranque omite realms existentes; el entorno de prueba siempre usa volumen desechable.
- Comandos que deben aprobar: prueba estructural, `pnpm run ci` y harness Keycloak en el VPS.

## Recuperacion

- Compatibilidad o migracion: primera definicion del realm; cambios futuros requeriran exportacion revisada u operacion administrativa versionada.
- Rollback de aplicacion: retirar el artefacto antes de importarlo; una importacion persistente no se revierte borrando Git.
- Recuperacion de datos, si aplica: no aplica a la validacion desechable; en un entorno persistente se restaura la base de identidad conforme a continuidad.

## Evidencia de cierre

- Archivos y commits: `d4cb38e` planifica la rebanada; `ad99075` agrega realm, invariantes y documentacion; `84e16d8` agrega el harness repetible de Keycloak real. No existe remoto configurado, por lo que no hay PR ni push.
- Verificacion local: 4/4 invariantes del realm, lint, 13/13 pruebas de arquitectura y `git diff --check` aprobados.
- Verificacion reproducible en VPS sobre `84e16d8`: `pnpm run ci` aprobado con formato, lint, typecheck, 31 pruebas de configuracion, 93 unitarias, 13 de arquitectura y build de los 17 workspaces aplicables bajo Node 24.
- Integracion Keycloak en VPS: `bash infra/keycloak/validate-realm.sh` aprobo contra Keycloak 26.7.4 fijado por digest `sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c`; valido importacion, discovery, JWKS RSA, realm, cliente, grants, PKCE, ACR, mappers, ausencia de usuarios y pasos password/OTP mediante Admin API.
- Documentacion actualizada: `infra/README.md`, realm importable, harness, ficha y estado oficial.
- Desviaciones del plan: ninguna. La prueba usa HTTP, H2 y credenciales sinteticas solo dentro del contenedor desechable; no representa el despliegue persistente ni reduce los requisitos HTTPS, PostgreSQL o secretos por archivo.
- Pendientes: despliegue persistente, PostgreSQL/secretos de Keycloak, credencial confidencial, operador inicial, BFF, sesiones, CSRF, endpoints, guardas y UI permanecen en `ADM-01`.
