# DOC-02-b - Editor documental de escritorio

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `DOC-02`.
- Requisitos relacionados: `DOC-01`, `DOC-03`, `DOC-04`, `DOC-05`, `DOC-11`, `DOC-13`, `DOC-15` y `DOC-16`.
- Fase del MVP: 8. Cierre comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: editor, contratos y persistencia documental existentes.
- Bloquea a: uso cotidiano de plantillas, cotizaciones y facturas.
- ADR, arquitectura o diseno aplicables: ADR-0014 y `frontends-experiencia-visual.md`.

## Resultado esperado

Documentos usa toda el area disponible del CRM como una aplicacion de escritorio simplificada: barra superior, herramientas de insercion, lienzo paginado central editable y paneles plegables. El usuario edita viendo el resultado final, sin alternar entre un formulario tecnico y una previsualizacion pequena.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- La ruta `/documents` ya persiste documentos y plantillas, controla versiones y permite bloques, variables, imagenes y adjuntos.
- La interfaz actual mantiene tres columnas permanentes y separa edicion de previsualizacion; reduce demasiado el papel y expone el modelo tecnico de bloques.
- Se conserva toda la integracion real y se reemplaza la composicion de la interfaz y la interaccion con los bloques.

## Alcance

### Incluido

- Editor de altura completa dentro del shell del CRM.
- Lienzo central tipo Word con edicion directa por bloques.
- Barra de herramientas simplificada y paneles plegables de biblioteca y propiedades.
- Reordenamiento, proteccion, eliminacion, variables, archivos, estilos, duplicacion y plantillas existentes.
- Estados responsive, foco visible y navegacion accesible.

### No incluido

- PDF, envio, firma, pagos o calculos comerciales nuevos.
- Cambio de contratos, persistencia o permisos.

## Impacto tecnico

| Area                       | Impacto previsto            |
| -------------------------- | --------------------------- |
| Aplicaciones y modulos     | `crm-web`                   |
| Contratos y eventos        | Sin cambios                 |
| Datos y migraciones        | Sin cambios                 |
| Permisos y aislamiento     | Se conservan los existentes |
| Configuracion y secretos   | Sin cambios                 |
| Observabilidad y operacion | Sin cambios                 |
| Documentacion              | Estado y esta ficha         |

## Plan de implementacion

- [ ] Reorganizar la pantalla como editor de escritorio de altura completa.
- [ ] Integrar la edicion de bloques dentro del lienzo visible.
- [ ] Hacer plegables biblioteca y propiedades sin perder contexto.
- [ ] Validar tipos, build y recorrido autenticado en el VPS.

## Criterios de aceptacion

- [ ] El lienzo ocupa el area principal y conserva proporcion de pagina legible.
- [ ] Crear, seleccionar, editar, reordenar y guardar no exige abandonar el lienzo.
- [ ] Biblioteca y propiedades pueden mostrarse u ocultarse.
- [ ] Las funciones documentales existentes permanecen operativas.
- [ ] La experiencia es utilizable en escritorio y adaptable en pantallas menores.

## Plan de verificacion

- Typecheck y build afectados de `crm-web` en el VPS.
- Prueba focalizada de la estructura interactiva si existe una frontera sincronica estable.
- Recorrido autenticado en `/documents`: abrir, editar, insertar bloque, guardar y recargar.

## Recuperacion

- Sin migraciones ni cambios de contrato.
- El rollback consiste en desplegar la imagen anterior de `crm-web`; los documentos permanecen compatibles.

## Evidencia de cierre

- Pendiente.
