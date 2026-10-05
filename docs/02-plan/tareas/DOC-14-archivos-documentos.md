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

- Archivos, commits o PR: candidato tecnico `c9a0b9e05d8a85ef93597b3b761f6e3ca6b46347`; integrado en `main` mediante PR `#89`, commit `3d96d3c5846d0a8090b0e289012ac0a404dbbdb0`.
- Comandos y resultados: en el VPS aprobaron Prettier y ESLint focalizados, typecheck de dominio, base de datos, API y worker, 32 pruebas focalizadas y los builds de API y worker. El recorrido autenticado completo confirmo archivo `AVAILABLE` y vinculado despues de scan ClamAV.
- Cierre de seguridad del 2026-10-04: el pipeline real del worker, usando ClamAV privado del VPS, llevo la cadena EICAR valida a `REJECTED` con `rejectionCode=MALWARE`; las credenciales S3 del perfil `quantum-demo-jueves` recibieron `PERMISSION_DENIED` al intentar leer el bucket privado de otro perfil. No se promovieron ni persistieron bytes de prueba.
- Publicacion y operacion: la matriz completa de GitHub y el escaneo de imagenes aprobaron la release `0.0.0-candidate.3d96d3c5846d`; la promocion durable `0f77e00b-09c7-4933-aca3-69025693735c` termino `SUCCEEDED`. El perfil piloto quedo `ACTIVE` sobre la release `ef673663-f7d6-5bd2-9ed9-472b03d0d13f`; `api`, `worker`, `crm-web`, `portal-web` y `agent-runtime` quedaron saludables por digest. Un smoke autenticado posterior devolvio `200` para `/documents`, `/api/documents` y `/api/documents/templates`, con seis documentos y dos plantillas persistidas.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`.
- Desviaciones del plan: el worker existente no iniciaba el bucle de archivos y la transicion PostgreSQL inferia tipos incompatibles; ambos defectos quedaron corregidos. La comparacion de bloques protegidos ahora canoniza JSON para tolerar el orden de propiedades de JSONB sin permitir cambios estructurales.
- Pendientes o decisiones nuevas: backup externo y recorridos de chat/formularios/catalogo conservan sus requisitos propios; no bloquean el cierre de `DOC-14`.
