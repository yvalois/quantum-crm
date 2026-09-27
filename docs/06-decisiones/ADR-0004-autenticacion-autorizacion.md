# ADR 0004 Autenticacion y autorizacion

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-01, USR-01 a USR-11, CFG-14 y todos los casos de uso con acceso protegido

## Contexto

Quantum necesita autenticar operadores de plataforma, usuarios de cada CRM, servicios, automatizaciones y agentes. Los permisos no se limitan a secciones: tambien dependen del equipo, la asignacion, el canal, el pipeline, el calendario, el registro concreto y la operacion solicitada.

Keycloak ya fue elegido como proveedor de identidad y cada perfil usa un realm separado. Falta definir como se protegen las sesiones web y donde vive la autorizacion comercial para evitar tokens expuestos, roles rigidos o comprobaciones diferentes en cada interfaz.

## Decision

Keycloak administra identidad, credenciales, inicio de sesion, MFA y protocolos OIDC. Quantum administra membresias, equipos, roles, permisos, alcances y relaciones con recursos.

La autorizacion usa un modelo hibrido de roles y atributos: un permiso funcional habilita una accion y un alcance determina sobre cuales registros puede ejecutarse. Toda decision se aplica en el servidor y se deniega por defecto.

## Fuentes de verdad

| Responsabilidad | Fuente de verdad |
|---|---|
| Credenciales, factores MFA, sesion OIDC y bloqueo de autenticacion | Keycloak |
| Identidad externa | Claim `sub` dentro del issuer esperado |
| Membresia activa en el CRM o plataforma | Base de Quantum correspondiente |
| Equipos, roles, permisos y alcances comerciales | Modulo `iam` del CRM |
| Roles y permisos de operadores de Quantum | Modulo `platform-iam` |
| Asignacion, propiedad y acceso a recursos | Modulo propietario del recurso |

El correo, nombre y username son atributos modificables. No se utilizan como identificador de autorizacion. Una identidad autenticada solo obtiene acceso si existe una membresia activa para ese `sub` y perfil.

## Separacion de identidades

- La plataforma central y los CRM usan realms, clientes OIDC, audiencias y cookies separados.
- Una cuenta de administrador de CRM no implica acceso a la plataforma.
- Un token se acepta solo con firma, algoritmo, issuer, audience, expiracion y tipo esperados.
- La API rechaza tokens de otro perfil aunque el usuario exista en ambos.
- Las identidades humanas, de servicio, de agente y de automatizacion son tipos de principal distintos.
- No se comparte una cuenta humana para integraciones, workers o agentes.

## Sesion web

Las aplicaciones web usan un cliente OIDC confidencial y Authorization Code Flow con PKCE `S256`. El servidor realiza el intercambio del codigo y conserva access y refresh tokens fuera del JavaScript del navegador.

El navegador recibe solo un identificador opaco de sesion mediante una cookie:

- `HttpOnly` y `Secure` en entornos HTTPS.
- `SameSite=Lax` como base compatible con el retorno OIDC.
- Limitada al hostname, sin `Domain=.nip.io` ni dominios compartidos.
- Preferiblemente con prefijo `__Host-`, `Path=/` y sin atributo `Domain`.
- Renovada despues de autenticar, elevar privilegios o completar una recuperacion.

Los tokens no se guardan en `localStorage`, `sessionStorage`, URLs ni HTML. La perdida del almacen de sesiones puede cerrar sesiones, pero no puede perder operaciones comerciales.

Los flujos OIDC verifican `state`, `nonce`, PKCE, issuer y redirect URI exacta. No se habilitan Implicit Flow ni Resource Owner Password Credentials.

## CSRF, origen y tiempo real

- Las solicitudes que cambian estado requieren token CSRF o una defensa equivalente, ademas de la cookie `SameSite`.
- El servidor valida `Origin` en operaciones de navegador y no configura CORS abierto con credenciales.
- WebSocket y SSE autentican la sesion al conectar y vuelven a autorizar cada suscripcion o accion sensible.
- Un ticket temporal para tiempo real es de corta duracion, de un solo uso y ligado a sesion, perfil y audiencia.
- Cerrar sesion invalida la sesion de Quantum y solicita el cierre o revocacion aplicable en Keycloak.

## Sesiones y revocacion

- Los access tokens son de corta duracion y las sesiones tienen expiracion por inactividad y absoluta configuradas.
- Los refresh tokens permanecen en el servidor, se rotan cuando el proveedor lo permita y nunca se exponen al navegador.
- Desactivar una membresia bloquea el acceso en Quantum aunque la sesion de Keycloak siga vigente.
- Desactivar un usuario tambien revoca sus sesiones de aplicacion y se sincroniza con Keycloak cuando corresponda.
- Cambios en roles, equipos o accesos incrementan una revision de autorizacion e invalidan caches relacionados.
- Los fallos de Keycloak o del almacen de autorizacion cierran el acceso; no se reutilizan permisos desconocidos indefinidamente.

Los limites concretos de inactividad y duracion maxima se definen como configuracion de seguridad antes de produccion y no pueden ampliarse silenciosamente por perfil.

## Modelo de permisos

Los permisos CRM usan identificadores estables y tipados con forma `namespace:recurso:accion`, por ejemplo:

```text
iam:members:read
crm:contacts:read
crm:conversations:transfer
crm:documents:approve
crm:reports:export
crm:agents:configure
```

El catalogo de permisos se versiona con el codigo. Los nombres de rol nunca se usan directamente en condiciones comerciales.

Los roles `administrador`, `supervisor` y `asesor` son plantillas iniciales de permisos. Los roles personalizados combinan permisos existentes, pero no crean acciones arbitrarias que el servidor no conozca.

## Alcance sobre datos

Un permiso se combina con uno o varios limites:

- `all`: todos los registros permitidos dentro del perfil.
- `team`: registros accesibles para los equipos efectivos del principal.
- `assigned`: registros asignados al principal.
- `own`: registros creados o poseidos por el principal cuando esa relacion sea relevante.
- `explicit`: canales, bandejas, pipelines, calendarios u otros recursos seleccionados.

El significado de cada alcance lo define el modulo propietario. `own` no se supone equivalente a `assigned` y pertenecer a un equipo no otorga automaticamente todos sus recursos.

## Punto de aplicacion

Cada caso de uso recibe un `AuthContext` inmutable con principal, perfil, sesion o credencial, permisos, revision y correlation ID.

La autorizacion ocurre en dos niveles:

1. El caso de uso comprueba la accion solicitada.
2. El modulo propietario aplica el alcance en la consulta y verifica la relacion con el recurso antes de leer o modificar.

La interfaz puede ocultar acciones para mejorar la experiencia, pero nunca sustituye estos controles. Controladores, resolvers, consumidores y herramientas de agentes llaman los mismos casos de uso autorizados.

Una ausencia de autenticacion devuelve `401`; una identidad valida sin permiso devuelve `403`, salvo que revelar la existencia del recurso requiera una respuesta indistinguible de `404`.

## MFA y operaciones sensibles

- MFA es obligatorio para operadores de la plataforma central.
- Los realms de CRM permiten exigir MFA por politica y rol.
- WebAuthn es el metodo preferido cuando sea viable; TOTP y codigos de recuperacion controlados son alternativas.
- Cambiar credenciales, factores, permisos privilegiados, secretos o configuracion critica puede exigir autenticacion reciente o step-up.
- La recuperacion de acceso no omite MFA ni concede permisos adicionales.
- Invitaciones y acciones de recuperacion usan enlaces de un solo uso, expiracion corta y destino registrado.

## Servicios, automatizaciones y agentes

- Las comunicaciones maquina a maquina usan Client Credentials u otra identidad de carga verificable, no sesiones humanas.
- Cada integracion importante tiene su propio principal, alcance, vencimiento y mecanismo de rotacion.
- Se desactiva `Full Scope Allowed`; el token contiene solo las audiencias y scopes necesarios.
- Un agente LangGraph recibe permiso para herramientas concretas, no acceso directo a modulos, bases o secretos.
- Los argumentos de una herramienta nunca pueden seleccionar otro perfil ni aumentar el permiso del principal.
- Actuar en nombre de un usuario requiere delegacion explicita, conserva ambas identidades y se registra en auditoria.

## API keys y enlaces publicos

Si se incorporan API keys:

- Se generan con entropia criptografica.
- Se muestra el valor solo al crearlo y se almacena un hash verificable.
- Incluyen propietario, perfil, scopes, expiracion, ultima utilizacion y estado de revocacion.
- Se rotan sin exigir una interrupcion y nunca se aceptan en query strings.

Los enlaces publicos para formularios, documentos o aceptaciones usan tokens de capacidad separados de las sesiones. Cada token esta ligado a perfil, recurso, proposito, expiracion y estado de revocacion; su valor no se guarda en texto plano ni se registra en logs.

## Auditoria y proteccion contra abuso

- Se auditan inicios de sesion relevantes, fallos, bloqueos, cambios de permisos, MFA, sesiones revocadas y operaciones sensibles.
- La auditoria registra actor, tipo de principal, perfil, accion, objetivo, resultado y correlacion sin tokens ni secretos.
- Los endpoints de autenticacion, invitacion, recuperacion y validacion de credenciales aplican rate limiting.
- Los mensajes de error no confirman si un correo, usuario, API key o recurso existe.
- Las decisiones de autorizacion fallidas pueden generar eventos de seguridad sin copiar datos sensibles.

## Alternativas consideradas

### Guardar JWT en el navegador

Se rechaza porque JavaScript malicioso puede extraer tokens almacenados y reutilizarlos fuera de la sesion. Una sesion opaca server-side reduce esa exposicion.

### Implementar autenticacion y contraseñas en Quantum

Se rechaza porque duplica gestion de credenciales, MFA, recuperacion, bloqueo y protocolos que ya resuelve Keycloak.

### Administrar todos los permisos en Keycloak

Se rechaza porque los alcances comerciales dependen de asignaciones y recursos que pertenecen a los modulos del CRM. Sincronizarlos como roles del proveedor produciria dos modelos divergentes.

### Usar solo RBAC

Se rechaza porque un rol no expresa por si solo acceso a registros asignados, equipos, canales, pipelines o calendarios especificos.

### Incorporar inicialmente un motor externo de politicas

Se rechaza por la complejidad operativa y de depuracion inicial. La autorizacion se encapsula tras puertos y politicas tipadas para permitir sustituirla si la complejidad medida lo exige.

## Consecuencias positivas

- Los tokens OIDC no quedan expuestos al JavaScript de la aplicacion.
- Los roles personalizados no obligan a duplicar datos comerciales en Keycloak.
- Usuarios, servicios y agentes siguen el mismo modelo de minimo privilegio.
- Los permisos pueden probarse independientemente de la interfaz.
- La separacion entre perfiles y plataforma permanece verificable.

## Costos y riesgos

- El servidor debe administrar sesiones y su almacenamiento disponible.
- Cada consulta protegida necesita aplicar correctamente su alcance.
- Revocar permisos requiere invalidar caches y sesiones relacionadas.
- La combinacion de permisos, equipos y recursos exige pruebas de matriz y de denegacion.
- Una configuracion incorrecta de Keycloak puede impedir accesos o ampliar scopes; se versiona, revisa y prueba como infraestructura.

## Validacion

La decision se considera aplicada cuando pruebas automatizadas demuestran que:

- El flujo web usa Authorization Code con PKCE y no expone tokens al navegador.
- CSRF, redirect URI incorrecta, issuer incorrecto y audience incorrecta son rechazados.
- Un usuario sin permiso no puede ejecutar la accion mediante API, WebSocket, worker o herramienta de agente.
- Un asesor ve solo lo asignado, un supervisor lo permitido por sus equipos y un administrador lo autorizado por su rol.
- Cambiar un rol o desactivar una membresia invalida el acceso vigente dentro del limite acordado.
- Un token de CRM no accede a la plataforma ni a otro perfil.
- MFA es obligatorio para operadores de Quantum.
- Un principal de servicio o agente no puede ampliar sus scopes ni actuar como usuario sin delegacion.
- API keys y tokens publicos pueden expirar y revocarse sin almacenar sus valores en texto plano.
- La auditoria identifica decisiones sensibles sin registrar secretos.

## Referencias

- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/info/rfc9700/)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [Keycloak: OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers)
- [Keycloak: Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)

Se revisa esta decision si aparecen necesidades de federacion empresarial, autorizacion externa centralizada, delegacion entre organizaciones o requisitos regulatorios que cambien los factores y tiempos de sesion.
