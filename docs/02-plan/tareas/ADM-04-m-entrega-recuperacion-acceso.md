# ADM-04-m - Entrega y recuperacion de acceso del administrador

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `USR-01`, `USR-03`
- Fase del MVP: 2 - Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: perfil activo, identidad aislada y entrega efimera de ADR-0022
- Bloquea a: acceso autosuficiente de InterAmerican y futuros administradores sin terminal
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0022 y `docs/08-arquitectura/mapa-del-sistema.md`

## Resultado esperado

Un operador autorizado obtiene desde Quantum Admin el correo, URL del CRM y un enlace de un solo uso para configurar o recuperar contraseña y MFA del administrador inicial. El flujo funciona también después de una activación consumida y no almacena ni registra contraseñas o enlaces.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `USR-01`, `activation-deliveries`, administrador inicial, contraseña y TOTP.
- Codigo o documentacion encontrados: entrega efimera ya conectada entre Admin, ejecutor y Keycloak; la API rechazaba administradores cuyo primer enlace ya había sido consumido y la interfaz mostraba solo el enlace sin los datos completos de acceso.
- Pruebas e historial encontrados: cobertura del dominio, repositorio de entregas, callback efimero y activaciones reales en el VPS.
- Decision de reutilizacion, extension o reemplazo: extender la entrega ADR-0022 para recuperación; no crear una segunda fuente de credenciales ni leer archivos secretos desde la web.

## Alcance

### Incluido

- Reemitir una generación de acceso para un administrador inicial ya activado.
- Invalidar la generación anterior mediante el proveedor de Keycloak existente.
- Mostrar empresa, CRM, usuario, vencimiento y enlace efímero en Quantum Admin.
- Copiar los datos de acceso desde la interfaz sin persistirlos.

### No incluido

- SMTP o envío por un proveedor externo.
- Consulta o revelado de contraseñas anteriores.
- Almacenamiento del enlace de activación.

## Impacto tecnico

| Area                       | Impacto previsto                                                             |
| -------------------------- | ---------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `admin-web`, `admin-api`, `deploy-executor` y entrega de identidad existente |
| Contratos y eventos        | reutiliza `activation-delivery/v1` sin cambios incompatibles                 |
| Datos y migraciones        | sin migracion; reutiliza generaciones y estados existentes                   |
| Permisos y aislamiento     | conserva `deployments:activate`, perfil exacto y operador autenticado        |
| Configuracion y secretos   | sin secretos nuevos; no se leen archivos privados desde la web               |
| Observabilidad y operacion | conserva auditoria saneada y respuesta `no-store`                            |
| Documentacion              | estado y evidencia de esta ficha                                             |

## Plan de implementacion

- [x] Permitir una nueva entrega después del consumo inicial.
- [x] Mantener monotónica la generación y limpiar el consumo anterior al emitir.
- [x] Presentar los datos completos y copiables dentro de la sesión administrativa.
- [x] Añadir pruebas de dominio y persistencia para recuperación.
- [ ] Validar el candidato exacto en el VPS y desplegarlo.

## Riesgos y mitigaciones

| Riesgo                                      | Mitigacion                                                       | Verificacion                         |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Exponer el enlace fuera de la sesión        | respuesta `no-store`, estado solo en memoria y sin base de datos | búsqueda de secretos y revisión HTTP |
| Mantener dos enlaces vigentes               | nueva generación invalida la anterior en Keycloak                | prueba y smoke con dos generaciones  |
| Retroceder el estado por una entrega tardía | actualización condicionada a una generación superior             | prueba de repositorio                |

## Criterios de aceptacion

- [ ] InterAmerican puede generar desde Admin un nuevo acceso sin terminal.
- [ ] La pantalla muestra usuario, URL del CRM, vencimiento y enlace copiable.
- [ ] El enlace permite definir una nueva contraseña y completar el MFA.
- [ ] Una generación anterior deja de ser válida.
- [ ] No aparecen contraseña, enlace ni token en almacenamiento durable o logs.

## Plan de verificacion

- Pruebas unitarias: transición desde `CONSUMED` y entrega de nueva generación.
- Pruebas de integracion o contratos: repositorio y API de activación existentes.
- Pruebas E2E: generación desde Admin y consumo contra el realm real de InterAmerican.
- Comprobacion manual: datos visibles y copiables, apertura del CRM y enlace.
- Seguridad, permisos y aislamiento: permiso `deployments:activate`, enlace efímero y perfil exacto.
- Idempotencia, concurrencia y recuperacion: una generación vigente y actualización monotónica.
- Comandos que deben aprobar: formato, lint, typecheck, pruebas y builds afectados en el VPS.

## Recuperacion

- Compatibilidad o migracion: no aplica migración ni cambia contratos.
- Rollback de aplicacion: restaurar digests anteriores; las generaciones emitidas conservan su vencimiento.
- Recuperacion de datos, si aplica: no se modifica información comercial.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente de validación VPS.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: ninguna registrada.
- Pendientes o decisiones nuevas: SMTP permanece como adaptador futuro.
