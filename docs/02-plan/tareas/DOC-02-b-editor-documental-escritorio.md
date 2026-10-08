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

Documentos funciona como un estudio de edicion dedicado, sin el sidebar global del CRM durante la composicion: barra superior, herramientas de insercion, lienzo paginado central editable y paneles temporales. El usuario edita viendo el resultado final, puede dividir un renglon en columnas y no pierde el ancho de pagina por navegacion o propiedades permanentes.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- La ruta `/documents` ya persiste documentos y plantillas, controla versiones y permite bloques, variables, imagenes y adjuntos.
- El candidato anterior elimino la previsualizacion separada, pero mantuvo el sidebar global y reservo columnas permanentes para biblioteca e inspector; el recorrido visual demostro que el papel sigue reducido.
- `COLUMNS` persiste contenido real, pero no expone disposiciones, proporciones ni la conversion de un renglon existente.
- Se conserva la integracion real y se reemplaza la composicion de la interfaz y la interaccion de estructura.

## Alcance

### Incluido

- Estudio documental de altura y ancho completos, con retorno explicito al CRM.
- Lienzo central tipo Word con edicion directa por bloques.
- Barra de herramientas simplificada y paneles superpuestos de biblioteca y propiedades.
- Selector visual de disposiciones de dos y tres columnas, cambio de proporcion y conversion de texto a renglon dividido sin perder contenido.
- Reordenamiento, proteccion, eliminacion, variables, archivos, estilos, duplicacion y plantillas existentes.
- Estados responsive, foco visible y navegacion accesible.

### No incluido

- PDF, envio, firma, pagos o calculos comerciales nuevos.
- Bloques anidados arbitrarios dentro de una columna; esta iteracion mantiene celdas de texto sin romper documentos existentes.

## Impacto tecnico

| Area                       | Impacto previsto                                              |
| -------------------------- | ------------------------------------------------------------- |
| Aplicaciones y modulos     | `crm-web`                                                     |
| Contratos y eventos        | Extension compatible de `COLUMNS` si la auditoria la requiere |
| Datos y migraciones        | Sin cambios                                                   |
| Permisos y aislamiento     | Se conservan los existentes                                   |
| Configuracion y secretos   | Sin cambios                                                   |
| Observabilidad y operacion | Sin cambios                                                   |
| Documentacion              | Estado y esta ficha                                           |

## Plan de implementacion

- [ ] Separar el estudio documental del sidebar global y hacer dominante el lienzo.
- [ ] Convertir biblioteca y propiedades en paneles temporales que no reduzcan el papel.
- [ ] Implementar disposiciones de columnas y conversion de un renglon conservando su contenido.
- [ ] Integrar la edicion de bloques dentro del lienzo visible.
- [ ] Validar tipos, build y recorrido autenticado en el VPS.

## Criterios de aceptacion

- [ ] El lienzo ocupa el area principal y conserva proporcion de pagina legible sin el sidebar del CRM.
- [ ] Crear, seleccionar, editar, reordenar y guardar no exige abandonar el lienzo.
- [ ] Biblioteca y propiedades se abren temporalmente sin redimensionar el papel.
- [ ] Un bloque de texto puede convertirse en dos o tres columnas y cambiar de proporcion conservando su contenido.
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

- El candidato `0c7d347` aprobo en el VPS Prettier, ESLint focalizado, typecheck, auditoria sin hallazgos altos y builds de produccion de `crm-web`, `admin-web` y `portal-web` con Next.js `16.3.8`.
- La imagen `qcrm-candidate/crm-web:0c7d347` esta desplegada y saludable en InterAmerican; `/documents` conserva redireccion protegida al login cuando no existe sesion.
- Pendiente: recorrido visual autenticado para editar, insertar, guardar, recargar y revisar los breakpoints antes del cierre.
