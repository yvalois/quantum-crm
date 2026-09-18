# ADR 0013 Archivos y almacenamiento de objetos

- Estado: aceptado
- Fecha: 2026-09-18
- Responsables: propietario del proyecto
- Requisitos relacionados: PROY-019, BASE-01, BASE-06, CHAT-04, FORM-04, FORM-05, FORM-18, CAT-02, CAT-12, CAT-22, CAT-24, DOC-03, DOC-05, DOC-14, DOC-17, DOC-18, DOC-23, DOC-31, ADM-04, ADM-15, OPS-02, OPS-04, OPS-14, OPS-21, OPS-22, OPS-23 y OPS-24

## Contexto

Quantum necesita almacenar imagenes, audios, videos, documentos, PDFs, firmas y comprobantes sin mezclar perfiles ni convertir el disco local de una aplicacion en fuente de verdad. Los archivos pueden llegar desde navegadores, formularios publicos, canales externos o procesos internos y son una frontera no confiable: el nombre, extension, MIME, tamano declarado y contenido pueden ser falsos o maliciosos.

El MVP se ejecutara inicialmente en un solo VPS y no debe depender de un servicio de objetos externo para su operacion primaria. Aun asi, los modulos necesitan un contrato S3 estandar que permita cambiar el proveedor sin alterar el dominio. PostgreSQL y un almacen de objetos no comparten transacciones, por lo que tambien se requiere una maquina de estados durable y reconciliacion.

## Decision

Quantum usara SeaweedFS como almacenamiento compatible con S3 autohospedado dentro del VPS. Su imagen se fija por digest y sus puertos administrativos permanecen en redes privadas de Compose. Caddy publica solo la entrada S3 necesaria para operaciones firmadas.

Cada perfil tiene dos buckets privados y credenciales separadas por funcion:

- `incoming`: recepcion y cuarentena de bytes aun no confiables.
- `objects`: objetos verificados y disponibles.

El modulo `files` es el unico propietario de metadatos, claves y acceso S3. Los demas modulos conservan `fileId` y usan contratos publicos; no conocen buckets, claves ni credenciales. PostgreSQL es la autoridad de propietario, referencias, estado, checksum, retencion y acceso. SeaweedFS conserva los bytes.

Toda carga crea primero una reserva durable con SHA-256 esperado y una policy Browser POST, breve y limitada a una clave opaca de `incoming`. El bucket tiene versionado activo y `complete` vincula una sola `versionId`; reutilizar la autorizacion no puede reemplazar los bytes vinculados. Al finalizar se comprueba tamano observado, SHA-256 calculado, firma del formato, extension, MIME y estructura. ClamAV escanea en una red privada con firmas actualizadas. Solo un archivo `AVAILABLE` puede descargarse, previsualizarse, compartirse, enviarse o entregarse al agente.

La promocion lee la `versionId` verificada de `incoming`, crea una version inmutable en `objects`, vuelve a calcular su checksum y elimina la copia temporal. Cada paso es idempotente, usa lease y generacion de fencing, y se reconcilia desde PostgreSQL ante un resultado incierto. Un archivo nunca se sobrescribe: una sustitucion crea otro `fileId`, clave, version y checksum.

Todos los buckets son privados. La API vuelve a autorizar el recurso antes de emitir una URL firmada de aproximadamente 60 segundos. Los enlaces publicos de formularios o documentos apuntan a una capacidad de Quantum, no a una URL S3 persistida. Las URLs firmadas, nombres sensibles y contenidos no se registran en logs.

Los limites iniciales por clase son 20 MiB para imagenes, 50 MiB para audio, 50 MiB para documentos y 250 MiB para video. Cada canal, formulario o perfil puede imponer un limite menor. Elevar el maximo operativo exige revisar capacidad, tiempos de procesamiento y riesgo.

Los objetos y derivados son inmutables. PDFs, comprobantes, versiones enviadas, aceptadas o firmadas quedan vinculados al `fileId` exacto. `files` mantiene referencias activas y reservadas mediante comandos y eventos idempotentes de los modulos propietarios; una carrera no puede adjuntar durante el borrado. La eliminacion es una operacion durable que comprueba referencias, retencion y legal hold, programa la gracia, elimina, verifica ausencia y concilia resultados inciertos. Las cargas incompletas expiran a las 24 horas; bytes rechazados se eliminan como maximo en 24 horas conservando solo evidencia segura. Los archivos comerciales ordinarios usan `DELETE_SCHEDULED`, lectura bloqueada y una gracia inicial de 30 dias durante la cual pueden restaurarse de forma autorizada.

SeaweedFS usa cifrado en reposo y TLS en las fronteras de red aprobadas. Claves, credenciales S3 y configuracion sensible entran mediante secretos montados por servicio. `deploy-executor` es el unico componente con permisos administrativos para crear buckets, politicas, cuotas o credenciales.

El almacenamiento principal en el VPS no es alta disponibilidad ni respaldo. La copia cifrada fuera del VPS y la restauracion coordinada de PostgreSQL, objetos y configuracion son obligatorias para el piloto. Un manifiesto durable fija cada `fileId`, estado, key interna, `versionId` y checksum al mismo corte de PostgreSQL y protege esas versiones contra borrado mientras se copian. ADR-0015 elegira destino, cifrado, RPO, RTO, retencion y runbook sin debilitar ese contrato.

La especificacion operativa completa vive en [Archivos y objetos](../08-arquitectura/archivos-objetos.md) y las restricciones de implementacion en [Reglas de archivos y objetos](../05-reglas/13-archivos-objetos.md).

## Alternativas consideradas

### Amazon S3 o Cloudflare R2 como almacenamiento primario

Se difieren porque el propietario decidio mantener la operacion primaria dentro del VPS. El adaptador S3 conserva una ruta de migracion futura y el respaldo externo sigue siendo obligatorio.

### Garage

Es una alternativa S3 autohospedada activa, pero su principal ventaja aparece en despliegues distribuidos. Para el primer VPS, SeaweedFS ofrece una ruta de operacion de nodo unico mas directa y licencia Apache 2.0.

### MinIO Community

Se rechaza para una adopcion nueva porque su repositorio comunitario fue archivado y dejo de mantenerse. No se incorpora una dependencia central sin una ruta comunitaria activa.

### Archivos en el filesystem de API o worker

Se rechaza porque acopla datos al ciclo de vida del contenedor, dificulta URLs firmadas, aislamiento, restauracion y migracion, y permite que varios procesos observen estados divergentes.

### Subir directamente al bucket definitivo

Se rechaza porque haria disponibles bytes antes de validar y escanear. La cuarentena separa fisicamente entrada no confiable de objetos utilizables.

### Bucket publico o URLs permanentes

Se rechaza porque omite la autorizacion vigente, expone objetos por filtracion del enlace y dificulta revocacion, auditoria y aislamiento.

## Consecuencias

- El producto conserva un contrato S3 portable y no paga un servicio de objetos por la operacion primaria.
- El aislamiento de archivos se vuelve comprobable por bucket, credencial, politica y autorizacion de aplicacion.
- Los archivos maliciosos o no inspeccionables fallan cerrados antes de llegar a recorridos comerciales o agentes.
- El VPS suma SeaweedFS, ClamAV, almacenamiento persistente, consumo de CPU, memoria y disco, y nuevos runbooks.
- Una sola maquina sigue siendo un punto de fallo; cifrado y aislamiento no sustituyen respaldo externo ni alta disponibilidad.
- PostgreSQL y S3 requieren outbox, trabajos idempotentes y reconciliadores; no se puede presentar una copia como atomica.
- La inmutabilidad consume mas espacio, por lo que cuotas, retencion, derivados y margen de disco deben observarse.

## Validacion

La decision se considera aplicada cuando:

- dos perfiles usan buckets y credenciales distintos y ningun intento cruzado puede leer, escribir, firmar ni enumerar objetos;
- solo el modulo `files` conoce claves S3 y ningun contrato comercial expone buckets o paths;
- una URL expirada, alterada o emitida para otro objeto se rechaza y una URL reutilizada durante su vigencia no amplia objeto, version ni operacion;
- reutilizar una policy de carga aun vigente solo crea una version huerfana que no reemplaza la version vinculada ni los bytes escaneados;
- MIME falso, doble extension, checksum incorrecto, archivo cifrado no inspeccionable, bomba de descompresion y EICAR nunca alcanzan `AVAILABLE`;
- la indisponibilidad de ClamAV o firmas con mas de 48 horas deja el archivo en cuarentena y no produce un exito falso;
- finalizar, escanear, promover o borrar dos veces converge en un unico resultado;
- reiniciar durante la copia entre buckets permite reconciliar el archivo sin perderlo ni duplicarlo;
- un archivo referenciado, retenido o bajo legal hold no se elimina fisicamente;
- adjuntar o retirar una referencia mientras se programa un borrado converge sin purgar bytes activos;
- cargas incompletas, objetos huerfanos y borrados pendientes se detectan y concilian;
- el sistema bloquea nuevas escrituras antes de agotar el disco y mantiene lecturas seguras cuando sea posible;
- chat, formularios, catalogo y documentos completan carga, previsualizacion, descarga y envio usando archivos reales verificados;
- una restauracion aislada recupera de forma consistente metadatos y objetos del perfil.

## Referencias

- [SeaweedFS](https://github.com/seaweedfs/seaweedfs)
- [SeaweedFS Security Policy](https://github.com/seaweedfs/seaweedfs/blob/master/SECURITY.md)
- [ClamAV: scanning](https://docs.clamav.net/manual/Usage/Scanning.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Se revisa esta decision al agregar varios VPS, necesitar alta disponibilidad del almacen, superar la capacidad medida del nodo, requerir retencion inmutable regulada o migrar el almacenamiento primario a un servicio externo.
