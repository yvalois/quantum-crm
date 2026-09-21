# ADM-04-f - Crear almacenamiento privado del perfil

> Ficha derivada para completar el paso `CREATE_STORAGE` del aprovisionamiento. No sustituye el alcance, el estado ni la definición de terminado.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `OPS-01`, `OPS-04`, `OPS-23`
- Fase del MVP: Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-04-e` integrado; la composicion de plataforma debe provisionar SeaweedFS dentro del VPS; secretos del tenant ya referenciados.
- Bloquea a: `ADM-04` pasos `WRITE_CONFIGURATION` y posteriores.
- ADR, arquitectura o diseno aplicables: `ADR-0013`, [`archivos-objetos.md`](../../08-arquitectura/archivos-objetos.md), reglas de archivos y objetos.

## Resultado esperado

El ejecutor procesa `CREATE_STORAGE` de forma idempotente para un perfil: crea o reconcilia los buckets privados `incoming` y `objects`, versionado, cuotas y credenciales de mínimo privilegio, conserva únicamente referencias en la plataforma y registra el resultado durable del intento.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md` y `docs/02-plan/trabajo.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `CREATE_STORAGE`, `SeaweedFS`, buckets, credenciales y reconciliacion.
- Codigo o documentacion encontrados: el contrato y la maquina de aprovisionamiento ya contienen `CREATE_STORAGE`; el ejecutor solo acredita `VALIDATE`, `CREATE_DATABASE` y `CREATE_SECRETS`.
- Pruebas e historial encontrados: contratos y pruebas de leasing/provisionamiento existentes; no hay implementacion de storage.
- Decision de reutilizacion, extension o reemplazo: extender el paso tipado existente y reutilizar el fencing, los resultados por intento y la identidad de operaciones; no crear un segundo flujo de aprovisionamiento.

## Alcance

### Incluido

- Contrato de finalizacion y persistencia durable del paso `CREATE_STORAGE`.
- Servicio SeaweedFS de plataforma con imagen por digest, volumen persistente, configuracion fuera del checkout y red privada compartida.
- Adaptador restringido del ejecutor para SeaweedFS S3.
- Buckets privados `incoming` y `objects`, versionado y permisos por perfil.
- Referencias de credenciales sin valores en PostgreSQL, respuestas o logs.
- Reconciliacion idempotente y rechazo seguro de perfiles o servidores no autorizados.

### No incluido

- Carga, scan ClamAV, promoción, entrega o borrado de archivos.
- Configuración de contenedores, HTTPS o administrador inicial.
- Integraciones comerciales o interfaz del módulo `files`.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `deploy-executor`, `admin-api` solo para estado durable |
| Contratos y eventos | Resultado tipado de `CREATE_STORAGE` y referencias de credenciales |
| Datos y migraciones | Estado/referencias de storage por tenant y resultados por intento |
| Permisos y aislamiento | Credenciales acotadas a los dos buckets del perfil |
| Configuracion y secretos | Referencias montadas; ningún valor en Git o base administrativa |
| Observabilidad y operacion | Logs estructurados sin keys/secretos; reintento solo con fencing |
| Documentacion | Estado, ficha, inventario y reglas si cambia el procedimiento |

## Plan de implementacion

- [x] Anadir la base de plataforma SeaweedFS con imagen por digest, volumen, secreto de configuracion y red privada.

- [ ] Añadir el contrato de finalización y sus validaciones.
- [ ] Persistir el resultado de `CREATE_STORAGE` con lease, versión e intento.
- [ ] Implementar adaptador S3/SeaweedFS con operaciones idempotentes y mínimo privilegio.
- [ ] Conectar el paso al ejecutor sin shell arbitrario ni acceso desde otros procesos.
- [ ] Ejecutar la verificación afectada una vez en el VPS y reutilizar la evidencia en CI/PR.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Reintento duplica buckets o credenciales | Reconciliacion por identificador estable y fencing del intento | Dos ejecuciones con el mismo intento producen un solo estado válido |
| Credencial cruza perfiles | Política generada solo con referencias del tenant verificado | Intento de acceso cruzado denegado en VPS |
| API recibe privilegios S3 | Acceso exclusivo del ejecutor y futura frontera `files` | Inspección de mounts y permisos del compose |

## Criterios de aceptacion

- [ ] Un perfil obtiene exactamente `incoming` y `objects` privados.
- [ ] Repetir el paso no crea recursos duplicados ni cambia referencias válidas.
- [ ] Un resultado tardío o de otro intento no puede sobrescribir el estado actual.
- [ ] Los valores secretos no aparecen en respuestas, logs, Git ni PostgreSQL de plataforma.
- [ ] El paso fallido queda reanudable y no permite avanzar a `WRITE_CONFIGURATION`.

## Plan de verificacion

- Pruebas unitarias: validadores de comando, fencing, idempotencia y políticas de bucket.
- Pruebas de integracion o contratos: persistencia y transición a `WRITE_CONFIGURATION`.
- Pruebas E2E: no aplican en esta ficha; se ejecutarán al cerrar el alta completa.
- Comprobacion manual: una creación, un reintento y un intento cruzado en el VPS autorizado.
- Seguridad, permisos y aislamiento: credenciales de mínimo privilegio y buckets privados.
- Idempotencia, concurrencia y recuperacion: lease vencido, resultado tardío y reconciliación.
- Comandos que deben aprobar: los definidos por la matriz VPS/CI sin repetir comprobaciones no afectadas.

## Recuperacion

- Compatibilidad o migracion: paso aditivo; referencias anteriores permanecen válidas.
- Rollback de aplicacion: revertir la imagen del ejecutor sin borrar buckets válidos.
- Recuperacion de datos, si aplica: reconstruir configuración de storage desde las referencias y backup aprobado.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente de la verificación VPS.
- Documentacion actualizada: pendiente.
- Desviaciones del plan: ninguna conocida.
- Pendientes o decisiones nuevas: confirmar versión/digest de SeaweedFS disponible en el VPS antes de ejecutar.
