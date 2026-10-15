# ADM-17 - Dominio propio por perfil

## Identificacion

- Requisito principal: `ADM-17`.
- Relacionados: `OPS-06`, `ADM-04`.
- Fase: administracion y operacion del piloto.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Referencia: [`ADR-0019`](../../06-decisiones/ADR-0019-rutas-https-por-perfil.md).

## Resultado esperado

`quantumbusinessassistant.com` abre Quantum Admin. InterAmerican usa `interamerican.quantumbusinessassistant.com`. Al aprovisionar otro perfil, el ejecutor deriva `<slug>.quantumbusinessassistant.com` del slug registrado, no de un hostname recibido del navegador; Caddy conserva una ruta explicita por perfil y emite HTTPS. Los callbacks OIDC coinciden con cada origen.

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
- Un perfil nuevo de prueba debe comprobar la ruta automatica antes de marcar completa la subtarea global de `ADM-17`.

## Pendientes de estabilizacion posterior

- Reemplazar overrides directos por promocion registrada e inventario recuperable.
- Migrar de forma controlada el hostname registrado de InterAmerican, aun `nip.io`, antes de reconciliar su ruta.
- Probar login autenticado en Admin y CRM y el primer perfil nuevo.
- Conciliar URL del webhook del proveedor y estado de certificados en la interfaz administrativa.
