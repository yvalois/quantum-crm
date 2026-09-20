# ADM-01-h - Acceso administrativo completo y E2E

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-05`, `OPS-06`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a` a `ADM-01-g`, ADR-0004, ADR-0008, ADR-0009 y ADR-0014
- Bloquea a: cierre de `ADM-01` y uso real de la plataforma administrativa
- ADR, arquitectura o diseno aplicables: autenticacion, tres frontends, secretos, despliegue, Caddy y monorepo

## Resultado esperado

Un operador inicial de Quantum puede acceder por HTTPS a `admin.2-25-172-119.nip.io`, autenticarse en el realm exclusivo `quantum-platform`, completar MFA TOTP y llegar al panel mediante una sesion opaca. `admin-api` reconoce exclusivamente su membresia activa y permisos de plataforma. Caddy reemplaza a Nginx como frontera HTTPS sin perder los dos sitios existentes, con una recuperacion comprobable.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y fichas `ADM-01-a` a `ADM-01-g`.
- [x] Reglas de seguridad, pruebas, secretos, Git, despliegue y releases.
- [x] ADR de autenticacion, entornos, releases y frontends; arquitectura y operacion del VPS.
- [x] Documentacion oficial vigente de Caddy, Keycloak y Playwright.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, operador, MFA, TOTP, Keycloak, sesion, proxy, E2E, Caddy, Nginx, nip.io, puertos, certificados y Compose.
- Codigo o documentacion encontrados: realm con flujo password/OTP y ACR 2; BFF OIDC con PKCE y sesion Redis; guardas de `admin-api`; proxy same-origin; renovacion; fundacion persistente. `admin-web` y `admin-api` aun no estan desplegados.
- Pruebas e historial encontrados: Keycloak, Redis, PostgreSQL, contratos y builds reales ya aprobados; falta el recorrido de navegador contra los servicios persistentes.
- Estado del VPS: Nginx y Certbot ocupan 80/443 para `2-25-172-119.nip.io` y `mr-business.2-25-172-119.nip.io`; Caddy esta inactivo; la fundacion Quantum esta saludable y sin puertos publicos.
- Decision de reutilizacion, extension o reemplazo: reutilizar todos los componentes de autenticacion; agregar aprovisionamiento reanudable del operador, despliegue por digest y E2E. Migrar atomicamente los cuatro hosts a Caddy, preservando archivos y configuracion anterior para rollback, en vez de introducir una excepcion permanente con Nginx.

## Alcance

### Incluido

- Aprovisionamiento reanudable y secreto del operador inicial, membresia activa y permisos cerrados.
- Imagenes y despliegue por digest de `admin-web` y `admin-api`.
- Caddy persistente con los dos sitios existentes, administrador e identidad, HTTPS automatico y headers seguros.
- Migracion de ingreso con validacion previa, comprobaciones externas y recuperacion a Nginx.
- E2E de password, enrolamiento TOTP, callback, sesion, API autorizada, logout y denegaciones.
- Estado final del operador preparado para enrolamiento humano, sin conservar semilla TOTP de la prueba.

### No incluido

- Funciones administrativas posteriores a `ADM-01`.
- Completar todo `OPS-05` para hosts de clientes, WebSocket/SSE o alertas de renovacion.
- Dominio propio, correo transaccional o recuperacion de cuenta.
- Sustituir el futuro flujo tipado de `deploy-executor` para cambios posteriores.

## Impacto tecnico

| Area                       | Impacto previsto                                                          |
| -------------------------- | ------------------------------------------------------------------------- |
| Aplicaciones y modulos     | Despliegue real de `admin-web` y `admin-api`; sin dominio comercial nuevo |
| Contratos y eventos        | Reutiliza contratos y endpoints existentes                                |
| Datos y migraciones        | Membresia/permiso del operador; sin nueva migracion de schema             |
| Permisos y aislamiento     | Realm, usuario, audience y membresia exclusivos de plataforma             |
| Configuracion y secretos   | Password inicial y credenciales solo por archivos externos                |
| Observabilidad y operacion | Caddy, healthchecks, rollback Nginx y evidencia E2E redactada             |
| Documentacion              | Ingreso, operador, procedimiento, inventario, estado y cierre de `ADM-01` |

## Plan de implementacion

- [ ] Declarar Caddy, configuracion de hosts, volumenes y procedimiento reversible de migracion.
- [ ] Implementar aprovisionamiento reanudable del operador sin secretos en argumentos o logs.
- [ ] Construir y desplegar `admin-web` y `admin-api` por digest en las redes autorizadas.
- [ ] Validar Caddy en paralelo, migrar 80/443 y comprobar los dos sitios existentes.
- [ ] Ejecutar E2E completo con MFA y matriz negativa; retirar credenciales OTP de prueba.
- [ ] Ejecutar CI, registrar evidencia y actualizar solo las casillas realmente satisfechas.

## Riesgos y mitigaciones

| Riesgo                                 | Mitigacion                                                                 | Verificacion                                       |
| -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Interrumpir sitios existentes          | Caddy probado antes, mismos roots, backup Nginx y rollback atomico         | Hash/contenido, HTTPS y health de los cuatro hosts |
| Bloquear 80/443 sin certificado        | DNS previo, almacenamiento Caddy persistente y rollback si readiness falla | TLS externo y redireccion HTTP                     |
| Exponer password, tokens o semilla OTP | Archivos `0400`, tmpfs, redaccion y borrado de semilla tras la prueba      | Escaneo de Git, procesos, logs y artefactos        |
| Aceptar operador sin MFA o membresia   | ACR 2 en Keycloak/API y membresia activa cerrada                           | E2E positivo y negativos                           |
| Repetir aprovisionamiento duplica      | Busqueda estable, operaciones idempotentes y restricciones unicas          | Dos ejecuciones y conteos invariantes              |
| E2E intermitente                       | Esperas por estado/URL/response, un worker y artefactos solo al fallar     | Segunda ejecucion limpia                           |

## Criterios de aceptacion

- [ ] Los cuatro hosts responden por HTTPS con certificados validos y HTTP redirige a HTTPS.
- [ ] Los dos sitios preexistentes conservan su contenido y Nginx queda recuperable pero inactivo.
- [ ] El operador inicial existe una sola vez, esta activo y tiene solo permisos de plataforma declarados.
- [ ] El flujo exige password y TOTP, entrega ACR 2 y nunca expone tokens al navegador.
- [ ] El panel y `/api/platform/operators/me` funcionan; no autenticados, usuarios ajenos y MFA insuficiente son denegados.
- [ ] Logout invalida la sesion y el operador queda obligado a configurar su propio password/TOTP.
- [ ] CI, despliegue por digest, reinicio y E2E real aprueban sin secretos ni artefactos sensibles.

## Plan de verificacion

- Pruebas unitarias: configuracion Caddy, aprovisionador y selectores/ayudas E2E.
- Pruebas de integracion o contratos: operador Keycloak + PostgreSQL, issuer, Redis y API real.
- Pruebas E2E: Chromium contra HTTPS publico con enrolamiento TOTP, panel, identidad y logout; negativos sin sesion y sin autorizacion.
- Comprobacion manual: DNS, certificados, headers, redirects, sitios previos, health y reinicio.
- Seguridad, permisos y aislamiento: secretos fuera de argv/logs/Git, ACR 2, cookies `Secure`/`HttpOnly`, redes y permisos cerrados.
- Idempotencia, concurrencia y recuperacion: dos aprovisionamientos, reinicio Compose y rollback de ingreso ensayado antes del cambio.
- Comandos que deben aprobar: `pnpm run ci`, validacion Compose/Caddy, harness de operador y Playwright en el VPS.

## Recuperacion

- Compatibilidad o migracion: Caddy conserva datos ACME en volumen y configuracion versionada; los roots estaticos no cambian.
- Rollback de aplicacion: volver a digests anteriores y conservar sesiones/identidad compatibles.
- Recuperacion de ingreso: detener Caddy, reactivar Nginx y Certbot, validar configuracion y recargar; no eliminar certificados ni sitios anteriores durante esta rebanada.
- Recuperacion de datos: eliminar una identidad de prueba no revierte ni toca la membresia del operador inicial; PostgreSQL y Keycloak se respaldaran conforme a `OPS-21` antes de datos reales.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: pendiente.
- Pendientes o decisiones nuevas: pendiente.
