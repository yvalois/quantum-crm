# ADR 0016 Aprovisionamiento idempotente de bases por perfil

- Estado: aceptado
- Fecha: 2026-09-21
- Responsables: propietario del proyecto
- Requisitos relacionados: ADM-04, OPS-04, OPS-14, OPS-16 y PROY-023

## Contexto

Cada perfil de Quantum debe tener una base PostgreSQL independiente, un rol de migracion y un rol de runtime. La plataforma ya conserva la operacion, el servidor y la release, pero el usuario runtime de `admin-api` y `deploy-executor` no puede ejecutar DDL. El paso `CREATE_DATABASE` tampoco puede recibir SQL, nombres de base o comandos desde HTTP, ni puede repetir un efecto despues de perder un lease.

La creacion de la base es un efecto externo respecto de la transaccion que actualiza la operacion de plataforma. Por tanto, el ejecutor necesita reconciliar el recurso por una identidad determinista y confirmar el resultado solo despues de observar sus propiedades. Las contrasenas pertenecen a `CREATE_SECRETS` y no deben aparecer en filas de plataforma ni en resultados de pasos.

## Decision

1. `deploy-executor` usa un puerto interno `TenantDatabaseProvisioner` con un adaptador PostgreSQL administrativo separado del pool runtime. La conexion se monta mediante `QCRM_DATABASE_ADMIN_URL_FILE` solo en ese proceso, con un rol sin superusuario y con los privilegios estrictamente necesarios para crear y reconciliar bases y roles de perfiles.
2. Los nombres se derivan exclusivamente del UUID inmutable del perfil: una base, un rol migrador y un rol runtime. No se aceptan identificadores libres ni interpolacion de SQL externo. El adaptador valida la forma, usa identificadores quoteados y comprueba propietario, atributos y destino antes de considerar exitoso el paso.
3. La base se crea con `PUBLIC CONNECT` revocado. Los roles de perfil nacen sin privilegios de superusuario, creacion de roles o creacion de bases; sus contrasenas y habilitacion de login se resuelven despues mediante `CREATE_SECRETS`.
4. La plataforma registra en una tabla de destino solo los nombres logicos, el servidor, el perfil y el estado. No guarda passwords, URLs completas ni material criptografico.
5. El efecto externo ocurre fuera de la transaccion de plataforma. `completeCreateDatabase` confirma el resultado con fencing (`operationId`, paso, intento, propietario, lease y version). Si la respuesta es incierta, un reintento observa y reconcilia el mismo recurso antes de crear nada.
6. Un conflicto de identidad, destino o permisos es fallo terminal tipado; no se ejecuta `DROP DATABASE`, no se renombra el recurso y el rollback de aplicacion no se presenta como rollback de datos.

## Alternativas consideradas

### Dar DDL al runtime de plataforma

Rechazada: mezcla lectura/escritura de operaciones con administracion de infraestructura y hace que un compromiso de `admin-api` pueda crear bases o roles.

### Ejecutar `psql`, Docker o shell desde el executor

Rechazada: rompe la frontera de operaciones tipadas, amplia el alcance de secretos y permite que una entrada accidental se convierta en comando de host.

### Crear todo en el migrador de cada perfil

Rechazada: el migrador del perfil no existe antes de la base y no debe tener privilegios para crear otras bases o roles.

### Guardar credenciales en la base de plataforma

Rechazada: contradice ADR-0008 y hace que backups, consultas administrativas y resultados de operaciones contengan secretos.

## Consecuencias

- Se agrega una migracion de metadatos y una referencia de secreto administrativa exclusiva del executor.
- `CREATE_SECRETS` debe reutilizar los nombres registrados y no recrear la base ni cambiar su identidad.
- La prueba de integracion necesita PostgreSQL 18 desechable con un rol administrativo sintetico; staging no crea perfiles reales.
- La restauracion y el desmantelamiento deben tratar la base como recurso independiente y exigir una operacion autorizada.

## Validacion

- Repetir el paso y ejecutar dos workers en carrera conserva una sola base y un solo par de roles.
- Un lease perdido no permite confirmar el resultado.
- El rol runtime no puede crear bases, roles ni objetos fuera de su base; `PUBLIC CONNECT` permanece revocado.
- Ningun secreto aparece en filas, errores, logs, imagenes o manifiestos.
