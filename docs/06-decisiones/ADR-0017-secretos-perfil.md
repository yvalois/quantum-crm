# ADR 0017 Secretos de base por perfil

- Estado: aceptado
- Fecha: 2026-09-21
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, OPS-04, OPS-14, OPS-16 y PROY-023

## Contexto

`CREATE_DATABASE` crea la base y los roles migrador/runtime de un perfil, pero los deja sin `LOGIN` y sin contrasenas. El siguiente paso necesita materializar credenciales para que las aplicaciones puedan conectarse sin guardar valores en PostgreSQL de plataforma, Git, imagenes, variables o resultados de operaciones. Los reintentos pueden perderse entre el cambio SQL y la escritura del archivo, por lo que el proceso debe reconciliar ambos lados sin rotar una credencial activa de forma silenciosa.

## Decision

1. `deploy-executor` ejecuta `CREATE_SECRETS` mediante un puerto tipado que combina la conexion administrativa PostgreSQL y una raiz de filesystem dedicada. No recibe shell, paths del usuario ni SQL libre.
2. Para cada perfil se generan dos secretos: `MIGRATOR_PASSWORD` y `RUNTIME_PASSWORD`. Sus nombres y referencias derivan exclusivamente del UUID del perfil; la plataforma conserva tipo, referencia relativa, version, estado y fechas, nunca el valor.
3. La raiz se monta solo en `deploy-executor` como `/run/tenant-secrets`, procedente de `/opt/quantum/secrets/<entorno>/tenants` fuera del checkout. Cada archivo es regular, no es symlink, usa modo `0400` y se instala mediante temporal y rename atomico.
4. Si un archivo valido ya existe, el reintento reutiliza sus bytes, valida su referencia y vuelve a aplicar esa contrasena al rol esperado. Un archivo ausente se genera con `crypto.randomBytes`; un archivo invalido o con identidad distinta es un fallo terminal y no se sobrescribe.
5. La operacion habilita `LOGIN` y establece las contrasenas dentro del adaptador administrativo. Solo despues de comprobar archivos, roles e identidad el repositorio registra las referencias y avanza a `CREATE_STORAGE` con fencing de operacion, paso, intento, lease, propietario y version.
6. Las URLs de conexion y los montajes de Compose no se crean en este paso; `WRITE_CONFIGURATION` las deriva de estas referencias sin duplicar secretos.

## Alternativas consideradas

### Guardar contrasenas en la base de plataforma

Rechazada: contradice ADR-0008 y expone valores a respaldos, consultas administrativas, replicacion y resultados.

### Entregar secretos desde el frontend o CI

Rechazada: amplia el alcance de credenciales, expone forks/PR y rompe la frontera del executor.

### Regenerar en cada reintento

Rechazada: rota una credencial activa cuando el efecto anterior ya pudo llegar al consumidor.

### Montar toda la raiz de secretos en los contenedores del perfil

Rechazada: permite leer credenciales ajenas. Los pasos posteriores montaran cada archivo exacto por servicio autorizado.

## Consecuencias

- Se agrega una tabla aditiva de referencias y un directorio host para secretos de perfiles.
- El executor necesita un bind mount de escritura estrechamente acotado; los servicios de negocio no lo reciben.
- La rotacion y revocacion requieren otra operacion autorizada y no se presentan como rollback de aplicacion.
- `WRITE_CONFIGURATION` debe derivar URLs sin copiar valores a la plataforma.

## Validacion

- Dos ejecuciones conservan los mismos bytes, referencias y version.
- Un symlink, path fuera de raiz, secreto malformado o identidad incompatible falla cerrado.
- PostgreSQL muestra roles `LOGIN` sin `SUPERUSER`, `CREATEDB` ni `CREATEROLE`.
- Ningun valor aparece en filas, logs, excepciones, JSON, imagenes o manifiestos.
