# ADM-17 - Dominio propio por perfil

## Identificacion

- Requisito principal: `ADM-17`.
- Relacionados: `OPS-06`, `ADM-04`.
- Fase: administracion y operacion del piloto.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Referencia: [`ADR-0019`](../../06-decisiones/ADR-0019-rutas-https-por-perfil.md).

## Resultado esperado

`quantumbusinessassistant.com` abre Quantum Admin. InterAmerican usa `interamerican.quantumbusinessassistant.com`. La identidad compartida usa `identity.quantumbusinessassistant.com`; su issuer coincide con Keycloak y los consumidores OIDC. Al aprovisionar otro perfil, el ejecutor deriva `<slug>.quantumbusinessassistant.com` del slug registrado, no de un hostname recibido del navegador; Caddy conserva una ruta explicita por perfil y emite HTTPS. Los callbacks OIDC coinciden con cada origen.

## Alcance y riesgos

- El DNS `*` ya resuelve al VPS; no se crea un registro por perfil.
- Se conserva el host `nip.io` del webhook existente para evitar perder mensajes durante la migracion.
- Se excluyen etiquetas reservadas de plataforma y otros dominios arbitrarios; el host no determina el tenant por si mismo.
- La configuracion directa actual del VPS puede ser reemplazada por la reconciliacion futura hasta que el inventario y el ejecutor queden promocionados.
- Sin migracion de esquema ni cambio de datos comerciales.

## Verificacion y evidencia

- [PR #171](https://github.com/yvalois/quantum-crm/pull/171), candidato `072ec18e`: siete checks CI verdes; 23 pruebas enfocadas de dominio, configuracion, enlace Admin y ruta Caddy en VPS.
- ESLint, Prettier y builds de `deploy-host`, `deploy-executor` y `admin-web` y dependencias aprobaron en VPS. Las tres imagenes del candidato estan activas.
- DNS comodin, TLS valido, readiness `200`, redireccion al login y callback OIDC correcto en ambos hosts; el webhook viejo no redirige.
- La identidad se migro en el VPS a `identity.quantumbusinessassistant.com`: issuer OIDC de plataforma y del perfil comprobados por discovery; `/api/auth/login` de Admin y CRM redirige al nuevo host, y ambos readiness siguen en `200`. Keycloak, borde, plataforma y consumidores OIDC activos estan saludables. Se conservaron respaldos de configuracion `.bak-identity-20261015`; el host anterior permanece enrutado temporalmente. No se utilizo el token de activacion compartido en chat.
- Recuperacion del callback de InterAmerican: `error=access_denied` muestra `/access-error` sin sesion, conserva protegido `/inbox` y limpia la transaccion temporal. Candidato `bcde92d4`: 47 pruebas enfocadas, formato y build en VPS; imagen `crm-web` `sha256:1c8e880bc1298e27f31f8bcdbe43e8259a165a8cbedee2e9fdfac0cc43a090c0` healthy, pagina y readiness publicos `200`. Los eventos de Keycloak confirmaron enlace previo vencido y paso obligatorio de contrasena interrumpido; no se declaro login autenticado reparado ni se reutilizo el enlace expuesto.
- Un perfil nuevo de prueba debe comprobar la ruta automatica antes de marcar completa la subtarea global de `ADM-17`.

## Pendientes de estabilizacion posterior

- Reemplazar overrides directos por promocion registrada e inventario recuperable.
- Migrar de forma controlada el hostname registrado de InterAmerican, aun `nip.io`, antes de reconciliar su ruta.
- Probar login autenticado en Admin y CRM y el primer perfil nuevo.
- Reemitir enlaces de activacion previos a la migracion; comprobar una activacion nueva real sin registrar su token. Retirar el host de identidad `nip.io` cuando no queden enlaces pendientes.
- Conciliar URL del webhook del proveedor y estado de certificados en la interfaz administrativa.
