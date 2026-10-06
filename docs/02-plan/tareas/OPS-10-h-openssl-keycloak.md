# OPS-10-h - Actualizar OpenSSL del runtime Keycloak

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-10`.
- Requisitos relacionados: `OPS-11`, `OPS-12`, `ADM-09`, `FORM-01`.
- Fase del MVP: infraestructura habilitadora de todas las fases.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: cadena de release inmutable, imagen Keycloak y escaneo Grype.
- Bloquea a: registro y promocion oficial de `d193b09` para InterAmerican.
- ADR, arquitectura o diseno aplicables: ADR-0008, ADR-0009 y reglas 09 y 15.

## Resultado esperado

La imagen final de Keycloak conserva el runtime aprobado y actualiza OpenSSL a una revision reparada antes de retirar `apk-tools`, permitiendo que la release se registre sin reducir la puerta de seguridad.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `OPS-10`, `Dockerfile.keycloak`, `openssl`, `apk`, `Grype` y pruebas de manifests.
- Codigo o documentacion encontrados: el runtime fijado de Temurin/Alpine contiene OpenSSL `3.5.8-r0`; Alpine 3.24 ya publica `3.5.9-r0` reparado.
- Pruebas e historial encontrados: la calidad de `d193b09` y las diez construcciones OCI aprobaron. El manifiesto fue bloqueado por CVE altas de OpenSSL exclusivamente en `PLATFORM_KEYCLOAK`.
- Decision de reutilizacion, extension o reemplazo: mantener la imagen base, actualizar los tres paquetes OpenSSL en la capa final, conservar la eliminacion posterior de `apk-tools` y agregar una regresion arquitectonica.

## Alcance

### Incluido

- Actualizacion de `openssl`, `libssl3` y `libcrypto3` a `3.5.9-r0` en el runtime Keycloak.
- Prueba estatica del Dockerfile, build/escaneo focalizado en VPS y nueva release desde un commit integrado.

### No incluido

- Cambios funcionales de identidad, datos, formularios o documentos.
- Excepciones que permitan vulnerabilidades altas o criticas.

## Impacto tecnico

| Area                       | Impacto previsto              |
| -------------------------- | ----------------------------- |
| Aplicaciones y modulos     | imagen `PLATFORM_KEYCLOAK`    |
| Contratos y eventos        | ninguno                       |
| Datos y migraciones        | ninguno                       |
| Permisos y aislamiento     | sin cambios                   |
| Configuracion y secretos   | sin cambios                   |
| Observabilidad y operacion | escaneo de imagen y promocion |
| Documentacion              | ficha y estado oficial        |

## Plan de implementacion

- [x] Fijar las revisiones reparadas de OpenSSL antes de retirar el gestor de paquetes.
- [x] Proteger el cambio con la prueba arquitectonica existente.
- [x] Validar build y escaneo focalizado en el VPS.
- [ ] Publicar PR y reutilizar la matriz de GitHub para registrar la release.

## Riesgos y mitigaciones

| Riesgo                                    | Mitigacion                                            | Verificacion                    |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| El runtime queda sin librerias requeridas | actualizar antes de la limpieza y arrancar Keycloak   | build y smoke focalizado        |
| El repositorio Alpine cambia              | fijar versiones exactas y mantener la base por digest | build reproducible              |
| Se oculta el hallazgo                     | conservar inventario APK y la puerta Grype            | reporte con cero altos/criticos |

## Criterios de aceptacion

- [x] La imagen contiene OpenSSL `3.5.9-r0` y no contiene `3.5.8-r0`.
- [x] Keycloak arranca y responde readiness en el VPS.
- [x] Grype reporta cero hallazgos altos o criticos para `PLATFORM_KEYCLOAK`.
- [x] La puerta de seguridad no se relaja.

## Plan de verificacion

- Pruebas unitarias: prueba arquitectonica de manifests.
- Pruebas de integracion o contratos: no aplica.
- Pruebas E2E: login no cambia; se reutiliza el smoke de identidad salvo cambio observable.
- Comprobacion manual: readiness de la imagen candidata en el VPS.
- Seguridad, permisos y aislamiento: escaneo Grype del digest construido.
- Idempotencia, concurrencia y recuperacion: sin cambios; rollback al digest anterior.
- Comandos que deben aprobar: formato/lint afectados, prueba arquitectonica, build Keycloak, inventario APK, readiness y Grype focalizado; solo en VPS.

## Recuperacion

- Compatibilidad o migracion: no hay migraciones ni cambio de contrato.
- Rollback de aplicacion: conservar el digest Keycloak anterior.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: candidato `ca092f0`; `Dockerfile.keycloak`, prueba arquitectonica, ficha y estado oficial.
- Comandos y resultados: en el VPS aprobaron Prettier y ESLint afectados, 15/15 pruebas de manifests, build OCI `sha256:48a634ffebe47a1eb86c8515b01a5e9aec8e596235531179371aea0b9939fddd`, inventario APK `3.5.9-r0`, readiness `UP` y Grype con cero altos o criticos.
- Documentacion actualizada: ficha y estado oficial.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: publicar el PR, registrar la release oficial desde `main` y promoverla.
