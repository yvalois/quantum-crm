# DOC-01 - Editor de documentos y plantillas reutilizables

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `DOC-01`
- Requisitos relacionados: `DOC-02`, `DOC-03`, `DOC-04`, `DOC-05`, `DOC-06`, `DOC-11`, `DOC-13`, `DOC-15`, `DOC-16`
- Fase del MVP: 8. Cierre comercial
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: identidad y permisos del CRM; contactos y oportunidades existentes
- Bloquea a: `DOC-17` a `DOC-37`, automatizaciones y herramientas documentales del agente
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005, ADR-0006, ADR-0013, ADR-0014, `frontends-experiencia-visual.md`

## Resultado esperado

Un usuario autorizado puede abrir Documentos desde el shell del CRM, crear o editar un borrador real, ordenar bloques de contenido, reutilizarlo como plantilla e instanciar una plantilla sin modificar su revision original. Los cambios quedan persistidos con control optimista y aislamiento del perfil.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `DOC-*`, `document`, `template`, `plantilla`, rutas web, contratos, dominio, repositorios, migraciones e historial.
- Codigo o documentacion encontrados: shell de `crm-web` con Documentos inactivo; patrones verticales funcionales en Contactos, Tareas, Conversaciones y Calendario; no existe modulo `documents` ni persistencia previa.
- Pruebas e historial encontrados: suites de contratos, dominio, repositorio, controlador/BFF y builds por aplicacion; ninguna prueba documental previa.
- Decision de reutilizacion, extension o reemplazo: extender contratos, dominio, base comercial, API y BFF existentes; reutilizar sesion opaca, permisos server-side, idempotencia y `If-Match`; crear el modulo propietario `documents` sin duplicar acceso a datos.

## Alcance

### Incluido

- Contrato versionado para documentos, plantillas, paginas y bloques editables/protegidos.
- Persistencia PostgreSQL en schema `documents`, historial de versiones e idempotencia.
- Casos de uso para listar, crear, consultar, editar, duplicar y guardar/reutilizar plantillas.
- API `/api/v1/documents` y BFF autenticado de `crm-web`.
- Pantalla visual de documentos con biblioteca, editor por bloques, vista previa y guardado.
- Pruebas de contratos, reglas de dominio, HTTP/BFF, aislamiento y concurrencia optimista.

### No incluido

- Render PDF, envio, aceptacion, firma, pagos, facturacion recurrente y herramientas MCP, que conservan sus requisitos `DOC-17` a `DOC-37`.
- Carga binaria de imagenes; los bloques de imagen conservan `fileId` y checksum y solo podran previsualizar objetos `AVAILABLE` cuando cierre el modulo `files`.
- Productos del catalogo y formulas, que dependen de `CAT-01` a `CAT-30` y `DOC-07` a `DOC-10`.

## Impacto tecnico

| Area                       | Impacto previsto                                                                |
| -------------------------- | ------------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `api`, `crm-web`, `documents` en dominio y base comercial                       |
| Contratos y eventos        | Contratos HTTP `documents/v1`; sin evento externo en esta rebanada              |
| Datos y migraciones        | Schema `documents`, borradores, revisiones e idempotencia                       |
| Permisos y aislamiento     | `crm:documents:read`, `create`, `update`, `templates`; actor derivado de sesion |
| Configuracion y secretos   | Sin variables ni secretos nuevos                                                |
| Observabilidad y operacion | Errores RFC 9457 existentes y migracion por perfil                              |
| Documentacion              | Estado, ficha, checklist solo donde exista cierre completo                      |

## Plan de implementacion

- [x] Definir contratos y permisos documentales.
- [x] Implementar agregado y servicio de aplicacion con versiones inmutables de contenido.
- [x] Crear migracion y repositorio PostgreSQL propietario.
- [x] Exponer API y BFF con schemas runtime, permisos e idempotencia.
- [x] Implementar biblioteca y editor visual conectado a datos reales.
- [x] Validar una vez el candidato exacto en el VPS y registrar evidencia.
- [x] Completar el recorrido HTTP/BFF autenticado despues del despliegue por digest.

## Riesgos y mitigaciones

| Riesgo                               | Mitigacion                                                                        | Verificacion                             |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------- |
| Sobrescritura concurrente            | Version numerica, `ETag` e `If-Match` obligatorio                                 | Actualizacion obsoleta responde `412`    |
| Plantilla alterada por una instancia | Snapshot profundo al instanciar y revisiones separadas                            | Prueba compara plantilla antes y despues |
| Acceso sin permiso                   | Guardas server-side y servicio con denegacion por defecto                         | Pruebas `403` y permisos por accion      |
| Contenido arbitrario peligroso       | Schemas estrictos, texto plano, limites y tipos allowlist                         | Pruebas de payload invalido              |
| Imagen no disponible                 | Solo referencia `fileId` + checksum; sin URL S3 ni preview binaria en este bloque | Contrato rechaza referencias incompletas |

## Criterios de aceptacion

- [x] Documentos aparece activo en el sidebar y abre una pantalla funcional.
- [x] Crear un documento vacio o desde plantilla persiste un borrador real.
- [x] El usuario agrega, edita, reordena y elimina bloques permitidos y ve la vista previa.
- [x] Guardar como plantilla conserva estructura, estilos y reglas editables/protegidas.
- [x] Duplicar crea un documento independiente y conserva el original.
- [x] Un `If-Match` obsoleto no pisa cambios.
- [x] Usuario sin permiso no puede leer ni mutar documentos.

## Plan de verificacion

- Pruebas unitarias: contratos y servicio de documentos, plantillas, duplicacion y control de version.
- Pruebas de integracion o contratos: migracion, repositorio, API y BFF.
- Pruebas E2E: smoke autenticado de biblioteca, alta, edicion y plantilla en el VPS.
- Comprobacion manual: coherencia con la pantalla Documentos y facturacion de Stitch.
- Seguridad, permisos y aislamiento: permisos server-side, perfil derivado, dos actores y entradas estrictas.
- Idempotencia, concurrencia y recuperacion: claves de idempotencia y `If-Match`.
- Comandos que deben aprobar: formato, lint, typecheck, unitarias afectadas, contratos, integracion PostgreSQL, builds de `api`, `crm-web` y `crm-migrator` en el VPS.

## Recuperacion

- Compatibilidad o migracion: migracion expand-only; aplicaciones anteriores ignoran el schema nuevo.
- Rollback de aplicacion: desplegar digest anterior; las tablas nuevas permanecen sin perdida.
- Recuperacion de datos, si aplica: no ejecutar down destructivo; corregir con migracion forward-only.

## Evidencia de cierre

- Archivos, commits o PR: PR #79 integrado en `main` como `28d64e0603220bc35e1d7c756f6064963dc5fda2`; 26 archivos de contratos, dominio, persistencia, API/BFF, interfaz, migracion y documentacion.
- Comandos y resultados: en el VPS aprobaron Prettier del repositorio, ESLint afectado, typecheck de `contracts`, `domain`, `database`, `api` y `crm-web`, 9 pruebas afectadas y builds de las imagenes `api`, `crm-web` y `crm-migrator`. La matriz de GitHub aprobo 7/7 y la release `659d5b84-0647-5a6d-8ccb-bd695516938f` publico imagenes sin hallazgos altos o criticos. El perfil piloto aplico la migracion `20261002010000_doc_editor_templates`; `api` y `crm-web` quedaron saludables con los digests oficiales `sha256:aac80cfc22be52152fff29772558d414445042c47a79408c5b3f7ce60ebf7197` y `sha256:922d7e27a7758a587773a92439b77e29372b5448c472f3245437b7505caee75d`.
- Recorrido autenticado: password y TOTP permanecieron en archivos privados del VPS; el login termino en `/documents`, la sesion devolvio `authenticated=true`, y crear, editar, guardar plantilla, instanciarla y duplicar devolvieron `200`. La actualizacion con version obsoleta devolvio `412`. El perfil conserva tres documentos sinteticos y una plantilla para la demostracion.
- Documentacion actualizada: esta ficha y `docs/04-proceso/estado.md`; solo se cierran las casillas realmente satisfechas por esta rebanada y permanecen abiertos catalogo, paginas, archivos binarios, PDF, envio, aceptacion, facturacion y pagos.
- Desviaciones del plan: ninguna en el producto. El primer smoke manual omitio la cabecera `Origin` obligatoria y fue rechazado con `403`; al repetir el escenario con el contrato HTTP correcto aprobo sin cambiar codigo ni permisos.
- Pendientes o decisiones nuevas: PDF, envio, aceptacion, facturacion, pagos, catalogo y archivos conservan sus requisitos propios.
