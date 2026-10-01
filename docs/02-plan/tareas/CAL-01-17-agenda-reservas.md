# CAL-01-17 - Agenda, disponibilidad y reservas

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `CAL-01`.
- Requisitos relacionados: `CAL-02` a `CAL-17`, `CON-04`, `PIPE-06`, `TAR-15`, `USR-07`, `BASE-04` y `BASE-05`.
- Fase del MVP: 6. Agenda y captura.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: contactos, oportunidades, miembros activos, permisos, sesiones OIDC y shell de `crm-web`.
- Bloquea a: recordatorios externos, herramientas de calendario del agente, automatizaciones por eventos y sincronizacion externa.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0011 y ADR-0014.

## Resultado esperado

Una empresa configura calendarios y disponibilidad por asesor, consulta horarios ofrecibles, crea o recibe reservas sin solapamientos, reprograma y cambia estados conservando historial, filtra su agenda y comparte un enlace publico de reserva. Los cambios generan recordatorios y eventos durables para que canales, automatizaciones y agentes se conecten sin reimplementar el nucleo.

## Lectura obligatoria aplicada

- [x] Requisitos en `docs/01-producto/funcionalidades.md`.
- [x] Fases y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg -n -i "calendar|calendario|appointment|booking|availability|reservation" apps packages tests infra docs`.
- Codigo o documentacion encontrados: requisitos `CAL-01` a `CAL-19`, patrones completos de contactos, ventas, tareas, conversaciones, idempotencia, alcance comercial, BFF y UI Quantum Precision; no existe codigo de calendario ni migracion propietaria.
- Pruebas e historial encontrados: suites de dominio, contratos y repositorios comerciales reutilizables como patron, sin evidencia previa de calendario.
- Decision de reutilizacion, extension o reemplazo: crear el modulo propietario `calendar`, reutilizar identidad, permisos, referencias publicas de contactos/ventas/IAM, BFF y shell; no duplicar esos modulos.

## Alcance

### Incluido

- Contratos runtime de calendarios, disponibilidad, eventos, estados, historial, horarios ofrecibles y reserva publica.
- Dominio independiente de NestJS y PostgreSQL con validacion temporal, permisos y transiciones.
- Persistencia PostgreSQL con historial, idempotencia, recordatorios, outbox y exclusion de solapamientos concurrentes.
- API autenticada para configuracion y operacion, y frontera publica minima por slug para consultar horarios y reservar.
- BFF de `crm-web`, agenda Quantum Precision, formularios de calendario/cita y pagina publica de reserva.
- Eventos proximos visibles desde la ficha del contacto.

### No incluido

- Envio real por correo, WhatsApp o SMS de recordatorios; este bloque persiste su programacion para el adaptador de canal posterior.
- Tools MCP del agente y consumo de eventos por automatizaciones; este bloque entrega contratos y outbox durables.
- Sincronizacion de `CAL-19`, que exige seleccionar y aprobar el proveedor externo justo antes de implementarla.

## Impacto tecnico

| Area                       | Impacto previsto                                                        |
| -------------------------- | ----------------------------------------------------------------------- |
| Aplicaciones y modulos     | `api`, `crm-web`, `domain`, `database`, `contracts`                     |
| Contratos y eventos        | `/api/v1/calendar/*`, esquemas Zod y outbox `calendar.event.*`          |
| Datos y migraciones        | Schema PostgreSQL `calendar`, migracion forward-only                    |
| Permisos y aislamiento     | Permisos `crm:calendar:*` y alcance comercial derivado de la membresia  |
| Configuracion y secretos   | Sin secretos ni variables nuevas                                       |
| Observabilidad y operacion | Misma API/BFF; recordatorios y outbox quedan observables y recuperables |
| Documentacion              | Ficha, estado, checklist y evidencia                                    |

## Plan de implementacion

- [ ] Definir contratos y dominio del modulo calendario.
- [ ] Crear migracion y repositorio con concurrencia, idempotencia, historial, recordatorios y outbox.
- [ ] Integrar permisos, API, BFF y referencias a contactos, oportunidades y miembros.
- [ ] Implementar agenda interna y reserva publica con el sistema visual aprobado.
- [ ] Verificar el candidato en VPS, migrar el perfil sintetico y desplegar por digest.

## Riesgos y mitigaciones

| Riesgo                                      | Mitigacion                                                                  | Verificacion                                  |
| ------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| Dos reservas toman el mismo horario         | Lock transaccional y constraint de exclusion por asesor y rango             | Prueba concurrente con una sola confirmacion  |
| Errores por zona horaria o cambio de dia    | Instantes UTC, zona IANA persistida y calculo de franjas desde fecha civil   | Casos de zona, limites y horario invalido     |
| Reintento duplica evento o efectos          | Clave idempotente por principal/comando y outbox en la misma transaccion     | Repeticion con mismo y distinto payload       |
| Reserva publica cruza permisos internos     | Frontera limitada por slug activo; no acepta tenant ni permisos del cliente  | Contratos publicos y recurso inexistente      |
| Cambio visual rompe modulos existentes      | Shell compartido y rutas nuevas sin modificar handlers comerciales actuales | Build y recorrido autenticado afectado        |

## Criterios de aceptacion

- [ ] Una empresa configura calendario, asesores, franjas, excepciones y separacion entre citas.
- [ ] La agenda crea, filtra, reprograma, confirma, completa, cancela o marca inasistencia con historial.
- [ ] Contactos y oportunidades se vinculan sin permitir referencias fuera del alcance.
- [ ] Una reserva concurrente del mismo asesor y horario confirma una sola operacion.
- [ ] Un enlace publico ofrece solo horarios vigentes y confirma la reserva de manera idempotente.
- [ ] Creacion y cambios actualizan recordatorios durables y emiten eventos para integraciones posteriores.
- [ ] El mismo candidato validado se despliega en el VPS y el PR termina con checks verdes.

## Plan de verificacion

- Pruebas unitarias: transiciones, intervalos, zonas, permisos y validacion de referencias.
- Pruebas de integracion o contratos: schemas, migracion, idempotencia y concurrencia PostgreSQL.
- Pruebas E2E: crear calendario, configurar disponibilidad, reservar, reprogramar y cancelar.
- Comprobacion manual: agenda autenticada y enlace publico en el perfil sintetico.
- Seguridad, permisos y aislamiento: denegacion sin permiso, alcance comercial y slug inexistente.
- Idempotencia, concurrencia y recuperacion: repeticion de comandos, carrera del mismo horario y outbox/reminders persistentes.
- Comandos que deben aprobar: formato/lint/tipos, pruebas afectadas, migracion y builds de consumidores en VPS.

## Recuperacion

- Compatibilidad o migracion: aditiva; aplicaciones anteriores ignoran el schema nuevo.
- Rollback de aplicacion: restaurar los digests anteriores sin revertir la migracion.
- Recuperacion de datos, si aplica: no eliminar tablas; una correccion usa otra migracion forward-only.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: proveedor externo para `CAL-19` antes de cerrar la seccion completa.
