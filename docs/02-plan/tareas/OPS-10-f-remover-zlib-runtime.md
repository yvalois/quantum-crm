# OPS-10-f - Remocion de zlib vulnerable del runtime Alpine

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `ADM-09`, `ADM-20` y `ADM-04`.
- Fase del MVP: Bootstrap tecnico.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `OPS-10-e` integrada mediante PR #36; el workflow 35875997635 publico los ocho artefactos de `d34a136480713584a8027b25b1953b6f0b0cbb63` y rechazo el manifiesto por un unico hallazgo alto sin version reparada: `CVE-2026-85091` en `zlib 1.3.2-r0`, presente una vez en cada imagen.
- Bloquea a: manifiesto admisible, registro OIDC de candidatas, despliegue por digest y validacion verificable de `ADM-04-i`.
- ADR, arquitectura o diseno aplicables: `ADR-0007`, `ADR-0009`, reglas 02, 05, 09 y 15, `monorepo.md`, `mapa-del-sistema.md` e `infra/README.md`.

## Resultado esperado

Las capas finales Alpine eliminan `apk-tools` y su dependencia `zlib` despues de reunir los artefactos de aplicacion. La imagen conserva su base oficial Node 24.21.0 Alpine fijada por digest, `libstdc++`, usuario `node`, registro de paquetes verificable y los mismos entrypoints. La siguiente release se construye una sola vez desde un commit nuevo y genera manifiesto solo si Grype no detecta hallazgos altos ni criticos.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` (`OPS-10` y `OPS-11`).
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `release-candidate`, `grype`, `CVE-2026-85091`, `zlib`, `apk`, `Dockerfile.node`, `Dockerfile.web` y `Dockerfile.migrator`.
- Codigo o documentacion encontrados: `OPS-10-e` establecio Node Alpine en toolchain y runtime y conserva los runtime como capas separadas. La guia oficial de Node para Alpine compone su runtime minimo con el binario Node y `libstdc++`; este cambio comprueba `node --version` inmediatamente despues de retirar los paquetes durante el build.
- Pruebas e historial encontrados: PR #36 aprobo los siete checks. El reporte `release-manifest-and-scans` del workflow 35875997635 contiene ocho reportes, cada uno con exactamente un hallazgo alto, cero criticos y sin version reparada: `CVE-2026-85091` en `zlib 1.3.2-r0`. La release 35879407176 del commit `58c03e4` repitio exactamente ese resultado: el build revelo que `apk-tools` conserva `zlib` como dependencia (`zlib: apk-tools`), por lo que borrar solo `/sbin/apk` no eliminaba el paquete.
- Decision de reutilizacion, extension o reemplazo: conservar Alpine, BuildKit, Grype, los digests, los entrypoints y la politica. Remover `apk-tools` junto a su dependencia vulnerable `zlib` del runtime tras el build, sin borrar la base de datos de paquetes ni esconderla del scanner.

## Alcance

### Incluido

- Eliminar `apk-tools` y su dependencia `zlib` sin red de las tres capas finales Alpine, despues de instalar o copiar los artefactos necesarios, y comprobar `node --version` en la misma capa.
- Eliminar el gestor de paquetes del runtime sin borrar su inventario de paquetes.
- Proteger ambas condiciones en la prueba arquitectonica existente.
- Verificar unicamente con la matriz CI del PR y la release automatica posterior al merge.

### No incluido

- Cambiar de distribucion, version de Node, contratos, datos, migraciones, secretos, permisos, VPS o trafico.
- Desactivar, reducir o exceptuar la politica de escaneo.
- Reejecutar, reconstruir, registrar, desplegar o promover `d34a136`.

## Impacto tecnico

| Area | Impacto previsto |
| --- | --- |
| Aplicaciones y modulos | Los ocho procesos Node y el migrador conservan sus entrypoints; solo se reduce la superficie de sus runtimes. |
| Contratos y eventos | Ninguno. |
| Datos y migraciones | Ninguna migracion; el migrador conserva el mismo comando. |
| Permisos y aislamiento | Mantiene `USER node`; no agrega accesos ni permisos. |
| Configuracion y secretos | Ninguno. |
| Observabilidad y operacion | Se conservan SBOM, procedencia, reportes, inventario de paquetes y bloqueo ante hallazgos. |
| Documentacion | Fichas, estado y prueba arquitectonica actualizados. |

## Plan de implementacion

- [x] Remover `apk-tools` y `zlib` de cada runtime Alpine despues de preparar los artefactos.
- [x] Actualizar la prueba de manifests contra regresiones de `zlib` o `apk` en runtime.
- [ ] Abrir PR y usar una sola matriz CI como evidencia.
- [ ] Tras el merge, inspeccionar una sola release automatica y registrar el resultado sin repetirla.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Un binario depende de `zlib` en runtime | La base oficial de Node solo requiere `libstdc++`; toolchain y runtime siguen en Alpine. | Build y smokes de CI; release por digest. |
| Se oculta el inventario al scanner | Se desinstala `apk-tools` con su dependencia, pero se conserva la base de datos de paquetes. | Reporte Grype de release. |
| El hallazgo se exceptua para publicar | Scanner y schema de manifiesto no cambian. | Reportes y bloqueo si persiste high/critical. |

## Criterios de aceptacion

- [ ] Los tres Dockerfiles eliminan `apk-tools` y `zlib` de sus runtimes Alpine, sin `latest` y sin root.
- [ ] La prueba arquitectonica protege digest Alpine, ausencia de gestores de paquetes Node y ausencia de `zlib`/`apk` en runtime.
- [ ] CI aprueba el commit y su unica release posterior conserva los reportes y crea candidata solo sin highs ni criticals.

## Plan de verificacion

- Pruebas unitarias: no aplica; la condicion es declarativa en Dockerfiles.
- Pruebas de integracion o contratos: prueba de manifests y builds de consumidores en CI.
- Pruebas E2E: smokes aplicables de la matriz CI, sin repetirlos manualmente.
- Comprobacion manual: comparar los reportes Grype de la release nueva con el artefacto 10757752707 de la ejecucion 35875997635.
- Seguridad, permisos y aislamiento: confirmar digest, `USER node`, inventario visible, ausencia de `zlib` y bloqueo ante high/critical.
- Idempotencia, concurrencia y recuperacion: una release por commit; no se relanza el commit rechazado ni se cambia trafico.
- Comandos que deben aprobar: matriz CI del PR y workflow `release-candidate` de `main` tras el merge.

## Recuperacion

- Compatibilidad o migracion: no cambia contratos ni datos; los digests rechazados permanecen solo como evidencia.
- Rollback de aplicacion: revertir crea un commit nuevo y nunca promueve una release bloqueada.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente; se reutilizara la evidencia de CI y release del commit correspondiente.
- Documentacion actualizada: ficha y estado al inicio.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: la primera correccion fue insuficiente porque `apk-tools` retenia el paquete. Esta correccion elimina ambos paquetes; si el reporte mantiene hallazgos altos o criticos, se abrira otra remediacion especifica sin aceptar excepciones automaticas.
