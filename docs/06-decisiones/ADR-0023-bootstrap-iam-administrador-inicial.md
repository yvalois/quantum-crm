# ADR 0023 Bootstrap IAM del administrador inicial

- Estado: aceptado
- Fecha: 2026-09-26
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, USR-01, USR-03, OPS-04 y PROY-024

## Contexto

ADR-0022 verifica que el administrador inicial completó contraseña y TOTP, pero `deploy-executor` no puede escribir las tablas comerciales de IAM. El perfil no puede activarse hasta crear su primera membresía de CRM mediante el caso de uso público de `iam`. Esa llamada debe seguir siendo imposible para navegadores, operadores humanos, otros perfiles o procesos que no sean el ejecutor del perfil.

## Decisión

1. Cada realm de perfil tiene un cliente confidencial de servicio `quantum-crm-bootstrap`, con audiencia exclusiva `quantum-crm-api` y permiso único `iam:bootstrap-initial-administrator`. Su secreto se crea o reconcilia como archivo privado de perfil y solo se monta en `deploy-executor`; no llega a `admin-api`, CRM, frontend ni resultado durable.
2. La API del perfil expone un comando público estrecho, solo por su red privada: crea o reconcilia exclusivamente la primera membresía `ADMINISTRATOR` para el `subject` de Keycloak confirmado por `VERIFY`. El perfil, rol, correo, realm y permisos no entran libres por HTTP. Una vez existe una membresía distinta, el comando queda cerrado; reintentar el mismo subject es idempotente.
3. `deploy-executor` obtiene por client credentials un token del realm derivado, llama el endpoint interno exacto del API del mismo perfil y conserva el resultado saneado. `ACTIVATE` solo avanza cuando ese comando devuelve éxito idempotente bajo el lease y fencing de la operación.

## Alternativas consideradas

### Escritura directa del ejecutor en IAM

Rechazada: rompe la propiedad exclusiva de `iam`, salta validación, auditoría y contratos públicos.

### Reutilizar una sesión de operador o CRM

Rechazada: mezcla principal humano y servicio, expone tokens y permitiría que el navegador determine el bootstrap.

### Cliente de servicio compartido entre perfiles

Rechazada: una credencial podría crear administradores en otro perfil y no cumple el aislamiento por credenciales.

## Consecuencias

- El provisionador de identidad reconcilia un cliente adicional y su secreto privado por perfil.
- API e IAM implementan una sola operación bootstrap con validación, auditoría, idempotencia y denegación por defecto.
- El ejecutor necesita el endpoint interno derivado del perfil, timeout y llamada con token de servicio, pero no obtiene acceso SQL ni tokens humanos.

## Validación

- El token bootstrap A falla contra API B; tokens humanos, CRM y sin audiencia/permiso se deniegan.
- El comando crea una sola membresía administrador del subject verificado y repite el mismo resultado ante reintento.
- Un segundo subject, rol, perfil o llamada posterior a la primera membresía se rechaza.
- El secreto, access token y enlace de activación no aparecen en contratos, logs, resultados durables ni frontend.
