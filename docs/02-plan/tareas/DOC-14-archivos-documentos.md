# DOC-14 - Archivos e imagenes verificadas en documentos

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `DOC-14`
- Requisitos relacionados: `DOC-03`, `DOC-05`, `CHAT-04`, `FORM-05`, `CAT-02`, `OPS-14`, `OPS-21`
- Fase del MVP: 8. Cierre comercial
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: editor documental desplegado, SeaweedFS privado por perfil y PostgreSQL comercial
- Bloquea a: previsualizacion de imagenes, fichas tecnicas, PDF, envio de documentos y archivos para el agente
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005, ADR-0006, ADR-0011, ADR-0013, ADR-0015 y `archivos-objetos.md`

## Resultado esperado

Un usuario autorizado puede reservar y subir desde Documentos una imagen o ficha tecnica al bucket privado `incoming`; Quantum valida bytes, checksum, tipo y scan, la promueve de forma inmutable a `objects` y solo entonces permite vincularla por `fileId`, previsualizarla o descargarla. Ninguna ruta acepta bucket, object key, URL persistida ni perfil elegido por el cliente.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `DOC-14`, `fileId`, `files`, `incoming`, `objects`, SeaweedFS, S3, scan, ClamAV, contratos, migraciones, worker y editor documental.
- Codigo o documentacion encontrados: SeaweedFS y buckets privados ya son aprovisionados por perfil; el editor conserva `fileId` y checksum en bloques de imagen, pero no existe aun el modulo comercial `files`, su API ni el pipeline de disponibilidad.
- Pruebas e historial encontrados: aprovisionamiento de almacenamiento y aislamiento de configuracion; no existe evidencia de carga, scan, promocion o entrega desde `crm-web`.
- Decision de reutilizacion, extension o reemplazo: reutilizar SeaweedFS y secretos por perfil; crear un modulo `files` propietario con contratos publicos y conectar Documentos exclusivamente por `fileId`.

## Alcance

### Incluido

- Contratos versionados de reserva, finalizacion, estado, referencia y entrega.
- Metadatos y trabajos durables del modulo `files` en PostgreSQL.
- Adaptador S3 exclusivo del modulo y cliente privado de ClamAV.
- Reserva idempotente, carga acotada en `incoming`, verificacion y promocion a `objects`.
- API/BFF autorizados para estado, previsualizacion y descarga breve de archivos `AVAILABLE`.
- Selector de imagen o adjunto en Documentos y persistencia del `fileId` exacto.
- Pruebas de aislamiento, checksum, tipo, scan cerrado, reintento e idempotencia afectadas.

### No incluido

- Archivos de chat, formularios y catalogo, que reutilizaran el modulo mediante sus requisitos propietarios.
- PDF, firma, enlace publico y envio, que permanecen en `DOC-17`, `DOC-18` y requisitos posteriores.
- Destino externo de backup y restauracion integral, obligatorio antes de datos reales mediante `OPS-21` y ADR-0015.

## Impacto tecnico

| Area                       | Impacto previsto                                                                 |
| -------------------------- | -------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `api`, `worker`, `crm-web` y nuevo modulo propietario `files`                    |
| Contratos y eventos        | `/files/v1`, trabajos durables y eventos internos de disponibilidad              |
| Datos y migraciones        | Metadatos, versiones, referencias, operaciones e idempotencia en schema `files`   |
| Permisos y aislamiento     | Permisos de archivos, perfil derivado y relacion documental comprobada en servidor |
| Configuracion y secretos   | Endpoints y credenciales S3/ClamAV mediante `packages/config` y archivos `*_FILE` |
| Observabilidad y operacion | Estados visibles, timeouts, leases, reconciliacion, cuota y fallo cerrado         |
| Documentacion              | Estado, ficha, inventario y runbook afectado                                      |

## Plan de implementacion

- [x] Auditar el aprovisionamiento y los adaptadores existentes de SeaweedFS.
- [x] Definir contratos, permisos y maquina de estados de archivos.
- [x] Crear migracion y repositorios propietarios con idempotencia y fencing.
- [x] Implementar S3, validacion de tipo/checksum y scan ClamAV sin exponer objetos.
- [x] Exponer API/BFF y procesamiento durable en worker.
- [x] Integrar carga, estado, imagenes y adjuntos en el editor documental.
- [x] Validar el candidato exacto una sola vez en el VPS y recorrerlo autenticado.

## Riesgos y mitigaciones

| Riesgo                         | Mitigacion                                                  | Verificacion                                  |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| Archivo malicioso disponible   | Cuarentena, allowlist, ClamAV vigente y fallo cerrado       | EICAR y scanner caido nunca llegan a AVAILABLE |
| Cruce entre perfiles           | Perfil derivado, bucket/credencial por perfil y referencias | Intento cruzado rechazado                     |
| Reintento duplica objetos      | Claves idempotentes, version exacta, lease y fencing        | Complete/promocion repetidos convergen        |
| URL filtra acceso permanente   | Firma breve y autorizacion renovada                         | URL expirada o alterada rechazada             |
| Carrera entre adjunto y borrado| Referencias durables y gracia antes de purga                | Archivo activo nunca se elimina               |

## Criterios de aceptacion

- [x] Una reserva repetida con la misma clave devuelve el mismo resultado y otra carga no reemplaza sus bytes.
- [x] Checksum, MIME, magic bytes, extension, tamano y scan se comprueban antes de `AVAILABLE`.
- [x] Solo un archivo `AVAILABLE` puede previsualizarse, descargarse o vincularse a un documento.
- [x] El editor carga una imagen o ficha real, muestra su estado y guarda el `fileId` exacto.
- [x] Ningun usuario, perfil o modulo ajeno enumera o consume buckets, object keys o bytes.
- [x] Reintentos, reinicios y resultados tardios convergen sin duplicar ni perder objetos.

## Plan de verificacion

- Pruebas unitarias: maquina de estados, allowlist, checksum, referencias, permisos e idempotencia.
- Pruebas de integracion: PostgreSQL, SeaweedFS y ClamAV privados en el VPS.
- Pruebas E2E: carga autenticada desde Documentos, espera de scan, previsualizacion, descarga y rechazo seguro.
- Seguridad y aislamiento: dos perfiles, objeto en cuarentena, EICAR, URL expirada y referencia cruzada.
- Comandos que deben aprobar: formato/lint/typecheck afectados, pruebas del modulo y builds de `api`, `worker`, `crm-web` y migrador.

## Recuperacion

- Migracion expand-only; los componentes anteriores ignoran las tablas nuevas.
- Un rollback de aplicacion no borra metadatos ni objetos; trabajos pendientes quedan pausados y conciliables.
- Ningun objeto se elimina para revertir una release; una correccion de datos usa migracion o reconciliacion forward-only.

## Evidencia de cierre

### Extensión 2026-10-13: calibración visual de la biblioteca

- Alcance: reorganización visual de `/media` sin alterar contratos ni datos. La navegación de carpetas y el área de archivos comparten un contenedor; encabezado, carga y filtros ocupan menos alto, y los textos de navegación son más legibles.
- Validación: PR #148 (`00a04c74`) y corrección móvil PR #149 (`67ed602e`) aprobaron siete checks cada uno. En VPS pasaron Prettier, ESLint, typecheck y build afectados del primer candidato, y Prettier y build del ajuste solo CSS. Release final `67ed602e` con scan `PASSED`; `crm-web` quedó `healthy` por `sha256:bdb5e2becf6bb9f15df575ae5a4f4f522fe0ea327f60466646997a4673b9cfab`.
- Recorrido: navegador autenticado de InterAmerican mostró el archivo sintético en la primera pantalla de escritorio y confirmó cambio a vista de lista; a 390 px de ventana, el documento midió 375 px sin desborde horizontal. Readiness público 200 y `/media` sin sesión 307.
- Desviación: el primer despliegue expuso un desborde móvil del shell, reparado antes del cierre. Se mantiene la excepción temporal de candidata directa; una promoción oficial posterior puede reemplazar este digest. No se marca terminado todo `DOC-14`.

### Extensión 2026-10-13: organización de multimedia

- La búsqueda actual revisa solo la página cargada. Se sustituye por búsqueda paginada en PostgreSQL, con filtros de tipo, carpeta y etiqueta y orden estable.
- Las carpetas y etiquetas pertenecen al módulo Files y no modifican bucket, object key ni bytes verificados. La migración es aditiva y deja los archivos anteriores en «Sin carpeta».
- El servidor aplica permiso de lectura/carga, alcance del miembro y relación con archivo y carpeta. Crear carpeta usa idempotencia durable; mover o renombrar un activo solo altera metadatos de biblioteca.
- Evidencia: el commit candidato `df0517b7` tuvo typechecks afectados de contratos, dominio, base, API y CRM web, ESLint y 17 pruebas unitarias verdes en VPS; la integración PostgreSQL sobre dos perfiles aislados aprobó organización, búsqueda, filtros, permisos e idempotencia. PR #146 integrado como `91925ba5`, siete checks verdes en PR y `main`, y release `91925ba5` con escaneo `PASSED`. La migración se aplicó con `crm-migrator` en InterAmerican; API `sha256:1fb6e7e31886c54df63baf88ca2d256b97a4f4358496726eaf00b31e3e6e7048` y CRM web `sha256:36321e5483a9687316a98e9232a6ca7d7c0086ecd45d7f7aa59ba7ec4a8f4228` quedaron saludables. En navegador autenticado se creó `Pruebas multimedia`, se movió `img0.jpg`, se guardaron dos etiquetas y se verificaron búsqueda, filtros y vista de lista. El almacenamiento y la vista previa del archivo siguieron disponibles.
- Desviación: la publicación en InterAmerican conserva la excepción temporal de candidata directa sin promoción autenticada; el `runtime.env` canónico mantiene la release anterior y una promoción oficial posterior puede sustituirla. No se conectó Google Drive ni se implementó reutilización entre módulos o borrado de archivos.

### Extensión 2026-10-13: biblioteca multimedia local

- Alcance solicitado: una biblioteca propia del CRM para imágenes, audio, video y documentos; la conexión opcional a Google Drive se pospone por decisión del propietario.
- Se reutiliza el módulo Files, sus permisos, bucket privado por perfil, scan obligatorio y URLs firmadas breves. El propietario `library` no acepta `tenantId`, buckets ni rutas enviadas por el navegador.
- Cambio de datos: migración forward-only que amplía la restricción del propietario y añade un índice para listar la biblioteca. No reescribe ni borra archivos existentes.
- Ruta prevista: `/media`, con carga, filtros, paginación, estados y vista previa/descarga únicamente después de `AVAILABLE`.
- Verificación: typecheck de cinco paquetes, ESLint afectado y 15 pruebas focalizadas aprobados en VPS; PostgreSQL sintético aceptó la migración aditiva. El contenedor de prueba aislado se retiró sin tocar perfiles ni datos reales.
- Despliegue y evidencia funcional: PR #143 integrado en `main` (`291485b6`), siete checks CI verdes y release por digest aprobada. La migración forward-only se aplicó en InterAmerican junto con la migración pendiente de USR-06. Por excepción temporal autorizada, API `sha256:5690587a57b0b51a8629bde7cb78d8903fa0f8637c7f537106e3aaf0efd535d6`, worker `sha256:fe12f935ec9451b92978e3b2461f92b54f484a281455c091273646d1129bec48` y CRM web `sha256:d88aca09c1867575033b3a020668cde959d2179a3007e0856d85dd9a5a4a44c4` quedaron saludables. `/api/health/ready` devolvió 200; `/media` sin sesión redirigió y `/api/files?collection=library` sin sesión devolvió 401. En navegador autenticado, la carga de `img0.jpg` atravesó preparación, validación y scan, quedó visible en la biblioteca y abrió la previsualización. La imagen de prueba permanece en el perfil para la revisión del propietario.
- Ruta operativa: `https://interamerican.2-25-172-119.nip.io/media`. PR #144 generaliza la etiqueta para otros perfiles; no cambia el candidato activo del piloto.
- Pendientes de estabilización posterior: Google Drive opcional, borrado y reutilización de activos desde otros módulos, y promoción registrada que sustituya esta excepción temporal. La extensión local no cierra por sí sola todos los criterios de `DOC-14`.

- Archivos, commits o PR: candidato tecnico `c9a0b9e05d8a85ef93597b3b761f6e3ca6b46347`; integrado en `main` mediante PR `#89`, commit `3d96d3c5846d0a8090b0e289012ac0a404dbbdb0`.
- Comandos y resultados: en el VPS aprobaron Prettier y ESLint focalizados, typecheck de dominio, base de datos, API y worker, 32 pruebas focalizadas y los builds de API y worker. El recorrido autenticado completo confirmo archivo `AVAILABLE` y vinculado despues de scan ClamAV.
- Cierre de seguridad del 2026-10-04: el pipeline real del worker, usando ClamAV privado del VPS, llevo la cadena EICAR valida a `REJECTED` con `rejectionCode=MALWARE`; las credenciales S3 del perfil `quantum-demo-jueves` recibieron `PERMISSION_DENIED` al intentar leer el bucket privado de otro perfil. No se promovieron ni persistieron bytes de prueba.
- Publicacion y operacion: la matriz completa de GitHub y el escaneo de imagenes aprobaron la release `0.0.0-candidate.3d96d3c5846d`; la promocion durable `0f77e00b-09c7-4933-aca3-69025693735c` termino `SUCCEEDED`. El perfil piloto quedo `ACTIVE` sobre la release `ef673663-f7d6-5bd2-9ed9-472b03d0d13f`; `api`, `worker`, `crm-web`, `portal-web` y `agent-runtime` quedaron saludables por digest. Un smoke autenticado posterior devolvio `200` para `/documents`, `/api/documents` y `/api/documents/templates`, con seis documentos y dos plantillas persistidas.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: el worker existente no iniciaba el bucle de archivos y la transicion PostgreSQL inferia tipos incompatibles; ambos defectos quedaron corregidos. La comparacion de bloques protegidos ahora canoniza JSON para tolerar el orden de propiedades de JSONB sin permitir cambios estructurales.
- Pendientes o decisiones nuevas: backup externo y recorridos de chat/formularios/catalogo conservan sus requisitos propios; no bloquean el cierre de `DOC-14`.
