# ADM-04-l - Aprovisionar perfiles desde Quantum Admin

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-02`, `ADM-03`, `ADM-05`, `ADM-09`
- Fase del MVP: 2 - Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: motor durable de aprovisionamiento, inventario de servidores y releases validadas existentes
- Bloquea a: alta operativa de InterAmerican y de futuros clientes sin usar llamadas manuales a la API
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0005, ADR-0009, ADR-0014 y `docs/08-arquitectura/mapa-del-sistema.md`

## Resultado esperado

Un operador autorizado crea o selecciona un perfil en Quantum Admin, elige un servidor disponible y una release validada, define su reserva inicial e inicia el aprovisionamiento real. El panel refleja el progreso mediante el estado durable del perfil y habilita la activacion del administrador cuando el perfil queda activo.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `provisioning-operations`, `infrastructure-servers`, `VALIDATED`, rutas BFF y acciones de `dashboard/tenants`.
- Codigo o documentacion encontrados: el `admin-api`, el dominio y el ejecutor ya realizan el aprovisionamiento durable; `admin-web` solo permite registrar/editar perfiles, activar administradores y promover releases.
- Pruebas e historial encontrados: dos perfiles fueron aprovisionados de extremo a extremo mediante la API y el VPS; existen pruebas HTTP para perfiles, servidores y solicitudes de aprovisionamiento.
- Decision de reutilizacion, extension o reemplazo: reutilizar contratos y motor existentes; agregar exclusivamente la frontera BFF y el flujo visual faltantes, sin duplicar el aprovisionador.

## Alcance

### Incluido

- Consulta protegida de servidores disponibles y releases validadas desde `admin-web`.
- Solicitud protegida e idempotente de aprovisionamiento desde el panel.
- Asistente visual con servidor, release y reserva de CPU, memoria y almacenamiento.
- Actualizacion automatica del estado del perfil mientras la operacion esta en curso.
- Accion de aprovisionar visible solo para perfiles elegibles y operadores con permiso.
- Alta y aprovisionamiento del perfil `InterAmerican` mediante el flujo administrativo desplegado.

### No incluido

- Cambios al ejecutor, a la topologia del VPS o al protocolo durable ya aprobado.
- SMTP; la activacion inicial continua entregandose dentro de la sesion administrativa.
- Datos comerciales reales dentro del perfil.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-web`; consumo de endpoints existentes de `admin-api` |
| Contratos y eventos | reutiliza contratos v1 sin cambios incompatibles |
| Datos y migraciones | sin migraciones nuevas |
| Permisos y aislamiento | sesiones de plataforma, CSRF y `deployments:execute`; sin acceso a datos comerciales |
| Configuracion y secretos | sin secretos nuevos |
| Observabilidad y operacion | estado durable del perfil y operacion existente |
| Documentacion | ficha y estado del requisito |

## Plan de implementacion

- [x] Exponer inventario de servidores y solicitud de aprovisionamiento mediante el BFF protegido.
- [x] Incorporar el asistente de aprovisionamiento y sus estados en el directorio de perfiles.
- [x] Cubrir validacion, permisos, CSRF, version e idempotencia en pruebas afectadas.
- [ ] Validar el candidato exacto en el VPS, publicar PR y desplegar por el flujo de release.
- [ ] Crear y aprovisionar `InterAmerican` desde Quantum Admin.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Reservar mas capacidad de la disponible | mostrar capacidad observada y conservar la admision atomica del servidor | prueba BFF y recorrido VPS |
| Solicitud duplicada por doble clic | clave de idempotencia por intento y bloqueo visual | prueba de headers y smoke |
| Usar una release no validada | selector alimentado solo por releases `VALIDATED`; validacion definitiva en backend | prueba de consulta y recorrido VPS |
| Perder el estado al cerrar el dialogo | refrescar el perfil durable, no depender del estado local del navegador | smoke autenticado |

## Criterios de aceptacion

- [ ] Un operador autorizado puede aprovisionar un perfil `PENDING` sin usar herramientas externas al panel.
- [ ] Solo se presentan servidores `AVAILABLE` y releases `VALIDATED`.
- [ ] El panel muestra la transicion `PENDING` -> `PROVISIONING` -> `ACTIVE` o el error durable.
- [ ] Una repeticion de la misma solicitud no duplica la reserva ni la operacion.
- [ ] `InterAmerican` queda visible y operativo en Quantum Admin.

## Plan de verificacion

- Pruebas unitarias: handlers BFF, validacion de cuerpo, headers y traduccion de errores.
- Pruebas de integracion o contratos: reutilizar la cobertura existente del endpoint de aprovisionamiento.
- Pruebas E2E: recorrido autenticado en el VPS desde el panel hasta perfil activo.
- Comprobacion manual: servidor/release seleccionados, capacidad, estado y acceso de activacion.
- Seguridad, permisos y aislamiento: sesion de operador, CSRF, origen, permiso y version vigente.
- Idempotencia, concurrencia y recuperacion: clave unica por intento; motor durable existente.
- Comandos que deben aprobar: formato/lint, pruebas y typecheck/build afectados, solo en VPS.

## Recuperacion

- Compatibilidad o migracion: no cambia datos ni contratos persistidos.
- Rollback de aplicacion: revertir `admin-web` no altera operaciones ya solicitadas.
- Recuperacion de datos, si aplica: el motor existente conserva y reconcilia la operacion durable.

## Evidencia de cierre

- Archivos, commits o PR: candidato funcional `574313f` en `feat/ADM-04-admin-provisioning`.
- Comandos y resultados: en el VPS autorizado aprobaron Prettier y ESLint afectados, 9/9 pruebas BFF, typecheck de `admin-web` y build de produccion con las rutas nuevas incluidas.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: ninguna en el alcance implementado.
- Pendientes o decisiones nuevas: CI, despliegue de la plataforma y alta de `InterAmerican` desde el panel.
