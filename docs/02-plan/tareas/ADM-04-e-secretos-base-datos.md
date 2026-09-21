# ADM-04-e - Credenciales idempotentes del perfil

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-04`.
- Requisitos relacionados: `ADM-03`, `ADM-05`, `ADM-12`, `ADM-20`, `OPS-04`, `OPS-14`, `OPS-16` y `PROY-023`.
- Fase del MVP: fase 2, administracion de la plataforma.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: `ADM-04-d`, `OPS-04-a` y `OPS-23-a`.
- Bloquea a: migrador por perfil, escritura de configuracion y los pasos posteriores de despliegue.
- ADR, arquitectura o diseno aplicables: ADR-0003, ADR-0008, ADR-0009, ADR-0010, ADR-0011, ADR-0016, `docs/08-arquitectura/mapa-del-sistema.md` y `docs/08-arquitectura/monorepo.md`.

## Resultado esperado

Una operacion validada en `CREATE_SECRETS` genera o reutiliza las contrasenas criptograficamente aleatorias de los roles migrador y runtime ya creados por `CREATE_DATABASE`, las aplica con `LOGIN` y las instala como archivos privados fuera del checkout. La plataforma conserva unicamente referencias, tipo, version y estado. Los reintentos y reinicios convergen a los mismos archivos sin imprimir, persistir ni devolver valores secretos.

## Lectura obligatoria aplicada

- [x] Requisito, fase, checklist, estado y ficha `ADM-04-d` revisados.
- [x] Implementacion, pruebas e historial de solicitud, leases, validacion y base PostgreSQL auditados.
- [x] Reglas de secretos, entrega, observabilidad, trabajos asincronos y ADR relacionados revisados.

## Auditoria del trabajo existente

- Busquedas realizadas: `CREATE_SECRETS`, `tenant_databases`, `QCRM_CRM_DATABASE_URL_SECRET_FILE`, `provision-secrets`, `deploy-executor` y rutas de secretos.
- Codigo o documentacion encontrados: `CREATE_DATABASE` deja dos roles `NOLOGIN` sin contrasena; ADR-0008 exige archivos fuera del checkout y referencias sin valores; `deploy-executor` ya posee el limite de operaciones tipadas.
- Pruebas e historial encontrados: `ADM-04-d` valido idempotencia, fencing y ausencia de contrasenas; no existe todavia materializacion de secretos de perfiles.
- Decision de reutilizacion, extension o reemplazo: extender el executor y el repositorio de plataforma con un adaptador tipado de filesystem y PostgreSQL. No se crea un segundo flujo de despliegue ni se habilita shell o SQL recibido por HTTP.

## Alcance

### Incluido

- Generacion idempotente de contrasenas para roles migrador y runtime.
- Habilitacion de `LOGIN` y aplicacion de contrasenas mediante la conexion administrativa separada.
- Archivos `0400` bajo el directorio de secretos de perfiles montado exclusivamente en `deploy-executor`.
- Referencias relativas, tipo, version y estado durables en `tenants.tenant_database_secrets`, sin valores ni URLs completas.
- Claim, fencing, resultado durable y avance a `CREATE_STORAGE`.
- Reconciliacion de archivos existentes, rechazo de symlinks, paths fuera de raiz, identidades incompatibles y secretos invalidos.

### No incluido

- Rotacion, revocacion o recuperacion de secretos existentes.
- Generacion de URLs de conexion o escritura de Compose; pertenece a `WRITE_CONFIGURATION`.
- Migraciones comerciales, configuracion del perfil, contenedores, almacenamiento, Keycloak, Caddy o activacion.
- Perfiles reales en staging o produccion.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `deploy-executor`, `platform-domain` y `database`. |
| Contratos y eventos | Comandos internos tipados para provisionar y confirmar `CREATE_SECRETS`; contrato HTTP v1 compatible. |
| Datos y migraciones | Tabla aditiva de referencias de secretos y nuevos codigos de fallo; migracion forward-only. |
| Permisos y aislamiento | Solo el executor recibe el bind mount de secretos; cada referencia deriva del UUID del perfil. |
| Configuracion y secretos | `QCRM_TENANT_SECRET_DIRECTORY` apunta a una raiz fuera del checkout; el proceso lee y escribe archivos atomicos sin exponer valores. |
| Observabilidad y operacion | Resultados y logs contienen solo tipo, referencia, version y codigos acotados. |
| Documentacion | Esta ficha, estado, ADR, mapa, README de infraestructura y plantilla Compose. |

## Plan de implementacion

- [x] Registrar la decision de almacenamiento de secretos de perfil y su referencia relativa.
- [x] Crear migracion, enums, constraints y modelo Prisma para referencias sin valores.
- [x] Definir puerto y adaptador idempotente de PostgreSQL/filesystem con aleatoriedad criptografica.
- [x] Implementar handler de `CREATE_SECRETS` con lease, fencing y avance durable.
- [x] Montar la raiz de perfiles solo en `deploy-executor` y preparar el directorio del host.
- [x] Cubrir repeticion, symlink/path traversal, conflicto, permisos, fencing y ausencia de valores en resultados.
- [x] Validar una vez en VPS con datos desechables y luego ejecutar la matriz CI del commit final.
- [x] Registrar evidencia y preparar pull request.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Repetir el paso cambia una credencial activa | Reutilizar archivo valido y aplicar la misma contrasena al rol; nunca sustituir silenciosamente un archivo existente. | Dos ejecuciones conservan bytes y referencias. |
| El executor escribe fuera de su perfil | Raiz fija, UUID validado, `lstat`, rechazo de symlinks y nombres derivados. | Intentos con path malformado fallan sin crear archivos. |
| Se filtra una contrasena | Valores solo viven en memoria y archivos `0400`; se excluyen de filas, excepciones y resultados. | Escaneo de logs/JSON y canario sintético. |
| Archivo creado pero SQL no confirmado | Reintento lee el archivo, vuelve a aplicar la contraseña y verifica atributos del rol. | Reinicio entre fases converge. |

## Criterios de aceptacion

- [x] Cada base creada obtiene exactamente dos referencias: migrador y runtime.
- [x] Los roles quedan con `LOGIN`, sin privilegios administrativos y con contraseña no vacia.
- [x] Los archivos existen fuera del checkout, son regulares, no son symlinks y tienen modo `0400`.
- [x] La segunda ejecucion es idempotente y no rota bytes existentes.
- [x] La plataforma no contiene valores, URLs completas ni material criptografico.
- [x] Un lease perdido no permite confirmar el resultado ni avanzar el paso.
- [x] El executor conserva ausencia de shell y Docker socket.

## Plan de verificacion

- Pruebas unitarias: referencias, nombres, aleatoriedad validada, paths, permisos y transiciones.
- Pruebas de integracion o contratos: PostgreSQL 18 desechable, roles, migracion, fencing y repeticion.
- Pruebas E2E: proceso real del executor con raiz de secretos temporal y perfil sintético.
- Comprobacion manual: mount exclusivo, modo `0400`, usuario del contenedor y ausencia de archivos en Git.
- Seguridad, permisos y aislamiento: otro perfil no puede leer ni reutilizar la referencia; el runtime no recibe credenciales del executor.
- Idempotencia, concurrencia y recuperacion: dos workers, reinicio tras archivo/SQL y conflicto de identidad.
- Comandos que deben aprobar: matriz CI oficial y validacion dirigida en VPS; no se ejecuta el proyecto en el equipo local.

## Recuperacion

- Compatibilidad o migracion: migracion aditiva; un executor anterior deja pendiente `CREATE_SECRETS`.
- Rollback de aplicacion: detiene nuevos efectos, pero no elimina contrasenas ni archivos ya creados.
- Recuperacion de datos, si aplica: revocacion/rotacion autorizada separada; nunca borrar o sustituir archivos como rollback automatico.

## Evidencia de cierre

- Archivos, commits o PR: commits `db39a0d` y `513845b`; [PR #6](https://github.com/yvalois/quantum-crm/pull/6).
- Comandos y resultados: CI oficial 7/7 verde (static, unit, integration, contracts, build y seguridad). En VPS se construyeron `platform-domain` y `database` con Node 24; PostgreSQL 18.1 desechable aplico las 10 migraciones. La primera ejecucion creo dos archivos de 65 bytes y habilito ambos roles; la segunda devolvio `reconciled=true` con las mismas referencias. `stat` confirmo archivos regulares `0400`; PostgreSQL confirmo `LOGIN=true`, `SUPERUSER=false`, `CREATEROLE=false`, `CREATEDB=false` para migrador y runtime.
- Documentacion actualizada: esta ficha, `docs/04-proceso/estado.md`, ADR-0017, README de decisiones, mapa del sistema, README de infraestructura, Compose y provision de secretos.
- Desviaciones del plan: no se desplego staging ni se crearon perfiles reales; el checkout, contenedor PostgreSQL, volumen y secretos sinteticos del VPS fueron retirados al terminar. No se expusieron valores de contrasena.
- Pendientes o decisiones nuevas: `WRITE_CONFIGURATION` debe derivar las URLs de conexion y montar cada archivo exacto por servicio; el PR requiere aprobacion humana antes de integrar.
