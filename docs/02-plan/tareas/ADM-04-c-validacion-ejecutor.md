# ADM-04-c - Validacion durable del ejecutor

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`.
- Requisitos relacionados: `ADM-03`, `ADM-05`, `ADM-09`, `ADM-12`, `ADM-20`, `OPS-14`, `OPS-16`.
- Fase del MVP: fase 2, administracion de la plataforma.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `ADM-04-a`, `ADM-04-b`, `ADM-05-b` y `ADM-09-a`.
- Bloquea a: creacion tipada de base, secretos, almacenamiento, configuracion, contenedores, HTTPS y administrador inicial.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0006, ADR-0009, ADR-0010, ADR-0011, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/08-arquitectura/monorepo.md`.

## Resultado esperado

`deploy-executor` reclama automaticamente solo operaciones cuyo paso soporta, revalida dentro de PostgreSQL que el perfil, servidor, release y reserva siguen siendo coherentes y registra un resultado durable. Una validacion aprobada deja la operacion pendiente en `CREATE_DATABASE`; un fallo permanente marca la operacion y el perfil en error y libera exactamente una vez la capacidad reservada.

## Lectura obligatoria aplicada

- [x] Requisito, fase, checklist, estado y fichas anteriores revisados.
- [x] Implementacion, pruebas e historial de aprovisionamiento, leases, capacidad y releases auditados.
- [x] Reglas y ADR de persistencia, trabajos asincronos, fallos y despliegues revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `provisioning`, `claimNext`, `renewLease`, `deploy-executor`, `VALIDATE`, reserva, servidor y release.
- Codigo o documentacion encontrados: solicitud atomica, reserva de capacidad, release validada, claim con lease y fencing; el proceso ejecutor solo mantiene health y conexion, sin loop ni resultado de paso.
- Pruebas e historial encontrados: competencia de claims, lease vencido, idempotencia, rechazo de servidor/release y migraciones hasta `ADM-09-a`; PR #3 integrado en `5bc8c14`.
- Decision de reutilizacion, extension o reemplazo: extender la operacion y repositorio existentes. El claim filtrara pasos soportados y la validacion sera una transicion cercada, no un segundo flujo de aprovisionamiento.

## Alcance

### Incluido

- Resultado durable por intento del paso `VALIDATE`, sin datos secretos.
- Claim limitado a una lista cerrada de pasos soportados por el worker.
- Revalidacion transaccional de perfil, servidor, release, reserva, capacidad e identidades relacionadas.
- Avance cercado `VALIDATE -> CREATE_DATABASE` que libera el lease y devuelve la operacion a `PENDING`.
- Fallo permanente tipado que marca perfil `ERROR`, operacion `FAILED` y reserva `RELEASED`, descontando capacidad una sola vez.
- Loop cooperativo con polling acotado, un trabajo a la vez y cierre ordenado.
- Pruebas unitarias, arquitectura e integracion PostgreSQL para exito, fallo, repeticion y fencing.

### No incluido

- Crear bases, roles, secretos, buckets, configuracion, contenedores, DNS, HTTPS o el administrador del cliente.
- Reclamar `CREATE_DATABASE` u otros pasos aun no implementados.
- Reintentos transitorios, cancelacion manual, UI de progreso o cierre de `ADM-04`.
- Activar el VPS real, crear perfiles o releases sinteticas en staging.

## Impacto tecnico

| Area                       | Impacto previsto                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `deploy-executor`, dominio de despliegues y adaptador PostgreSQL de plataforma.          |
| Contratos y eventos        | Contrato interno versionado de claim y finalizacion; sin cambio incompatible al HTTP v1. |
| Datos y migraciones        | Resultado durable de pasos y codigo de fallo terminal.                                   |
| Permisos y aislamiento     | Rol runtime existente; sin Docker socket ni nuevas credenciales.                         |
| Configuracion y secretos   | Sin secretos nuevos; valores operativos cerrados para un unico handler soportado.        |
| Observabilidad y operacion | Readiness de proceso y base; fallos persistidos mediante codigos acotados.               |
| Documentacion              | Ficha, estado e inventario al desplegar.                                                 |

## Plan de implementacion

- [ ] Modelar comandos cercados, resultados y codigos de fallo.
- [ ] Crear migracion forward-only y constraints del resultado durable.
- [ ] Filtrar claims por pasos soportados.
- [ ] Implementar finalizacion atomica de `VALIDATE` y liberacion idempotente ante fallo.
- [ ] Ejecutar un loop cooperativo en `deploy-executor` sin privilegios de host.
- [ ] Cubrir exito, fallo, lease perdido, repeticion, reinicio y ausencia de doble liberacion.
- [ ] Verificar Node 24 y PostgreSQL 18 en el VPS, migrar y desplegar por digest.
- [ ] Registrar evidencia y preparar pull request.

## Riesgos y mitigaciones

| Riesgo                               | Mitigacion                                                                       | Verificacion                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Un worker obsoleto confirma un paso  | Condicionar por ID, propietario, version, paso y lease vigente.                  | Integracion de fencing y lease vencido.                         |
| El loop reclama pasos sin handler    | Lista cerrada `supportedSteps` aplicada en SQL.                                  | `CREATE_DATABASE` permanece pendiente sin incrementar intentos. |
| Un fallo libera capacidad dos veces  | Transicion de reserva `RESERVED -> RELEASED` bajo lock y decremento condicional. | Repeticion conserva contadores.                                 |
| Se pierde el resultado entre cambios | Resultado, operacion, perfil y reserva cambian en una sola transaccion.          | Fallos forzados no dejan estado parcial.                        |
| Polling impide apagar el proceso     | Espera cancelable y un solo ciclo en vuelo durante shutdown.                     | Prueba unitaria con reloj controlado.                           |

## Criterios de aceptacion

- [ ] El ejecutor no reclama pasos que no soporta.
- [ ] Una validacion coherente registra exito y deja `CREATE_DATABASE` pendiente sin lease.
- [ ] Un estado incompatible registra un codigo acotado, falla operacion/perfil y libera la reserva una sola vez.
- [ ] Un lease perdido o version obsoleta no puede escribir resultado ni efectos.
- [ ] Reiniciar el ejecutor recupera trabajo reclamable sin duplicar el resultado.
- [ ] El proceso mantiene health y no recibe Docker socket, secretos de host ni comandos libres.

## Plan de verificacion

- Pruebas unitarias: comandos, transiciones, loop vacio, exito, fencing y cierre.
- Pruebas de integracion o contratos: migracion, claim filtrado y finalizacion atomica en PostgreSQL 18.
- Pruebas E2E: proceso real contra base desechable; staging solo confirma health y ausencia de operaciones inventadas.
- Seguridad, permisos y aislamiento: rol runtime, schemas cerrados y ningun acceso a Docker o secretos operativos.
- Idempotencia, concurrencia y recuperacion: lease, version, unicidad del resultado y liberacion condicional.
- Comandos que deben aprobar: formato, lint, tipos, unitarias, arquitectura, integracion afectada, builds y migraciones desde cero.

## Recuperacion

- Compatibilidad o migracion: tablas y columnas aditivas; el ejecutor anterior ignora los nuevos datos.
- Rollback de aplicacion: volver al digest anterior detiene el loop sin revertir resultados ya confirmados.
- Recuperacion de datos: correcciones mediante operacion o migracion forward-only; nunca marcar exito manualmente.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna al iniciar.
- Pendientes o decisiones nuevas: handlers tipados desde `CREATE_DATABASE` hasta `ACTIVATE`.
