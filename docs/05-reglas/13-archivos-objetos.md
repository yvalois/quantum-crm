# Archivos y objetos

Estas reglas aplican a cargas, adjuntos, medios, PDFs, firmas, comprobantes, derivados, almacenamiento y borrado. Desarrollan [ADR-0013](../06-decisiones/ADR-0013-archivos-almacenamiento-objetos.md).

## Propiedad y aislamiento

- Usar el modulo `files` como unico propietario de metadatos, claves y acceso S3.
- Guardar en otros modulos solo `fileId` y referencias comerciales; no guardar bucket, object key, URL firmada ni credencial.
- Crear por perfil buckets privados `incoming` y `objects`, con politicas y credenciales de minimo privilegio.
- Separar credenciales de carga, scan/promocion, entrega y mantenimiento; limitar el listado de reconciliacion al bucket y prefijo tecnico configurados del perfil.
- Derivar el perfil desde identidad y configuracion verificadas; nunca desde un `tenant_id`, bucket o key recibido libremente.
- Prohibir enumeracion, copia, deduplicacion o acceso entre perfiles, incluso cuando SeaweedFS comparta proceso o disco.
- Reservar administracion de buckets, cuotas, politicas y credenciales a `deploy-executor`.

## Carga y validacion

- Crear una reserva durable antes de emitir una autorizacion de carga.
- Exigir `Idempotency-Key` y SHA-256 esperado al reservar; firmar Browser POST con clave opaca, checksum, rango de tamano y vencimiento maximo de 10 minutos dentro de `incoming`.
- Mantener versionado activo y vincular el `fileId` a una sola `incomingVersionId`; no usar ETag como SHA-256 ni permitir que una carga posterior reemplace la version confirmada.
- No aceptar el nombre original como path ni permitir que el cliente elija bucket u object key.
- Validar el tamano observado, SHA-256, magic bytes, extension, MIME y estructura; no confiar en valores declarados.
- Aplicar allowlist por caso de uso. HTML, JavaScript, SVG activo, ejecutables y archivos comprimidos quedan deshabilitados para adjuntos ordinarios.
- Aplicar los maximos iniciales: imagen 20 MiB, audio 50 MiB, documento 50 MiB y video 250 MiB.
- Hacer pasar por el mismo pipeline archivos del navegador, proveedores, importaciones y generadores internos.

## Cuarentena y disponibilidad

- Escanear con ClamAV dentro de una red privada y mantener sus firmas mediante `freshclam`.
- No exponer el socket TCP de `clamd` fuera de la red interna ni tratarlo como autenticado.
- Fallar cerrado si el scanner no responde, sus firmas superan 48 horas o el contenido no puede inspeccionarse.
- Reintentar cuarentena transitoria con backoff y jitter durante un maximo de 72 horas; despues fallar y purgar bytes en un maximo de 24 horas.
- No descargar, previsualizar, compartir, enviar, procesar ni entregar al agente un archivo que no este `AVAILABLE`.
- Promover la version exacta mediante copia a una nueva version de `objects`, recalcular su SHA-256 y borrar la copia temporal solo despues de confirmar el destino.
- Usar leases, fencing e idempotencia durable; rechazar resultados tardios de un worker que perdio la titularidad.

## Acceso y entrega

- Mantener todos los buckets privados.
- Autorizar de nuevo identidad, permiso, perfil, relacion con el recurso y estado antes de cada entrega.
- Emitir URLs firmadas de aproximadamente 60 segundos y alcance exacto; no persistirlas ni registrarlas. Son bearer tokens reutilizables hasta vencer y no se presentan como enlaces de un solo uso.
- Hacer que los enlaces publicos apunten a una capacidad revocable de Quantum que emite una autorizacion breve, nunca al objeto S3 permanente.
- Limitar CORS a origenes registrados y usar `Content-Disposition` y nombres saneados al descargar.
- Entregar a agentes solo metadatos, extracciones autorizadas o referencias MCP; nunca credenciales S3, paths internos ni archivos codificados sin necesidad.

## Inmutabilidad, retencion y borrado

- No sobrescribir objetos. Una sustitucion crea nuevo `fileId`, key y checksum.
- Vincular documentos enviados, aceptados, firmados, PDFs y comprobantes a la version exacta del archivo.
- Administrar referencias activas y reservadas dentro de `files`; attach y detach llegan mediante comandos/eventos idempotentes del modulo propietario y se serializan con el borrado.
- Tratar previews, thumbnails, texto extraido y PDFs derivados como objetos nuevos vinculados a su fuente.
- Eliminar cargas incompletas despues de 24 horas y bytes rechazados en un maximo de 24 horas, conservando solo evidencia segura.
- Aplicar `DELETE_SCHEDULED`, bloqueo de lectura y una gracia inicial de 30 dias a archivos comerciales ordinarios cuando referencias, retencion y legal hold lo permitan; solo durante esa gracia se admite restauracion autorizada.
- Ejecutar el borrado fisico como operacion durable: comprobar, eliminar, confirmar ausencia y conciliar resultados inciertos.
- No presentar como eliminados los bytes aun presentes en respaldos; aplicar la expiracion definida por la politica de backup.

## Operacion y observabilidad

- Fijar SeaweedFS, ClamAV y herramientas auxiliares por version y digest; no desplegar `latest`.
- Mantener puertos administrativos y de datos internos fuera de Internet; Caddy publica solo la frontera aprobada.
- Entregar credenciales, claves de cifrado y configuracion sensible mediante secretos `*_FILE` montados por servicio.
- Reservar margen de disco y bloquear nuevas escrituras antes del agotamiento; una escritura rechazada no puede aparecer como completada.
- Incluir en readiness el acceso requerido al almacen, capacidad minima y scanner cuando el proceso acepte cargas o promociones.
- Registrar solo `fileId`, estado, operacion, codigo de error y correlacion permitida; nunca contenido, URL firmada, nombre sensible o credencial.
- Mantener reconciliadores para reservas vencidas, objetos huerfanos, copias incompletas y borrados pendientes.

## Pruebas y evidencia

Un cambio de archivos demuestra, segun su riesgo:

- contrato S3 contra la version exacta de SeaweedFS;
- aislamiento real entre dos perfiles, buckets, credenciales y URLs;
- autorizaciones expiradas, alteradas y usadas para otro objeto;
- formatos falsos o maliciosos, checksum incorrecto, EICAR y contenido no inspeccionable;
- duplicacion, reinicio y fallo de PostgreSQL, SeaweedFS, ClamAV o worker en cada transicion;
- referencias, retencion, legal hold, eliminacion y reconciliacion;
- limites de cuota, presion de disco y recursos de procesamiento;
- recorrido real de carga y consumo desde cada modulo afectado;
- backup y restauracion coordinados de metadatos y objetos.

Un mock, una fila `AVAILABLE`, una URL generada o una previsualizacion aislada no acreditan la capacidad completa.
