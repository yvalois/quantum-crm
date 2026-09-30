# ADM-04-k - Recuperar un aprovisionamiento detenido

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `ADM-03`, `ADM-05`, `OPS-12`, `OPS-14`
- Fase del MVP: 2 - Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: operaciones de aprovisionamiento durables, releases validadas, reservas de capacidad y fencing existentes
- Bloquea a: despliegue de la vertical comercial sobre un perfil demostrable actualizado
- ADR, arquitectura o diseno aplicables: ADR-0004, ADR-0005, ADR-0006, ADR-0009, ADR-0011 y `docs/08-arquitectura/mapa-del-sistema.md`

## Resultado esperado

Un operador autorizado puede cancelar de forma tipada una operacion de aprovisionamiento detenida antes de iniciar contenedores. La cancelacion libera el lease y la reserva sin borrar resultados ni afirmar que se revirtieron efectos ya confirmados. El ejecutor queda desbloqueado para aprovisionar un perfil nuevo con una release validada; el perfil cancelado permanece en `ERROR` hasta una reconciliacion explicita posterior.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md` y `docs/03-operaciones/despliegues.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-04`, `OPS-12`, `provisioning_operations`, `claimNext`, `MIGRATE_DATABASE`, `cancel`, `retry`, `capacity_reservations` y endpoints de perfiles.
- Codigo o documentacion encontrados: maquina durable, leases, fencing, resultados por paso, liberacion de capacidad ante fallo y endpoint para solicitar un alta; no existe una operacion publica para cancelar o sustituir un alta detenida.
- Pruebas e historial encontrados: el commit `6de140ff17da2f841ea6813cec8c689afa2c35dd` corrige el migrador y tiene CI/release verdes. La operacion de `quantum-demo` permanece fijada a la candidata defectuosa anterior.
- Decision de reutilizacion, extension o reemplazo: extender la maquina y repositorio existentes; no editar SQL operativo, manifiestos inmutables ni resultados historicos.

## Alcance

### Incluido

- Contrato versionado para cancelar una operacion con version esperada y motivo saneado.
- Transicion atomica desde `PENDING` o `RUNNING` hacia `CANCELLED`, limitada a pasos anteriores a contenedores, con fencing y liberacion unica de la reserva.
- Estado `ERROR` explicito del perfil cancelado, sin reutilizar configuraciones o recursos parciales como si pertenecieran a otra release.
- Endpoint protegido por `deployments:execute`, idempotencia y respuesta contractual.
- Pruebas de concurrencia, repeticion, lease vigente, reserva y rechazo despues de un punto no cancelable.

### No incluido

- Revertir migraciones o eliminar bases, buckets, secretos o contenedores ya creados.
- Cambiar el `releaseId` de una operacion o manifiesto existente.
- Marcar manualmente pasos como exitosos.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-api`, dominio de despliegues y adaptador PostgreSQL de plataforma |
| Contratos y eventos | comando/respuesta HTTP v1 de cancelacion |
| Datos y migraciones | agrega metadatos de cancelacion auditables sin reescribir filas `CANCELLED` historicas |
| Permisos y aislamiento | `deployments:execute`, operacion ligada al perfil y actor de plataforma |
| Configuracion y secretos | sin secretos nuevos |
| Observabilidad y operacion | resultado durable, motivo saneado, correlacion e idempotencia |
| Documentacion | ficha, estado y evidencia de despliegue |

## Plan de implementacion

- [ ] Definir contrato y transicion de cancelacion segura.
- [ ] Implementar persistencia atomica con liberacion idempotente de capacidad.
- [ ] Exponer el endpoint protegido y su traduccion de errores.
- [ ] Cubrir autorizacion, version, concurrencia, repeticion y puntos no cancelables.
- [ ] Validar en el VPS, publicar PR y usar la operacion para recuperar el perfil demostrable.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Cancelar mientras un worker conserva lease | actualizacion condicional por version/estado y fencing del resultado tardio | prueba concurrente |
| Liberar dos veces la capacidad | transaccion y estado condicional de la reserva | repeticion idempotente |
| Presentar cancelacion como rollback | conservar resultados y prohibir borrados automaticos | prueba y contrato |
| Reanudar una operacion con digest defectuoso | la operacion cancelada es terminal y la nueva fija otra release | recorrido VPS |

## Criterios de aceptacion

- [ ] Una operacion detenida antes de iniciar contenedores termina `CANCELLED` mediante API autorizada.
- [ ] Su reserva queda liberada exactamente una vez y un resultado tardio no progresa la operacion.
- [ ] Repetir la solicitud converge al mismo resultado.
- [ ] El ejecutor procesa un perfil demostrable nuevo con la release corregida sin quedar bloqueado por la operacion cancelada.
- [ ] `quantum-piloto` permanece activo e inalterado.

## Plan de verificacion

- Pruebas unitarias: transiciones, validacion de version, motivo e idempotencia.
- Pruebas de integracion o contratos: transaccion PostgreSQL y endpoint protegido.
- Pruebas E2E: cancelar la operacion detenida y aprovisionar un perfil demostrable nuevo con la release corregida.
- Comprobacion manual: estados, servicios saludables, HTTPS y readiness.
- Seguridad, permisos y aislamiento: permiso `deployments:execute`; no aceptar perfil, release o reserva libres en el cuerpo.
- Idempotencia, concurrencia y recuperacion: dos cancelaciones, resultado tardio y nueva solicitud.
- Comandos que deben aprobar: verificaciones afectadas en VPS y matriz unica de GitHub.

## Recuperacion

- Compatibilidad o migracion: compatible hacia adelante; no reescribe operaciones terminales.
- Rollback de aplicacion: retirar el endpoint conserva estados ya persistidos.
- Recuperacion de datos, si aplica: no se borran efectos; cualquier recurso previo se reconcilia durante la nueva operacion.

## Evidencia de cierre

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
