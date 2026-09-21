# ADM-04-d - Creacion idempotente de la base del perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`.
- Requisitos relacionados: `ADM-03`, `ADM-05`, `ADM-09`, `ADM-12`, `ADM-20`, `OPS-04`, `OPS-14` y `OPS-16`.
- Fase del MVP: fase 2, administracion de la plataforma.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `ADM-04-c`, `OPS-04-a`, `ADM-05-b` y `ADM-09-a`.
- Bloquea a: `CREATE_SECRETS`, migrador por perfil, runtime comercial y los pasos posteriores de despliegue.
- ADR, arquitectura o diseno aplicables: ADR-0003, ADR-0006, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0016, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/08-arquitectura/monorepo.md`.

## Resultado esperado

Una operacion validada en `CREATE_DATABASE` crea o reconcilia, mediante un adaptador SQL administrativo tipado y de privilegio minimo, la base PostgreSQL exclusiva del perfil y sus identidades de migracion y runtime. El efecto es reanudable: reinicios, reintentos, carreras y resultados inciertos convergen a los mismos nombres y propiedades sin crear otra base, otro rol ni otro resultado de paso. La operacion solo avanza cuando la configuracion observada coincide exactamente con la identidad del perfil y el servidor registrado; nunca se guardan contrasenas ni se acepta SQL libre.

## Lectura obligatoria aplicada

- [x] Requisito, fase, checklist, estado y fichas anteriores revisados.
- [x] Implementacion, pruebas e historial de solicitud, reservas, leases y validacion auditados.
- [x] Reglas y ADR de aislamiento, persistencia, secretos, entrega, observabilidad y trabajos asincronos revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `CREATE_DATABASE`, `deploy-executor`, `claimNext`, `completeValidation`, `TenantProfile`, `ProvisioningOperation`, `OPS-14`, roles y bases por perfil.
- Codigo o documentacion encontrados: la operacion y su resultado durable ya existen; `VALIDATE` avanza a `CREATE_DATABASE`; el ejecutor todavia filtra ese paso y no recibe DDL, Docker ni secretos de host. La infraestructura declara una base y roles separados por perfil, pero el aprovisionamiento dinamico continua pendiente.
- Pruebas e historial encontrados: integracion PostgreSQL 18 para leases, fencing, validacion y aislamiento de roles; no existe aun una prueba de creacion dinamica por perfil.
- Decision de reutilizacion, extension o reemplazo: extender dominio, contratos y adaptadores existentes. La escritura se encapsula en un puerto `TenantDatabaseProvisioner`; el executor solo usa un handler para `CREATE_DATABASE` y el adaptador valida una allowlist de identificadores derivados del UUID. No se crea un segundo flujo de despliegue ni se habilita shell, Docker o SQL recibido por HTTP.

## Alcance

### Incluido

- Metadatos durables de la base objetivo del perfil (nombre de base, roles logicos, servidor PostgreSQL y estado), sin valores de contrasena.
- Conexion administrativa separada, montada por archivo y limitada a crear/reconciliar las bases y roles de perfiles autorizados.
- Creacion idempotente de una base por perfil, rol migrador y rol runtime, con `PUBLIC CONNECT` revocado y privilegios iniciales cerrados.
- Claim y finalizacion cercada por operacion, paso, intento, lease, propietario y version; un resultado por intento.
- Reintento tras reinicio o respuesta incierta mediante observacion antes de repetir.
- Pruebas de integracion en PostgreSQL 18 desechable para exito, repeticion, carrera, conflicto de identidad, fencing y ausencia de secretos.

### No incluido

- Generacion, almacenamiento o rotacion de contrasenas y archivos secretos (`CREATE_SECRETS`).
- Schemas comerciales, migraciones de CRM, checkpoints, Keycloak, SeaweedFS, Redis, Compose, Caddy o activacion del perfil.
- Cambiar la politica de una base ya existente, renombrar recursos o borrar una base como rollback.
- Crear perfiles, releases o datos sinteticos persistentes en staging.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `deploy-executor`, `platform-domain` y adaptador PostgreSQL de plataforma. |
| Contratos y eventos | Comandos internos tipados para solicitar y confirmar `CREATE_DATABASE`; el contrato HTTP v1 conserva compatibilidad. |
| Datos y migraciones | Tabla aditiva de destinos de base y resultado de paso; migracion forward-only. |
| Permisos y aislamiento | Usuario administrativo separado del runtime; nombres derivados del UUID, verificacion de propiedad y `PUBLIC CONNECT` revocado. |
| Configuracion y secretos | Referencia `*_FILE` para el conector administrativo; nunca contrasenas en Git, filas, logs o resultados. |
| Observabilidad y operacion | Codigos acotados para conflicto, no encontrado, permiso y respuesta incierta; metricas sin nombres de base ni credenciales. |
| Documentacion | Esta ficha, estado, arquitectura e inventario al desplegar. |

## Plan de implementacion

- [ ] Modelar identidad y estado del destino de base sin secretos.
- [ ] Crear migracion y constraints para un destino por perfil y nombres inmutables.
- [ ] Definir puerto tipado de provision y adaptador PostgreSQL con identificadores allowlisted.
- [ ] Implementar handler de `CREATE_DATABASE` con lease, fencing, resultado durable y reconciliacion.
- [ ] Exponer al ejecutor solo la referencia de conexion administrativa necesaria, sin Docker ni shell.
- [ ] Cubrir idempotencia, concurrencia, reinicio, conflicto y no filtracion de secretos.
- [ ] Validar una vez en VPS con PostgreSQL 18 desechable y luego ejecutar la matriz CI completa del commit final.
- [ ] Registrar evidencia y preparar pull request.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Repetir un efecto despues de una respuesta incierta | Consultar por nombres e identidad antes de crear y reconciliar propiedades esperadas. | Segunda ejecucion conserva un unico recurso y resultado. |
| Un perfil obtiene una base ajena | Nombres derivados del UUID, destino registrado, permisos cerrados y comprobacion de propietario. | Intento con identidad distinta falla sin modificar el recurso. |
| El rol administrativo se filtra al runtime | Secreto separado por archivo, sin mount en API/worker/agent, y redaccion de errores. | Inspeccion de manifiesto y canario ausente en logs. |
| Carrera entre ejecutores | Lease y fencing en plataforma; lock breve sobre la identidad del perfil en el servidor PostgreSQL. | Dos workers producen una sola base y un solo resultado efectivo. |
| Error parcial entre base y metadatos | Registrar metadatos solo despues de observar el recurso; reconciliacion reanudable y sin borrado automatico. | Reinicio entre fases converge sin duplicar ni marcar exito prematuro. |

## Criterios de aceptacion

- [ ] Un perfil validado obtiene exactamente una base PostgreSQL y dos roles con nombres derivados de su UUID.
- [ ] La segunda ejecucion y una carrera concurrente no crean recursos ni resultados duplicados.
- [ ] Un lease perdido, version obsoleta o identidad incompatible no puede confirmar el paso.
- [ ] La base revoca `PUBLIC CONNECT`; los roles runtime/migrador no son superusuario ni pueden crear otros roles o bases.
- [ ] No se persisten ni exponen contrasenas, URLs completas, SQL libre ni nombres de perfiles no autorizados.
- [ ] El ejecutor continua sin socket Docker y sin comandos arbitrarios.
- [ ] La validacion VPS y la matriz CI del commit final aprueban sin modificar datos persistentes de staging.

## Plan de verificacion

- Pruebas unitarias: derivacion de nombres, validacion de comandos, transiciones y codigos de fallo.
- Pruebas de integracion o contratos: PostgreSQL 18 desechable, DDL administrativo, constraints, aislamiento y reintentos.
- Pruebas E2E: proceso real del executor contra una base sintetica; staging solo confirma health y ausencia de operaciones inventadas.
- Comprobacion manual: mounts, usuario, capacidades, red privada y ausencia de Docker socket.
- Seguridad, permisos y aislamiento: runtime sin DDL; cruces de perfil y plataforma rechazados; secretos fuera de filas, JSON y logs.
- Idempotencia, concurrencia y recuperacion: reintento, carrera, lease vencido, respuesta incierta y reinicio.
- Comandos que deben aprobar: puertas de CI y migraciones desde cero ejecutadas en el VPS autorizado.

## Recuperacion

- Compatibilidad o migracion: migracion aditiva y forward-only; el executor anterior ignora operaciones cuyo paso no soporta.
- Rollback de aplicacion: volver al digest anterior detiene nuevos efectos, pero no elimina bases creadas.
- Recuperacion de datos, si aplica: reconciliacion o operacion compensatoria autorizada; nunca `DROP DATABASE` automatico ni restauracion implicita.

## Evidencia de cierre

- Archivos, commits o PR: pendiente hasta implementar.
- Comandos y resultados: pendiente; se ejecutaran solo en el VPS.
- Documentacion actualizada: ficha y estado durante el trabajo; arquitectura e inventario al desplegar.
- Desviaciones del plan: ninguna conocida.
- Pendientes o decisiones nuevas: `CREATE_SECRETS` debe consumir los nombres registrados sin volver a crear ni renombrar recursos.
