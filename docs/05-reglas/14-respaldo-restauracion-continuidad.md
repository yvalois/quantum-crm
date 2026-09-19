# Respaldo, restauracion y continuidad

Estas reglas aplican [ADR-0015](../06-decisiones/ADR-0015-respaldo-restauracion-continuidad.md) y su [arquitectura de recuperacion](../08-arquitectura/respaldo-restauracion-continuidad.md).

## Fuente de verdad

- Un volumen, snapshot o archivo dentro del VPS primario no cuenta como respaldo ante desastre.
- Solo un `BackupSet` completo y `VERIFIED` puede seleccionarse para restauracion.
- Logs, paneles, Redis y la respuesta de un comando no sustituyen estado y evidencia durables.
- Rollback de aplicacion, restauracion de perfil y reconstruccion del VPS son operaciones diferentes.

## Alcance y consistencia

- Cada conjunto identifica perfil, plataforma, release, config revision, corte PostgreSQL y todos sus componentes.
- PostgreSQL y objetos se coordinan mediante generacion, barrier, manifiesto, version exacta y checksum.
- Un componente ausente, WAL incompleto o checksum distinto hace fallar el conjunto completo.
- Redis, cache y trabajos derivables se reconstruyen; nunca se restauran como unica fuente de intencion.
- Secretos y claves usan un paquete y custodia separados de los datos comerciales.

## Seguridad

- La copia sale del VPS cifrada y el destino externo no controla la clave de descifrado.
- Credenciales de backup, lectura, restauracion y borrado son distintas y de minimo privilegio.
- La interfaz y las APIs reciben IDs registrados, nunca shell, paths, endpoints o credenciales libres.
- Ningun backup, clave, dump, WAL, manifiesto sensible o dato real entra en Git, fixtures, imagenes o logs.
- La clave de recuperacion y sus custodios no dependen unicamente del VPS o del destino cifrado.

## Ejecucion

- Backup y restauracion son operaciones tipadas, idempotentes, bloqueadas por alcance y auditadas.
- Un resultado remoto incierto se observa y reconcilia antes de repetir.
- La retencion se aplica al conjunto completo y respeta restauraciones activas, legal holds y ventanas de migracion.
- El borrado de backups es autorizado, durable, idempotente y verifica ausencia.
- Una migracion destructiva no comienza sin un backup previo aplicable y verificado.

## Restauracion

- Toda restauracion se ejecuta primero en un entorno aislado con efectos externos deshabilitados.
- Se validan release, esquema, WAL, objetos, identidad, configuracion, secretos, permisos e invariantes.
- Una sustitucion de datos muestra el recovery point y la perdida esperada y exige doble confirmacion autorizada.
- No se restaura directamente sobre produccion desde el navegador.
- No se recuperan tablas, carpetas o secretos de forma manual sin un runbook especifico y evidencia.
- Checkpoints agentivos incompatibles se cierran o reinician explicitamente; nunca se fuerzan sobre otro grafo.

## Objetivos y pruebas

- Se alertan edad, huecos de WAL, copias parciales, checksums, capacidad, destino, claves y simulacros vencidos.
- RPO y RTO se miden desde el ultimo punto valido y el tiempo real de recuperacion, no desde la configuracion esperada.
- Mensualmente se prueba un perfil completo y trimestralmente la reconstruccion del VPS.
- Un backup que no se ha restaurado dentro de su ventana no se presenta como garantia verificada.
- El piloto no admite datos reales hasta completar destino externo, custodia, alertas y simulacros exigidos.

## Cambios

- Cambiar destino, cifrado, RPO, RTO, retencion o alcance requiere actualizar ADR, arquitectura y procedimiento.
- Reducir retencion u objetivos necesita aprobacion explicita, impacto documentado y compatibilidad con obligaciones legales.
- Los runbooks finales se derivan de comandos, versiones y señales reales; no se inventan como evidencia antes de implementar.
