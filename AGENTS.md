# Reglas de trabajo de Quantum CRM

Estas reglas se aplican a todo el repositorio.

## Lectura obligatoria

Antes de modificar codigo o documentacion:

1. Leer `docs/README.md`.
2. Identificar el requisito en `docs/01-producto/funcionalidades.md`.
3. Revisar sus subtareas en `docs/02-plan/trabajo.md`.
4. Revisar `docs/04-proceso/estado.md` y buscar el identificador en todo el repositorio.
5. Leer las reglas pertinentes en `docs/05-reglas/`.
6. Si afecta componentes, modulos o estructura, revisar `docs/08-arquitectura/` y los ADR relacionados.

## Reglas no negociables

- Ningun trabajo comienza sin un identificador de requisito. Para labores internas que no pertenecen al producto se usa `PROY-NNN`.
- No se vuelve a implementar una funcion sin inspeccionar primero el codigo, las pruebas, el historial y la evidencia existente.
- Una interfaz, boton, ruta vacia, mock o comentario `TODO` no demuestra que una funcion este terminada.
- Antes de programar, el elemento se registra como `EN_CURSO` en `docs/04-proceso/estado.md`.
- Solo se marca `[x]` en el checklist cuando todas las subtareas y la verificacion aplicable cumplen la definicion de terminado.
- Todo cambio de comportamiento incluye pruebas proporcionales al riesgo.
- Los permisos, el aislamiento por cliente y la validacion se aplican en el servidor; la interfaz no es una barrera de seguridad.
- Las migraciones, trabajos, webhooks, pagos, reservas, mensajes y despliegues deben tolerar reintentos sin duplicar efectos.
- No se guardan secretos, datos reales de clientes, credenciales ni respaldos en Git, fixtures, capturas o logs.
- Las decisiones estructurales se registran como ADR en `docs/06-decisiones/`.
- Se preservan los cambios ajenos y no se mezclan refactorizaciones sin relacion con el requisito activo.
- Si la documentacion y la implementacion discrepan, no se oculta la diferencia: se detiene el cierre, se documenta y se resuelve la fuente correcta.
- Cuando exista el remoto, no se trabaja ni se hace push directamente sobre `main`; se usa una rama corta y pull request segun `docs/05-reglas/05-git-y-github.md`.
- No se hace force push, no se reescribe historia compartida y no se elimina trabajo sin autorizacion explicita.
- No se integra ni publica una rama con comprobaciones obligatorias fallidas.
- El codigo propio de Quantum CRM se escribe en TypeScript estricto conforme a `docs/06-decisiones/ADR-0001-stack-base.md`.
- Los agentes LangGraph pueden ser servicios externos JavaScript o Python, pero deben cumplir el contrato versionado y no acceden directamente a la infraestructura de datos.
- Cada modulo es propietario exclusivo de sus datos y cumple `docs/06-decisiones/ADR-0002-limites-modulos-dependencias.md`.
- Un modulo no importa repositorios, entidades internas ni adaptadores de infraestructura de otro modulo; usa contratos publicos o eventos.
- El dominio no depende de NestJS, Prisma, Redis, HTTP ni proveedores externos.
- No se crea una carpeta generica `utils`; el codigo compartido se limita al shared kernel aprobado.
- Cada perfil cumple el aislamiento definido en `docs/06-decisiones/ADR-0003-aislamiento-multi-tenant.md`.
- El contexto del cliente se deriva de configuracion e identidad verificadas; nunca se confia en un `tenant_id` recibido libremente.
- Ningun proceso, credencial, token, archivo, trabajo o agente puede atravesar el limite de su perfil.
- Las APIs de plataforma no consultan directamente las tablas comerciales de los clientes.
- La autenticacion y autorizacion cumplen `docs/06-decisiones/ADR-0004-autenticacion-autorizacion.md`.
- Los tokens OIDC no se guardan en `localStorage`, `sessionStorage`, URLs ni HTML; las aplicaciones web usan sesiones opacas server-side.
- Toda operacion se deniega por defecto y comprueba en el servidor permiso, alcance y relacion con el recurso.
- Usuarios, servicios, automatizaciones y agentes usan principales separados y de minimo privilegio.
- Todo contrato externo cumple `docs/06-decisiones/ADR-0005-diseno-contratos-api.md` y `docs/05-reglas/06-api-y-contratos.md`.
- Los schemas runtime de `packages/contracts` generan OpenAPI, JSON Schema y tipos; no se duplican DTO manuales por aplicacion.
- Las operaciones criticas son idempotentes, los trabajos largos exponen recursos de operacion y los errores HTTP usan RFC 9457.
- Un cambio incompatible de API o evento requiere version nueva y plan de migracion; no se oculta regenerando artefactos.
- La persistencia cumple `docs/06-decisiones/ADR-0006-persistencia-transacciones-migraciones.md` y `docs/05-reglas/07-persistencia-y-migraciones.md`.
- Ninguna llamada externa ocurre dentro de una transaccion; auditoria y outbox se guardan junto con el cambio comercial.
- Las migraciones aplicadas son inmutables, forward-only en produccion y se ejecutan una vez por perfil mediante un migrador controlado.
- Los cambios incompatibles de datos usan expand-contract y backfills reanudables; rollback de aplicacion no equivale a restaurar datos.
- La estructura y las dependencias del monorepo cumplen `docs/08-arquitectura/monorepo.md`; una diferencia requiere actualizar la especificacion o registrar la decision que la sustituye.
- Las pruebas y puertas de calidad cumplen `docs/06-decisiones/ADR-0007-estrategia-pruebas-calidad.md` y `docs/05-reglas/02-pruebas-y-calidad.md`.
- Ningun porcentaje de cobertura sustituye los escenarios de permisos, aislamiento, idempotencia, concurrencia, migracion y recuperacion aplicables.
- Una prueba intermitente, reintentada o en cuarentena no se considera aprobada sin resolver el defecto o registrar una excepcion explicita.
- Los entornos, configuracion y secretos cumplen `docs/06-decisiones/ADR-0008-entornos-configuracion-secretos.md` y `docs/05-reglas/08-entornos-configuracion-secretos.md`.
- Solo `packages/config` lee `process.env`; cada proceso valida su schema completo y falla cerrado antes de readiness.
- Los secretos de staging y produccion entran mediante archivos `*_FILE` montados por servicio, nunca mediante Git, imagenes, frontend, argumentos o datos comerciales.
- Staging y produccion ejecutan los mismos digests con bases, identidades, archivos, colas y credenciales separados.

## Cierre del trabajo

Al terminar:

1. Ejecutar las verificaciones requeridas.
2. Guardar evidencia concreta en `docs/04-proceso/estado.md`.
3. Actualizar solo las casillas realmente satisfechas en `docs/02-plan/trabajo.md`.
4. Actualizar documentacion, decisiones y notas de cambio afectadas.
5. Confirmar que no quedan secretos, artefactos temporales ni cambios no relacionados.
