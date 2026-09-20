# CI/CD y releases

Estas reglas aplican a workflows, imagenes, manifiestos, promociones y operaciones de despliegue. Desarrollan [ADR-0009](../06-decisiones/ADR-0009-integracion-entrega-releases.md).

## Pull requests

- Tratar todo pull request como codigo no confiable.
- No entregar secretos, credenciales de paquetes, acceso al VPS ni permisos de despliegue a jobs de pull request.
- No ejecutar codigo del pull request con `pull_request_target` ni con un token de escritura.
- Instalar con versiones fijadas y lockfile congelado.
- Mantener nombres estables para checks protegidos; cambiarlos requiere actualizar primero el ruleset sin abrir una ventana sin control.
- Cancelar validaciones obsoletas del mismo pull request, no despliegues ya iniciados.
- Fijar actions externas por SHA completo y herramientas descargadas por version y checksum.
- Declarar permisos de workflow y job con minimo privilegio.

## Puertas obligatorias

- Ejecutar formato, lint, tipos, unitarias, cobertura, arquitectura, contratos, integracion afectada, build y E2E aplicable antes de integrar.
- En `main`, agregar integracion completa, migraciones, aislamiento entre perfiles y recorridos criticos.
- Ejecutar `pnpm secrets:scan` con Gitleaks fijado y verificado.
- Auditar dependencias y revisar nuevas vulnerabilidades sin presentar un control no disponible como aprobado.
- Ejecutar CodeQL para TypeScript cuando el plan y visibilidad del repositorio lo permitan.
- Una excepcion de seguridad siempre registra hallazgo, mitigacion, responsable y vencimiento.
- No aprobar una release con una excepcion vencida.

## Artefactos

- No iniciar Docker Desktop, construir imagenes ni levantar Compose en el equipo local del propietario.
- Ejecutar la validacion real de contenedores en el VPS de desarrollo o pruebas autorizado, separado de produccion y con datos sinteticos.
- Construir cada imagen una sola vez por commit aceptado.
- Publicar en GHCR con identidad por digest OCI.
- No desplegar `latest`, nombres de rama ni tags mutables.
- Generar SBOM y procedencia para cada imagen candidata.
- Escanear el digest o SBOM con Grype fijado y una base actualizada.
- Bloquear vulnerabilidades `high` y `critical` salvo excepcion temporal aprobada.
- No incluir secretos de runtime, credenciales de build, herramientas de compilacion ni archivos ajenos en la imagen final.
- Conservar el manifiesto que relaciona commit, lockfile, digests, contratos, migraciones, configuracion, pruebas y compatibilidad.

## Promocion

- Desplegar automaticamente a staging solo despues de publicar un candidato verificable.
- Validar en staging exactamente los digests propuestos para produccion.
- Crear una version SemVer sobre digests existentes; no reconstruir al etiquetar.
- Exigir aprobacion mediante el GitHub Environment de produccion.
- El workflow solicita una operacion tipada a `admin-api`; no ejecuta comandos arbitrarios por SSH.
- Solo `deploy-executor` toca Docker, migraciones, secretos del host o configuracion de Caddy.
- El VPS usa credenciales de solo lectura para GHCR.

## Despliegue y concurrencia

- Adquirir un lock autoritativo por perfil antes de migrar, iniciar slots o cambiar trafico.
- Hacer cada paso idempotente y reanudable tras perdida del runner o reinicio del ejecutor.
- Aplicar migraciones una sola vez mediante el migrador autorizado.
- Comprobar readiness, no solo proceso vivo, antes de dirigir trafico.
- Usar piloto y lotes limitados para promociones globales.
- Detener lotes pendientes ante un fallo y conservar el resultado observado de cada perfil.
- Usar blue/green solo cuando la capacidad medida lo permita; en caso contrario declarar una pausa controlada.

## Fallos y recuperacion

- Antes de cambiar trafico, mantener activa la version anterior si falla el candidato.
- Despues de cambiar trafico, volver a la aplicacion anterior solo si schema, configuracion y trabajos siguen siendo compatibles.
- No revertir migraciones destructivas automaticamente.
- No usar restauracion de datos como compensacion automatica de un despliegue.
- Tratar rollback de aplicacion, migracion correctiva y restauracion como operaciones separadas.
- Conservar temporalmente la release anterior compatible y no borrar un digest observado en ningun perfil.

## Evidencia de cierre

Una ejecucion registra al menos workflow, commit, actor, checks, manifiesto, digests, escaneos, aprobacion, perfiles objetivo y resultado observado. Los logs y artefactos se redactan y nunca contienen secretos o datos reales de clientes.
