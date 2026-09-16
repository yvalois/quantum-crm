# Entornos, configuracion y secretos

Estas reglas aplican al build, runtime, despliegue, CI y configuracion por perfil. La decision completa vive en `../06-decisiones/ADR-0008-entornos-configuracion-secretos.md`.

## Entornos y artefactos

- Usar solo `local`, `test`, `preview`, `staging` y `production` como valores de `QCRM_ENV`.
- Tratar `CI` como contexto de ejecucion, no como selector de credenciales o destino.
- No inferir el entorno desde la rama, hostname o nombre de archivo.
- Promover el mismo digest desde staging a produccion; no construir imagenes por cliente.
- Separar entre staging y produccion bases, realms, buckets, Redis, hosts y credenciales.
- Limitar preview a datos sinteticos, secretos minimos y expiracion automatica.
- Prohibir datos de produccion fuera de ella salvo restauracion autorizada y anonimizacion.

## Configuracion de proceso

- Leer `process.env` solo dentro de `packages/config`.
- Definir un schema Zod por aplicacion y validar antes de iniciar dependencias o readiness.
- Convertir explicitamente strings a booleanos, numeros, URLs, duraciones, enums o listas.
- Rechazar claves `QCRM_*` desconocidas, vacias, placeholders y combinaciones incoherentes.
- No usar defaults silenciosos para valores requeridos en staging o produccion.
- Producir un objeto tipado e inmutable e inyectarlo a los consumidores.
- No permitir simultaneamente una variable secreta en texto y su referencia `*_FILE`.
- Mantener `.env.example` sincronizado, no sensible y validable por `pnpm config:check`.

## Frontend

- Considerar publico todo valor recibido por el navegador.
- Reservar `NEXT_PUBLIC_*` para constantes publicas invariantes de la release.
- Resolver valores publicos del entorno mediante same-origin o un endpoint BFF con allowlist.
- No reflejar el entorno completo, referencias de secretos, hosts internos ni connection strings.
- Mantener contratos publicos separados para CRM y administrador.

## Secretos

- No guardar secretos en Git, imagenes, capas, variables publicas, argumentos, URLs, base administrativa, logs o artefactos.
- Mantener secretos de staging y produccion fuera del checkout y montarlos por servicio mediante Compose Secrets.
- Usar referencias `*_FILE` y paths permitidos; no montar directorios completos.
- Separar material de plataforma, entorno y perfil con minimo privilegio.
- Guardar en la base solo referencia, tipo, propietario, version y fechas.
- Validar path, tamano, archivo esperado y ausencia de symlinks antes de leer.
- Proteger directorios y archivos del host con propietario operativo y permisos minimos.
- Tratar como comprometido cualquier valor encontrado en Git, logs o artefactos y rotarlo antes de sanear copias.

## Ciclo de vida

- Registrar propietario, consumidores, creacion, rotacion, expiracion y revocacion.
- Generar material con aleatoriedad criptografica o mediante el proveedor.
- Rotar con una ventana `current`/`next` cuando el proveedor lo permita.
- Verificar consumidores antes de revocar la version anterior.
- Auditar la operacion sin incluir valores.
- Mantener un procedimiento explicito de exposicion, revocacion y recuperacion.

## CI y pruebas

- No entregar secretos a forks ni pull requests sin confianza.
- Usar credenciales sinteticas en pruebas y servicios desechables.
- Separar secretos y protecciones de staging y produccion.
- Preferir OIDC y credenciales temporales cuando el proveedor lo soporte.
- Dar a cada job solo los permisos y secretos que necesita.
- Ejecutar `pnpm config:check` y `pnpm secrets:scan` antes de integrar.
- Probar redaccion con canarios y comprobar que no aparecen en logs, trazas o reportes.

## Evidencia minima

Un cambio de configuracion o secretos incluye:

- Schema, ejemplo y documentacion actualizados.
- Resultado de `config:check` y `secrets:scan`.
- Prueba de arranque valido y fallo cerrado ante entrada invalida.
- Revision del alcance de cada secreto y de la configuracion publica.
- Procedimiento de rotacion si agrega una credencial nueva.
