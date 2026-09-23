# ADR 0021 Identidad OIDC y sesiones por perfil

- Estado: aceptado
- Fecha: 2026-09-22
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, USR-01, USR-03, OPS-04, OPS-23 y PROY-023

## Contexto

Cada perfil requiere un realm Keycloak, un cliente confidencial para `crm-web`, una audiencia exclusiva de API y credenciales de sesión que no puedan acceder a otro perfil. El CRM no puede recibir una credencial administrativa de Keycloak ni seleccionar libremente su realm, issuer, cliente o Redis. El aprovisionamiento ya es durable y cercado por operación, pero el paso `CREATE_ADMINISTRATOR` aún no materializa identidad.

Crear un usuario inicial tampoco basta: sin una entrega autenticada y de un solo uso de su activación, una contraseña temporal o enlace se filtraría a logs, resultados de operación, base de plataforma o Git, o bien el usuario quedaría sin manera de entrar.

## Decisión

1. `deploy-executor` será el único consumidor de una credencial administrativa de Keycloak, montada por archivo y limitada al adaptador tipado de identidad. `admin-api`, `crm-web`, `api`, workers y agentes no reciben esa credencial ni llaman la API administrativa.
2. El realm se deriva únicamente del UUID inmutable: `qcrm-<uuid-sin-guiones>`. Su issuer, audiencia `quantum-crm-api`, cliente `quantum-crm-web`, redirects y Web Origins se derivan del hostname reservado y la configuración confiable del perfil; no entran por HTTP ni por el manifiesto comercial.
3. El adaptador reconcilia realm, cliente, mappers de audiencia/principal humano, PKCE S256, sesiones, política de contraseña, TOTP y acciones obligatorias. Repetir una operación observa primero el recurso esperado; una diferencia de identidad o configuración es un conflicto tipado, no una sustitución silenciosa.
4. El secreto de cliente OIDC y una credencial Redis ACL propia de cada perfil se crean o reconcilian como archivos privados de perfil. Solo `crm-web` recibe ambos archivos exactos; `api` recibe issuer y audiencia públicos, nunca el secreto del cliente ni Redis. Un prefijo Redis no sustituye credenciales separadas.
5. El usuario administrador inicial se crea con acciones obligatorias de contraseña y TOTP, pero `CREATE_ADMINISTRATOR` no se confirma hasta que exista una operación separada, autorizada y auditada para entregar una activación de un solo uso. Esa operación obtiene o genera el enlace directamente desde el adaptador y lo entrega solo a un operador autenticado; no persiste el enlace ni una contraseña en PostgreSQL, logs o resultados de aprovisionamiento.
6. La operación durable conserva solamente referencias, realm, cliente, subject del administrador cuando exista, revisión y resultado saneado. Sus transiciones siguen lease, fencing e idempotencia de `ADM-04`; una respuesta externa incierta se reconcilia antes de repetir.

## Alternativas consideradas

### Compartir el realm de plataforma

Rechazada: cruza operadores centrales y usuarios comerciales, mezcla audiencias, sesiones, políticas y ciclo de vida.

### Entregar una contraseña temporal en el resultado de provisión

Rechazada: los resultados viajan por API, auditoría, bases y logs; no son un almacén de secretos ni una entrega de credenciales.

### Permitir que CRM administre Keycloak directamente

Rechazada: amplía el privilegio del plano comercial y permitiría que un usuario CRM cree realms, clientes o identidades de otros perfiles.

### Confiar solo en namespaces Redis

Rechazada: el aislamiento requiere ACL y credenciales por perfil; un prefijo protege contra errores de código, no contra el uso de una credencial compartida.

## Consecuencias

- `ADM-04-j` añade puertos internos, configuración del ejecutor, referencias de secretos por perfil y pruebas de reconciliación.
- La plantilla de perfil recibe únicamente las variables y secretos exactos necesarios por proceso.
- La activación visible del primer administrador se implementa como la siguiente rebanada tipada; hasta entonces no se declara `USR-01` funcional ni se activa un perfil.
- Rotación, eliminación de realm y restauración requieren operaciones explícitas; un rollback de aplicación no revierte identidad.

## Validación

- Dos perfiles generan realms, clientes, secretos Redis y cookies incompatibles entre sí.
- Reintentos y dos workers producen una sola identidad derivada por perfil y detectan divergencias.
- Ningún token, secreto de cliente, URL de activación o contraseña aparece en contratos, logs, errores, filas de plataforma o manifiestos.
- Un token de un realm o audiencia no pasa el verificador de otro perfil; el CRM no puede usar la API administrativa de Keycloak.
