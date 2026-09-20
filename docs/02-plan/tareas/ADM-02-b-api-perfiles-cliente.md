# ADM-02-b - API protegida de perfiles de cliente

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-02`
- Requisitos relacionados: `ADM-01`, `ADM-03`, `ADM-04`, `ADM-05`, `ADM-06`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-02-a`, `ADM-01`, ADR-0002 a ADR-0007
- Bloquea a: interfaz administrativa de perfiles, membresias, aprovisionamiento y ciclo de vida
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007 y especificacion del monorepo

## Resultado esperado

Un operador autorizado puede crear, consultar, listar y editar perfiles desde `admin-api` mediante contratos runtime versionados. La API filtra por estado, servidor, release o texto, pagina con cursor estable, exige concurrencia optimista al editar y no expone modelos de persistencia.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-02`, `TenantProfile`, `tenant_profiles`, `tenants:read`, `tenants:manage`, controladores, contratos y repositorios.
- Codigo o documentacion encontrados: agregado e invariantes de `TenantProfile`, schema y migracion de plataforma, permisos administrativos, guardas globales y filtro RFC 9457.
- Pruebas e historial encontrados: pruebas de dominio, migracion PostgreSQL real, membresias administrativas y frontera HTTP autenticada de `ADM-01`.
- Decision de reutilizacion, extension o reemplazo: extender el modulo `tenants`, el adaptador PostgreSQL y la composicion existente; no crear otra entidad, tabla ni mecanismo de autenticacion.

## Alcance

### Incluido

- Schemas runtime y tipos HTTP v1 para crear, obtener, listar y actualizar perfiles.
- Puerto de repositorio y casos de uso del modulo `tenants`.
- Adaptador PostgreSQL parametrizado con seleccion acotada y cursor estable.
- Endpoints protegidos por `tenants:read` y `tenants:manage`.
- `ETag` e `If-Match` para impedir actualizaciones perdidas.
- Pruebas unitarias, de contrato, infraestructura y HTTP.

### No incluido

- Membresias de usuarios dentro de cada perfil.
- Interfaz de `admin-web`.
- Aprovisionamiento, activacion, suspension operativa o eliminacion.
- Marcar `ADM-02` completo.

## Impacto tecnico

| Area                       | Impacto previsto                                                      |
| -------------------------- | --------------------------------------------------------------------- |
| Aplicaciones y modulos     | Casos de uso e interfaz HTTP de `tenants` en `admin-api`              |
| Contratos y eventos        | Contratos `tenant-profile/v1`; sin eventos nuevos                     |
| Datos y migraciones        | Sin cambio de schema; repositorio sobre `tenants.tenant_profiles`     |
| Permisos y aislamiento     | Lectura y gestion separadas; plataforma no consulta datos comerciales |
| Configuracion y secretos   | Sin variables ni secretos nuevos                                      |
| Observabilidad y operacion | Errores publicos acotados; sin datos sensibles en fallos              |
| Documentacion              | Ficha y estado con evidencia de la rebanada                           |

## Plan de implementacion

- [ ] Definir contratos runtime de entrada y salida.
- [ ] Implementar puerto, casos de uso y errores del modulo.
- [ ] Implementar repositorio PostgreSQL con filtros, cursor y version.
- [ ] Publicar controladores protegidos y semantica RFC 9457/ETag.
- [ ] Agregar y ejecutar pruebas aplicables.
- [ ] Registrar evidencia y pendientes sin cerrar `ADM-02`.

## Riesgos y mitigaciones

| Riesgo                          | Mitigacion                                                            | Verificacion                      |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------- |
| Sobrescritura concurrente       | `If-Match` obligatorio y actualizacion condicional por version        | Prueba de version obsoleta        |
| Consulta ilimitada o inyectable | Schemas estrictos, filtros permitidos, parametros SQL y limite maximo | Pruebas de contrato y repositorio |
| Permiso insuficiente            | Guardas del servidor por operacion                                    | Pruebas 401/403                   |
| Filtrar detalles internos       | Errores de aplicacion traducidos a RFC 9457                           | Pruebas HTTP                      |
| Acoplar API a PostgreSQL        | Dominio y aplicacion dependen de un puerto                            | Prueba arquitectonica y typecheck |

## Criterios de aceptacion

- [ ] Crear normaliza y persiste un perfil valido, y rechaza slug duplicado sin revelar SQL.
- [ ] Obtener y listar requieren `tenants:read`; crear y editar requieren `tenants:manage`.
- [ ] El listado admite filtros acotados y cursor opaco con orden determinista.
- [ ] La edicion exige la version observada y rechaza conflictos sin perder cambios.
- [ ] Entradas y salidas se validan con schemas de `packages/contracts`.
- [ ] Las pruebas y puertas afectadas aprueban.

## Plan de verificacion

- Pruebas unitarias: contratos, casos de uso y traduccion de errores.
- Pruebas de integracion o contratos: consultas parametrizadas, filtros, cursor, conflicto y unicidad.
- Pruebas E2E: smoke HTTP autenticado de las rutas administrativas; la UI queda para otra rebanada.
- Comprobacion manual: respuestas, permisos, `ETag`, cursores y ausencia de campos internos.
- Seguridad, permisos y aislamiento: 401 sin identidad, 403 sin permiso y ninguna consulta a bases comerciales.
- Idempotencia, concurrencia y recuperacion: slug unico y actualizacion condicional por version; no hay efectos externos.
- Comandos que deben aprobar: pruebas afectadas, `pnpm run ci` y smoke contra PostgreSQL real en el VPS.

## Recuperacion

- Compatibilidad o migracion: API v1 aditiva sobre tabla existente; no requiere migracion.
- Rollback de aplicacion: retirar los endpoints no modifica ni elimina perfiles persistidos.
- Recuperacion de datos, si aplica: no aplica; no se ejecutan cambios destructivos.

## Evidencia de cierre

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
