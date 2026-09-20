# ADM-03-a - Maquina de estados del perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-03`
- Requisitos relacionados: `ADM-02`, `ADM-04`, `USR-01`, `OPS-14`
- Fase del MVP: 2. Plataforma administrativa
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-02-a`, `ADM-02-b`
- Bloquea a: activacion, suspension, aprovisionamiento y recuperacion controlada de perfiles
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006 y ADR-0011

## Resultado esperado

El dominio define transiciones explicitas entre pendiente, aprovisionando, activo, suspendido y error, rechaza saltos invalidos y evita que la edicion general del perfil cambie el estado por accidente.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-03`, `TenantProfile`, estados, contratos, controlador, repositorio, UI y pruebas.
- Codigo o documentacion encontrados: los cinco estados ya existen en dominio, contrato, PostgreSQL y vista administrativa; la edicion generica aun acepta cualquier estado valido.
- Pruebas e historial encontrados: pruebas unitarias y de integracion de perfil, API protegida y UI desplegada en las fichas `ADM-02-a` a `ADM-02-c`.
- Decision de reutilizacion, extension o reemplazo: reutilizar el agregado y el control optimista; agregar una politica pura de transiciones y retirar `status` del contrato de edicion general.

## Alcance

### Incluido

- Definir acciones y transiciones validas de ciclo de vida en el dominio.
- Rechazar transiciones invalidas con un error de dominio explicito.
- Impedir que `PATCH /tenant-profiles/:id` y su BFF alteren el estado.
- Probar la matriz de transiciones y la frontera contractual.

### No incluido

- Exponer todavia acciones de activar o suspender que solo cambien una etiqueta sin controlar el runtime real.
- Aprovisionar infraestructura, pausar webhooks o reanudar trabajos; pertenecen a las siguientes rebanadas de `ADM-03` y `ADM-04`.
- Duplicar membresias de usuarios en plataforma: su autoridad permanece en el IAM del CRM segun ADR-0002 y ADR-0004.
- Marcar `ADM-03` o `ADM-02` completos.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Dominio de `tenants`, contrato compartido y controlador administrativo |
| Contratos y eventos | La edicion general deja de aceptar `status`; las acciones futuras tendran contrato dedicado |
| Datos y migraciones | Ninguno; se reutiliza el enum persistente existente |
| Permisos y aislamiento | Sin permisos nuevos; se evita una mutacion lateral no orquestada |
| Configuracion y secretos | Ninguno |
| Observabilidad y operacion | Sin efecto operativo hasta conectar el orquestador real |
| Documentacion | Ficha, estado y evidencia del limite de membresias |

## Plan de implementacion

- [ ] Implementar la matriz de transiciones como funcion pura de dominio.
- [ ] Cubrir todas las acciones validas e invalidas con pruebas.
- [ ] Retirar `status` del comando y contrato de edicion general.
- [ ] Verificar contratos, dominio, API, BFF y build afectados.
- [ ] Registrar evidencia sin cerrar el requisito completo.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Activar un perfil sin runtime listo | No publicar accion operativa en esta rebanada | No existe endpoint ni boton de activacion |
| Romper clientes existentes que enviaban estado | La API aun no es publica y la UI desplegada nunca envia `status` | Pruebas de contrato y BFF |
| Permitir saltos arbitrarios desde otro caso de uso | Politica unica exportada desde el dominio | Matriz unitaria exhaustiva |

## Criterios de aceptacion

- [ ] Los cinco estados siguen siendo visibles y filtrables.
- [ ] Solo las transiciones aprobadas por accion son aceptadas por el dominio.
- [ ] La actualizacion general rechaza el campo `status`.
- [ ] Ninguna accion se presenta como suspension real antes de controlar acceso, jobs y webhooks.

## Plan de verificacion

- Pruebas unitarias: matriz de ciclo de vida y servicio de perfil.
- Pruebas de integracion o contratos: schemas de contratos y pruebas existentes de API/BFF.
- Pruebas E2E: no aplica a una politica aun no expuesta.
- Comprobacion manual: confirmar que la UI solo muestra el estado y que su formulario no lo muta.
- Seguridad, permisos y aislamiento: el contrato estricto rechaza `status` en la edicion general.
- Idempotencia, concurrencia y recuperacion: la futura ejecucion usara `If-Match`; esta rebanada no produce efectos.
- Comandos que deben aprobar: `pnpm --filter @quantum-crm/platform-domain test`, `pnpm --filter @quantum-crm/contracts test`, pruebas de `admin-api` y `admin-web`, typecheck y build afectados.

## Recuperacion

- Compatibilidad o migracion: no hay migracion de datos.
- Rollback de aplicacion: revertir el commit antes de que existan consumidores del contrato dedicado.
- Recuperacion de datos, si aplica: no aplica; no se mutan datos en el despliegue de esta rebanada.

## Evidencia de cierre

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
