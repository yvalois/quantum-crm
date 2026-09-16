# ADR 0009 Integracion, entrega y releases

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: OPS-10 a OPS-21, ADM-09 a ADM-14 y ADM-20

## Contexto

Quantum debe verificar cambios no confiables, producir artefactos reproducibles, validar una release en staging y promover exactamente esos artefactos a produccion. Ademas, el despliegue por perfil puede incluir migraciones, workers, cambio de trafico y recuperacion, por lo que un workflow no debe ejecutar comandos arbitrarios sobre el VPS ni confundir una imagen construida con una release desplegable.

El repositorio remoto todavia no existe. La decision fija el contrato que debera implementar GitHub sin afirmar que sus rulesets, entornos o workflows ya estan configurados.

## Decision

Quantum usa GitHub Actions para integracion y entrega continua y GitHub Container Registry (GHCR) para imagenes OCI. Los runners iniciales son administrados por GitHub; el VPS no ejecuta codigo de pull requests.

Cada merge aceptado en `main` construye una sola vez los artefactos del commit, los identifica por digest y genera un candidato de release con SBOM, procedencia y manifiesto. Staging valida ese candidato. Una etiqueta SemVer aprobada promueve los mismos digests a produccion, sin reconstruirlos.

GitHub autoriza y coordina la promocion; `admin-api` recibe una operacion tipada y `deploy-executor` es el unico componente de Quantum que ejecuta migraciones, Compose, comprobaciones del host y cambios de Caddy.

## Fronteras de confianza

- Un pull request se considera codigo no confiable, incluso si procede de una rama del mismo repositorio.
- Los jobs de pull request no reciben secretos de staging o produccion, credenciales de publicacion ni acceso al VPS.
- No se usa `pull_request_target` para compilar o ejecutar codigo procedente del pull request.
- Los runners alojados por GitHub se usan para validacion y build iniciales. No se instala un runner de PR en el VPS.
- Cada workflow y job declara `permissions` minimos. La escritura de paquetes, attestations o deployments solo se concede al job que la necesita.
- Las actions de terceros se fijan por SHA completo. Las herramientas descargadas se fijan por version y checksum.
- Las credenciales temporales mediante OIDC se prefieren cuando el destino las admita; un token persistente tiene alcance minimo y rotacion documentada.

## Flujo de integracion continua

### Pull request

Todo pull request ejecuta, segun el cambio afectado:

1. Instalacion con versiones exactas de Node.js y pnpm y `--frozen-lockfile`.
2. Formato, lint, limites arquitectonicos y tipos.
3. Pruebas unitarias y umbrales de cobertura.
4. Pruebas de contratos, integracion afectada y build de consumidores afectados.
5. Smoke E2E aplicable.
6. Escaneo de secretos y dependencias.

Los nombres de checks son estables para que el ruleset de `main` pueda exigirlos. La primera implementacion conserva, como minimo:

- `ci / static`
- `ci / unit`
- `ci / integration`
- `ci / contracts`
- `ci / build`
- `security / secrets`
- `security / dependencies`
- `security / codeql`, cuando la visibilidad y licencia del repositorio permitan usarlo

Un nuevo commit cancela validaciones obsoletas del mismo pull request. Un despliegue ya iniciado nunca se cancela automaticamente por concurrencia de GitHub.

### Main

Cada merge a `main` vuelve a validar el commit integrado y agrega:

- suite completa de integracion;
- migraciones desde cero y desde la version anterior soportada;
- aislamiento entre al menos dos perfiles;
- recorridos E2E criticos;
- construccion y publicacion de imagenes;
- generacion del candidato y despliegue automatico a staging.

El cache acelera descargas, pero no sustituye al lockfile ni constituye evidencia de una build. Una entrada de cache se deriva de plataforma, herramienta y hash del lockfile.

## Controles de seguridad

- `pnpm secrets:scan` ejecuta Gitleaks CLI fijado por version y checksum sobre el contenido versionado y los cambios relevantes.
- `pnpm security:dependencies` combina la auditoria del gestor de paquetes con la politica de vulnerabilidades del repositorio.
- Dependabot mantiene propuestas de actualizacion. Dependency Review bloquea nuevas dependencias vulnerables cuando la funcion este disponible para la visibilidad y licencia del repositorio.
- CodeQL analiza TypeScript cuando GitHub lo permita. Su ausencia por plan no se presenta como un control ejecutado.
- Las excepciones de seguridad requieren hallazgo, justificacion, mitigacion, responsable y vencimiento. Al vencer vuelven a bloquear.
- Ningun reporte, log o artefacto publica secretos, datos reales de clientes o cuerpos sensibles de pruebas.

## Construccion y registro de imagenes

- Las imagenes se construyen mediante Docker BuildKit y Dockerfiles multi-stage.
- Las imagenes finales usan usuario no root, incluyen solo runtime y fijan la imagen base de forma reproducible; para releases se prefiere digest.
- GHCR conserva las imagenes candidatas y aprobadas. El workflow publica; el VPS solo obtiene lectura.
- Nunca se despliega `latest` ni una etiqueta mutable. El digest OCI es la identidad operativa.
- Etiquetas como `sha-<commit>` y `vMAJOR.MINOR.PATCH` son referencias humanas al digest, no autoridad de despliegue.
- Cada imagen produce SBOM y attestations de procedencia vinculadas a su digest.
- Grype CLI, fijado por version y checksum, escanea el digest o su SBOM con una base de vulnerabilidades actualizada.
- Hallazgos `high` o `critical` bloquean la promocion salvo excepcion temporal aprobada. Una excepcion no cambia ni oculta el reporte.

Una imagen de API y worker puede compartirse solamente si el mismo artefacto contiene ambos entrypoints y la medicion demuestra que no aumenta superficie o tamaño de forma injustificada. El manifiesto siempre identifica los seis procesos desplegables, aunque algunos referencien el mismo digest.

## Manifiesto y estados de release

El manifiesto de release es generado, validado y ligado al commit. Incluye:

- identificador SemVer cuando exista, commit y lockfile;
- digest de cada aplicacion desplegable;
- SBOM, procedencia y resultados de escaneo;
- versiones de contratos, migraciones y schema de configuracion;
- arquitecturas de CPU admitidas;
- compatibilidad con la release anterior, trabajos y agentes;
- necesidad de pausa, estrategia de trafico y posibilidad de rollback de aplicacion;
- evidencia de pruebas y fecha de validacion.

Estados minimos:

```text
candidato -> validado -> promovido
     |           |
     +-------> rechazado

promovido -> retirado
```

Crear `vMAJOR.MINOR.PATCH` valida que el tag apunte a un commit elegible y asigna la version a digests ya construidos. Un tag no dispara otra build. Los artefactos en uso o dentro de la ventana de rollback no se eliminan.

## Staging y promocion

- Un candidato de `main` se despliega automaticamente a staging con recursos, identidades, credenciales y datos separados.
- El despliegue ejecuta prechecks, migraciones controladas, readiness, smoke y E2E. Solo entonces el candidato queda `validado`.
- Produccion usa un GitHub Environment protegido y requiere aprobacion humana.
- La aprobacion selecciona un manifiesto validado; no puede sustituir digests, editar Compose ni introducir comandos.
- La solicitud autenticada a `admin-api` contiene `release_id`, entorno, alcance, idempotency key y actor. La API registra estado deseado y auditoria.
- `deploy-executor` obtiene operaciones autorizadas y ejecuta solamente pasos predefinidos. No existe un campo de shell, path o archivo Compose arbitrario.

GitHub no es la fuente de verdad del estado observado: la plataforma registra por perfil el digest, schema, configuracion y resultado realmente observados.

## Despliegue por perfil

Cada despliegue sigue una maquina de estados reanudable:

1. Validar elegibilidad, compatibilidad, capacidad, secretos y respaldo exigido.
2. Adquirir un lock autoritativo por perfil en la plataforma.
3. Registrar version activa, configuracion y schema observados.
4. Aplicar una sola vez las migraciones mediante el migrador autorizado.
5. Preparar el slot candidato con los digests exactos.
6. Comprobar liveness, readiness y dependencias esenciales.
7. Transferir trafico y titularidad de workers de forma coordinada.
8. Observar un periodo de estabilizacion y ejecutar smoke posterior.
9. Persistir el resultado y liberar el lock.

GitHub usa grupos de concurrencia para serializar solicitudes por entorno. El lock de la plataforma es la autoridad por perfil y sobrevive a reintentos, perdida del runner o solicitudes desde el panel administrativo.

Las promociones globales comienzan por un perfil piloto y continuan en lotes limitados por capacidad. Un fallo detiene lotes pendientes sin alterar silenciosamente perfiles ya completados.

## Trafico, fallos y rollback

- Se usa blue/green cuando el VPS puede mantener temporalmente ambos slots. Caddy cambia trafico solo despues de readiness.
- Si la capacidad no permite dos slots, la operacion declara y muestra una pausa controlada antes de iniciar.
- Un fallo anterior al cambio de trafico elimina o conserva el candidato para diagnostico y mantiene activa la version actual.
- Un fallo posterior intenta rollback de aplicacion solo si el manifiesto confirma compatibilidad con schema, configuracion y trabajos pendientes.
- El rollback vuelve a los digests y configuracion compatibles anteriores; no revierte automaticamente migraciones aplicadas.
- Rollback de aplicacion, migracion correctiva y restauracion de datos son operaciones distintas, con autorizacion y evidencia propias.
- Una restauracion que pueda descartar datos nunca se dispara como compensacion automatica de un deploy.

## Evidencia y retencion

Cada ejecucion conserva commit, workflow, checks, actor, manifiesto, digests, attestations, reportes, aprobacion y resultado. Los logs se redactan y los artefactos de prueba usan datos sinteticos.

La politica de retencion protege releases en uso, la anterior compatible y la evidencia exigida. La limpieza de paquetes comprueba primero el estado observado de todos los perfiles; una etiqueta ausente no demuestra que un digest no este en uso.

## Alternativas consideradas

### Construir o desplegar directamente por SSH en el VPS

Se rechaza porque mezcla codigo no confiable, secretos, build y operacion en el host de produccion, y dificulta demostrar que staging y produccion usan el mismo artefacto.

### Desplegar etiquetas mutables como `latest`

Se rechaza porque no identifica de forma reproducible el contenido ni permite un rollback verificable.

### Reconstruir al crear el tag de release

Se rechaza porque produce un artefacto distinto del validado en staging aunque use el mismo commit.

### Permitir scripts libres desde GitHub Actions

Se rechaza porque el workflow se convertiria en una consola privilegiada del VPS. La entrega solicita operaciones tipadas al plano administrativo.

### Desplegar automaticamente `main` a produccion

Se rechaza inicialmente. Staging es automatico; produccion requiere una release validada y aprobacion protegida.

### GitFlow o una rama `develop` permanente

Se rechaza porque agrega ramas de larga vida y divergencia sin aportar una frontera que no cubran `main`, candidatos y entornos protegidos.

### Kubernetes o runners autoalojados desde el inicio

Se difieren. En un solo VPS aumentan superficie operativa antes de demostrar una necesidad de orquestacion o capacidad dedicada.

## Consecuencias positivas

- Staging y produccion ejecutan los mismos bytes identificados por digest.
- Los pull requests no reciben privilegios operativos.
- Las releases conservan trazabilidad entre codigo, dependencias, imagenes, pruebas y despliegues.
- Los despliegues por perfil son serializables, reanudables y auditables.
- Un fallo de aplicacion no implica automaticamente perder datos.

## Costos y riesgos

- Se deben mantener workflows, manifests, attestations, scanners y politicas de retencion.
- GHCR y GitHub Actions son dependencias del proceso de entrega, aunque el contrato de artefactos permite sustituirlos.
- Un solo VPS puede no tener capacidad para blue/green y requerir pausas visibles.
- La disponibilidad de CodeQL y Dependency Review depende de la visibilidad y plan del repositorio.
- El ejecutor concentra privilegios operativos y requiere minimo privilegio, auditoria y observabilidad estrictos.

## Validacion

La decision se considera aplicada cuando:

- Un pull request externo no puede leer secretos ni alcanzar produccion.
- El ruleset de `main` exige checks estables y una integracion fallida no puede fusionarse.
- Dos builds reproducibles del mismo commit no introducen diferencias no explicadas.
- Una imagen se identifica y despliega por digest, sin `latest`.
- El candidato genera SBOM y procedencia y supera escaneo de secretos, dependencias e imagen.
- Staging valida exactamente los digests promovidos despues a produccion.
- Una etiqueta SemVer no reconstruye artefactos.
- Produccion exige aprobacion y solo solicita una operacion tipada.
- Dos solicitudes concurrentes sobre un perfil no ejecutan migraciones ni cambios de trafico en paralelo.
- Un despliegue fallido antes de trafico conserva la version activa.
- El rollback compatible restaura la aplicacion anterior sin restaurar datos.
- Un fallo incompatible bloquea rollback automatico y presenta el procedimiento correctivo.
- Un rollout global se detiene tras un fallo piloto o de lote y conserva el estado individual.

## Referencias

- [GitHub: controlar despliegues con environments y concurrencia](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [GitHub: publicar imagenes Docker](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [GitHub: seguridad de GitHub Actions](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats)
- [GitHub: configurar code scanning](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning)
- [Docker: GitHub Actions para builds](https://docs.docker.com/build/ci/github-actions/)
- [Docker: SBOM y procedencia](https://docs.docker.com/build/ci/github-actions/attestations/)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [Grype](https://oss.anchore.com/docs/guides/vulnerability/getting-started/)

Se revisa esta decision al cambiar de forja o registro, adoptar varios hosts o regiones, necesitar runners dedicados o sustituir Compose por otro orquestador.
