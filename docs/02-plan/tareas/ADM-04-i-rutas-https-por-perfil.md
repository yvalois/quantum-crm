# ADM-04-i - Configurar rutas HTTPS por perfil

> Ficha derivada para completar `CONFIGURE_HTTPS` del aprovisionamiento. No sustituye el alcance, el estado ni la definición de terminado.

## Identificación

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-06`, `ADM-17`, `OPS-05`, `OPS-06`, `OPS-14` y `OPS-15`
- Fase del MVP: Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-04-h` integrado y validado; hostname reservado, red de borde del perfil, Caddy persistente y release candidata disponibles.
- Bloquea a: `CREATE_ADMINISTRATOR`, `VERIFY` y `ACTIVATE` de `ADM-04`.
- ADR, arquitectura o diseño aplicables: [`ADR-0019`](../../06-decisiones/ADR-0019-rutas-https-por-perfil.md), `ADR-0003`, `ADR-0004`, `ADR-0008`, `ADR-0009`, `ADR-0018`, `monorepo.md`, `mapa-del-sistema.md` y `despliegues.md`.

## Resultado esperado

El ejecutor registra o reconcilia de forma idempotente el hostname nip.io del perfil en el borde Caddy, con upstreams y red derivados del UUID. La configuración se valida y sustituye atómicamente; Caddy permanece privado para el adaptador y solo se avanza cuando la generación observada coincide. La emisión del certificado y el acceso externo quedan pendientes de `VERIFY` hasta comprobarse fuera del VPS.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`, `docs/02-plan/trabajo.md` y `docs/03-operaciones/despliegues.md` (`OPS-05`, `OPS-14`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `CONFIGURE_HTTPS`, `Caddyfile`, `edge.yaml`, `deploy-host`, `START_CONTAINERS`, `OPS-05`, `OPS-14` y modelos de hostname.
- Código y documentación encontrados: Caddy publica hosts estáticos y el runner de perfil crea una red de borde derivada, pero el ejecutor no tiene handler HTTPS ni existe persistencia de rutas por perfil.
- Pruebas e historial encontrados: PR #18 y PR #19 integraron el runner y sus pruebas; no hay evidencia de certificado, ruta dinámica ni validación externa.
- Decisión de reutilización, extensión o reemplazo: extender el transporte Unix y el inventario de plataforma con un adaptador allowlisted; no editar Caddyfile por shell ni crear un segundo sistema de proxy.

## Alcance

### Incluido

- Contrato versionado para reconciliar hostname, red, upstreams, generación e idempotencia.
- Persistencia de hostname y generación observada por perfil.
- Adaptador privado que genera, valida, aplica y comprueba la configuración Caddy de forma atómica.
- Políticas de TLS, WebSocket/SSE, timeouts, cookies por hostname y rollback de ruta.
- Pruebas de permisos, aislamiento, concurrencia, configuración inválida y recuperación.

### No incluido

- Dominio propio, wildcard, proveedor DNS externo o gateway comercial.
- Creación del administrador del cliente, migraciones comerciales, activación o rollback de datos.
- Exposición de la API administrativa de Caddy, Docker socket o shell al ejecutor.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `deploy-executor`, `deploy-host`, `tenants`, `deployments` y `admin-api` |
| Contratos y eventos | Acción tipada de ruta, generación observada, errores RFC 9457 y auditoría |
| Datos y migraciones | Hostname único, route generation, upstream/slot observado y estado de reconciliación |
| Permisos y aislamiento | Perfil derivado de identidad; solo upstreams y redes allowlisted |
| Configuración y secretos | Reutiliza almacenamiento persistente de Caddy; nunca persiste certificados en Git o logs |
| Observabilidad y operación | Métricas de reconciliación, emisión, recarga, resolución y validación externa |
| Documentación | ADR, mapa, runbook de HTTPS, ficha y estado |

## Plan de implementación

- [x] Añadir contrato y validadores de hostname, upstream, red, generación e idempotency key.
- [ ] Persistir la ruta deseada y la observada con fencing por perfil.
- [ ] Implementar el adaptador privado de Caddy con snapshot, validación, reemplazo atómico y rollback.
- [ ] Conectar `CONFIGURE_HTTPS` al ejecutor sin entregar Docker socket ni shell.
- [ ] Probar configuración, concurrencia, aislamiento, recarga y recuperación en VPS autorizado.
- [ ] Completar `VERIFY` con DNS, firewall, certificado, HTTPS, WebSocket/SSE, cookies, autenticación y aislamiento.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Hostname o directiva inyectada | Schema cerrado y generación desde identidad registrada | Entradas arbitrarias rechazadas antes de Caddy |
| Una ruta apunta a otro perfil | Red y upstream derivados del UUID y allowlist de servicios | Prueba cruzada A/B |
| Recarga deja el borde inconsistente | Snapshot completo, validación previa y reemplazo atómico | Snapshot inválido conserva generación anterior |
| ACME o DNS no termina | `CONFIGURED` separado de `VERIFIED` y `ACTIVE` | Resolución y HTTPS externos medidos |

## Criterios de aceptación

- [ ] Solo se registra el hostname reservado y validado del perfil.
- [ ] Ningún upstream, puerto, red o directiva llega libremente desde la petición.
- [ ] Repetir o concurrir no duplica rutas ni cambia otro perfil.
- [ ] Una configuración inválida no elimina la ruta activa.
- [ ] `VERIFY` confirma certificado, HTTPS, cookies, autenticación, aislamiento y streaming antes de `ACTIVATE`.

## Plan de verificación

- Pruebas unitarias: hostname, esquema, derivación, allowlist, generación y errores.
- Pruebas de integración o contratos: transporte Unix, adaptador Caddy, configuración atómica y persistencia.
- Pruebas E2E: hostname nip.io real del perfil piloto desde fuera del VPS.
- Comprobación manual: DNS, firewall, certificado, redirección, WebSocket/SSE y logs redactados.
- Seguridad, permisos y aislamiento: sin Docker socket, sin shell, sin acceso cruzado y cookies limitadas al host.
- Idempotencia, concurrencia y recuperación: leases, generación, recarga fallida y reconstrucción desde inventario.
- Comandos que deben aprobar: puertas CI y verificaciones afectadas en VPS según `15-ejecucion-verificaciones-vps.md`.

## Recuperación

- Compatibilidad o migración: migración aditiva; un ejecutor anterior deja `CONFIGURE_HTTPS` pendiente.
- Rollback de aplicación: restaurar la generación anterior de Caddy sin modificar datos del perfil.
- Recuperación de datos, si aplica: restaurar inventario y almacenamiento persistente de Caddy mediante el procedimiento de `ADR-0015`; no confundirlo con rollback de ruta.

## Evidencia de cierre

- Archivos, commits o PR: contrato y validadores en la rama `feat/ADM-04-i-route-contract`; PR pendiente de apertura.
- Comandos y resultados: la auditoría documental confirma que no existe todavía una ruta HTTPS dinámica ni evidencia de certificado externo.
- Documentación actualizada: ADR-0019, esta ficha y estado del proyecto.
- Desviaciones del plan: ninguna; el bloque se separa de `ADM-04-h` porque requiere una decisión estructural y pruebas externas.
- Pendientes o decisiones nuevas: implementar el contrato y adaptador; después completar `CREATE_ADMINISTRATOR`, `VERIFY` y `ACTIVATE`.
