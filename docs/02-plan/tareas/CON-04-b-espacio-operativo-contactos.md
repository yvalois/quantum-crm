# CON-04-b - Espacio operativo de contactos

> Plan derivado de `CON-04`; no sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `CON-04`.
- Requisitos relacionados: `CON-02`, `CON-06`, `CON-07`, `CON-08`, `CON-10`, `CON-11`, `CON-12`, `CON-13` y `CON-14`.
- Fase del MVP: Fase 4 - Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: contactos, IAM, ventas, tareas, agenda y conversaciones existentes.
- Bloquea a: importador de GHL con asignaciones, etiquetas, origen y relaciones reutilizables.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0005, ADR-0006, ADR-0007 y ADR-0014.

## Resultado esperado

Un usuario autorizado opera Contactos desde una sola superficie de trabajo: busca, filtra, pagina, abre una ficha relacional, crea/edita, asigna, etiqueta, archiva o restaura contactos y ejecuta acciones masivas reales. Cada resultado se limita al perfil y alcance del actor en el servidor.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `CON-01` a `CON-14`, rutas CRM de contactos, contratos, dominio, controladores, repositorios y pruebas.
- Codigo encontrado: CRUD de nombre/correo/teléfono, filtros parciales, importación/exportación y relaciones existentes con oportunidades, tareas y citas.
- Pruebas e historial encontrados: `CON-01`, `CON-02` y `CON-03` tienen evidencia histórica; la pantalla sigue siendo un CRUD apilado sin búsqueda, asignación, etiquetas, archivo ni actividad.
- Decision de reutilizacion, extension o reemplazo: reutilizar permisos, alcance y relaciones propietarias; extender contratos, migración y BFF, y reemplazar la interfaz de lista por un workbench operativo.

## Alcance

### Incluido

- Búsqueda, orden estable, paginación y filtros compactos autorizados en servidor.
- Propietario, etiquetas, origen, archivo/restauración y resumen de actividad persistentes.
- Acciones individuales y masivas tipadas para asignar, etiquetar, archivar/restaurar y automatizar sin duplicar efectos.
- Ficha con perfil, actividad y relaciones disponibles de conversaciones, oportunidades, tareas y citas.
- Interfaz de Contactos de productividad: vistas, tabla, selección, barra contextual, creación/edición y detalle sin paneles permanentes que bloqueen el trabajo diario.

### No incluido

- Fusión definitiva de duplicados (`CON-09`), constructor global de campos personalizados (`CON-05`) ni reconstrucción de automatizaciones externas; quedan preparados por los identificadores, etiquetas, origen y actividades introducidos aquí.
- Integración o extracción desde GHL; la conexión se construye sobre esta base después de validar el alcance de datos.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `contacts`, contratos, base CRM, API y `crm-web`. |
| Contratos y eventos | Consulta de colección y comandos de contacto aditivos, validados en runtime. |
| Datos y migraciones | Migración forward-only de metadatos y estado operativo de contactos. |
| Permisos y aislamiento | Alcance y permisos comprobados en cada lectura y comando; ningún perfil se elige desde la interfaz. |
| Configuracion y secretos | Sin secretos nuevos. |
| Observabilidad y operacion | Resultados por contacto e idempotencia para acciones masivas. |
| Documentacion | Estado, ficha y evidencia de cierre en el mismo PR. |

## Plan de implementacion

- [ ] Extender contratos, dominio, repositorio, API y BFF con datos y comandos operativos.
- [ ] Migrar estado de archivo, origen y metadatos de lista sin perder contactos existentes.
- [ ] Reemplazar `/contacts` y la ficha por el workbench y relaciones reales.
- [ ] Añadir regresiones de consulta, permisos, archivo, etiquetas, asignación y acciones masivas.
- [ ] Validar el commit exacto en VPS, desplegar el digest y comprobar el recorrido autenticado.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Una acción masiva afecta contactos fuera del alcance | Resolver y autorizar cada ID en servidor dentro de la operación. | Prueba de usuario con alcance restringido y perfil cruzado. |
| Reintento duplica etiquetas o efectos | Comandos idempotentes y relaciones con constraints. | Repetir la misma clave y comprobar un solo resultado. |
| La lista se vuelve lenta al crecer | Cursor, límite y orden estable desde repositorio. | Prueba de paginación y consulta acotada. |
| El rediseño pierde relaciones existentes | Reutilizar contratos públicos de ventas, tareas, agenda y conversaciones. | Ficha con relaciones existentes y enlaces al origen. |

## Criterios de aceptacion

- [ ] Buscar por nombre, correo o teléfono devuelve solo contactos visibles y paginados.
- [ ] Un contacto puede recibir propietario, etiquetas, origen y archivo/restauración mediante operaciones persistentes autorizadas.
- [ ] Las acciones masivas informan resultado por contacto y no repiten efectos al reintentarse.
- [ ] La ficha relaciona actividad, oportunidades, tareas, citas y conversaciones disponibles sin leer tablas ajenas directamente.
- [ ] La interfaz permite operar los flujos anteriores desde una lista densa y clara, sin pantallas simuladas.

## Plan de verificacion

- Pruebas unitarias: validación, transiciones, etiquetas y comandos masivos.
- Pruebas de integracion o contratos: consulta paginada, alcance, archivo y asignación contra PostgreSQL.
- Pruebas E2E: buscar, crear, asignar, etiquetar, archivar/restaurar y abrir ficha.
- Comprobacion manual: recorrido autenticado completo en el perfil de desarrollo autorizado.
- Seguridad, permisos y aislamiento: actor restringido y perfil cruzado.
- Idempotencia, concurrencia y recuperacion: repetición de acción masiva y migración forward-only.
- Comandos que deben aprobar: solo comprobaciones afectadas en VPS y matriz única de CI.

## Recuperacion

- Compatibilidad o migracion: campos aditivos, con valores seguros para registros existentes.
- Rollback de aplicacion: retirar lectores y controles no elimina contactos ni relaciones existentes.
- Recuperacion de datos, si aplica: restauración aislada conforme a ADR-0015.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: esta ficha y `estado.md` al inicio.
- Desviaciones del plan: ninguna al inicio.
- Pendientes o decisiones nuevas: fusión, campos personalizados e importador GHL después de estabilizar este bloque.
