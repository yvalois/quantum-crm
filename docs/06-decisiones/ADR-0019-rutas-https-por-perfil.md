# ADR 0019 Rutas HTTPS por perfil

- Estado: aceptado
- Fecha: 2026-09-22
- Responsables: propietario del proyecto
- Requisitos relacionados: `ADM-04`, `ADM-06`, `ADM-17`, `OPS-05`, `OPS-06`, `OPS-14` y `OPS-15`

## Contexto

`START_CONTAINERS` ya reconcilia los cinco servicios privados de un perfil, pero el flujo de alta todavía no puede completar `CONFIGURE_HTTPS`. Caddy publica la administración y los sitios estáticos existentes; no existe un contrato para registrar el hostname de un perfil, dirigirlo a su red privada, solicitar el certificado ni cambiar tráfico de forma auditable.

La solución debe conservar el aislamiento por perfil, evitar que datos de usuario se conviertan en directivas Caddy, tolerar reintentos y no entregar el socket Docker ni un shell al `deploy-executor`. La ruta debe poder cambiarse o retirarse sin editar manualmente el Caddyfile ni interrumpir las rutas de otros perfiles.

## Decisión

Quantum usará un adaptador de borde privado y tipado, propiedad de `deploy-host`, para reconciliar las rutas HTTPS por perfil. El ejecutor solicitará una operación cerrada con `tenantId`, hostname canónico, release/slot, red de borde derivada del UUID, upstreams allowlisted, generación e idempotency key. No aceptará Caddyfile, JSON de configuración, hostname, upstream, ruta, puerto ni comando arbitrario.

El adaptador mantendrá una configuración declarativa generada a partir del inventario de plataforma y de observaciones verificadas. Cada perfil tendrá un bloque independiente con:

- hostname validado y único, sin comodines ni dominios compartidos;
- upstreams únicamente de servicios publicados por la plantilla del perfil y de la red de borde derivada;
- políticas de WebSocket/SSE y timeouts aprobadas para el CRM;
- TLS automático de Caddy con almacenamiento persistente ya montado en `edge`;
- metadatos de generación, operación y resultado, sin secretos ni query strings.

La reconciliación escribirá un snapshot temporal, validará el conjunto completo y hará un reemplazo atómico seguido de una recarga controlada. La configuración anterior permanecerá disponible para rollback de la ruta. El adaptador comprobará después la configuración cargada y la salud de Caddy; la emisión ACME y la resolución pública se verifican desde fuera del VPS como parte de `VERIFY`, no se infieren por una recarga exitosa.

El canal entre `deploy-executor` y el adaptador seguirá siendo el transporte Unix privado existente. El acceso administrativo de Caddy permanecerá en una red privada y solo el adaptador podrá usarlo. `deploy-executor` nunca recibirá Docker socket, credenciales ACME ni acceso directo a Caddy. El cambio de tráfico de una actualización será otra operación tipada y solo podrá ejecutarse después de readiness.

Para el VPS piloto, Caddy conserva su endpoint administrativo exclusivamente en `127.0.0.1` dentro del contenedor. `deploy-host` identifica el único contenedor de borde por las etiquetas fijas del proyecto `quantum-edge`, conecta la red derivada del perfil y ejecuta únicamente `caddy validate` y `caddy reload` con el `Caddyfile` fijo. Cada servicio de borde del perfil recibe un alias DNS derivado del UUID, de modo que Caddy nunca resuelve un nombre genérico compartido como `api` o `crm-web` entre perfiles.

## Alternativas consideradas

- Editar el `Caddyfile` mediante SSH o shell: se rechaza porque permite inyección de directivas, rompe la trazabilidad y mezcla operación manual con el flujo durable.
- Exponer la API administrativa de Caddy al `deploy-executor`: se rechaza porque amplía la frontera de privilegios y permite manipular rutas fuera del perfil.
- Crear un Caddy por perfil: se rechaza en el VPS piloto por consumo y porque multiplica certificados, almacenamiento y superficies de actualización.
- Usar etiquetas Docker o descubrimiento automático: se difiere; no demuestra autorización por perfil ni ofrece el inventario declarativo y el rollback requerido.
- Enrutar todos los perfiles a un gateway comercial externo: se rechaza para el MVP porque añade proveedor y coste fuera del VPS.

## Consecuencias

- Las rutas, certificados y cambios de tráfico quedan dentro del flujo de operaciones tipadas, con idempotencia y auditoría.
- Un error de un perfil no puede modificar la ruta de otro ni publicar un servicio no allowlisted.
- Se debe implementar un almacén durable de hostname/route generation, el adaptador de borde y la validación HTTPS externa antes de cerrar `ADM-04`.
- La configuración persistente de Caddy debe respaldarse junto con el inventario y poder reconstruirse desde él; una copia temporal no cuenta como recuperación.
- La emisión ACME sigue dependiendo de DNS, firewall y límites del emisor. Un estado `CONFIGURED` no equivale a `ACTIVE`.

## Validación

La decisión se considerará aplicada cuando:

- una solicitud con directiva, hostname, upstream, puerto o perfil no derivados sea rechazada antes de tocar Caddy;
- dos reconciliaciones del mismo perfil sean idempotentes y dos perfiles concurrentes no compartan configuración;
- un snapshot inválido conserve la configuración anterior y no interrumpa las rutas existentes;
- Caddy recargue el conjunto generado y el adaptador confirme su generación observada;
- desde una red externa, el hostname resuelva a la IP prevista, entregue un certificado válido, redirija HTTP a HTTPS y conserve WebSocket/SSE;
- `VERIFY` pruebe autenticación, aislamiento, health, trabajos y callbacks con el hostname exacto antes de `ACTIVATE`.

La decisión se revisará al adoptar dominios propios, varios VPS o un gateway de borde distinto.
