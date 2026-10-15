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

- Pruebas del dominio, configuracion, enlace Admin y validacion de rutas.
- Typecheck, lint, build y comprobacion enfocada en VPS del commit candidato.
- DNS, certificado, salud, redireccion al login y callback correcto en ambos hosts.
- Un perfil nuevo de prueba debe comprobar la ruta automatica antes de marcar completa la subtarea global de `ADM-17`.

## Pendientes de estabilizacion posterior

- Reemplazar overrides directos por promocion registrada e inventario recuperable.
- Conciliar URL del webhook del proveedor y estado de certificados en la interfaz administrativa.
