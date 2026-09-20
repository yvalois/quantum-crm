# ADM-01-d - Sesion administrativa opaca

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-01`, `OPS-06`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a`, `ADM-01-b`, `ADM-01-c`, ADR-0004 y ADR-0008
- Bloquea a: guardas HTTP, consumo autenticado de `admin-api` y experiencia administrativa
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0005, ADR-0008, seguridad, contratos, configuracion y monorepo

## Resultado esperado

`admin-web` inicia y completa Authorization Code con PKCE `S256`, `state` y `nonce`; conserva tokens exclusivamente en una sesion Redis server-side y entrega al navegador solo identificadores opacos en cookies `HttpOnly`, host-only, `SameSite=Lax` y `Secure` bajo HTTPS. El cierre invalida la sesion y toda mutacion queda preparada para validar Origin y CSRF.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y evidencia previa.
- [x] Reglas, ADR y arquitectura pertinentes.
- [x] Referencias oficiales de Next.js 16.3.5, OpenID Client y Redis.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-01`, session, cookie, PKCE, callback, nonce, CSRF, Redis, `admin-web`, Keycloak y configuracion.
- Codigo o documentacion encontrados: realm y verificador OIDC cerrados; `admin-web` solo muestra bootstrap y health; no existen sesiones, Redis, login ni callback.
- Pruebas e historial encontrados: Keycloak real y JWKS real ya se validan; no existe recorrido web autenticado.
- Decision de reutilizacion, extension o reemplazo: usar `openid-client` para el protocolo, un puerto de sesiones con adaptador Redis y Route Handlers de Next.js; no almacenar JWT en cookies ni implementar criptografia propia.

## Alcance

### Incluido

- Configuracion tipada de origen, issuer, cliente confidencial y Redis mediante secretos por archivo.
- Transaccion OIDC de un solo uso con `state`, `nonce`, PKCE y retorno local validado.
- Sesion opaca con expiracion inactiva y absoluta, rotacion al autenticar y tokens solo en Redis.
- Login, callback, consulta de sesion y logout en el BFF de `admin-web`.
- Cookies seguras, errores uniformes, no-cache, validacion Origin y token CSRF para logout.
- Pruebas unitarias, HTTP y Redis real desechable en VPS.

### No incluido

- Usuario operador o secretos reales en Git.
- Despliegue persistente de Keycloak/Redis, DNS o TLS.
- Guardas y proxy autenticado hacia todos los casos de uso de `admin-api`.
- Marcar `ADM-01` completo.

## Impacto tecnico

| Area                       | Impacto previsto                                               |
| -------------------------- | -------------------------------------------------------------- |
| Aplicaciones y modulos     | `admin-web`, `packages/auth` y `packages/config`               |
| Contratos y eventos        | Endpoints BFF same-origin; sin API publica versionada nueva    |
| Datos y migraciones        | Registros efimeros Redis con TTL; sin migracion comercial      |
| Permisos y aislamiento     | Sesion exclusiva de plataforma y ACR 2                         |
| Configuracion y secretos   | Client secret y Redis URL montados como archivos               |
| Observabilidad y operacion | Fallo cerrado, errores constantes y ninguna credencial en logs |
| Documentacion              | Ejemplo, Compose, ficha y estado                               |

## Plan de implementacion

- [ ] Modelar configuracion fail-closed de `admin-web` y secretos por archivo.
- [ ] Implementar transacciones y sesiones opacas con expiraciones acotadas.
- [ ] Implementar adaptador Redis con consumo unico e invalidacion.
- [ ] Implementar Authorization Code + PKCE y Route Handlers same-origin.
- [ ] Aplicar cookies seguras, Origin/CSRF y retorno local validado.
- [ ] Probar protocolo, ataques, Redis real y build en VPS.
- [ ] Registrar evidencia sin cerrar `ADM-01`.

## Riesgos y mitigaciones

| Riesgo                        | Mitigacion                                                  | Verificacion                   |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------ |
| Robo o fijacion de sesion     | 256 bits aleatorios, rotacion y cookie host-only            | Cookies y handles distintos    |
| Login CSRF o interception     | `state`, `nonce`, PKCE S256 y transaccion consumida una vez | Repeticion y valores invalidos |
| Tokens expuestos al navegador | Redis server-side; cookie solo contiene handle opaco        | Respuestas y cookies canario   |
| CSRF en logout/mutaciones     | Origin exacto, SameSite y token ligado a sesion             | Matriz negativa                |
| Redirect abierto              | Solo rutas locales normalizadas                             | Entradas hostiles              |
| Caida de Redis o proveedor    | Timeout, error uniforme y acceso denegado                   | Fallos simulados               |

## Criterios de aceptacion

- [ ] Login genera una autorizacion con state, nonce, PKCE S256 y ACR 2.
- [ ] Callback invalido o repetido no crea sesion.
- [ ] La sesion del navegador es opaca y no contiene tokens OIDC.
- [ ] Cookies y expiraciones cumplen ADR-0004.
- [ ] Logout exige Origin/CSRF, destruye sesion y limpia cookie.
- [ ] Configuracion insegura o secretos ausentes fallan antes de servir autenticacion.
- [ ] CI e integracion Redis afectada aprueban en VPS.

## Plan de verificacion

- Pruebas unitarias: configuracion, aleatoriedad, retorno, expiracion, state/nonce/PKCE, CSRF y errores.
- Pruebas de integracion o contratos: Redis real desechable con create/take/load/touch/delete y TTL.
- Pruebas E2E: callback completo con operador + OTP queda para la rebanada que aprovisione identidad persistente.
- Comprobacion manual: ningun token aparece en URL final, cookie, HTML, JSON o logs.
- Seguridad, permisos y aislamiento: issuer fijo, ACR 2, cookie host-only y fallos cerrados.
- Idempotencia, concurrencia y recuperacion: transaccion de login se consume atomicamente; repetir callback se rechaza.
- Comandos que deben aprobar: pruebas focalizadas, arquitectura, `pnpm run ci` e integracion Redis en VPS.

## Recuperacion

- Compatibilidad o migracion: primer contrato de sesion, versionado en claves Redis.
- Rollback de aplicacion: retirar rutas y configuracion; sesiones dejan de ser utilizables y expiran por TTL.
- Recuperacion de datos, si aplica: perder Redis cierra sesiones y transacciones, sin perder datos comerciales.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: pendiente.
- Pendientes o decisiones nuevas: aprovisionamiento persistente, operador inicial, guardas y proxy a `admin-api`.
