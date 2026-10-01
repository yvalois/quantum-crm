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

- [x] Definir contrato y transicion de cancelacion segura.
- [x] Implementar persistencia atomica con liberacion idempotente de capacidad.
- [x] Exponer el endpoint protegido y su traduccion de errores.
- [x] Cubrir autorizacion, version, concurrencia, repeticion y puntos no cancelables.
- [x] Validar en el VPS y usar la operacion para recuperar el perfil demostrable; la publicacion del PR queda como ultimo paso de entrega.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Cancelar mientras un worker conserva lease | actualizacion condicional por version/estado y fencing del resultado tardio | prueba concurrente |
| Liberar dos veces la capacidad | transaccion y estado condicional de la reserva | repeticion idempotente |
| Presentar cancelacion como rollback | conservar resultados y prohibir borrados automaticos | prueba y contrato |
| Reanudar una operacion con digest defectuoso | la operacion cancelada es terminal y la nueva fija otra release | recorrido VPS |

## Criterios de aceptacion

- [x] Una operacion detenida antes de iniciar contenedores termina `CANCELLED` mediante API autorizada.
- [x] Su reserva queda liberada exactamente una vez y un resultado tardio no progresa la operacion.
- [x] Repetir la solicitud converge al mismo resultado.
- [x] El ejecutor procesa un perfil demostrable nuevo con la release corregida sin quedar bloqueado por la operacion cancelada.
- [x] `quantum-piloto` permanece activo e inalterado.

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

- Archivos, commits o PR: commits `551a3af`, `148f26b`, `6286176`, `3b3f1f2` y `2b44966` en `feat/ADM-04-k-provisioning-recovery`.
- Comandos y resultados: instalacion con lockfile, Prettier, ESLint y typecheck afectado aprobados en el VPS para el candidato exacto. La activacion real completo contrasena y TOTP; la operacion `01a0f300-7ed1-74b2-96ee-c17bb60337da` termino `succeeded` y el perfil `quantum-showcase` quedo `ACTIVE`.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: el realm creado por una candidata anterior carecia de acciones requeridas y politica OTP completa. Se implemento reconciliacion idempotente del realm y se corrigio la firma del token de activacion con la clave del realm del perfil.
- Pendientes o decisiones nuevas: la promocion desde la etiqueta candidata del VPS hacia una release publicada por digest ocurre despues de integrar el PR; no invalida el recorrido funcional aprobado.

### Evidencia adicional — perfil demostrable con bandeja omnicanal

- La release integrada `e939d5a` se registró y promovió como `0.0.0-candidate.e939d5af3d2b`, con los diez artefactos fijados por digest.
- El perfil `01a0f479-5da2-733f-b9f0-434f78a40956` (`quantum-demo-jueves`) completó la operación `01a0f479-5db0-779e-a5fc-90563e73ebd8`: todos los pasos, incluidos `VERIFY` y `ACTIVATE`, terminaron `succeeded`; el perfil quedó `ACTIVE` y sus cinco servicios están saludables.
- La cuenta inicial completó contraseña y TOTP reales. El material sintético permanece fuera de Git y de la evidencia, en archivos privados del VPS con modo `0400`.
- El recorrido detectó que la emisión de activación usaba el origen administrativo HTTP interno. El commit candidato `a5ab057` usa el origen HTTPS público solo para emitir el enlace, conserva la administración por la red interna y valida exactamente origen y ruta devueltos.
- En el VPS se aprobaron para `a5ab057`: instalación congelada por lockfile, Prettier, ESLint, cuatro pruebas unitarias del provisionador y typecheck de `deploy-executor`. No se repitió la matriz completa ni se ejecutó código en el equipo local.
- El smoke autenticado posterior detectó un token humano incompleto (`acr=1`, sin `qcrm_principal_type`). Se reconciliaron el flujo LoA 2, el mapeo ACR y la claim de principal del cliente OIDC; un login nuevo terminó en `/inbox` con sesión `200` y `authenticated=true`. El aprovisionador incorpora la misma configuración para que los perfiles posteriores nazcan con el contrato exigido por el BFF y la API.
