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
- ADR, arquitectura o diseño aplicables: `ADR-0002`, `ADR-0003`, `ADR-0004`, `ADR-0005`, `ADR-0006`, `ADR-0007`, `ADR-0008`, `monorepo.md` y `mapa-del-sistema.md`.

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

- [x] Crear el módulo `iam`, contratos públicos y la historia `crm` con membresías e invitaciones inmutables.
- [x] Implementar repositorio PostgreSQL y casos de uso de crear, invitar, editar, aceptar y desactivar; la invitación persiste una clave de idempotencia y la aceptación se bloquea transaccionalmente.
- [ ] Generalizar de forma segura las primitivas de sesión/OIDC y añadir la composición exclusiva de CRM.
- [x] Conectar autorización CRM en API; el BFF protegido de `crm-web` continúa pendiente junto con su sesión propia.
- [ ] Completar la administración visual de miembros y el flujo de aceptación.
- [ ] Extender `ADM-04` con aprovisionamiento idempotente del realm, cliente y administrador inicial, sin exponer administración Keycloak al CRM.
- [ ] Añadir pruebas proporcionales de dominio, contrato, aislamiento, revocación e invitación de un único uso.
- [ ] Ejecutar una única verificación afectada en VPS y la matriz CI del commit candidato; actualizar evidencia antes de cerrar.

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

- Archivos, commits o PR: cambios sin publicar en `feat/USR-01-miembros-crm`.
- Comandos y resultados: pendiente de la comprobación afectada única en VPS y CI del commit candidato; no se ejecutó ninguna comprobación técnica local.
- Documentación actualizada: ficha creada y `estado.md` marcado `EN_CURSO` antes del código; se registra la base `iam` implementada sin afirmar que el flujo completo está cerrado.
- Desviaciones del plan: pendiente.
- Pendientes o decisiones nuevas: `USR-03` a `USR-10` permanecen abiertos; los roles mínimos de bootstrap no los dan por terminados.
