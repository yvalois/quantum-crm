# CON-02 - Filtros de contactos

> Plan derivado de `CON-02`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `CON-02`.
- Requisitos relacionados: `CON-04`, `CON-06`, `CON-07`, `CON-12`, `PIPE-14`, `USR-06`.
- Fase del MVP: Fase 4 — Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: contactos persistentes, oportunidades/pipelines y alcance server-side integrados.
- Bloquea a: acciones masivas y reportes filtrados sobre contactos.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0005, ADR-0006 y ADR-0007.

## Resultado esperado

Un usuario autorizado puede combinar filtros por etiqueta, pipeline, asesor, canal y rango de fechas sin duplicar contactos cuando existen varias oportunidades. El filtro se valida en el API, se aplica dentro del repositorio propietario y respeta siempre el alcance comercial del actor.

## Lectura obligatoria aplicada

- [x] Requisito y subtareas en `funcionalidades.md` y `trabajo.md`.
- [x] Fase, dependencias y puerta del MVP en `mvp-piloto.md`.
- [x] Estado, fichas relacionadas y busquedas de codigo, pruebas e historial.
- [x] Reglas, ADR y arquitectura de modulos aplicables.

## Auditoria del trabajo existente

- Los contactos y oportunidades ya tienen repositorios propietarios, visibilidad SQL y rutas BFF protegidas.
- No existia query tipada para contactos ni una relacion persistente de etiquetas; el pipeline y el propietario ya estaban disponibles en `sales.opportunities` y `contacts.contacts`.
- Se reutiliza la lista existente, se anade una migracion forward-only para etiquetas y se filtra con `EXISTS` para evitar duplicados por oportunidades.

## Alcance

### Incluido

- Query tipada para etiqueta, pipeline, asesor, canal derivado y rango de creacion.
- Relacion `contacts.labels`/`contacts.contact_labels` preparada para `CON-07`.
- API, BFF y controles visibles en `crm-web`; exportacion conserva los filtros activos.
- Aislamiento por perfil y alcance `PROFILE`, `TEAM`, `ASSIGNED`/`OWN` en el repositorio.

### No incluido

- Crear, editar o asignar etiquetas; pertenece a `CON-07`.
- Cambiar propietario de un contacto; pertenece a `CON-06`.
- Busqueda libre y ordenacion avanzada; pertenece a `CON-12`.

## Impacto tecnico

| Area                       | Impacto previsto                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `contacts`, `sales`, `api` y `crm-web`.                                             |
| Contratos y eventos        | Schema Zod aditivo para query de contactos.                                         |
| Datos y migraciones        | Tablas propietarias de etiquetas e indices de consulta; migracion forward-only.     |
| Permisos y aislamiento     | El repositorio combina filtros con la visibilidad del actor; no acepta `tenant_id`. |
| Configuracion y secretos   | Sin secretos nuevos.                                                                |
| Observabilidad y operacion | Sin procesos asincronos; consultas acotadas e idempotencia no afectada.             |
| Documentacion              | Ficha, estado y checklist de `CON-02`.                                              |

## Plan de implementacion

- [ ] Definir schema de filtros y tipos de dominio.
- [ ] Implementar migracion y consulta server-side sin duplicados.
- [ ] Exponer API/BFF y mantener filtros en exportacion.
- [ ] Integrar controles de filtros y opciones de pipeline/asesor en el panel.
- [ ] Añadir pruebas de combinacion, alcance y rango de fechas.
- [ ] Validar una vez en VPS y publicar un unico PR.

## Riesgos y mitigaciones

| Riesgo                                    | Mitigacion                                                           | Verificacion                                     |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Varias oportunidades duplican un contacto | `EXISTS` en lugar de `JOIN` para el criterio de pipeline.            | Prueba con dos oportunidades del mismo contacto. |
| El filtro revela otro perfil              | La predicacion de visibilidad se combina antes de todos los filtros. | Prueba de actor cruzado en repositorio/API.      |
| Query libre o parametros inesperados      | Schema estricto, UUID y fechas validados, lista cerrada de canales.  | Contrato y BFF rechazan claves desconocidas.     |

## Criterios de aceptacion

- [ ] Se pueden combinar los cinco criterios sin duplicar contactos.
- [ ] Perfil, equipo y asesor solo reciben registros visibles para su alcance.
- [ ] Pipeline y asesor no provocan `JOIN` multiplicador; un contacto aparece una sola vez.
- [ ] Fechas invalidas, UUID ajenos y canales desconocidos devuelven `400` sin consultar datos.
- [ ] La exportacion CSV respeta los mismos filtros y permisos.

## Plan de verificacion

- Pruebas unitarias: schema, normalizacion de query y servicio.
- Pruebas de integracion: SQL de etiquetas, pipeline, propietario y fechas con datos repetidos.
- Pruebas E2E: aplicar, limpiar y combinar filtros desde `crm-web`.
- Comprobacion manual: lista y exportacion reflejan exactamente el conjunto filtrado.
- Seguridad, permisos y aislamiento: `PROFILE`, `TEAM`, `ASSIGNED`/`OWN` y perfil cruzado.
- Idempotencia, concurrencia y recuperacion: no aplica a lectura; migracion forward-only.
- Comandos que deben aprobar: Prettier, typecheck y pruebas afectadas en VPS; matriz completa en GitHub.

## Recuperacion

- Compatibilidad o migracion: tablas aditivas; `CON-07` puede poblarlas sin cambiar el contrato de filtros.
- Rollback de aplicacion: retirar query y controles no borra etiquetas ni contactos.
- Recuperacion de datos: restauracion aislada conforme a ADR-0015 si la migracion requiere recuperacion.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente de validacion en VPS.
- Documentacion actualizada: esta ficha, `estado.md` y checklist de `CON-02`.
- Desviaciones del plan: ninguna al inicio.
- Pendientes o decisiones nuevas: pendiente de implementacion y verificacion.
