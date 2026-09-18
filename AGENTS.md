# Reglas de trabajo de Quantum CRM

Estas reglas se aplican a todo el repositorio.

## Lectura obligatoria

Antes de modificar codigo o documentacion:

1. Leer `docs/README.md`.
2. Identificar el requisito en `docs/01-producto/funcionalidades.md`.
3. Confirmar su fase y dependencias en `docs/02-plan/mvp-piloto.md`.
4. Revisar sus subtareas en `docs/02-plan/trabajo.md`.
5. Revisar `docs/04-proceso/estado.md` y buscar el identificador en todo el repositorio.
6. Leer las reglas pertinentes en `docs/05-reglas/`.
7. Si afecta componentes, modulos o estructura, revisar `docs/08-arquitectura/` y los ADR relacionados.

## Reglas no negociables

- Ningun trabajo comienza sin un identificador de requisito. Para labores internas que no pertenecen al producto se usa `PROY-NNN`.
- El MVP del cliente piloto incluye los 249 requisitos de producto y `OPS-01` a `OPS-24` conforme a `docs/02-plan/mvp-piloto.md`; una fase ordena trabajo, no excluye alcance.
- Ninguna entrega parcial, demo, feature flag, mock o integracion simulada se presenta como el MVP terminado.
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
- El agente oficial vive en `agent-runtime` TypeScript con LangGraph.js; agentes personalizados pueden usar JavaScript o Python, pero todos cumplen `/agent/v1`, MCP y `docs/06-decisiones/ADR-0012-integracion-agentes-langgraph-mcp.md`.
- Los agentes son una capacidad nativa de Quantum, pero no acceden directamente a datos comerciales, Redis, S3, administracion de Keycloak, secretos de proveedores ni APIs internas; usan resources y tools del Quantum MCP Gateway. Solo su adaptador OAuth accede a discovery y token endpoints publicados.
- Cada modulo es propietario exclusivo de sus datos y cumple `docs/06-decisiones/ADR-0002-limites-modulos-dependencias.md`.
- Un modulo no importa repositorios, entidades internas ni adaptadores de infraestructura de otro modulo; usa contratos publicos o eventos.
- El dominio no depende de NestJS, Prisma, Redis, HTTP ni proveedores externos.
- No se crea una carpeta generica `utils`; el codigo compartido se limita al shared kernel aprobado.
- Cada perfil cumple el aislamiento definido en `docs/06-decisiones/ADR-0003-aislamiento-multi-tenant.md`.
- El contexto del cliente se deriva de configuracion e identidad verificadas; nunca se confia en un `tenant_id` recibido libremente.
- Ningun proceso, credencial, token, archivo, trabajo o agente puede atravesar el limite de su perfil.
- Los archivos y objetos cumplen `docs/06-decisiones/ADR-0013-archivos-almacenamiento-objetos.md`, `docs/05-reglas/13-archivos-objetos.md` y `docs/08-arquitectura/archivos-objetos.md`.
- SeaweedFS vive dentro del VPS, se despliega por digest y mantiene buckets privados `incoming` y `objects` por perfil; sus puertos administrativos no se publican.
- Solo el modulo `files` accede a S3 y conoce buckets o object keys; los demas modulos usan `fileId` y contratos publicos.
- Ningun archivo se descarga, previsualiza, comparte, procesa o entrega a un agente antes de estar `AVAILABLE` tras validacion y scan ClamAV.
- Las URLs firmadas son breves, exactas, no se persisten ni registran; una sustitucion crea otro archivo inmutable.
- El scan falla cerrado y los trabajos de promocion, reconciliacion y borrado son durables, idempotentes y aislados por perfil.
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
- La integracion, entrega y promocion cumplen `docs/06-decisiones/ADR-0009-integracion-entrega-releases.md` y `docs/05-reglas/09-ci-cd-y-releases.md`.
- Cada imagen se construye una vez, genera SBOM y procedencia y se despliega por digest; nunca se usa `latest` como identidad operativa.
- Los pull requests no reciben secretos ni acceso al VPS; las actions externas se fijan por SHA completo y usan permisos minimos.
- Los workflows solo solicitan operaciones tipadas a `admin-api`; `deploy-executor` es el unico componente que ejecuta Docker, migraciones y cambios de Caddy.
- Rollback de aplicacion, migracion correctiva y restauracion de datos son operaciones diferentes y no se sustituyen automaticamente entre si.
- La observabilidad y el manejo de fallos cumplen `docs/06-decisiones/ADR-0010-observabilidad-manejo-fallos.md` y `docs/05-reglas/10-observabilidad-y-fallos.md`.
- El dominio no importa logging, tracing, metricas ni SDKs de proveedores; la instrumentacion comun vive en `packages/observability`.
- Los logs son JSON estructurado y redactado; IDs, rutas o valores no acotados nunca son labels de metricas ni nombres de spans.
- Toda dependencia externa tiene timeout; solo se reintentan fallos transitorios con presupuesto, jitter e idempotencia o deduplicacion.
- Una excepcion no capturada retira readiness y termina el proceso con error; no se continua en un estado desconocido.
- Auditoria, outbox, inbox, operaciones y resultados durables no se sustituyen por logs o trazas.
- Los trabajos asincronos y automatizaciones cumplen `docs/06-decisiones/ADR-0011-trabajos-asincronos-automatizaciones.md` y `docs/05-reglas/11-trabajos-asincronos-automatizaciones.md`.
- PostgreSQL conserva la intencion, espera, ejecucion y resultado comercial; Redis y BullMQ distribuyen trabajo, pero nunca son su unica copia.
- Todo consumidor asume entrega al menos una vez, usa idempotencia durable y rechaza resultados de un worker que perdio su lease.
- Una automatizacion fija una revision inmutable, persiste checkpoints y revalida permisos, invariantes y toma humana antes de cada efecto.
- Los reintentos se limitan a fallos transitorios con timeout, presupuesto, backoff y jitter; un resultado externo desconocido se concilia antes de repetir.
- Pausas, cancelaciones, compensaciones y reanudaciones son operaciones tipadas, autorizadas y auditadas; no existe rollback generico ni edicion arbitraria de payloads.
- La implementacion agentiva cumple `docs/05-reglas/12-agentes-langgraph-mcp.md` y `docs/08-arquitectura/agentes-mcp.md`.
- Existe un agente principal visible por empresa; sus subagentes son internos, usan capabilities minimas y no deciden permisos ni aprobaciones.
- El CRM conserva el estado comercial; checkpoints y memoria del agente no lo sustituyen, y el aprendizaje solo se persiste mediante una tool autorizada.
- Cada tool MCP declara version, schema, permiso, riesgo, aprobacion, timeout e idempotencia y llama el caso de uso publico del modulo propietario.
- Ningun prompt, mensaje, documento, resource o tool result concede permisos, cambia de perfil, revela secretos o evita aprobaciones.
- CRM y runtime se autentican por separado; una ejecucion no transporta tokens humanos o MCP, y los callbacks se validan y deduplican por intento y generacion.
- No se solicita, almacena ni expone cadena de pensamiento; la evidencia usa resultados y decisiones estructuradas permitidas.

## Cierre del trabajo

Al terminar:

1. Ejecutar las verificaciones requeridas.
2. Guardar evidencia concreta en `docs/04-proceso/estado.md`.
3. Actualizar solo las casillas realmente satisfechas en `docs/02-plan/trabajo.md`.
4. Actualizar documentacion, decisiones y notas de cambio afectadas.
5. Confirmar que no quedan secretos, artefactos temporales ni cambios no relacionados.
