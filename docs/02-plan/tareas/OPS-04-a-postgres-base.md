# OPS-04-a - Conexion PostgreSQL segura por perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `OPS-04`
- Requisitos relacionados: `OPS-02`, `OPS-03`, `OPS-10`, `OPS-14`, `OPS-19`, `OPS-21`, `OPS-23`, `ADM-04` y `ADM-13`
- Fase del MVP: 1. Bootstrap tecnico
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `OPS-01-d`, PostgreSQL 18, ADR-0003, ADR-0006 y ADR-0008
- Bloquea a: repositorios comerciales, plataforma administrativa, migraciones, outbox, auditoria, colas y aprovisionamiento por perfil
- ADR, arquitectura o diseno aplicables: ADR-0003, ADR-0006, ADR-0008, `docs/05-reglas/03-seguridad-y-datos.md`, `docs/05-reglas/07-persistencia-y-migraciones.md`, `docs/05-reglas/08-entornos-configuracion-secretos.md` y `docs/08-arquitectura/monorepo.md`

## Resultado esperado

`api` y `worker` reciben exclusivamente la conexion runtime de su perfil, mientras `admin-api` recibe exclusivamente la conexion de plataforma. Las credenciales se leen una vez desde un archivo autorizado, nunca desde una variable en texto, y cada proceso falla antes de readiness si falta la configuracion o PostgreSQL no responde. Una prueba real con dos perfiles sinteticos demuestra que sus roles no pueden conectarse a la base ajena y que el rol runtime no puede ejecutar DDL.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/03-operaciones/despliegues.md` y relacion con producto revisada en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas relacionadas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `OPS-04`, `packages/database`, `DATABASE_URL`, `PostgreSQL`, `Prisma`, configuracion runtime, composition roots, health y manifiestos Compose.
- Codigo o documentacion encontrados: `packages/database` solo exporta su identificador; no existen cliente, schema, migraciones ni dependencias PostgreSQL. `packages/config` ya centraliza variables `QCRM_*`, pero no consume secretos. Los procesos exponen health, aunque readiness aun no consulta dependencias.
- Pruebas e historial encontrados: `OPS-01-a` a `OPS-01-d` acreditan monorepo, procesos, imagenes, Compose y configuracion base; no existe prueba real de aislamiento entre bases.
- Decision de reutilizacion, extension o reemplazo: extender `packages/config`, `packages/database` y los composition roots existentes. Se usa el driver `pg` para bootstrap y probes; Prisma 7 y sus tres historias se agregaran cuando exista el primer schema propietario, sin inventar tablas vacias ni migraciones ficticias.

## Alcance

### Incluido

- Carga segura y redactada de `QCRM_DATABASE_URL_FILE` desde `packages/config`.
- `QCRM_TENANT_ID` obligatorio para conexiones CRM y prohibido para la conexion de plataforma.
- Paths fijos bajo `/run/secrets` en preview, staging y produccion; validacion de archivo regular, tamano, symlinks y contenido.
- Pool PostgreSQL con limites y timeouts definidos, probe parametrizado y cierre ordenado en `packages/database`.
- Integracion de la conexion en `api`, `worker` y `admin-api` antes de readiness.
- Secrets Compose montados solo en los servicios consumidores.
- Pruebas unitarias, de arquitectura e integracion real con dos perfiles sinteticos y una base de plataforma.

### No incluido

- Modelos comerciales, repositorios de modulos, outbox, inbox, auditoria o datos iniciales.
- Primera migracion Prisma; no existe aun un schema propietario que justifique crearla.
- Aprovisionamiento dinamico desde `deploy-executor`, migraciones productivas o restauraciones.
- Redis, BullMQ, Keycloak, SeaweedFS, ClamAV, Caddy o respaldos.
- Datos reales, secretos productivos o ejecucion de Docker en el equipo local.

## Impacto tecnico

| Area                       | Impacto previsto                                                              |
| -------------------------- | ----------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `api`, `worker` y `admin-api` adquieren y cierran una conexion antes de ready |
| Contratos y eventos        | Ninguno                                                                       |
| Datos y migraciones        | Sin schema comercial; fixture SQL sintetico para probar privilegios           |
| Permisos y aislamiento     | Base y rol runtime distintos por perfil; plataforma separada                  |
| Configuracion y secretos   | Primer consumidor real de `*_FILE`, con redaccion y mounts minimos            |
| Observabilidad y operacion | Readiness depende de un probe seguro sin revelar host, rol, base ni URL       |
| Documentacion              | Ficha, estado, `.env.example`, Compose y guia de infraestructura              |

## Plan de implementacion

- [ ] Definir binding de base por proceso y cargar el secreto desde archivo.
- [ ] Implementar redaccion, paths permitidos y validaciones de archivo/URL.
- [ ] Implementar pool, probe y cierre PostgreSQL en `packages/database`.
- [ ] Integrar la dependencia en los tres procesos autorizados y su readiness.
- [ ] Declarar secrets y red interna en las plantillas Compose afectadas.
- [ ] Agregar pruebas unitarias, arquitectura e integracion de aislamiento.
- [ ] Ejecutar puertas de codigo y prueba real con PostgreSQL 18 en el VPS.
- [ ] Registrar evidencia y pendientes sin cerrar `OPS-04`.

## Riesgos y mitigaciones

| Riesgo                                     | Mitigacion                                                                    | Verificacion                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Filtrar la URL o password                  | Contenedor sensible redactado y errores solo por nombre logico                | Canario ausente de errores, JSON e inspeccion      |
| Conectar un perfil a otra base             | Binding inmutable, `tenant_id` configurado y credenciales sin `CONNECT` ajeno | Prueba negativa entre perfiles A y B               |
| Entregar DDL al runtime                    | Rol migrador separado; runtime sin propiedad ni `CREATE`                      | `CREATE TABLE` falla con credencial runtime        |
| Declarar ready sin PostgreSQL              | Probe antes del arranque y en readiness                                       | Caida controlada devuelve 503 o impide el arranque |
| Agotar conexiones del VPS                  | Pool pequeno y timeouts explicitos para la capacidad medida                   | Inspeccion de configuracion y smoke                |
| Confundir bootstrap con persistencia lista | No crear tablas comerciales ni marcar `OPS-04`                                | Revision de alcance, checklist y estado            |

## Criterios de aceptacion

- [ ] Solo `api`, `worker` y `admin-api` reciben configuracion PostgreSQL.
- [ ] Staging y produccion rechazan URL inline, path distinto del mount autorizado, symlink, archivo vacio o excesivo.
- [ ] Ningun error, health, JSON o inspeccion expone el secreto canario.
- [ ] Los procesos no alcanzan readiness si el probe inicial falla.
- [ ] API y worker de A conectan solo a la base A; las credenciales de A no conectan a B.
- [ ] `admin-api` conecta a plataforma y no recibe una conexion comercial.
- [ ] El rol runtime no crea objetos y el rol migrador permanece separado.
- [ ] Las puertas aplicables y la integracion PostgreSQL 18 aprueban en el VPS.

## Plan de verificacion

- Pruebas unitarias: archivo valido, ausencia, tamano, symlink, path, URL, tenant UUID, redaccion, binding y cierre.
- Pruebas de integracion o contratos: PostgreSQL 18 con plataforma y dos perfiles, roles runtime/migrador y revocacion de `PUBLIC CONNECT`.
- Pruebas E2E: arranque, readiness, perdida de conectividad y cierre de al menos un proceso representativo.
- Comprobacion manual: ningun proceso no autorizado recibe mount o referencia de base.
- Seguridad, permisos y aislamiento: cruces A/B y plataforma/CRM rechazados; password canario ausente de salidas.
- Idempotencia, concurrencia y recuperacion: bootstrap SQL de pruebas reejecutable; no hay migracion ni dato productivo que recuperar.
- Comandos que deben aprobar: `pnpm config:check`, pruebas de `packages/database`, `pnpm test:architecture`, `pnpm run ci` y suite de integracion en el VPS.

## Recuperacion

- Compatibilidad o migracion: no se modifica ningun schema persistente de producto.
- Rollback de aplicacion: volver al commit anterior y retirar los mounts agregados; no borrar volumenes.
- Recuperacion de datos, si aplica: no aplica a esta rebanada; las bases de integracion son sinteticas y desechables.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: pendiente.
- Pendientes o decisiones nuevas: Prisma 7, historias `crm`/`platform`/`agent` y el migrador controlado se implementaran con el primer schema propietario.
