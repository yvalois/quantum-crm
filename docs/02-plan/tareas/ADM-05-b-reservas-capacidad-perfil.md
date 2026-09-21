# ADM-05-b - Reservas atomicas de capacidad por perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-05`.
- Requisitos relacionados: `ADM-04`, `ADM-06`, `OPS-04`.
- Fase del MVP: fase 2, administracion de la plataforma.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex.
- Dependencias: `ADM-02-a`, `ADM-04-a`, `ADM-05-a`.
- Bloquea a: admision segura de perfiles y ejecucion real de `ADM-04`.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0005, ADR-0006, ADR-0007, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/08-arquitectura/monorepo.md`.

## Resultado esperado

Al solicitar el aprovisionamiento, el sistema registra una colocacion durable que relaciona perfil, servidor, version y capacidad reservada. La admision bloquea la fila del servidor y confirma la reserva junto con la operacion y el cambio de estado del perfil, o no confirma ningun efecto. Una repeticion idempotente devuelve la misma colocacion sin volver a consumir capacidad.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-05`, `serverId`, capacidad, perfil, aprovisionamiento y repositorios en documentacion, contratos, dominio, migraciones, adaptador PostgreSQL, API y pruebas.
- Codigo o documentacion encontrados: inventario de servidores con totales y reservas agregadas; perfiles con `server_id` y `release_id` sin FK al inventario; solicitud durable de aprovisionamiento sin cantidades de capacidad ni colocacion propia.
- Pruebas e historial encontrados: contratos y pruebas unitarias de `ADM-05-a`; integracion PostgreSQL del inventario; integracion de idempotencia, concurrencia y lease de `ADM-04`; commits `36d861f`, `593077e` y `21b3e75`.
- Decision de reutilizacion, extension o reemplazo: extender el flujo durable existente. No crear un segundo flujo de admision ni usar la consulta de capacidad como garantia. La reserva se confirma dentro de la transaccion que ya crea la operacion.

## Alcance

### Incluido

- Modelo durable de colocacion con perfil, servidor, release, slot y capacidad.
- FK reales desde colocacion y operacion hacia el inventario de servidores.
- Cantidades de CPU, RAM y almacenamiento en la solicitud versionada.
- Admision solo en servidores `AVAILABLE` con capacidad suficiente.
- Bloqueo de fila y actualizacion atomica de contadores, colocacion, operacion y perfil.
- Repeticion idempotente sin doble reserva y rechazo de reutilizacion incompatible de clave.
- Pruebas de contrato, dominio, PostgreSQL y dos admisiones concurrentes contra el mismo remanente.
- Documentacion de datos y estado afectada.

### No incluido

- Ejecutar Docker, crear bases, buckets, secretos o contenedores.
- Activar, liberar o reconciliar colocaciones tras cada paso del ejecutor; se implementara con la maquina de ejecucion de `ADM-04`.
- Inventariar identificadores observados de cada contenedor, base y bucket; requiere resultados reales del ejecutor.
- Seleccion automatica del servidor o dimensionamiento comercial por plan.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-api`, dominio de infraestructura/despliegues y adaptador PostgreSQL de plataforma. |
| Contratos y eventos | Ampliar la solicitud y respuesta v1 antes de consumidores externos; publicar la colocacion reservada. |
| Datos y migraciones | Nueva tabla de colocaciones, enums, restricciones, indices y FK; nueva FK de operaciones a servidores/colocaciones. |
| Permisos y aislamiento | Se conserva `deployments:execute`; toda relacion usa UUID internos verificados en servidor. |
| Configuracion y secretos | Sin variables ni secretos nuevos. |
| Observabilidad y operacion | Errores diferenciados para servidor no admisible y capacidad insuficiente. |
| Documentacion | Ficha, estado, checklist solo si la evidencia satisface la subtarea y mapa de datos afectado. |

## Plan de implementacion

- [x] Definir el contrato y el dominio de capacidad/colocacion.
- [x] Crear una migracion forward-only con invariantes, FK e indices.
- [x] Integrar la reserva en la transaccion idempotente de aprovisionamiento.
- [x] Exponer la colocacion sin credenciales ni detalles internos del host.
- [x] Cubrir validacion, insuficiencia, servidor no disponible, repeticion y carrera concurrente.
- [x] Ejecutar puertas locales que no requieren Docker.
- [x] Aplicar migracion y ejecutar pruebas reales en el VPS autorizado.
- [x] Actualizar evidencia y preparar pull request.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Sobreasignacion por carreras | Bloquear el servidor y condicionar el incremento a los tres remanentes. | Dos solicitudes concurrentes compiten por un remanente que admite solo una. |
| Doble consumo por reintento | Reutilizar la identidad idempotente y comparar tambien slot y capacidad. | El replay conserva IDs y contadores. |
| Estado parcial entre modulos | Una unica transaccion confirma reserva, colocacion, operacion y perfil. | Forzar rechazos y comprobar ausencia de efectos parciales. |
| Totales reducidos debajo de reservas | Mantener restricciones SQL y rechazar actualizaciones incompatibles. | Prueba de constraint y repositorio. |
| Reserva sin liberacion | Estado durable y pendiente explicito; la liberacion solo se agregara con transiciones terminales tipadas. | No marcar recursos observados ni ADM-05 completo en esta rebanada. |

## Criterios de aceptacion

- [x] Una solicitud valida crea una sola colocacion reservada y descuenta los tres recursos disponibles.
- [x] Un servidor inexistente, no disponible o sin capacidad no crea operacion, colocacion ni mutacion del perfil.
- [x] Una repeticion exacta devuelve la misma operacion y colocacion sin variar la capacidad.
- [x] Una misma clave con carga distinta responde conflicto.
- [x] Bajo concurrencia nunca se exceden los totales ni se aceptan dos solicitudes incompatibles con el remanente.
- [x] PostgreSQL impide relaciones huerfanas y capacidades no positivas.
- [x] Los contratos, pruebas y documentacion coinciden con el comportamiento desplegado.

## Plan de verificacion

- Pruebas unitarias: validacion de capacidad y forma de la colocacion.
- Pruebas de integracion o contratos: schemas Zod; migracion; FK; admision, rechazo, replay y carrera PostgreSQL.
- Pruebas E2E: solicitud administrativa autenticada, incluida traduccion de conflictos.
- Comprobacion manual: capacidad antes/despues y relacion visible en la respuesta administrativa.
- Seguridad, permisos y aislamiento: permiso `deployments:execute`, IDs derivados de recursos existentes y ausencia de referencias secretas.
- Idempotencia, concurrencia y recuperacion: replay exacto, conflicto semantico y bloqueo concurrente por servidor.
- Comandos que deben aprobar: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:contracts`, `pnpm test:integration`, `pnpm build` y comprobaciones de migracion en VPS.

## Recuperacion

- Compatibilidad o migracion: migracion aditiva; las operaciones historicas se conservan y la nueva FK solo se exige para nuevas colocaciones.
- Rollback de aplicacion: volver al digest anterior no revierte la migracion ni libera reservas.
- Recuperacion de datos, si aplica: toda correccion se hara con migracion forward-only; no editar contadores de produccion sin reconciliacion trazable.

## Evidencia de cierre

- Archivos, commits o PR: implementacion `125c5ea`, pruebas de rechazo `1deb8a7` y `8757662`, toolchain final `c3e0d6f`, excepcion exacta de falsos positivos historicos `c6d3850` y PR [#2](https://github.com/yvalois/quantum-crm/pull/2).
- Comandos y resultados: 191/191 pruebas generales y 20/20 de arquitectura aprobadas; CI completo de Node 24 aprobo formato, lint, tipos, 41 pruebas de configuracion, 191 generales, 20 de arquitectura y los 17 builds; PostgreSQL 18 desechable aplico las seis migraciones y aprobo 14/14 escenarios seleccionados, incluida la carrera atomica.
- Despliegue: migracion `20260921030000_adm_05_capacity_reservations` aplicada en staging y reejecutada sin pendientes. `admin-api` quedo saludable con digest `sha256:ffebb9c50dd5c67038709413fd2554aeb1adf24b046359042677f1ed547db518`; el migrador se verifico con digest `sha256:323be25f62cf02eac7b6b1044cd7104e3bda35d4c85b73f43df84dba7d1fac8f`.
- Documentacion actualizada: ficha, estado, checklist e inventario operativo. El servidor real conserva `UNAVAILABLE` y reservas cero; no se simulo una admision de cliente.
- Desviaciones del plan: las operaciones anteriores a esta migracion que siguieran pendientes o ejecutandose sin reserva se cancelan de forma explicita para impedir continuar con semantica incompleta. El toolchain y el migrador usan la imagen Node Bookworm fijada por digest para disponer de OpenSSL; la imagen final del servicio sigue siendo `slim`.
- Pendientes o decisiones nuevas: implementar activacion, liberacion y reconciliacion con las transiciones terminales tipadas del ejecutor `ADM-04`, y despues inventariar los recursos realmente observados. Esto mantiene `ADM-05` abierto sin invalidar esta rebanada.
