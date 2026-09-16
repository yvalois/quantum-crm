# Seguridad y datos

## Aislamiento por cliente

- Aplicar `docs/06-decisiones/ADR-0003-aislamiento-multi-tenant.md` a todo recurso nuevo.
- El `tenant_id` se deriva de una identidad autenticada o contexto confiable, nunca de un valor aceptado sin verificacion.
- El `tenant_id` es un UUID inmutable; slugs, nombres y hostnames no son identificadores de seguridad.
- Cada cliente tiene base, rol, realm de Keycloak, configuracion y secretos propios.
- Cada acceso a datos, archivos, cache, cola y herramienta del agente conserva el alcance del cliente.
- Un token emitido para un perfil se rechaza en cualquier otro perfil.
- Si se comparte infraestructura, sus ACL, credenciales y namespaces se separan por perfil; un prefijo por si solo no es una barrera de seguridad.
- Las pruebas de aislamiento usan al menos dos clientes y verifican lectura y escritura.
- La administracion central y los administradores de cada CRM tienen identidades y permisos separados.
- La administracion central no consulta directamente tablas comerciales y sus operaciones indican y autorizan el perfil objetivo.

## Autorizacion

- Aplicar `docs/06-decisiones/ADR-0004-autenticacion-autorizacion.md` a identidades, sesiones y permisos.
- Autenticacion confirma identidad; autorizacion decide la accion concreta sobre el recurso concreto.
- Keycloak autentica; Quantum conserva membresias, roles, permisos y alcances comerciales.
- Los clientes web usan Authorization Code con PKCE y sesiones opacas server-side; no exponen tokens OIDC a JavaScript.
- Las cookies de sesion son `HttpOnly`, `Secure`, `SameSite`, host-only y se acompañan de proteccion CSRF.
- Los permisos siguen `recurso:accion` y se combinan con alcance `all`, `team`, `assigned`, `own` o `explicit`.
- El servidor comprueba permisos aunque la interfaz o el agente oculten la accion.
- Cada caso de uso deniega por defecto y verifica accion, alcance y relacion con el recurso.
- El principio es minimo privilegio para usuarios, servicios, bases, CI y ejecutores.
- MFA es obligatorio para operadores de la plataforma y se permite exigir autenticacion reciente en acciones sensibles.
- Cambios de permisos y desactivaciones invalidan caches y sesiones relacionadas.
- Acciones sensibles generan auditoria con actor, objetivo, resultado y correlacion, sin secretos.

## Secretos y privacidad

- Aplicar `docs/06-decisiones/ADR-0008-entornos-configuracion-secretos.md` y `docs/05-reglas/08-entornos-configuracion-secretos.md` a todo proceso, entorno y perfil.
- Los secretos se inyectan mediante un mecanismo gestionado y se referencian sin mostrarlos.
- Nunca se registran tokens, contraseñas, claves, cuerpos completos sensibles ni URLs firmadas reutilizables.
- Datos de prueba son sinteticos o anonimizados.
- Archivos se validan por tamaño, tipo permitido, contenido y autorizacion de descarga.
- Se definen retencion, eliminacion, exportacion y respaldo antes de usar datos reales.

## Entradas y salidas

- Validar esquema, longitud, formato y valores permitidos.
- Parametrizar consultas y escapar la salida segun su contexto.
- Webhooks verifican autenticidad, antiguedad y deduplicacion antes de producir efectos.
- Redirecciones, callbacks y URLs externas usan destinos permitidos.
- Los mensajes de error para usuarios no exponen internals; los logs conservan contexto seguro para diagnostico.

## Operaciones criticas

- Pagos, reservas, inventario, mensajes y despliegues usan claves de idempotencia o restricciones equivalentes.
- Cambios destructivos requieren respaldo, alcance exacto y procedimiento de recuperacion.
- Dependencias y contenedores se fijan a versiones revisables; las actualizaciones pasan por CI.
