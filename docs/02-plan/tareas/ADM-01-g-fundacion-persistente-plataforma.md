# ADM-01-g - Fundacion persistente de plataforma

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-01`, `OPS-04`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a` a `ADM-01-f`, ADR-0004, ADR-0006, ADR-0008 y ADR-0009
- Bloquea a: operador inicial y E2E administrativo con MFA
- ADR, arquitectura o diseno aplicables: autenticacion, persistencia, configuracion, secretos, despliegue y monorepo

## Resultado esperado

PostgreSQL, Redis y Keycloak de plataforma pueden aprovisionarse de forma reproducible y persistente en el VPS autorizado, sin puertos administrativos publicos, sin secretos en Git, Compose, argumentos o logs y con redes, volumenes, healthchecks y limites explicitos. `admin-web` y `admin-api` quedan conectables solo a las dependencias que les corresponden.

## Lectura obligatoria aplicada

- [x] Requisito, MVP, subtareas, estado y fichas anteriores.
- [x] Reglas de seguridad, persistencia, configuracion, pruebas y releases.
- [x] ADR de autenticacion, persistencia y secretos; arquitectura del monorepo.
- [x] Documentacion oficial vigente de Keycloak y PostgreSQL para contenedores, importacion y configuracion.

## Auditoria del trabajo existente

- Busquedas realizadas: servicios Compose, Keycloak, Redis, PostgreSQL, migraciones, secretos, operador, redes y pruebas de arquitectura.
- Codigo o documentacion encontrados: aplicaciones declaradas en `platform.yaml`; realm importable; adaptadores reales; migraciones de plataforma; validaciones desechables de Keycloak, Redis y PostgreSQL. No existe declaracion persistente de sus motores.
- Pruebas e historial encontrados: importacion real de realm, Redis real, PostgreSQL real y CI aprobados en rebanadas anteriores.
- Decision: separar el ciclo de vida de los servicios con estado en `platform-foundation.yaml`, conectarlos mediante redes externas privadas a `platform.yaml` y automatizar el bootstrap con un procedimiento reanudable que consume archivos secretos.

## Alcance

### Incluido

- Compose persistente para PostgreSQL, Redis y Keycloak fijados por digest.
- Volumenes nombrados, redes privadas, healthchecks, limites y endurecimiento aplicable.
- Entrada de credenciales mediante archivos secretos fuera del checkout.
- Bootstrap reanudable de roles y bases, migraciones, realm y credencial confidencial del cliente.
- Conexion de `admin-web` y `admin-api` a redes de minimo privilegio.
- Pruebas estructurales y validacion real en el VPS sin publicar trafico.

### No incluido

- Modificar Nginx, DNS, TLS, firewall o los sitios existentes.
- Crear o activar el operador humano inicial y su TOTP.
- E2E de navegador o cierre de `ADM-01`.
- Backups externos o alta disponibilidad.

## Impacto tecnico

| Area                       | Impacto previsto                                                        |
| -------------------------- | ----------------------------------------------------------------------- |
| Aplicaciones y modulos     | Sin cambio de dominio; conexiones de `admin-web` y `admin-api`          |
| Contratos y eventos        | Sin contrato publico nuevo                                              |
| Datos y migraciones        | Motor persistente, roles separados y migraciones `platform` controladas |
| Permisos y aislamiento     | Redes de datos/sesion separadas; ningun puerto de motor publicado       |
| Configuracion y secretos   | Archivos externos `0400`/`0440`; adaptacion de proveedores sin `*_FILE` |
| Observabilidad y operacion | Healthchecks y procedimiento de bootstrap/reanudacion                   |
| Documentacion              | Infraestructura, tarea y estado                                         |

## Plan de implementacion

- [x] Declarar servicios persistentes, redes y volumenes con imagenes por digest.
- [x] Implementar adaptadores de entrada por archivo para Redis y Keycloak.
- [x] Implementar bootstrap idempotente de PostgreSQL y migracion controlada.
- [x] Importar y validar el realm sin sobrescribirlo en reinicios.
- [x] Conectar las aplicaciones con minimo privilegio y ampliar pruebas de arquitectura.
- [x] Aprovisionar la fundacion en el VPS, verificar persistencia/reinicio y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo                                    | Mitigacion                                                                             | Verificacion                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| Secretos visibles en Compose o inspeccion | Solo referencias a archivos; wrappers leen archivos y no pasan valores como argumentos | Inspeccion de manifiesto y contenedores     |
| Reinicio sobrescribe realm o datos        | Volumenes nombrados e importacion que omite realm existente                            | Reinicio y conteos invariantes              |
| API obtiene privilegios de migrador       | Roles y URLs independientes; grants posteriores a migracion                            | Consultas de privilegios negativas          |
| Redis o PostgreSQL quedan publicados      | Redes internas sin `ports`                                                             | Compose renderizado e inspeccion de sockets |
| Consumo excesivo en VPS pequeno           | Limites de memoria/CPU y arranque secuencial                                           | Estado, health y medicion inicial           |
| Bootstrap parcial                         | Pasos idempotentes, comprobaciones previas y fallo cerrado                             | Segunda ejecucion sin duplicados            |

## Criterios de aceptacion

- [x] Las tres dependencias usan digests exactos y sobreviven recreacion mediante volumenes.
- [x] PostgreSQL separa administrador de cluster, migrador, runtime y Keycloak.
- [x] Redis exige autenticacion y solo `admin-web` alcanza su red.
- [x] Keycloak usa PostgreSQL, modo de servidor y realm `quantum-platform` sin `start-dev`.
- [x] Ningun secreto real queda en Git, manifiestos renderizados, argumentos o logs.
- [x] Las migraciones se ejecutan una vez por un proceso separado y `admin-api` usa solo runtime.
- [x] La validacion real del VPS aprueba sin cambiar 80/443 ni servicios existentes.

## Plan de verificacion

- Pruebas unitarias: validadores de manifiestos y scripts.
- Pruebas de integracion o contratos: health, realm, roles, grants, Redis autenticado y persistencia tras recreacion.
- Pruebas E2E: diferidas a `ADM-01-h`.
- Comprobacion manual: `docker compose config`, redes, mounts, puertos, volumenes y logs redactados.
- Seguridad, permisos y aislamiento: intentos de conexion no autorizada y ausencia de valores secretos.
- Idempotencia, concurrencia y recuperacion: dos ejecuciones de bootstrap y recreacion sin eliminar volumenes.
- Comandos que deben aprobar: CI, validacion Compose y harness real en VPS.

## Recuperacion

- Compatibilidad o migracion: migraciones forward-only mediante rol migrador; no se ejecutan en el arranque normal.
- Rollback de aplicacion: detener servicios sin eliminar volumenes ni secretos; revertir manifiesto compatible.
- Recuperacion de datos, si aplica: no se considera resuelta hasta `OPS-21`; eliminar volumenes no forma parte del rollback.

## Evidencia de cierre

- Archivos, commits o PR: Compose persistente, cuatro Dockerfiles, wrappers de PostgreSQL/Redis/Keycloak, migrador separado, aprovisionador de secretos, requisito sysctl, conexiones de red, documentacion y pruebas en los commits locales `4f4dadb` a `51f5d52` de `feat/ADM-01-platform-foundation`; no existe remoto configurado.
- Comandos y resultados: CI completa en Node 24 sobre `9ef4d63` aprobo formato, lint, tipos, 41 pruebas de configuracion, 138 unitarias, 17 de arquitectura y los builds; el cambio final `51f5d52` aprobo formato y 18 pruebas de arquitectura. En el VPS, Compose valido, los tres servicios quedaron `healthy`, sin puertos publicados y con imagenes por digest; el migrador ejecuto dos veces y luego de la recreacion sin migraciones pendientes; runtime pudo leer pero no crear tablas; Redis nego acceso sin autenticacion y fuera de prefijo, y conservo una escritura valida tras recreacion; Keycloak conservo el realm y discovery correcto tras recreacion.
- Documentacion actualizada: `infra/README.md`, esta ficha y `docs/04-proceso/estado.md`; `infra/platform/provision-secrets.sh` es la fuente operativa reanudable para los diez archivos secretos y derivados.
- Seguridad y operacion: escaneo de valores contra checkout, inspecciones y logs aprobado; archivos con modos `0400`/`0440`; redes de datos y sesion internas; `vm.overcommit_memory=1`; consumos iniciales aproximados: PostgreSQL 40 MiB, Redis 7 MiB y Keycloak 441 MiB.
- Desviaciones del plan: ninguna funcional. La persistencia de Keycloak reside en el volumen PostgreSQL y Redis usa AOF con `appendfsync everysec`; la prueba de Redis respeto ese intervalo y su prefijo ACL.
- Pendientes o decisiones nuevas: operador inicial, TOTP, exposicion HTTPS mediante el proxy existente y E2E completo permanecen para `ADM-01-h`; `ADM-01` no se marca terminado.
