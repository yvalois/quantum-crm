# ADR 0022 Entrega interna de activacion inicial

- Estado: aceptado
- Fecha: 2026-09-26
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, USR-01, USR-03, OPS-04 y PROY-024

## Contexto

ADR-0021 exige crear al administrador inicial con contrasena y TOTP obligatorios, pero prohibe almacenar o exponer una contrasena o enlace de activacion en PostgreSQL, logs, contratos o resultados de aprovisionamiento. La API administrativa de Keycloak puede enviar una accion por correo, pero no devuelve el enlace para una entrega autenticada al operador. El proyecto debe funcionar inicialmente solo dentro del VPS; SMTP se integrara despues como otro canal de entrega.

## Decision

1. Se incorpora un proveedor interno de Keycloak, empaquetado en la imagen de identidad y sin puerto publico propio. Usa el SPI soportado de Keycloak para emitir y consumir su accion nativa, de un solo uso y con vencimiento, de configuracion de contrasena y TOTP. El proveedor es una excepcion limitada al TypeScript de Quantum: se escribe en el lenguaje requerido por el SPI de Keycloak y no contiene dominio, contratos comerciales ni acceso a bases de Quantum.
2. `CREATE_ADMINISTRATOR` conserva su operacion durable, idempotente y saneada: `deploy-executor` crea o reconcilia el usuario y sus acciones requeridas por la API administrativa, pero nunca genera ni guarda un enlace. Una intencion de entrega separada conserva actor, perfil, subject, generacion, vencimiento, correlacion e idempotencia, sin URL, token ni contrasena.
3. El operador autenticado solicita la entrega desde `admin-web`. `admin-api` autoriza `deployments:activate`, registra la intencion saneada y mantiene solo en memoria un espera asociada a esa conexion, operador, perfil y generacion. `deploy-executor` reclama la intencion y es el unico consumidor del endpoint interno del proveedor; este acepta solamente el principal de servicio `quantum-provisioner`, el realm derivado y entradas tipadas. No acepta hostname, usuario, redirect o realm libre.
4. El enlace vuelve de `deploy-executor` a `admin-api` por callback privado autenticado y solo se retransmite por la respuesta HTTP original si coincide con la espera efimera. La respuesta usa `Cache-Control: no-store` y `Referrer-Policy: no-referrer`. El callback obtiene solo acuse, nunca el enlace. Si se corta la conexion, se reinicia un proceso o falta esa espera, el enlace se descarta y se exige una reemision autorizada; no se escribe en PostgreSQL, Redis, archivos, logs, trazas, errores ni resultados durables.
5. El proveedor invalida la generacion anterior antes de emitir otra. Cada enlace vence a los 30 minutos y conserva solamente hash/JTI, generacion, estado y vencimiento en el almacenamiento propio de Keycloak. Confirma el consumo antes de permitir `VERIFY` y `ACTIVATE`. La auditoria registra actor, perfil, administrador, correlacion y resultado, nunca el enlace ni sus claims. El ejecutor crea o activa la membresia CRM mediante un comando publico y estrecho de `iam`, no escribiendo sus tablas directamente.
6. La frontera de entrega se expresa como un puerto tipado. La implementacion inicial es `operator-display`; una futura implementacion SMTP recibira el enlace efimero en vuelo y no cambiara la creacion, autorizacion, invalidacion ni auditoria.

## Alternativas consideradas

### SMTP inmediato

Rechazada para este incremento: requiere proveedor, credenciales y operacion externos que aun no estan definidos. Se conserva como adaptador posterior del mismo puerto.

### Contrasena temporal o URL en resultado de aprovisionamiento

Rechazada: resultados y auditorias son durables y podrian filtrarse por API, base de datos o logs.

### Servicio TypeScript que fabrique un token Keycloak

Rechazada: la firma, el almacenamiento de un solo uso y el consumo de acciones pertenecen a Keycloak; reproducirlos fuera del servidor evita sus garantias y requiere acceder a material criptografico que Quantum no debe poseer.

### Exponer el proveedor directamente al navegador

Rechazada: permitiria que una sesion comercial o una entrada no autenticada solicite activaciones y ampliaria la superficie de identidad.

## Consecuencias

- Se entrega una activacion visible sin datos externos ni un bypass manual, y SMTP se puede anadir sin redisenar el flujo.
- Se deben versionar, escanear y desplegar por digest tanto el proveedor de Keycloak como la imagen de identidad; sus configuraciones y credenciales de servicio entran por archivos privados.
- `admin-api` y `deploy-executor` necesitan un contrato interno acotado, autenticado y con timeout; ninguno persiste el material de activacion. Caddy bloquea la ruta del proveedor en el host publico de identidad.
- El reinicio del ejecutor o de la solicitud puede impedir una entrega, pero no deja un secreto recuperable: se reconcilia la identidad y se emite una activacion nueva mediante una solicitud autorizada.

## Validacion

- Un operador autorizado recibe una URL solo por la respuesta inmediata; busquedas en respuestas durables, PostgreSQL, Redis, logs y trazas no contienen el canario de activacion.
- Un operador no autorizado, una sesion CRM, otro perfil y una llamada directa al proveedor son denegados.
- Dos solicitudes, reintentos y dos workers dejan como maximo una activacion vigente; el primer consumo funciona y el segundo se rechaza.
- El usuario no puede iniciar sesion hasta completar contrasena y TOTP; `VERIFY` y `ACTIVATE` permanecen bloqueados si falta consumo confirmado.
- La futura entrega SMTP ejecuta los mismos escenarios de autorizacion, invalidez y ausencia de persistencia del enlace.
