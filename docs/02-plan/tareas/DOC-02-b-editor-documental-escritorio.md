# DOC-02-b - Editor documental de escritorio

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `DOC-02`.
- Requisitos relacionados: `DOC-01`, `DOC-03`, `DOC-04`, `DOC-05`, `DOC-06`, `DOC-11`, `DOC-13`, `DOC-15` y `DOC-16`.
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
- Celdas de columna con elementos ordenables de texto, imagen, variable y separador; las imagenes conservan validacion, scan y referencia inmutable.
- Encabezado y pie como regiones visibles y configurables del lienzo: visibilidad, distribucion, alineacion, espacio, logotipo, tipo documental y numeracion.
- Margenes configurables y paginacion visual automatica cuando el contenido supera el alto util de la hoja.
- Tablas con filas y columnas agregables o eliminables y anchos ajustables desde la cuadricula.
- Movimiento directo de imagenes entre el flujo principal y las celdas compatibles mediante arrastrar y soltar.
- Compositor de imagen basado en marco: tamano continuo, proporcion, recorte y punto focal, rotacion, opacidad, radio, alineacion y modos de flujo; sustituir el archivo conserva la composicion.
- Reordenamiento, proteccion, eliminacion, variables, archivos, estilos, duplicacion y plantillas existentes.
- Edicion editorial sin tarjetas tecnicas permanentes: cinta Inicio/Insertar/Diseno, acciones contextuales y formato persistente de parrafo (titulo, subtitulo, cuerpo o nota; negrita, cursiva, subrayado y alineacion).
- Estados responsive, foco visible y navegacion accesible.

### No incluido

- PDF, envio, firma, pagos o calculos comerciales nuevos.
- Columnas anidadas dentro de columnas; se evitan estructuras recursivas sin limite y se mantiene compatibilidad con documentos existentes.

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

- [x] Separar el estudio documental del sidebar global y hacer dominante el lienzo.
- [x] Convertir biblioteca y propiedades en paneles temporales que no reduzcan el papel.
- [x] Implementar disposiciones de columnas y conversion de un renglon conservando su contenido.
- [x] Integrar la edicion de bloques dentro del lienzo visible.
- [x] Validar tipos, build y recorrido autenticado en el VPS.
- [x] Permitir imagenes y elementos ordenados dentro de cada columna sin perder contenido previo.
- [x] Convertir encabezado y pie en regiones configurables y comprobar su persistencia.
- [x] Sustituir el constructor visible por edicion directa y comprobar que formato, columnas y regiones se conservan al guardar y recargar.
- [x] Corregir la carga real de imagenes desde el origen HTTPS del CRM hasta el almacenamiento privado.
- [x] Completar tipografia, formato de texto, cuadricula editable, movimiento de imagenes, margenes y paginacion automatica.
- [x] Convertir las imagenes en marcos visuales manipulables y persistentes, tanto en la pagina como dentro de columnas.
- [x] Hacer que tamano, giro y reencuadre se manipulen directamente sobre la imagen, separando el asa de movimiento de la superficie de edicion.
- [x] Mostrar la imagen completa de forma predeterminada y conservar el recorte como una eleccion explicita.
- [x] Permitir ajustar ancho y alto desde ocho tiradores directos y eliminar cualquier bloque desde su barra contextual.
- [x] Iniciar documentos sin plantilla con un lienzo vacio y mantener encabezado, datos del documento y pie como regiones opcionales.
- [x] Iniciar toda imagen nueva a cero grados y escalar la imagen completa dentro de marcos menores sin recortarla.

## Criterios de aceptacion

- [x] El lienzo ocupa el area principal y conserva proporcion de pagina legible sin el sidebar del CRM.
- [x] Crear, seleccionar, editar, reordenar y guardar no exige abandonar el lienzo.
- [x] Biblioteca y propiedades se abren temporalmente sin redimensionar el papel.
- [x] Un bloque de texto puede convertirse en dos o tres columnas y cambiar de proporcion conservando su contenido.
- [x] Las funciones documentales existentes permanecen operativas.
- [x] La experiencia es utilizable en escritorio y adaptable en pantallas menores.
- [x] Una columna admite texto, imagen, variable y separador, permite reordenarlos y guarda sus archivos mediante el pipeline seguro.
- [x] Encabezado y pie se pueden mostrar u ocultar, alinear, espaciar y configurar con logo, tipo documental y numero de pagina.
- [x] La hoja no expone tarjetas ni formularios tecnicos de manera permanente; al seleccionar texto se puede aplicar y persistir estilo, enfasis y alineacion desde la cinta.
- [x] Cargar una imagen no produce errores de red y la imagen queda disponible tras validacion.
- [x] El usuario ajusta filas, columnas y anchos de una tabla sin reconstruirla.
- [x] Encabezado, pie y margenes se reconocen y editan directamente sobre la hoja.
- [x] El contenido que excede una pagina continua visualmente en hojas adicionales sin perderse.
- [x] Una imagen se redimensiona, recorta, reenfoca, gira y alinea sin perder el archivo ni romper la pagina.
- [x] Arrastrar una imagen entre pagina y columnas conserva todos sus atributos visuales; sustituirla conserva el marco.
- [x] Al seleccionar una imagen aparecen tiradores convencionales; el usuario redimensiona desde cualquier esquina, gira desde el control superior y reencuadra arrastrando el contenido sin abrir un panel.
- [x] Una imagen nueva se presenta completa dentro de su marco; solo se recorta cuando el usuario elige `Recortar para llenar`.
- [x] El modo de imagen completa no se recorta con proporciones distintas a la del archivo; el alto libre se guarda y puede volver al tamaño original.
- [x] Al seleccionar un bloque aparece una accion `Eliminar` junto al elemento, sin depender de la cinta superior.
- [x] Un documento nuevo sin plantilla tiene cero bloques y ninguna region impresa hasta que el usuario la agrega.
- [x] `Imagen completa` limita ancho y alto preservando la proporcion, y `Enderezar a 0deg` elimina cualquier giro deliberado anterior.

## Plan de verificacion

- Typecheck y build afectados de `crm-web` en el VPS.
- Prueba focalizada de la estructura interactiva si existe una frontera sincronica estable.
- Recorrido autenticado en `/documents`: abrir, editar, insertar bloque, guardar y recargar.

## Recuperacion

- No existe migracion de datos. `COLUMNS.layout` es una extension compatible del contrato y los documentos anteriores reciben `EQUAL_2` por defecto.
- El rollback coordinado consiste en desplegar las imagenes anteriores de `api` y `crm-web`; los documentos permanecen legibles, aunque la interfaz anterior no conserva al volver a guardar una proporcion de columnas nueva.

## Evidencia de cierre

- El candidato `32fea33` aprobo una sola vez en el VPS Prettier, ESLint focalizado, 18 pruebas de modelo/contrato/dominio, typecheck de `contracts`, `domain`, `api` y `crm-web`, y builds de produccion de API y CRM web con Next.js `16.3.8`. No se ejecuto codigo del proyecto en el equipo local.
- Estan desplegadas y saludables en InterAmerican `qcrm-candidate/api:32fea33` (`sha256:15220709306f22c6825207f0f1d444e6353f58058a76c9a27d4c83fa81afcaf2`) y `qcrm-candidate/crm-web:32fea33` (`sha256:cea714f6e0006f13ab66846e1a74326c3c5d47d81cef63dcbcffd19174253679`). Readiness publico respondio `200` y `/documents` sin sesion conservo la redireccion OIDC `307`.
- El recorrido autenticado abrio el estudio sin sidebar, comprobo biblioteca e inspector como paneles superpuestos, inserto un renglon de tres columnas, escribio contenido diferente en sus tres celdas, guardo la revision 2 y confirmo los mismos valores despues de recargar. La consola del navegador no registro errores.
- La vista estrecha de `900 x 900` conservo el papel, las herramientas y las tres columnas utilizables; el navegador quedo restaurado a su tamano normal y `/documents` abierto para el propietario.
- El candidato `1bbb1d6` aprobo en el VPS Prettier y ESLint focalizados, 29 pruebas documentales, typecheck de `contracts`, `domain`, `api` y `crm-web`, y builds de produccion de API y CRM web. Las imagenes desplegadas son `qcrm-candidate/api:7113472` (`sha256:be78c68e7513d16e41c6c87b56c15891cf5885839aacfe5407594913f2e59bd4`) y `qcrm-candidate/crm-web:7113472` (`sha256:2c4ae7936c01a8066a79cc7cd33d59b5a08c3d3f8b3380d228539a9de80d0d43`); ambos contenedores quedaron saludables.
- El recorrido autenticado aplico titulo y negrita a un parrafo, guardo la revision 3, recargo y comprobo ambos atributos persistidos; despues restauro el contenido de prueba y guardo la revision 4. Tambien inserto una imagen dentro de la primera columna, verifico sus controles de archivo, ancho, alineacion, ajuste y reemplazo, y descarto esa prueba sin alterar la revision guardada. El doble clic en el encabezado abrio la configuracion completa de encabezado y pie.
- La carga segura de imagenes recupero su dependencia operativa: ClamAV estaba vivo pero sin `clamd` por OOM con el limite anterior de 1536 MiB. `platform-foundation.yaml` fija ahora 3072 MiB para el host de 32 GiB; el contenedor se reinicio con ese limite y quedo `healthy`, `OOMKilled=false` y con socket de `clamd` disponible.
- El candidato final `a09a1e51` aprobo en el VPS Prettier y ESLint focalizados; 37 pruebas de contratos, dominio, modelo del editor y proxy; 20 pruebas finales de las fronteras HTTP de autenticacion, CSP y carga; typecheck de `contracts`, `domain`, `api` y `crm-web`; y builds de produccion afectados. No se ejecuto codigo del proyecto en el equipo local.
- La carga de imagen usa un BFF autenticado con sesion, origen y CSRF, valida el origen exacto del almacenamiento del perfil y no expone credenciales. El recorrido real en `https://interamerican.2-25-172-119.nip.io/documents` recibio `Archivo verificado y vinculado`, mostro la imagen y elimino el anterior `Failed to fetch`.
- En el mismo recorrido se agrego una fila y una columna a una tabla, se ajusto el primer ancho a 45 y se comprobo la redistribucion del resto; se aplicaron fuente Serif, tamano y negrita; el margen superior cambio de 20 a 25 mm; y las regiones de encabezado y pie quedaron visibles desde la cinta Diseno.
- Al insertar contenido adicional el lienzo paso de `A4 · 1 PAGINA` a `A4 · 2 PAGINAS` y la numeracion visible cambio a `01 / 02`. La pagina se recargo sin guardar al finalizar, por lo que el documento de prueba permanecio en la revision 4. API `qcrm-candidate/api:20909c1` y CRM web `qcrm-candidate/crm-web:a09a1e5` quedaron `healthy`.
- La regresion visual reportada despues del primer cierre tenia dos causas verificadas: el firmador S3 ordenaba la consulta con `localeCompare`, incompatible con el orden binario canonico de AWS y SeaweedFS (`SignatureDoesNotMatch`), y el contenedor de ancho completo heredaba los `1.35rem` del asa visual. Los candidatos API `38e82e6` y CRM web `e1e692a` corrigen ambas causas y quedaron saludables.
- La comprobacion autenticada cargo una imagen PNG de `640 x 360`, verifico dimensiones naturales `640 x 360` y dimensiones visibles `649 x 365`; la autorizacion cambio preventivamente a los 45 segundos y la imagen permanecio completa despues de superar los 60 segundos de la URL original. La prueba se descarto sin guardar y el documento permanecio en la revision 4.
- Verificacion VPS adicional: Prettier y ESLint focalizados, cinco pruebas del adaptador S3, typecheck de `files-infrastructure` y `api`, builds de API y CRM web, y comprobacion de salud de ambos contenedores.
- El candidato documental `91b4ff2` aprobo en el VPS Prettier y ESLint focalizados, 26 pruebas de contrato y modelo del editor, typecheck de `contracts` y `crm-web`, y builds de produccion de API y CRM web. InterAmerican ejecuta `qcrm-candidate/api:7defcc3` y `qcrm-candidate/crm-web:91b4ff2`, ambos saludables; el readiness publico respondio `200`.
- En el recorrido autenticado se cargo una imagen PNG de `640 x 360` y se guardo la revision 5 con ancho `60 %`, marco `16:9`, ajuste `cover`, punto focal `100/0`, giro `3 grados`, opacidad `92 %`, radio `14 px` y flujo izquierdo. Tras recargar, el DOM calculado conservo todos los valores y la imagen natural; un parrafo temporal quedo lateral al marco (`textInputLeft=833`, `imageRight=819`) y luego se descarto sin alterar la revision guardada.
- La imagen dentro de columnas expone el mismo compositor, asa de redimensionado, proporcion, ajuste, punto focal y acabado; omite deliberadamente el flujo externo porque su contenedor ya es la propia columna. Las pruebas del modelo acreditan que moverla entre celdas o reducir la disposicion conserva la configuracion completa.
- El candidato `c5d0fa7` con manipulacion directa aprobo en el VPS formato, lint focalizado, 18 pruebas del modelo, typecheck de `crm-web` y build de produccion con Next.js `16.3.8`. La imagen `qcrm-candidate/crm-web:c5d0fa7` (`sha256:b97a6c23b202c7e2f1458964f86888fee52ce7249f6a3da757f11bfd4d7cab0a`) quedo desplegada y saludable en InterAmerican; readiness publico respondio `200`.
- El recorrido autenticado selecciono la imagen de la revision 5, encontro cuatro tiradores de esquina, un control de giro y la superficie directa de reencuadre. El teclado sobre los mismos controles cambio el ancho de `60 %` a `65 %` y el giro de `3` a `4` grados sin abrir los ajustes precisos; la prueba no se guardo y la revision 5 permanecio intacta. La comprobacion visual detecto y corrigio antes del cierre dos reglas heredadas que tapaban y recortaban el control superior.
- El candidato `2b16727a` cambio a `CONTAIN` el valor predeterminado del contrato, los bloques de imagen nuevos y las imagenes dentro de columnas; `Recortar para llenar` permanece disponible como ajuste explicito. En el VPS aprobaron Prettier, ESLint focalizado, 31 pruebas, typecheck de `contracts` y `crm-web`, y los builds de produccion de API y CRM web.
- InterAmerican ejecuta `qcrm-candidate/api:2b16727` (`sha256:cdfb0eb723733ee62a5de9a54214f8d1d57056520fc5578a35dbb8232272d88d`) y `qcrm-candidate/crm-web:2b16727` (`sha256:0b6a69c55fd5e7a3d787bd1d639ffd8d5f5505d6f3af309ff10e2b7525889fb3`), ambos saludables; el readiness publico respondio `200`.
- En el recorrido autenticado se selecciono la imagen del documento `preuba`, se cambio de `Recortar para llenar` a `Imagen completa` y se guardo la revision 6. Despues de recargar persistieron `object-fit: contain`, dimensiones visibles `387 x 218` y dimensiones naturales `640 x 360`, sin sustituir ni perder el archivo.
- La regresion posterior se debia a una regla CSS mas especifica que imponia `height: auto` despues de configurar el marco, por lo que una imagen con proporcion distinta podia desbordarse y quedar recortada pese a declarar `contain`. El candidato `35569776` aplica `height: 100%` a marcos fijos o libres y conserva `height: auto` solo para la proporcion original.
- El mismo candidato incorpora `heightPx` acotado y compatible en el contrato, proporcion libre, control de alto exacto, restauracion al tamaño original y ocho tiradores directos para ancho y alto. En el VPS aprobaron Prettier, ESLint focalizado, 33 pruebas, typecheck de `contracts`, `crm-web` y `api`, y los builds de produccion de API y CRM web.
- InterAmerican ejecuta `qcrm-candidate/api:3556977` (`sha256:095854478368728d4e3bdb60f0bd0b011427818b35aa4b764c50a29d072cc12d`) y `qcrm-candidate/crm-web:3556977` (`sha256:2b4c9709b9d027410404b899acb9392686a85e76fcba2dce7c604b1e9f30ac79`), ambos saludables; readiness publico respondio `200`.
- El recorrido autenticado cambio temporalmente la imagen natural `640 x 360` a un marco vertical `386 x 516` y comprobo `object-fit: contain` sin recorte; luego activo alto libre y lo modifico desde el tirador inferior. Tambien creo un bloque de texto temporal y lo elimino con la accion contextual del propio bloque, pasando de 4 a 5 y de nuevo a 4 bloques. Se recargo sin guardar y la revision 6 permanecio intacta.
- El candidato funcional `6186faf1` aprobo en el VPS Prettier, ESLint focalizado, 42 pruebas documentales, typecheck de `contracts`, `domain`, `api` y `crm-web`, y builds de produccion de API y CRM web. InterAmerican ejecuta `qcrm-candidate/api:ab3278a` y `qcrm-candidate/crm-web:6186faf`, ambos saludables; readiness publico respondio `200`.
- El recorrido autenticado creo `Documento en blanco` y comprobo cero bloques, encabezado oculto, datos fijos ocultos y pie oculto, conservando botones discretos para agregar cada region. En `preuba`, la imagen de `640 x 360` quedo guardada en revision 7 con giro `0deg`; despues de recargar, `object-fit: contain` la mantuvo completa dentro del marco (`348 x 196` visibles dentro de `350 x 197`).

## Pendientes de estabilizacion posterior

- La seleccion de rangos dentro de un mismo parrafo, listas, saltos de pagina y deshacer/rehacer quedan como ampliacion posterior; el alcance validado aplica formato persistente por parrafo y mantiene el documento compatible.
- Ampliar la prueba automatizada de arrastrar y soltar en navegador. El reordenamiento seguro ya esta cubierto por el modelo puro y por controles de teclado/botones visibles.
- La posicion libre con capas, superposicion deliberada y ajuste avanzado por delante/detras del texto queda para una ampliacion posterior; el bloque actual cubre flujo en renglon, rodeo izquierdo/derecho y composicion dentro de columnas sin romper la paginacion.
