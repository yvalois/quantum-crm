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

| Area                       | Impacto previsto                                                             |
| -------------------------- | ---------------------------------------------------------------------------- |
| Aplicaciones y modulos     | Sin cambio de dominio; conexiones de `admin-web` y `admin-api`               |
| Contratos y eventos        | Sin contrato publico nuevo                                                   |
| Datos y migraciones        | Motor persistente, roles separados y migraciones `platform` controladas      |
| Permisos y aislamiento     | Redes de datos/sesion separadas; ningun puerto de motor publicado            |
| Configuracion y secretos   | Archivos `0600` externos; adaptacion de proveedores que no soportan `*_FILE` |
| Observabilidad y operacion | Healthchecks y procedimiento de bootstrap/reanudacion                        |
| Documentacion              | Infraestructura, tarea y estado                                              |

## Plan de implementacion

- [ ] Declarar servicios persistentes, redes y volumenes con imagenes por digest.
- [ ] Implementar adaptadores de entrada por archivo para Redis y Keycloak.
- [ ] Implementar bootstrap idempotente de PostgreSQL y migracion controlada.
- [ ] Importar y validar el realm sin sobrescribirlo en reinicios.
- [ ] Conectar las aplicaciones con minimo privilegio y ampliar pruebas de arquitectura.
- [ ] Aprovisionar la fundacion en el VPS, verificar persistencia/reinicio y registrar evidencia.

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

- [ ] Las tres dependencias usan digests exactos y sobreviven recreacion mediante volumenes.
- [ ] PostgreSQL separa administrador de cluster, migrador, runtime y Keycloak.
- [ ] Redis exige autenticacion y solo `admin-web` alcanza su red.
- [ ] Keycloak usa PostgreSQL, modo de servidor y realm `quantum-platform` sin `start-dev`.
- [ ] Ningun secreto real queda en Git, manifiestos renderizados, argumentos o logs.
- [ ] Las migraciones se ejecutan una vez por un proceso separado y `admin-api` usa solo runtime.
- [ ] La validacion real del VPS aprueba sin cambiar 80/443 ni servicios existentes.

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

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: pendiente.
- Pendientes o decisiones nuevas: operador inicial, TOTP, proxy HTTPS y E2E permanecen para la siguiente rebanada.
