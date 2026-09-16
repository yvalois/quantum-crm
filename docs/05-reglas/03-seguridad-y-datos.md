# Seguridad y datos

## Aislamiento por cliente

- El `tenant_id` se deriva de una identidad autenticada o contexto confiable, nunca de un valor aceptado sin verificacion.
- Cada acceso a datos, archivos, cache, cola y herramienta del agente conserva el alcance del cliente.
- Las pruebas de aislamiento usan al menos dos clientes y verifican lectura y escritura.
- La administracion central y los administradores de cada CRM tienen identidades y permisos separados.

## Autorizacion

- Autenticacion confirma identidad; autorizacion decide la accion concreta sobre el recurso concreto.
- El servidor comprueba permisos aunque la interfaz o el agente oculten la accion.
- El principio es minimo privilegio para usuarios, servicios, bases, CI y ejecutores.
- Acciones sensibles generan auditoria con actor, objetivo, resultado y correlacion, sin secretos.

## Secretos y privacidad

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
