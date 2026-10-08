# USR-01 - Miembros, invitaciones y sesión del CRM

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificación

- Requisito principal: `USR-01`
- Requisitos relacionados: `ADM-04`, `USR-03`, `USR-05`, `USR-10`, `USR-11`, `OPS-04` y `OPS-23`
- Fase del MVP: Fase 3 — Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: Base CRM aislada por perfil creada por `ADM-04`; Keycloak como proveedor OIDC conforme a `ADR-0004`.
- Bloquea a: `USR-02` a `USR-11` y cualquier módulo que requiera una identidad CRM autorizada.
- ADR, arquitectura o diseño aplicables: `ADR-0002`, `ADR-0003`, `ADR-0004`, `ADR-0005`, `ADR-0006`, `ADR-0007`, `ADR-0008`, `ADR-0014`, `monorepo.md`, `mapa-del-sistema.md` y `frontends-experiencia-visual.md`.

## Resultado esperado

Cada perfil dispone de un realm OIDC separado y un administrador inicial. Un administrador CRM autorizado puede crear o invitar miembros; la invitación es de un único uso y caduca. La persona invitada activa su cuenta mediante Keycloak y entra al CRM con sesión opaca server-side. El administrador puede editar el perfil comercial y desactivar la membresía sin borrar historial; esa desactivación bloquea el acceso e invalida sus sesiones de Quantum.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `USR-01`, `membership`, `invitation`, `session`, `realm`, `CREATE_ADMINISTRATOR`, `Oidc` y `crm` en código, pruebas y documentación.
- Código o documentación encontrados: `api` y `crm-web` son bootstrap sin flujo comercial; `database` solo posee la historia `platform`; `auth` ya contiene el patrón seguro de sesión opaca y OIDC de la plataforma; el flujo `ADM-04` llega hasta `CONFIGURE_HTTPS`, aunque el enum ya reserva `CREATE_ADMINISTRATOR`.
- Pruebas e historial encontrados: las pruebas de OIDC y sesión existentes cubren solo el límite `platform`; no existe prueba ni implementación CRM que pueda reutilizarse como producto terminado.
- Decisión de reutilización, extensión o reemplazo: se extraerán primitivas neutrales de OIDC/sesión cuando se preserve el aislamiento de audiencia y namespace; se crea el módulo propietario `iam`, la historia Prisma `crm` y contratos CRM. No se reutilizan membresías ni sesiones de plataforma.

## Alcance

### Incluido

- Historia CRM con tablas propiedad de `iam`, migración forward-only y repositorio aislado por base de perfil.
- Contratos `/api/v1` y casos de uso para listado, alta/invitación, edición, activación y desactivación de miembros.
- Roles mínimos de arranque estrictamente necesarios para administrar miembros, sin cerrar `USR-03` ni `USR-05`.
- Realm, cliente OIDC y administrador inicial creados de manera idempotente durante el alta del perfil.
- BFF de `crm-web`, Authorization Code con PKCE, cookies host-only, CSRF y sesiones opacas separadas de la plataforma.
- Interfaz real de administración de miembros y auditoría de los cambios sensibles.
- Alta de hasta dos administradores adicionales desde el perfil en Quantum Admin y alta de miembros desde el CRM. Ambos caminos crean membresias en el CRM aislado del perfil; nunca operadores globales de plataforma. La contraseña temporal es generada por identidad, visible una sola vez y nunca persistida por Quantum.
- Primer acceso con la credencial temporal, cambio obligatorio de contraseña y configuración TOTP antes de activar la membresía.

### No incluido

- Equipos, roles personalizados, matriz completa de permisos, alcance comercial o reasignación de datos: pertenecen a `USR-02` a `USR-10`.
- Sincronización de directorios, SSO empresarial, recuperación de contraseñas o proveedores de correo distintos del mecanismo de invitación de Keycloak.
- Pulido visual transversal, tableros operativos, carga global o despliegue del piloto antes de que su release sea admisible.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `iam` en `domain`, `database`, `auth`, `api`, `crm-web`, `deploy-executor` y configuración de Keycloak |
| Contratos y eventos | Schemas Zod versionados de miembros, invitaciones, sesión y eventos de auditoría permitidos |
| Datos y migraciones | Nueva historia `prisma/crm`, tablas `iam`, invitaciones con hash, revisiones de autorización y migrador explícito |
| Permisos y aislamiento | Realm, audiencia, credenciales, cookie, Redis y membresía propios del perfil; autorización en servidor |
| Configuración y secretos | Schemas por proceso; secretos por archivo y referencias por perfil sin valores en Git |
| Observabilidad y operación | Errores seguros, correlación y resultados durables; sin registrar token ni enlace de invitación |
| Documentación | Esta ficha, estado, contratos, migraciones y evidencia de verificación |

## Plan de implementación

Referencia visual para el panel: el shell de productividad de `crm-web` del proyecto Stitch **Quantum CRM Enterprise Platform**. Se adopta su jerarquía de sidebar y contenido claro; las rutas, estados, permisos y textos de este flujo permanecen definidos por `USR-01` y los contratos del repositorio.

- [x] Crear el módulo `iam`, contratos públicos y la historia `crm` con membresías e invitaciones inmutables.
- [x] Implementar repositorio PostgreSQL y casos de uso de crear, invitar, editar, aceptar y desactivar; la invitación persiste una clave de idempotencia y la aceptación se bloquea transaccionalmente.
- [x] Generalizar de forma segura las primitivas de sesión/OIDC y añadir la composición exclusiva de CRM: namespace Redis por perfil, cliente OIDC CRM, sesión opaca, PKCE, CSRF y BFF de lectura con ruta upstream fija.
- [x] Conectar autorización CRM en API y el BFF protegido de `crm-web`; la configuración real del realm, cliente y secretos continúa en `ADM-04`.
- [x] Añadir revocación transaccional e idempotente de invitaciones pendientes, protegida por `iam:members:update`, con expiración cerrada y acción visible en la administración.
- [ ] Completar la administración visual de miembros y el flujo de aceptación.
- [x] Conectar la creación de administradores desde el perfil de empresa con la membresía, activación y login del CRM aislado, sin conceder permisos de Quantum Admin.
- [x] Establecer la frontera interna de activación: comando IAM sin token, contrato de servicio con permiso dedicado y correlación durable por invitación/sujeto/generación.
- [x] Extender `ADM-04` con aprovisionamiento idempotente del realm, cliente y administrador inicial, sin exponer administración Keycloak al CRM.
- [ ] Añadir pruebas proporcionales de dominio, contrato, aislamiento, revocación e invitación de un único uso.
- [x] Ejecutar la verificación afectada en VPS; pruebas de dominio y BFF (20/20), typecheck de `domain`, `database`, `api` y `crm-web`, Prettier de los 11 archivos modificados y comprobación operativa de Keycloak. La matriz CI del commit candidato continúa pendiente antes de integrar.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Una identidad o token cruza perfiles | Realm, issuer, audiencia, namespace de sesión y base derivados del perfil; sin `tenant_id` de entrada | Dos perfiles rechazan lectura y token cruzados |
| Invitación repetida o expuesta | Token aleatorio de un uso, hash persistido, expiración y sin logs | Dos aceptaciones concurrentes producen una sola membresía activa |
| Desactivar deja acceso vigente | Revisión de autorización y revocación de sesiones antes de confirmar el cambio | Sesión existente recibe denegación tras desactivar |
| El CRM obtiene privilegios de administración Keycloak | Solo el aprovisionador autorizado usa el adaptador administrativo; CRM usa OIDC publicado | Revisión de credenciales y contratos del adaptador |

## Criterios de aceptación

- [ ] Un administrador CRM puede crear o invitar, consultar y editar miembros autorizados de su propio perfil.
- [ ] Una invitación válida solo se puede aceptar una vez; una vencida o revocada no revela datos ni crea acceso.
- [ ] Inicio y cierre de sesión CRM usan PKCE y cookie opaca; ningún token llega a JavaScript, URL o HTML.
- [ ] Una membresía desactivada no puede volver a usar una sesión existente y su historial permanece.
- [ ] Ninguna petición puede elegir libremente perfil, realm, objeto de sesión o permiso.

## Plan de verificación

- Pruebas unitarias: invariantes de membresía, estados de invitación, hash, expiración, transición y autorización.
- Pruebas de integración o contratos: migración CRM, repositorio PostgreSQL, OIDC/Keycloak aislado, contratos HTTP y revocación.
- Pruebas E2E: administrador invita; miembro acepta; inicia/cierra sesión; se edita y desactiva.
- Comprobación manual: un perfil autorizado en VPS después de una release admisible, sin datos comerciales reales.
- Seguridad, permisos y aislamiento: dos perfiles, token/issuer/audiencia cruzados, CSRF, redirecciones y acceso directo por API.
- Idempotencia, concurrencia y recuperación: invitación, aceptación, primer administrador y reintento del aprovisionamiento.
- Comandos que deben aprobar: una comprobación afectada del VPS y la matriz final de GitHub Actions según `15-ejecucion-verificaciones-vps.md`.

## Recuperación

- Compatibilidad o migración: tablas aditivas; las migraciones CRM se aplican una sola vez por perfil y no se reescriben.
- Rollback de aplicación: una versión anterior no acepta rutas nuevas; no elimina membresías, auditoría ni invitaciones.
- Recuperación de datos, si aplica: restauración CRM y realm en aislamiento mediante el procedimiento de continuidad; no se reemplaza por rollback de aplicación.

## Evidencia de cierre

- Bloque de activación implementado en el commit candidato bde2d22 (feat/USR-01-member-activation-flow): api emite el enlace de Keycloak usando el cliente quantum-crm-bootstrap, correlaciona subject/generación en IAM y el primer token OIDC válido promueve la membresía de INVITED a ACTIVE de forma transaccional; crm-web entrega el enlace únicamente en memoria.
- El proveedor Java de Keycloak acepta invitaciones solo en el realm derivado y con el cliente bootstrap de ese perfil; el enlace conserva un solo uso, vencimiento y revocación por generación. Caddy enruta exclusivamente la ruta del proveedor y la autorización vuelve a validarse en Keycloak.
- En el VPS se aprobaron una sola vez los typechecks afectados (config, contracts, domain, database, auth, api, crm-web y deploy-host), Prettier de los archivos afectados y la compilación Maven de la imagen Keycloak. No se ejecutó ninguna comprobación técnica local.
- Archivos, commits o PR: commit `b40b9d0` y [PR #51](https://github.com/yvalois/quantum-crm/pull/51) (integrado) en `feat/USR-01-miembros-e2e`; se añaden la transición de revocación, el caso de uso protegido, la operación PostgreSQL transaccional/idempotente, la ruta API/BFF y la acción del panel. La corrección operativa de readiness queda en `ab7c161` y [PR #52](https://github.com/yvalois/quantum-crm/pull/52), rama `feat/USR-01-activacion-miembros`.
- Comandos y resultados: en el VPS, `member-service.test.ts` y `crm-auth-http.test.ts` aprobaron 20/20 pruebas; `domain`, `database`, `api` y `crm-web` aprobaron typecheck; Prettier aprobó los 11 archivos modificados. La imagen Keycloak `sha256:cf3d689e3be041d41a2824b11a5645a9d9092d73c4dcd436b7c922813ef3f67f` contiene `quantum-activation-provider.jar`, el contenedor queda `healthy` y discovery OIDC devuelve `200`. No se ejecutó ninguna comprobación técnica local.
- Documentación actualizada: ficha, `estado.md` y `ADR-0023` mantienen `USR-01` en `EN_CURSO`; la actualización VPS del 2026-09-29 complementa esta evidencia histórica.
- Desviaciones del plan (evidencia histórica): al redactar este cierre todavía faltaban el realm CRM real y el bootstrap del administrador. Esa parte queda cubierta por la validación VPS `f8df5e7` descrita abajo; siguen pendientes la promoción persistente, la administración visual, las invitaciones de miembros y sus pruebas proporcionales.
- Pendientes o decisiones nuevas: `USR-03` a `USR-10` no se consideran terminados. El flujo de activación inicial ya tiene una comprobación real del comando interno, pero no se marca el requisito completo hasta terminar las capacidades restantes de `USR-01`.

### Actualización de validación VPS — 2026-09-29

- El commit `f8df5e7` corrigió la claim de permisos del cliente de servicio a `qcrm_service_permissions`; no se reutiliza la claim estándar `scope` de Keycloak.
- En el perfil piloto real `01a0e50a-ab43-7c18-92ee-2f0a2567f292` se ejecutó el API candidato `qcrm-platform/api:f8df5e7` en una red aislada, usando el realm, la base y los secretos del perfil sin reemplazar el contenedor persistente.
- El token client-credentials incluyó el principal de servicio y los permisos `iam:bootstrap-initial-administrator` e `iam:accept-member-invitation`. El comando interno de bootstrap respondió `200` y devolvió una membresía `ACTIVE` con revisión `1`.
- La base CRM confirmó exactamente una fila de `iam.members` y una fila de `iam.bootstrap_initial_administrator` para el subject `2f2db230-250d-439b-be54-4a8615f0e94d`; la operación persistió su clave de idempotencia.
- El contenedor candidato y los archivos temporales fueron eliminados del VPS. La imagen persistente del perfil todavía requiere promoción posterior al CI del PR; esta validación no se presenta como cierre total de `USR-01` porque la administración visual, la invitación de miembros y sus pruebas proporcionales siguen pendientes.
- Rama y entrega: [PR #62](https://github.com/yvalois/quantum-crm/pull/62) (`feat/USR-01-crm-activation-e2e`).

### Recuperacion del callback CRM — 2026-10-01

- Causa observada: el callback devolvia `400 Invalid authentication response` si el navegador regresaba de Keycloak sin la cookie opaca de transaccion, por ejemplo tras expirar, repetirse o perderse el intento de acceso.
- Correccion candidata `15b9d57`: limpiar la cookie incompleta y reiniciar OIDC con retorno a `/inbox`, igualando la recuperacion ya existente en `admin-web` sin aceptar callbacks sin estado.
- Evidencia VPS: Prettier afectado, typecheck de `crm-web` y `crm-auth-http.test.ts` con 13/13 casos aprobados; ninguna ejecucion tecnica local.

### Acceso temporal y administradores adicionales — 2026-10-07

- El candidato `1743a54` genera en Keycloak una contraseña temporal aleatoria que satisface la politica del realm, la marca para cambio obligatorio y conserva `CONFIGURE_TOTP` y la finalizacion Quantum como acciones requeridas.
- La credencial se transporta solo en la respuesta efimera protegida con `Cache-Control: no-store`: no entra a PostgreSQL, Redis, operaciones durables ni logs. Quantum Admin la muestra una vez para el propietario inicial y el panel `/team` la muestra una vez para cada usuario creado.
- El propietario puede crear los dos usuarios de seguimiento seleccionando el rol sistema `Administrador`; los roles supervisor, asesor o personalizados siguen creandose dentro del mismo perfil y la autorizacion permanece validada por el API.
- VPS: Prettier afectado aprobado; typecheck de `contracts`, `admin-api`, `admin-web`, `api`, `crm-web` y `deploy-executor` aprobado; 15/15 pruebas focalizadas aprobadas; Maven y los seis builds de produccion afectados aprobaron.
- Despliegue funcional: `admin-api`, `admin-web`, `deploy-executor`, Keycloak, API InterAmerican y CRM InterAmerican ejecutan las imagenes `1743a54` y quedaron saludables. Admin responde `200`, CRM redirige a OIDC con `307` y discovery del realm responde `200`.
- Smoke de identidad: el proveedor emitio para una identidad sintetica una credencial temporal y un enlace del realm correcto; la identidad se elimino al terminar y no se imprimio ni persistio la contraseña.

### Pendientes de estabilizacion posterior

- Promover los artefactos por la cadena oficial despues de integrar el PR; el VPS ejecuta temporalmente las imagenes candidatas del commit validado.
- Ampliar la automatizacion de navegador del cambio de contraseña y enrolamiento TOTP; no bloquea la ruta activa ya provista por las acciones nativas de Keycloak.

### Administradores CRM desde Quantum Admin — 2026-10-07

- El perfil de empresa ya no crea operadores globales de Quantum Admin. La accion visible `Administradores CRM` registra una asignacion durable ligada al perfil y solicita al API aislado del CRM una membresia con el rol sistema `ADMINISTRATOR`.
- El servicio interno usa el permiso minimo `iam:create-administrator`; el perfil se deriva de la operacion durable y del runtime reservado, no de un `tenant_id` libre. La base, el realm y la identidad pertenecen exclusivamente al perfil seleccionado.
- La activacion entrega una sola vez la contraseña temporal y el enlace del realm del perfil; el primer acceso conserva `UPDATE_PASSWORD`, `CONFIGURE_TOTP` y la confirmacion de activacion de Quantum.
- Evidencia VPS del candidato tecnico `72c568e`: siete archivos de pruebas con 25 casos aprobados, lint y typecheck afectados aprobados, Prisma plataforma validado y generado, e imagenes de produccion de `admin-api`, `deploy-executor`, `api`, `admin-web` y `platform-migrator` construidas. La correccion final del emisor de activacion aprobo tres pruebas de regresion, dos typechecks y los builds de `api` y `admin-web`.
- Smoke E2E en InterAmerican: la cola durable paso a `ACTIVE`, creo una membresia `INVITED` con rol `ADMINISTRATOR`, una invitacion pendiente, una identidad en el realm del perfil y una activacion correlacionada por sujeto y generacion. La identidad, membresia, invitacion y asignacion sinteticas se eliminaron y verificaron al terminar.
- Despliegue: `admin-api`, `deploy-executor`, `admin-web` y el API de InterAmerican quedaron saludables con la migracion `20261008002000_usr_01_tenant_administrator_assignments` aplicada. No se ejecuto codigo del proyecto en el equipo local.
- Pendiente del requisito completo: terminar las capacidades generales de edicion/desactivacion y sus escenarios integrados; este cierre acredita especificamente el alta de administradores CRM desde el perfil central.
