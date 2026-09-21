# ADM-09-a - Catalogo durable de releases autorizadas

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-09`.
- Requisitos relacionados: `ADM-04`, `ADM-06`, `ADM-10`, `ADM-11`, `ADM-13`, `ADM-14`, `ADM-20`, `OPS-08`, `OPS-09`, `OPS-11`, `OPS-16`.
- Fase del MVP: fase 2, administracion de la plataforma.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `ADM-01`, `ADM-04-a`, `ADM-05-b` y artefactos construidos por digest.
- Bloquea a: validacion `ADM-04-c`, aprovisionamiento real, actualizaciones y estado observado de releases.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0005, ADR-0006, ADR-0007, ADR-0009, ADR-0011, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/08-arquitectura/monorepo.md`.

## Resultado esperado

La plataforma conserva un catalogo durable de releases con identificador, version, commit, ocho artefactos por digest, notas, migraciones y compatibilidad declarada. Solo una release `VALIDATED` puede entrar en una solicitud nueva de aprovisionamiento; una candidata o retirada se rechaza dentro de la misma transaccion, sin reservar capacidad ni mutar el perfil.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-09`, `releaseId`, release, digest, catalogo, artefactos, compatibilidad, operaciones de aprovisionamiento y permisos de despliegue.
- Codigo o documentacion encontrados: `releaseId` es hoy un UUID opaco en perfiles, reservas y operaciones; no existe modulo `releases`, tabla propietaria ni validacion de estado. Las imagenes y Compose ya exigen digests, y `ADM-04`/`ADM-05` ya garantizan solicitud durable, lease y capacidad atomica.
- Pruebas e historial encontrados: contratos y pruebas de `ADM-04-a`, lease de `ADM-04-b`, admision de `ADM-05-b`, pruebas de manifiestos por digest y PR #2 integrado en `0810221`.
- Decision de reutilizacion, extension o reemplazo: agregar el modulo propietario `releases` y extender la transaccion de solicitud existente. No duplicar la operacion de despliegue ni convertir variables de entorno o tags Docker en fuente de verdad.

## Alcance

### Incluido

- Agregado TypeScript y contratos HTTP v1 para registrar, consultar y transicionar releases.
- Ocho artefactos obligatorios, cada uno identificado por nombre cerrado y digest OCI `sha256`.
- Metadatos de commit, notas, migracion requerida, compatibilidad de configuracion y contrato de agentes.
- Estados `CANDIDATE`, `VALIDATED` y `RETIRED` con transiciones cerradas y control optimista.
- Persistencia PostgreSQL, restricciones, indices y relaciones de los consumidores existentes.
- Validacion atomica de una release `VALIDATED` antes de crear reserva, operacion o mutacion del perfil.
- API protegida con `deployments:read` para consulta y `deployments:execute` para registro/transicion.
- Pruebas de dominio, contratos, API, migracion, rechazo sin efectos e integracion PostgreSQL.

### No incluido

- Workflow de GitHub que publique automaticamente la release; se implementara en la rebanada CI/CD de `ADM-09`/`OPS-09` usando el mismo contrato.
- Construir o subir imagenes, inventar digests, firmar artefactos o promover una release real.
- Ejecutar Docker, migraciones de perfiles, SeaweedFS, Caddy, Keycloak o efectos de host.
- Interfaz visual del catalogo, actualizacion de perfiles o rollback.
- Marcar `ADM-09` o `ADM-04` completos.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `admin-api`, nuevo dominio `releases`, adaptador PostgreSQL de plataforma. |
| Contratos y eventos | Contrato `platform-release/v1`; sin comandos libres ni datos secretos. |
| Datos y migraciones | Schema `releases`, release, artefactos, enum de estado y FK desde perfiles, reservas y operaciones. |
| Permisos y aislamiento | Reutiliza permisos administrativos de despliegue; denegacion por defecto en servidor. |
| Configuracion y secretos | Sin variables ni secretos nuevos. |
| Observabilidad y operacion | Conflictos diferenciados por version, identidad duplicada y release no desplegable. |
| Documentacion | Ficha, estado, checklist solo para subtareas acreditadas e inventario al desplegar. |

## Plan de implementacion

- [ ] Definir agregado, artefactos obligatorios, estados y transiciones.
- [ ] Publicar schemas v1 de entrada y salida.
- [ ] Crear migracion forward-only con invariantes y relaciones.
- [ ] Implementar repositorio y servicio de aplicacion.
- [ ] Exponer endpoints protegidos y control optimista.
- [ ] Exigir una release validada en la admision de aprovisionamiento.
- [ ] Cubrir validacion, permisos, concurrencia, idempotencia y ausencia de efectos parciales.
- [ ] Verificar en Node 24 y PostgreSQL 18 del VPS, migrar y desplegar por digest.
- [ ] Registrar evidencia y preparar pull request.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Se despliega un tag mutable o digest incompleto | Nombres cerrados, ocho artefactos exactos y regex OCI `sha256`. | Dominio, contrato y constraints SQL. |
| Se admite una release candidata o retirada | Bloqueo/lectura de la release dentro de la transaccion de admision. | Integracion comprueba rollback total. |
| Dos publicaciones crean identidades ambiguas | Unicidad de version y commit, mas `If-Match` para transiciones. | Pruebas de conflicto y concurrencia. |
| Una release validada cambia su contenido | Metadatos y artefactos inmutables; solo cambia estado/version. | API no expone edicion de contenido. |
| Se confunde catalogar con publicar desde CI | Dejar el workflow fuera de esta rebanada y no marcar esa subtarea. | Checklist y evidencia explicitos. |

## Criterios de aceptacion

- [ ] Una release valida conserva exactamente los ocho artefactos y metadatos requeridos.
- [ ] Version, commit, nombres de artefacto, digests y compatibilidad invalidos se rechazan en dominio, HTTP y PostgreSQL.
- [ ] Una release solo transita `CANDIDATE -> VALIDATED -> RETIRED`, con version esperada.
- [ ] Lectura y administracion requieren permisos distintos ya existentes.
- [ ] Una solicitud con release inexistente, candidata o retirada no crea operacion, reserva ni cambio del perfil.
- [ ] Una solicitud con release validada conserva la admision atomica e idempotente existente.
- [ ] Migraciones desde cero y desde el estado desplegado terminan sin datos huerfanos.

## Plan de verificacion

- Pruebas unitarias: agregado, artefactos exactos, digests, compatibilidad y transiciones.
- Pruebas de integracion o contratos: schemas Zod, repositorio, FK, concurrencia y admision PostgreSQL.
- Pruebas E2E: rutas HTTP protegidas en el modulo real de NestJS; smoke externo solo cuando exista ruta BFF o cliente CI autorizado.
- Comprobacion manual: registrar candidata sintetica, validarla, consultarla y demostrar rechazo/aceptacion de admision en base desechable.
- Seguridad, permisos y aislamiento: `deployments:read`/`deployments:execute`, sin secretos, URLs de registro ni credenciales en contratos.
- Idempotencia, concurrencia y recuperacion: unicidad, `If-Match`, transiciones condicionales y rollback transaccional.
- Comandos que deben aprobar: formato, lint, tipos, unitarias, contratos, arquitectura, integracion afectada, builds y migraciones en PostgreSQL 18.

## Recuperacion

- Compatibilidad o migracion: cambio aditivo; las FK historicas se agregan de forma compatible y las nuevas escrituras siempre se validan.
- Rollback de aplicacion: volver al digest anterior no elimina el catalogo ni revierte la migracion.
- Recuperacion de datos, si aplica: correcciones mediante migracion forward-only; una release retirada permanece como evidencia referenciada.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna al iniciar.
- Pendientes o decisiones nuevas: publicacion autenticada desde CI/CD y uso de la release validada por `ADM-04-c`.
