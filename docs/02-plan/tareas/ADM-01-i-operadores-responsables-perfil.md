# ADM-01-i - Operadores Quantum responsables del perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificacion

- Requisito principal: `ADM-01`.
- Requisito relacionado: `ADM-02`.
- Fase del MVP: Plataforma Quantum.
- Responsable: Codex.
- ADR aplicables: `ADR-0004`, `ADR-0005`, `ADR-0006`, `ADR-0008` y `ADR-0009`.

## Resultado esperado

Desde la vista de un perfil en Quantum Admin, un operador con `operators:manage` puede crear hasta dos operadores responsables adicionales. Cada cuenta obtiene permisos de plataforma, una contrasena temporal mostrada una sola vez y debe cambiarla y configurar TOTP en el primer ingreso al Admin. Estas cuentas no son miembros internos del CRM.

## Auditoria del trabajo existente

- Se reutilizan `platform_iam.operator_memberships`, el cliente administrativo de Keycloak del `deploy-executor`, el patron durable de leases y la entrega efimera de credenciales ya usada por activaciones.
- El flujo `/team` permanece exclusivamente para usuarios internos del CRM.

## Alcance

- Contrato, API y persistencia de responsables de plataforma por perfil.
- Aprovisionamiento tipado mediante `deploy-executor` y Keycloak.
- Interfaz dentro del directorio de perfiles y entrega efimera del acceso inicial.
- Permisos completos de operador Quantum; maximo dos responsables adicionales por perfil.

## Criterios de aceptacion

- [ ] Crear y listar responsables desde el perfil en Quantum Admin.
- [ ] La cuenta puede iniciar sesion en Quantum Admin, cambiar la clave temporal y configurar TOTP.
- [ ] La cuenta creada puede crear y administrar perfiles CRM.
- [ ] La credencial temporal no se persiste ni se registra.
- [ ] Usuarios CRM y operadores Quantum permanecen separados.

## Plan de verificacion

- Pruebas focalizadas de contrato, repositorio, autorizacion, idempotencia y aprovisionador.
- Typecheck y builds afectados en el VPS.
- Migracion controlada, despliegue y recorrido autenticado en el VPS.

## Recuperacion

- Migracion aditiva y compatible.
- El rollback de aplicacion conserva asignaciones y membresias creadas.
