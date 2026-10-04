# OPS-18-a - Promoción tipada de componentes comunes

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificación

- Requisito principal: `OPS-18`
- Requisitos relacionados: `ADM-09`, `ADM-20`, `OPS-11`, `OPS-12`
- Fase del MVP: fase 2, plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: catálogo de releases `VALIDATED`, `deploy-executor` y `deploy-host` operativos
- Bloquea a: actualización reproducible de `admin-web`, `admin-api` y `deploy-executor` desde `platform.yaml`
- ADR, arquitectura o diseño aplicables: ADR-0005, ADR-0008, ADR-0009, ADR-0010 y ADR-0018

## Resultado esperado

Una promoción de plataforma ya registrada en el catálogo y solicitada por un operador recorre el flujo existente `admin-api → deploy-executor → deploy-host`, valida el catálogo completo por digest y reconcilia `platform.yaml` con los artefactos `ADMIN_WEB`, `ADMIN_API` y `DEPLOY_EXECUTOR`. No se aceptan comandos, rutas, tags ni digests desde el navegador y no se crea un canal Docker paralelo.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y evidencia previa revisados.
- [x] Reglas de API, persistencia, CI/CD, entornos y trabajos asincrónicos revisadas.
- [x] ADR y arquitectura de plataforma, ejecutor y host revisadas.

## Auditoría del trabajo existente

- Búsquedas realizadas: `OPS-18`, `platform.yaml`, `platform-foundation`, `PlatformFoundationPromotion`, `ADMIN_WEB`, `ADMIN_API`, `DEPLOY_EXECUTOR` y `deploy-host`.
- Código encontrado: existe operación durable y ruta protegida de promoción de foundation, pero el host solo deriva `PLATFORM_KEYCLOAK` y ejecuta `platform-foundation.yaml`; no reconcilia los tres servicios de `platform.yaml`.
- Pruebas e historial encontrados: contrato y pruebas de catálogo completo, cliente Unix tipado y reconciliador de foundation existentes; no existe mapping ni runner para el plano stateless.
- Decisión: extender el protocolo existente con una operación tipada de plataforma y configuración de paths controlada por `packages/config`; mantener compatibilidad de la ruta existente y sin SQL/Docker directo fuera de `deploy-host`.

## Alcance

### Incluido

- Mapping cerrado de `ADMIN_WEB`, `ADMIN_API` y `DEPLOY_EXECUTOR` a variables de `platform.yaml`.
- Runner allowlisted en `deploy-host` con env-file host-controlled, `compose config`, `pull_policy: always`, `up -d` de los tres servicios y observación `ps`/health.
- Conexión del executor y configuración validada del host.
- Pruebas focalizadas de mapping, rechazo de catálogo/digest y comandos permitidos.
- Evidencia de VPS y documentación de operación.

### No incluido

- Cambios en Keycloak, `platform-foundation.yaml`, migraciones de datos o rollback de datos.
- Promociones globales de perfiles (`OPS-17`) ni cambios en la interfaz comercial.
- Construcción manual, tags mutables, SQL manual o acceso Docker desde `admin-api`/`admin-web`.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `packages/config`, `packages/contracts`, `apps/deploy-executor`, `apps/deploy-host` |
| Contratos y eventos | Reutiliza `platform-foundation-promotion/v1` y amplía el payload interno cerrado |
| Datos y migraciones | Ninguno; reutiliza la operación durable existente |
| Permisos y aislamiento | Mantiene `deployments:execute`; solo el host ejecuta Compose con paths fijos |
| Configuración y secretos | Añade paths host-controlled para `platform.yaml` y su env-file; no guarda valores en Git |
| Observabilidad y operación | Reconciliación tipada y resultado observado por health/ps |
| Documentación | Ficha, estado, inventario y procedimiento de promoción |

## Plan de implementación

- [x] Extender catálogo de digests para el plano `platform.yaml`.
- [x] Implementar reconciliador tipado en `deploy-host` y conectarlo al executor.
- [x] Validar configuración y cobertura focalizada.
- [x] Verificar commit en VPS autorizado y registrar evidencia.

## Criterios de aceptación

- [x] Un catálogo incompleto, legacy o con digest inválido no ejecuta Compose.
- [x] La operación existente solicita únicamente artefactos registrados y `VALIDATED`.
- [x] `platform.yaml` recibe solo los tres digests cerrados y conserva su env-file host-controlled.
- [x] El host ejecuta únicamente `config`, `up` y `ps` sobre el proyecto `quantum-platform` y reporta fallo cerrado.
- [ ] No quedan cambios locales sin commit, secretos ni artefactos temporales.

## Plan de verificación

- Pruebas unitarias: mapping, catálogo incompleto, digest inválido y comandos allowlisted.
- Pruebas de integración o contratos: configuración y cliente del socket.
- Comprobación VPS: typecheck/build y prueba focalizada en Node 24 dentro del flujo autorizado; no se ejecuta ningún comando técnico local.
- Seguridad, permisos y aislamiento: operación protegida y paths no controlables por HTTP.
- Idempotencia, concurrencia y recuperación: se reutilizan lease/idempotencia del registro de promoción existente.

## Recuperación

- Compatibilidad o migración: cambio aditivo sin migración.
- Rollback de aplicación: restaurar el env-file/digests anteriores mediante el procedimiento tipado del host.
- Recuperación de datos: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: commits `13a876b` y `c5db32f` en `feat/OPS-18-platform-promotion`; PR pendiente de publicar.
- Comandos y resultados: en el VPS autorizado, Node 24.21.0 ejecutó Prettier sobre los seis archivos afectados, typecheck de `contracts`, `config` y `deploy-host`, build de `deploy-host` y dos pruebas focalizadas de `platform-foundation-release`; todos aprobaron. La prueba se repitió una sola vez tras construir las salidas `dist` requeridas por los paquetes workspace.
- Documentación actualizada: esta ficha, `docs/04-proceso/estado.md` e `infra/README.md`.
- Desviaciones del plan: la observación de salud usa `compose up --wait --wait-timeout` para no declarar éxito mientras los tres servicios siguen en `starting`.
- Pendientes o decisiones nuevas: publicar PR, CI, actualizar el `deploy-host` del VPS con esta capacidad y promover un release `VALIDATED` real; no se ejecutó Docker de producción ni se modificaron datos.
