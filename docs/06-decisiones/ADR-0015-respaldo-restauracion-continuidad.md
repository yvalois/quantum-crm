# ADR 0015 Respaldo, restauracion y continuidad

- Estado: aceptado
- Fecha: 2026-09-18
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-021, ADM-15, ADM-16, OPS-02, OPS-13, OPS-15, OPS-18, OPS-21, OPS-22 y OPS-24

## Contexto

El MVP parte de un solo VPS. PostgreSQL, SeaweedFS, Keycloak, configuracion y secretos pueden sobrevivir al reinicio de un contenedor, pero siguen dentro del mismo dominio de fallo fisico. Un volumen Docker, un snapshot local o una copia en otro directorio del servidor no permiten recuperarse de la perdida, corrupcion o compromiso completo del VPS.

La restauracion tambien debe coordinar datos relacionales, versiones inmutables de objetos, identidad y configuracion. Recuperar solo PostgreSQL puede dejar adjuntos ausentes; recuperar solo archivos puede producir objetos sin referencias o estados comerciales incoherentes.

## Decision

Quantum usa dos niveles complementarios:

1. **Recuperacion operativa local**, para errores acotados y rapidez, conservada en almacenamiento separado de los volumenes activos cuando la capacidad del VPS lo permita.
2. **Recuperacion ante desastre**, mediante copias cifradas fuera del VPS primario y fuera de sus credenciales administrativas. Esta copia es obligatoria antes de aceptar datos reales del piloto.

La operacion primaria permanece autohospedada en el VPS. Solo el material cifrado de recuperacion abandona ese dominio de fallo. El destino admite escritura automatizada con credenciales de minimo privilegio, retencion protegida y lectura mediante una identidad distinta. Puede ser almacenamiento S3 compatible o un repositorio de backup en otro servidor; el proveedor concreto se selecciona al conocer region, capacidad, costos y requisitos del VPS.

`admin-api` registra la intencion y el resultado durable. `deploy-executor` coordina operaciones tipadas de backup y restauracion; no acepta shell, paths ni destinos libres desde la interfaz. PostgreSQL conserva inventario, estados, componentes, checksums, punto de recuperacion, actor y evidencia.

### Alcance del backup

| Componente | Tratamiento |
|---|---|
| Bases comerciales por perfil | Backup consistente y recuperacion a punto en el tiempo mediante base backups y archivo continuo de WAL |
| Base de plataforma | Mismo nivel de proteccion que las bases comerciales, con repositorio y credenciales de plataforma separados |
| Persistencia de Keycloak | Backup consistente de su base y del material no regenerable necesario para validar identidad |
| Checkpoints del agente | Backup separado por perfil; nunca sustituye datos comerciales y puede descartarse de forma explicita si una ejecucion no es reanudable |
| SeaweedFS | Copia de versiones exactas indicadas por el manifiesto de ADR-0013, con SHA-256 e inventario por perfil |
| Configuracion e inventario | Revisiones, Compose aprobado, Caddy, mapeo de servicios, dominios, politicas y manifiestos de release |
| Secretos y claves | Paquete cifrado independiente, con clave de recuperacion fuera del repositorio y del destino de backup |
| Imagenes de aplicacion | No se duplican como datos si pueden recuperarse por digest desde el registro; el manifiesto conserva sus referencias |
| Redis, cache y colas derivables | No se tratan como fuente de verdad; se reconstruyen desde PostgreSQL y configuracion |
| Logs y trazas | Se conservan por su politica de observabilidad; no son mecanismo de recuperacion comercial |

### Objetivos iniciales del piloto

Los valores son objetivos tecnicos verificables, no un SLA comercial. Si una prueba real no los alcanza, se ajusta capacidad o procedimiento antes del piloto; no se declara cumplimiento por configuracion teorica.

| Escenario | RPO maximo | RTO maximo |
|---|---:|---:|
| Base transaccional o de plataforma con host disponible | 15 minutos | 4 horas |
| Perfil completo: datos, objetos, identidad y configuracion | 1 hora | 8 horas |
| Perdida total del VPS y reconstruccion completa | 1 hora | 12 horas |
| Staging sin datos productivos | 24 horas | 24 horas |

El RPO del perfil completo queda limitado por el componente valido mas antiguo. No se anuncia un RPO de 15 minutos si los objetos o secretos recuperables solo llegan hasta una hora antes.

### Frecuencia y retencion inicial

- WAL de PostgreSQL se archiva continuamente fuera del VPS y se verifica que no existan huecos.
- Se genera al menos un recovery point coordinado por hora para datos, objetos y configuracion de cada perfil activo.
- Se conserva recuperacion a punto en el tiempo durante 14 dias.
- Se conservan recovery points semanales durante 8 semanas y mensuales durante 6 meses.
- Un backup previo a una migracion o cambio destructivo se protege al menos 30 dias o hasta que expire la ventana de compatibilidad, lo que sea mayor.
- Las generaciones de PostgreSQL, objetos, identidad, configuracion y secretos que formen un mismo `backupSetId` comparten retencion y no se eliminan parcialmente.
- Retenciones legales o contractuales pueden ampliar estos plazos; nunca se reducen silenciosamente.

La politica se revisa al medir volumen, velocidad y costo. Una reduccion requiere ADR o aprobacion operativa registrada y no puede invalidar RPO, RTO ni obligaciones legales.

### Consistencia y restauracion

El coordinador usa el barrier, generacion y manifiesto definidos por ADR-0013. Los objetos son inmutables y las versiones incluidas quedan protegidas contra borrado mientras la copia se completa. Cada backup termina en `VERIFIED` solo si todos sus componentes, manifiestos y checksums son validos; un conjunto parcial no es restaurable ni aparece como exitoso.

Toda restauracion:

1. crea una operacion independiente del rollback de aplicacion;
2. selecciona por ID un backup `VERIFIED`, el perfil y el punto de recuperacion;
3. valida claves, digests, version de esquema, WAL, manifiesto de objetos y capacidad antes de modificar un destino;
4. restaura primero en un entorno aislado, sin correo, mensajes, pagos, webhooks, automatizaciones ni agentes con efectos externos;
5. verifica invariantes, conteos, referencias de archivos, checksums, identidad, configuracion y smoke tests;
6. muestra la perdida esperada desde el punto seleccionado y exige doble confirmacion autorizada antes de una sustitucion;
7. conserva evidencia, actor, motivo, correlacion, resultado y destino;
8. realiza cutover mediante una operacion tipada o abandona el intento sin tocar el origen.

No existe restauracion directa sobre produccion desde el navegador, rollback generico de datos ni restauracion parcial improvisada de tablas o directorios. Una recuperacion selectiva necesita un procedimiento especifico y evidencia de integridad.

### Cifrado y custodia

- El backup se cifra antes de salir del VPS mediante una clave que el destino externo no controla.
- Transporte y almacenamiento usan cifrado; esto no sustituye el cifrado previo.
- Credenciales de escritura no pueden borrar recovery points protegidos ni leer datos cuando el mecanismo lo permita.
- La identidad de restauracion es distinta de la identidad de backup y solo se habilita durante una operacion autorizada.
- La clave de recuperacion tiene al menos dos custodios o un mecanismo de escrow probado y no reside unicamente en el VPS, Git, la base administrativa o el mismo destino cifrado.
- La rotacion crea nuevas generaciones y conserva las claves antiguas mientras exista un backup que las necesite.

### Pruebas y evidencia

- Cada ejecucion valida checksums, completitud, WAL continuo, cifrado, edad y retencion.
- Mensualmente se restaura al menos un perfil completo en aislamiento y se mide RPO y RTO reales.
- Trimestralmente se ensaya la reconstruccion del VPS desde inventario, digests y copias externas.
- Antes del piloto se completa una restauracion de perfil y una reconstruccion total sin depender del servidor original.
- Una copia no restaurada con exito dentro de su ventana no cuenta como respaldo verificado.

## Alternativas consideradas

### Mantener todas las copias dentro del VPS

Se rechaza porque comparte disco, cuenta administrativa, errores operativos, ransomware y perdida fisica con la fuente. Puede acelerar una recuperacion local, pero no satisface `OPS-21` ni la puerta del piloto.

### Snapshot completo del VPS como unico mecanismo

Se rechaza porque no prueba consistencia entre PostgreSQL y objetos, depende del proveedor y dificulta restaurar un solo perfil. Puede complementar, nunca reemplazar, los backups coordinados.

### Dumps manuales de PostgreSQL y copias de carpetas

Se rechaza porque no ofrecen archivo continuo de WAL, inventario durable, idempotencia, aislamiento ni evidencia automatizada. Copiar volumenes activos tampoco garantiza consistencia.

### Alta disponibilidad antes del piloto

Se difiere porque replicas, failover y varios nodos agregan operacion que un solo VPS no puede ofrecer. Alta disponibilidad reduce interrupciones, pero no sustituye backups ni recuperacion ante corrupcion.

### Elegir ya un proveedor externo concreto

Se difiere hasta conocer VPS, region, capacidad, residencia y presupuesto. La interfaz operativa y los criterios de seguridad evitan que esa seleccion cambie el dominio o el flujo de restauracion.

## Consecuencias

- El piloto necesita un destino externo y custodia de claves, aunque la operacion primaria permanezca en el VPS.
- El costo incluye almacenamiento, transferencia, pruebas y capacidad temporal de restauracion.
- La copia de objetos y datos requiere coordinacion durable, espacio y observabilidad.
- Los objetivos permiten medir si el VPS y el enlace de salida son suficientes antes de aceptar datos reales.
- Separar rollback, restauracion de perfil y reconstruccion del servidor evita descartar datos por una accion equivocada.
- La recuperacion de secretos introduce un procedimiento de custodia que no puede automatizarse con una sola credencial del servidor.

## Validacion

La decision se considera aplicada cuando:

- el destino externo y sus credenciales estan documentados sin guardar secretos en Git;
- un backup coordinado incluye todos los componentes exigidos y finaliza `VERIFIED` con evidencia;
- una corrupcion, copia parcial, hueco de WAL o checksum distinto impide usar el recovery point;
- se restaura un perfil aislado sin emitir efectos externos y todas sus referencias resuelven a bytes correctos;
- se reconstruye un VPS nuevo sin acceso al disco del servidor original;
- las pruebas medidas cumplen los RPO y RTO aplicables;
- borrar, rotar, reintentar o cancelar operaciones respeta retencion, permisos, idempotencia y auditoria;
- la perdida de Redis no elimina intencion, trabajos, auditoria ni resultados durables.

La especificacion ampliada vive en [Respaldo, restauracion y continuidad](../08-arquitectura/respaldo-restauracion-continuidad.md) y sus restricciones en [Reglas de respaldo y continuidad](../05-reglas/14-respaldo-restauracion-continuidad.md).
