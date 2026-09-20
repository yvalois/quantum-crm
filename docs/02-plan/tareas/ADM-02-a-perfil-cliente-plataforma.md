# ADM-02-a - Perfil de cliente persistente en plataforma

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-02`
- Requisitos relacionados: `ADM-03`, `ADM-04`, `ADM-05`, `ADM-06`, `OPS-04`, `OPS-14`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `OPS-04-a`, ADR-0002, ADR-0003 y ADR-0006
- Bloquea a: ciclo de vida, aprovisionamiento, asignacion de VPS, releases, despliegues y respaldos por perfil
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0003, ADR-0006, reglas de persistencia y especificacion del monorepo

## Resultado esperado

La plataforma dispone del primer agregado propietario `TenantProfile`, un schema Prisma 7 y una migracion `platform` real. El perfil conserva UUID inmutable, nombre, slug, contacto administrativo, estado y referencias estables de servidor y release; runtime puede operar datos pero no ejecutar DDL.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-02`, `TenantProfile`, `tenant_profiles`, `platform-domain`, historias Prisma y migraciones.
- Codigo o documentacion encontrados: `platform-domain` y la historia `platform` estan especificados pero vacios; `OPS-04-a` ya aporta conexiones y roles separados.
- Pruebas e historial encontrados: CI y aislamiento PostgreSQL 18 acreditados; no existe schema, migracion ni agregado de plataforma.
- Decision de reutilizacion, extension o reemplazo: extender `platform-domain`, iniciar exclusivamente la historia Prisma `platform` y reutilizar la carga segura de secretos.

## Alcance

### Incluido

- Agregado y reglas puras del perfil en el modulo `tenants`.
- Schema Prisma 7 de plataforma con namespace PostgreSQL propietario.
- Primera migracion forward-only y runner controlado por archivo secreto.
- Validacion desde cero con roles migrador/runtime separados.
- Pruebas de invariantes, schema, migracion y privilegios.

### No incluido

- HTTP, UI, autenticacion o autorizacion administrativa de `ADM-01`.
- Membresias de usuarios, activacion/suspension completa o aprovisionamiento de `ADM-03`/`ADM-04`.
- Tablas de infraestructura o releases; solo referencias UUID sin claves foraneas entre modulos.
- Marcar `ADM-02` completo.

## Impacto tecnico

| Area                       | Impacto previsto                                                |
| -------------------------- | --------------------------------------------------------------- |
| Aplicaciones y modulos     | Primer agregado en `platform-domain/tenants`                    |
| Contratos y eventos        | Ninguno publico todavia                                         |
| Datos y migraciones        | Historia `platform`, schema `tenants` y tabla `tenant_profiles` |
| Permisos y aislamiento     | Migrador propietario; runtime con DML y sin DDL                 |
| Configuracion y secretos   | URL de migracion leida desde archivo separado                   |
| Observabilidad y operacion | `db:check` reproducible y errores sin URL                       |
| Documentacion              | Ficha y estado; sin presentar `ADM-02` como terminado           |

## Plan de implementacion

- [x] Modelar invariantes del perfil en dominio puro.
- [x] Fijar Prisma 7 y crear schema/migracion de plataforma.
- [x] Implementar configuracion de migracion por archivo secreto.
- [x] Agregar validaciones unitarias, arquitectonicas y PostgreSQL real.
- [x] Ejecutar CI y `db:check` en el VPS.
- [x] Registrar evidencia sin cerrar `ADM-02`.

## Riesgos y mitigaciones

| Riesgo                         | Mitigacion                                                   | Verificacion                     |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------- |
| Mezclar empresa y contacto CRM | Tabla exclusiva de plataforma y modulo propietario `tenants` | Schema y limites de imports      |
| Slugs ambiguos o reutilizados  | Normalizacion, constraint e indice unico case-insensitive    | Pruebas de dominio e integracion |
| Runtime con privilegios DDL    | Migrador separado y grants DML explicitos                    | `CREATE TABLE` rechazado         |
| Deriva schema/migracion        | Aplicar desde cero y comparar estructura esperada            | `db:check` contra PostgreSQL 18  |
| Crear APIs sin seguridad       | HTTP/UI quedan fuera hasta integrar `ADM-01`                 | Revision de alcance              |

## Criterios de aceptacion

- [x] El dominio rechaza UUID, nombre, slug, email y estados invalidos.
- [x] La migracion crea solo objetos propietarios del modulo `tenants`.
- [x] UUID se genera con PostgreSQL 18 y slug es unico sin distinguir mayusculas.
- [x] Estado, servidor y release permiten los futuros filtros de `ADM-02`.
- [x] Runtime puede crear, leer y actualizar perfiles pero no cambiar el schema.
- [x] La migracion se aplica con credencial separada cargada desde archivo.
- [x] CI y prueba PostgreSQL real aprueban en el VPS.

## Plan de verificacion

- Pruebas unitarias: normalizacion e invariantes del agregado.
- Pruebas de integracion o contratos: migracion desde cero, restricciones, unicidad y grants.
- Pruebas E2E: no aplica hasta disponer de `ADM-01` y contratos HTTP.
- Comprobacion manual: schema coincide con propiedad de datos del modulo.
- Seguridad, permisos y aislamiento: runtime sin DDL; base de plataforma sin tablas comerciales.
- Idempotencia, concurrencia y recuperacion: migracion inmutable aplicada una vez; correcciones futuras son forward-only.
- Comandos que deben aprobar: `pnpm db:check`, `pnpm test`, `pnpm test:architecture` y `pnpm run ci`.

## Recuperacion

- Compatibilidad o migracion: primera version, sin datos previos.
- Rollback de aplicacion: el codigo anterior ignora la tabla; no se revierte automaticamente la migracion aplicada.
- Recuperacion de datos, si aplica: no aplica a la base sintetica de prueba.

## Evidencia de cierre

- Archivos, commits o PR: agregado `TenantProfile` en `packages/platform-domain`, configuracion segura en `packages/config`, schema, migracion y comandos Prisma 7 en `packages/database`, prueba PostgreSQL en `tests/integration` y soporte OpenSSL en la toolchain Node. Commits locales `8641f90`, `bb045ef`, `062436e`, `bcf6412`, `4069757` y `4ca912f` en `feat/ADM-02-tenant-profile`, sin remoto ni PR.
- Comandos y resultados: `pnpm db:check` valido el schema y genero Prisma Client 7.10.0. `pnpm run ci` aprobo en el VPS con Node 24.21.0 fijado por digest: formato, lint, typecheck y build de 17 workspaces, 21 pruebas de configuracion, 48 pruebas generales y 9 pruebas de arquitectura.
- Migracion e integracion: PostgreSQL 18 fijado por digest aplico la migracion desde cero; la segunda ejecucion informo `No pending migrations` y `prisma migrate diff` informo `No difference detected`. Las 3 pruebas de integracion verificaron UUIDv7, restricciones, slug canonico y unico, DML de runtime y rechazo de DDL. La comprobacion final confirmo PostgreSQL 18, migrador sin superusuario y runtime sin `CREATE` en `tenants`.
- Imagen de construccion: el target `toolchain` de `infra/docker/Dockerfile.node` se construyo correctamente en el VPS con OpenSSL y certificados; la imagen temporal de verificacion se retiro al terminar.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`; el checklist funcional no se marca porque aun faltan casos de uso, autorizacion, membresias, busqueda y UI.
- Desviaciones resueltas: se excluyo el cliente Prisma generado de lint, Vitest y pruebas de limites; los defaults SQL se alinearon con Prisma hasta obtener deriva cero; la prueba separa el duplicado exacto del rechazo de un slug no canonico.
- Pendientes o decisiones nuevas: `ADM-02` sigue `EN_CURSO`. La siguiente rebanada implementara repositorio, casos de uso y contratos protegidos despues de establecer `ADM-01`; siguen pendientes busqueda/filtros, membresias e interfaz administrativa.
