# Quantum CRM — Funcionalidades completas

Especificación funcional basada en `Funcionalidades Quantum Crm.docx` y en la conexión con agentes LangGraph definida en esta conversación. Incluye todo el alcance del adjunto y el administrador central solicitado posteriormente, sin estimaciones de tiempo.

Cada casilla representa un requisito. El archivo `Quantum_CRM_Checklist_Trabajo.md` lo desglosa en mini funciones utilizando el mismo identificador.

## Criterios comunes

- [ ] Alcance: se conservan los 223 puntos de las 11 secciones del documento adjunto. Los seis puntos BASE explicitan la conexión con LangGraph, las automatizaciones y las relaciones compartidas que esas funciones ya requieren.
- [ ] Identificadores: cada requisito conserva el mismo código en ambos archivos. Las casillas comienzan vacías porque estos documentos definen trabajo pendiente, no funciones ya implementadas.
- [ ] Chat mixto: pausar al agente impide responder, pero conserva los mensajes y acciones del asesor para recuperar el contexto al reactivarlo.
- [ ] Estructura dinámica: tipos como SUV y campos como Color son ejemplos configurables por el usuario; sus nombres, opciones y descripciones se entregan al agente.
- [ ] Disponibilidad: los productos de venta usan existencias; los servicios pueden no usar stock; los alquileres usan recursos o cantidades disponibles durante un periodo. Alquilar no consume existencias como una venta.
- [ ] Documentos: Cotizaciones y Facturación comparten el editor y las plantillas, pero conservan estados y operaciones propios. Una aceptación o firma queda vinculada a una versión concreta.
- [ ] Reportes: cada métrica define entidad, periodo y cálculo. Un contacto con varias oportunidades no debe generar conteos duplicados por las relaciones entre tablas.
- [ ] Pautas: el adjunto solicita que el agente consulte su contexto, pero no define un administrador de campañas. Se conserva la referencia a datos de pauta disponibles, sin incorporar edición de anuncios.
- [ ] Integraciones concretas: se deben seleccionar los canales, calendarios externos y pasarelas que se conectarán. El plan conserva esas capacidades sin dar por contratado un proveedor.
- [ ] Facturación fiscal: la emisión fiscal por país no está detallada en el adjunto; su proveedor y requisitos deberán definirse antes de presentarla como facturación electrónica habilitada.


- [ ] Administración central: cada perfil representa una empresa con su entorno y base de datos; el administrador de Quantum gestiona el conjunto de clientes y no se confunde con los usuarios administradores de cada CRM.
- [ ] Operación técnica: el diseño de contenedores, cambios locales, CI/CD, actualizaciones, VPS y HTTPS temporal con nip.io se desarrolla en `Quantum_CRM_DevOps_Despliegues.md`.

## Administrador central de Quantum

Gestionar múltiples perfiles de clientes, sus configuraciones, versiones y operaciones de despliegue. Los requisitos ADM corresponden al producto administrativo; sus mecanismos operativos se detallan en `Quantum_CRM_DevOps_Despliegues.md`.

- [x] **ADM-01** — Acceso al administrador central de Quantum.
- [ ] **ADM-02** — Crear y administrar perfiles de clientes o tenants.
- [ ] **ADM-03** — Gestionar el ciclo de vida de cada perfil.
- [ ] **ADM-04** — Desplegar un perfil nuevo desde el administrador.
- [ ] **ADM-05** — Registrar los VPS y la ubicación de cada perfil.
- [ ] **ADM-06** — Consultar la versión instalada y el estado real del despliegue.
- [ ] **ADM-07** — Habilitar módulos y funcionalidades por cliente.
- [ ] **ADM-08** — Administrar configuración global y cambios particulares por perfil.
- [ ] **ADM-09** — Administrar el catálogo de versiones publicadas.
- [ ] **ADM-10** — Actualizar un perfil individual.
- [ ] **ADM-11** — Aplicar actualizaciones globales o por grupos.
- [ ] **ADM-12** — Controlar operaciones y evitar despliegues simultáneos incompatibles.
- [ ] **ADM-13** — Consultar y controlar migraciones de datos por perfil.
- [ ] **ADM-14** — Revertir una versión cuando sea compatible.
- [ ] **ADM-15** — Administrar respaldos y recuperaciones por cliente.
- [ ] **ADM-16** — Monitorear la operación de cada perfil y del VPS.
- [ ] **ADM-17** — Administrar hosts temporales y certificados HTTPS.
- [ ] **ADM-18** — Administrar conexiones y agentes por perfil.
- [ ] **ADM-19** — Conservar auditoría administrativa.
- [ ] **ADM-20** — Conectar el administrador con un ejecutor de despliegues restringido.

## Base común de integración y automatizaciones

Capacidades compartidas necesarias para ejecutar las funcionalidades de las secciones siguientes.

- [ ] **BASE-01 — Conectar agentes LangGraph escritos en Python o JavaScript mediante un contrato común.**
  - [ ] Registrar endpoint, credenciales y agente asociado a cada canal o bandeja.
  - [ ] Definir entradas comunes con empresa, contacto, conversación, mensaje, archivos y contexto autorizado.
  - [ ] Definir resultados comunes con mensajes, acciones solicitadas, estado y solicitud de escalamiento.
  - [ ] Probar un agente de Python y otro de JavaScript usando adaptadores al mismo contrato, sin cambiar el núcleo del CRM.
- [ ] **BASE-02 — Conservar contexto y confirmar las acciones reales del agente.**
  - [ ] Relacionar conversation_id y thread_id del agente de forma estable.
  - [ ] Registrar mensajes humanos, respuestas del agente, formularios y resultados de herramientas en orden.
  - [ ] Exponer las herramientas de cada módulo solo según permisos y validar argumentos en el CRM.
  - [ ] Devolver el resultado real de cada acción y evitar cierres o confirmaciones cuando una operación falla.
- [ ] **BASE-03 — Ejecutar agentes sin duplicados ni respuestas posteriores a la toma humana.**
  - [ ] Guardar identificadores de eventos, mensajes y ejecuciones para deduplicar.
  - [ ] Serializar el procesamiento de cada conversación y conservar orden de mensajes.
  - [ ] Gestionar timeout, reintentos y respuesta diferida por callback cuando el adaptador lo requiera.
  - [ ] Revisar la versión y modo de la conversación antes de publicar una respuesta pendiente.
- [ ] **BASE-04 — Configurar automatizaciones mediante evento, condiciones y acciones.**
  - [ ] Crear flujos con nombre, evento inicial y estado borrador, activo o pausado.
  - [ ] Configurar condiciones sobre campos, etiquetas, estados y datos del evento.
  - [ ] Ordenar acciones y esperas usando los módulos ya definidos.
  - [ ] Activar un flujo manualmente para contactos seleccionados o desde los eventos de los módulos.
- [ ] **BASE-05 — Ejecutar y controlar las automatizaciones conectadas al CRM.**
  - [ ] Conectar acciones de mensaje, asignación, tarea, oportunidad, campo, etiqueta, agente y webhook con sus operaciones reales.
  - [ ] Guardar paso actual, resultado, error y próxima ejecución cuando exista una espera.
  - [ ] Evitar bucles y dobles efectos por eventos repetidos o reintentos.
  - [ ] Cancelar seguimientos pendientes cuando el cliente responda o el chat pase a atención humana según la regla del flujo.
  - [ ] Aplicar horarios, zona horaria y permisos al ejecutar cada acción.
- [ ] **BASE-06 — Compartir relaciones, permisos y trazabilidad entre los módulos.**
  - [ ] Mantener identificadores estables para contactos, oportunidades, conversaciones y documentos.
  - [ ] Aplicar el alcance de acceso en consultas, modificaciones, archivos y exportaciones.
  - [ ] Mantener cada registro asociado a su empresa y evitar cruces si la instalación aloja varias empresas.
  - [ ] Registrar eventos con autor, fecha y referencias para alimentar historiales y reportes.
  - [ ] Devolver errores comprensibles sin registrar credenciales dentro del historial visible.

## Chat multicanal

Atender conversaciones multicanal con asesores y agentes, conservando el contexto y controlando quién responde.

- [ ] **CHAT-01** — Manejo de asesores.
- [ ] **CHAT-02** — Chat mixto: se pausa el agente mientras responde el asesor, pero el agente conserva el contexto de la intervención.
- [ ] **CHAT-03** — El agente puede consultar partes autorizadas del CRM, como inventario, cotizaciones y pautas.
- [ ] **CHAT-04** — Envío y recepción de audios, imágenes y documentos.
- [ ] **CHAT-05** — Manejo de plantillas de WhatsApp.
- [ ] **CHAT-06** — Envío de formularios creados en el CRM y acceso del agente a las respuestas.
- [ ] **CHAT-07** — Asignación de conversaciones a asesores.
- [ ] **CHAT-08** — Estados de conversación.
- [ ] **CHAT-09** — Transferencia de conversaciones entre asesores.
- [ ] **CHAT-10** — Notas internas.
- [ ] **CHAT-11** — Búsqueda y filtros de conversaciones.
- [ ] **CHAT-12** — Respuestas rápidas.
- [ ] **CHAT-13** — Información del contacto visible desde el chat.
- [ ] **CHAT-14** — Historial unificado del contacto.
- [ ] **CHAT-15** — Indicadores de envío, entrega, lectura y error.
- [ ] **CHAT-16** — Reintento de mensajes fallidos.
- [ ] **CHAT-17** — Prevención de respuestas simultáneas entre el agente y el asesor.
- [ ] **CHAT-18** — Resumen automático al escalar la conversación.
- [ ] **CHAT-19** — Historial de asignaciones y acciones realizadas.
- [ ] **CHAT-20** — Activación y reactivación controlada del agente.
- [ ] **CHAT-21** — Bloqueo de seguimientos automáticos mientras un asesor atiende la conversación.

## Contactos

Centralizar la identidad, los datos y las relaciones comerciales de cada contacto.

- [ ] **CON-01** — Exportar e importar contactos.
- [ ] **CON-02** — Filtros por etiquetas, pipeline, asesor, canal y fecha.
- [ ] **CON-03** — Activar automatizaciones desde uno o varios contactos.
- [ ] **CON-04** — Crear y editar contactos.
- [ ] **CON-05** — Campos personalizados.
- [ ] **CON-06** — Asignación de contactos a asesores.
- [ ] **CON-07** — Agregar o eliminar etiquetas individualmente o en masa.
- [ ] **CON-08** — Historial de conversaciones, oportunidades, tareas y acciones del contacto.
- [ ] **CON-09** — Detección y combinación de contactos duplicados.
- [ ] **CON-10** — Acciones masivas sobre contactos seleccionados.
- [ ] **CON-11** — Relacionar un contacto con sus conversaciones, oportunidades, cotizaciones, facturas y documentos.
- [ ] **CON-12** — Búsqueda por nombre, teléfono, correo o campos personalizados.
- [ ] **CON-13** — Archivar contactos sin eliminarlos.
- [ ] **CON-14** — Registro del canal y origen del contacto.

## Pipelines

Organizar oportunidades y permitir que el agente las califique con las descripciones de pipelines y etapas.

- [ ] **PIPE-01** — Crear varios pipelines.
- [ ] **PIPE-02** — Cada pipeline debe incluir una descripción a la que tendrá acceso el agente para calificar correctamente las oportunidades.
- [ ] **PIPE-03** — Crear etapas con nombre, descripción y orden.
- [ ] **PIPE-04** — El agente tendrá acceso a la descripción de cada etapa para determinar cuándo mover una oportunidad.
- [ ] **PIPE-05** — Crear oportunidades asociadas a contactos.
- [ ] **PIPE-06** — Asignar oportunidades a asesores.
- [ ] **PIPE-07** — Mover oportunidades manualmente entre etapas.
- [ ] **PIPE-08** — Permitir que el agente cree, actualice y mueva oportunidades.
- [ ] **PIPE-09** — Registrar el valor estimado de cada oportunidad.
- [ ] **PIPE-10** — Marcar oportunidades como ganadas, perdidas o abandonadas.
- [ ] **PIPE-11** — Registrar motivos de pérdida o abandono.
- [ ] **PIPE-12** — Visualizar el historial de cambios de cada oportunidad.
- [ ] **PIPE-13** — Activar automatizaciones al crear una oportunidad o cambiarla de etapa.
- [ ] **PIPE-14** — Aplicar filtros por pipeline, etapa, asesor, estado, etiqueta y fecha.
- [ ] **PIPE-15** — Permitir varias oportunidades para un mismo contacto.

## Tareas y seguimientos

Controlar acciones pendientes y seguimientos vinculados con la atención y la venta.

- [ ] **TAR-01** — Crear tareas asociadas a contactos, conversaciones u oportunidades.
- [ ] **TAR-02** — Asignar tareas a asesores.
- [ ] **TAR-03** — Definir título, descripción, prioridad y fecha límite.
- [ ] **TAR-04** — Crear tareas manualmente, mediante automatizaciones o desde el agente.
- [ ] **TAR-05** — Tipos de tarea: llamada, mensaje, reunión, envío de cotización, cobro u otra acción.
- [ ] **TAR-06** — Estados: pendiente, en proceso, completada, vencida o cancelada.
- [ ] **TAR-07** — Recordatorios de tareas próximas o vencidas.
- [ ] **TAR-08** — Tareas recurrentes.
- [ ] **TAR-09** — Agregar comentarios internos.
- [ ] **TAR-10** — Consultar el historial de tareas realizadas.
- [ ] **TAR-11** — Filtrar por asesor, estado, prioridad, tipo y fecha.
- [ ] **TAR-12** — Mostrar tareas pendientes directamente desde el contacto.
- [ ] **TAR-13** — Permitir que el agente consulte las tareas y seguimientos anteriores.
- [ ] **TAR-14** — Permitir que el agente cree tareas cuando detecte que se necesita seguimiento.
- [ ] **TAR-15** — Activar automatizaciones cuando una tarea se cree, se venza o se complete.
- [ ] **TAR-16** — Evitar seguimientos automáticos cuando la conversación esté siendo atendida por un asesor.

## Calendario

Gestionar citas, disponibilidad y reservas con intervención humana o del agente.

- [ ] **CAL-01** — Crear citas, reuniones y eventos.
- [ ] **CAL-02** — Asociar eventos a contactos y oportunidades.
- [ ] **CAL-03** — Asignar eventos a asesores.
- [ ] **CAL-04** — Definir fecha, hora, duración, ubicación y descripción.
- [ ] **CAL-05** — Configurar horarios de atención y disponibilidad de cada asesor.
- [ ] **CAL-06** — Evitar reservas en horarios ocupados.
- [ ] **CAL-07** — Permitir reprogramar o cancelar eventos.
- [ ] **CAL-08** — Enviar recordatorios al cliente y al asesor.
- [ ] **CAL-09** — Crear eventos manualmente, mediante automatizaciones o desde el agente.
- [ ] **CAL-10** — Permitir que el agente consulte la disponibilidad antes de ofrecer horarios.
- [ ] **CAL-11** — Permitir que el agente agende, reprograme o cancele según sus permisos.
- [ ] **CAL-12** — Crear calendarios diferentes según servicio, sede o equipo.
- [ ] **CAL-13** — Generar enlaces de reserva.
- [ ] **CAL-14** — Definir tiempos de separación entre citas.
- [ ] **CAL-15** — Mostrar tareas y eventos próximos del contacto.
- [ ] **CAL-16** — Filtrar por asesor, servicio, estado y fecha.
- [ ] **CAL-17** — Estados: pendiente, confirmada, completada, cancelada o no asistió.
- [ ] **CAL-18** — Activar automatizaciones según creación, confirmación, reprogramación, cancelación o inasistencia.
- [ ] **CAL-19** — Sincronizar con calendarios externos.

## Formularios

Construir formularios interactivos y convertir sus respuestas en información utilizable por el CRM y el agente.

- [ ] **FORM-01** — Crear formularios interactivos con una experiencia similar a Google Forms.
- [ ] **FORM-02** — Constructor visual para agregar, eliminar y ordenar preguntas.
- [ ] **FORM-03** — Manejo de diferentes tipos de campos: texto, número, correo, teléfono, fecha, hora, selección única, selección múltiple, listas, casillas, escalas y campos abiertos.
- [ ] **FORM-04** — Agregar títulos, descripciones, imágenes y videos.
- [ ] **FORM-05** — Permitir la carga de imágenes y documentos por parte del usuario.
- [ ] **FORM-06** — Organizar los formularios mediante secciones.
- [ ] **FORM-07** — Aplicar lógica condicional para mostrar preguntas según respuestas anteriores.
- [ ] **FORM-08** — Configurar campos obligatorios y validaciones.
- [ ] **FORM-09** — Personalizar colores, logotipo y mensaje de finalización.
- [ ] **FORM-10** — Guardar formularios como borrador antes de publicarlos.
- [ ] **FORM-11** — Compartir formularios mediante enlace.
- [ ] **FORM-12** — Enviar formularios directamente desde el chat.
- [ ] **FORM-13** — Asociar cada respuesta con un contacto.
- [ ] **FORM-14** — Crear o actualizar contactos automáticamente a partir de las respuestas.
- [ ] **FORM-15** — Permitir que el agente consulte las respuestas del formulario.
- [ ] **FORM-16** — Utilizar las respuestas para actualizar campos, oportunidades o cotizaciones.
- [ ] **FORM-17** — Activar automatizaciones cuando se complete un formulario.
- [ ] **FORM-18** — Consultar, filtrar y exportar las respuestas.
- [ ] **FORM-19** — Recibir notificaciones cuando se envíe una nueva respuesta.
- [ ] **FORM-20** — Cerrar manual o automáticamente la recepción de respuestas.

## Catálogos e inventarios

Definir productos y servicios con estructura personalizada y controlar stock o disponibilidad por fechas.

- [ ] **CAT-01** — Crear productos o servicios.
- [ ] **CAT-02** — Registrar nombre, descripción, precio, imágenes y documentos.
- [ ] **CAT-03** — Crear categorías completamente personalizadas.
- [ ] **CAT-04** — Crear tipos personalizados, por ejemplo: SUV, sedán, pickup o vehículo de carga.
- [ ] **CAT-05** — Crear atributos personalizados para cada tipo de producto.
- [ ] **CAT-06** — Permitir atributos de selección única, selección múltiple, texto, número, fecha, verdadero/falso y color.
- [ ] **CAT-07** — Crear opciones personalizadas dentro de cada atributo.
- [ ] **CAT-08** — Permitir que un atributo llamado “Color” tenga opciones como rojo, negro, blanco o azul.
- [ ] **CAT-09** — Mostrar un selector visual de color cuando corresponda.
- [ ] **CAT-10** — Configurar atributos diferentes según el tipo de producto.
- [ ] **CAT-11** — Crear variantes combinando atributos como color, tamaño, modelo o presentación.
- [ ] **CAT-12** — Establecer precio, código, imágenes y disponibilidad por variante.
- [ ] **CAT-13** — Controlar existencias generales o por variante.
- [ ] **CAT-14** — Registrar entradas, salidas y ajustes de inventario.
- [ ] **CAT-15** — Mostrar productos disponibles, agotados, reservados o inactivos.
- [ ] **CAT-16** — Permitir productos sin control de inventario, como servicios o vehículos de alquiler.
- [ ] **CAT-17** — Manejar disponibilidad por fechas para productos de renta.
- [ ] **CAT-18** — Evitar reservas duplicadas durante un mismo periodo.
- [ ] **CAT-19** — Permitir varios catálogos.
- [ ] **CAT-20** — Organizar productos por categorías, tipos y atributos.
- [ ] **CAT-21** — Buscar y filtrar utilizando los campos personalizados.
- [ ] **CAT-22** — Compartir productos desde el chat.
- [ ] **CAT-23** — Agregar productos o servicios a cotizaciones y facturas.
- [ ] **CAT-24** — Importar y exportar productos e inventario.
- [ ] **CAT-25** — Permitir que el agente consulte categorías, tipos, atributos, variantes, precios, existencias y disponibilidad.
- [ ] **CAT-26** — Permitir que el agente filtre productos según lo solicitado por el cliente.
- [ ] **CAT-27** — Entregar al agente la descripción de cada campo personalizado para que comprenda su significado.
- [ ] **CAT-28** — Permitir que el agente recomiende productos usando los atributos configurados.
- [ ] **CAT-29** — Actualizar el contexto del agente cuando se modifique un producto, atributo, precio o disponibilidad.
- [ ] **CAT-30** — La estructura debería ser completamente dinámica. No debes programar directamente campos como “tipo de vehículo” o “color”. El usuario crea el campo, define qué significa y configura sus opciones; Quantum entrega esa estructura al agente para que pueda interpretarla y utilizarla

## Cotizaciones y facturación

Crear propuestas y facturas mediante documentos flexibles, relacionar su aceptación y controlar los pagos.

- [ ] **DOC-01** — Crear cotizaciones y facturas desde cero o utilizando plantillas.
- [ ] **DOC-02** — Constructor de documentos completamente flexible.
- [ ] **DOC-03** — Crear documentos utilizando bloques de texto, imágenes, tablas, columnas, separadores, productos, subtotales, impuestos, descuentos, firmas y campos personalizados.
- [ ] **DOC-04** — Mover y ordenar libremente los bloques del documento.
- [ ] **DOC-05** — Personalizar encabezados, pies de página, colores, tipografías, logotipo y fondos.
- [ ] **DOC-06** — Crear varias páginas dentro del documento.
- [ ] **DOC-07** — Agregar productos desde el catálogo.
- [ ] **DOC-08** — Agregar conceptos personalizados que no existan en el catálogo.
- [ ] **DOC-09** — Modificar descripción, cantidad, precio, impuesto y descuento de cada concepto.
- [ ] **DOC-10** — Crear fórmulas y cálculos personalizados.
- [ ] **DOC-11** — Insertar información dinámica del contacto, empresa, oportunidad, asesor, cotización o factura.
- [ ] **DOC-12** — Utilizar los campos personalizados del CRM dentro de los documentos.
- [ ] **DOC-13** — Agregar condiciones comerciales, términos, garantías y observaciones.
- [ ] **DOC-14** — Adjuntar imágenes, fichas técnicas y otros documentos.
- [ ] **DOC-15** — Guardar cualquier diseño como plantilla reutilizable.
- [ ] **DOC-16** — Duplicar y editar cotizaciones o facturas existentes.
- [ ] **DOC-17** — Generar documentos en PDF.
- [ ] **DOC-18** — Compartirlos mediante enlace, correo o chat.
- [ ] **DOC-19** — Permitir que el cliente acepte o rechace una cotización.
- [ ] **DOC-20** — Permitir que el cliente agregue comentarios al rechazarla.
- [ ] **DOC-21** — Manejar estados: borrador, enviada, vista, aceptada, rechazada, vencida o cancelada.
- [ ] **DOC-22** — Establecer fecha de emisión y vencimiento.
- [ ] **DOC-23** — Registrar el historial de cambios y versiones.
- [ ] **DOC-24** — Convertir una cotización aceptada en factura sin volver a ingresar la información.
- [ ] **DOC-25** — Asociar cotizaciones y facturas con contactos y oportunidades.
- [ ] **DOC-26** — Actualizar el valor de la oportunidad utilizando el total de la cotización.
- [ ] **DOC-27** — Permitir pagos completos, parciales o por cuotas.
- [ ] **DOC-28** — Manejar facturas únicas y recurrentes.
- [ ] **DOC-29** — Registrar estados de pago: pendiente, parcialmente pagada, pagada, vencida, anulada o reembolsada.
- [ ] **DOC-30** — Registrar pagos manuales o recibidos mediante una pasarela.
- [ ] **DOC-31** — Generar comprobantes de pago.
- [ ] **DOC-32** — Configurar monedas, impuestos y numeración de documentos.
- [ ] **DOC-33** — Activar automatizaciones según envío, visualización, aceptación, rechazo, vencimiento o pago.
- [ ] **DOC-34** — Permitir que el agente consulte cotizaciones, facturas y estados de pago.
- [ ] **DOC-35** — Permitir que el agente cree borradores de cotizaciones utilizando la conversación y el catálogo.
- [ ] **DOC-36** — Configurar si el agente puede enviar directamente el documento o necesita aprobación de un asesor.
- [ ] **DOC-37** — Permitir que el agente responda preguntas sobre productos, precios, impuestos, condiciones y estado del documento.

## Reportes

Ofrecer datos base y tableros donde el usuario elija gráficos, fuentes, métricas, filtros y comportamiento.

- [ ] **REP-01** — Incluir reportes base sobre conversaciones, contactos, oportunidades, ventas, cotizaciones, facturas, tareas, calendarios, agentes y asesores.
- [ ] **REP-02** — Permitir crear varios tableros personalizados.
- [ ] **REP-03** — Agregar, eliminar, duplicar y ordenar gráficos dinámicamente.
- [ ] **REP-04** — Modificar el tamaño y posición de cada gráfico.
- [ ] **REP-05** — Seleccionar la fuente de datos que utilizará cada gráfico.
- [ ] **REP-06** — Elegir el tipo de visualización: indicador, tabla, barras, líneas, áreas, pastel, embudo o progreso.
- [ ] **REP-07** — Seleccionar la métrica que se desea calcular.
- [ ] **REP-08** — Configurar operaciones como conteo, suma, promedio, porcentaje, mínimo, máximo o valores únicos.
- [ ] **REP-09** — Agrupar los resultados por fecha, canal, asesor, agente, pipeline, etapa, producto, etiqueta u otros campos.
- [ ] **REP-10** — Permitir utilizar campos personalizados como métricas, filtros o agrupaciones.
- [ ] **REP-11** — Crear métricas y fórmulas personalizadas.
- [ ] **REP-12** — Aplicar filtros generales al tablero.
- [ ] **REP-13** — Aplicar filtros independientes a cada gráfico.
- [ ] **REP-14** — Configurar periodos de tiempo fijos o dinámicos.
- [ ] **REP-15** — Comparar información con periodos anteriores.
- [ ] **REP-16** — Elegir si el gráfico se actualiza en tiempo real o en intervalos determinados.
- [ ] **REP-17** — Permitir que un gráfico filtre otros gráficos al seleccionar un dato.
- [ ] **REP-18** — Permitir abrir el detalle de los registros que componen un resultado.
- [ ] **REP-19** — Definir colores, títulos, leyendas y formato de valores.
- [ ] **REP-20** — Mostrar valores como moneda, porcentaje, tiempo o cantidades.
- [ ] **REP-21** — Guardar configuraciones como plantillas de reportes.
- [ ] **REP-22** — Definir qué usuarios o equipos pueden visualizar cada tablero.
- [ ] **REP-23** — Exportar los datos o gráficos.
- [ ] **REP-24** — Permitir que el agente consulte métricas autorizadas del CRM.
- [ ] **REP-25** — Incluir información sobre acciones y resultados de los agentes.
- [ ] **REP-26** — Registrar la fecha de última actualización de cada reporte.

## Usuarios, equipos y permisos

Administrar personas, equipos y alcance de acceso sobre datos y acciones.

- [ ] **USR-01** — Crear, invitar, editar y desactivar usuarios.
- [ ] **USR-02** — Crear equipos y asignar sus integrantes.
- [ ] **USR-03** — Definir roles como administrador, supervisor y asesor.
- [x] **USR-04** — Crear roles personalizados.
- [ ] **USR-05** — Configurar permisos por sección: consultar, crear, editar, eliminar y exportar.
- [ ] **USR-06** — Definir si cada usuario puede ver todos los registros, los de su equipo o únicamente los asignados.
- [ ] **USR-07** — Asignar acceso a canales, bandejas, pipelines y calendarios.
- [ ] **USR-08** — Configurar quién puede asignar o transferir contactos y conversaciones.
- [ ] **USR-09** — Configurar quién puede activar, pausar o modificar agentes y automatizaciones.
- [ ] **USR-10** — Reasignar los contactos, oportunidades y tareas pendientes al desactivar un usuario.
- [ ] **USR-11** — Registrar quién realizó cambios, asignaciones o eliminaciones.

## Configuración

Administrar reglas y datos compartidos que utilizan los distintos módulos.

- [ ] **CFG-01** — Configurar nombre de la empresa, logotipo, datos de contacto y dirección.
- [ ] **CFG-02** — Definir idioma, zona horaria, moneda y formatos de fecha y número.
- [ ] **CFG-03** — Configurar horarios de atención y días no laborables.
- [ ] **CFG-04** — Conectar y administrar los canales de comunicación.
- [ ] **CFG-05** — Consultar el estado de conexión de cada canal.
- [ ] **CFG-06** — Administrar integraciones, credenciales, API y webhooks.
- [ ] **CFG-07** — Crear y administrar campos personalizados por sección.
- [ ] **CFG-08** — Agregar descripciones a los campos personalizados para que los agentes comprendan su significado.
- [ ] **CFG-09** — Administrar etiquetas.
- [ ] **CFG-10** — Definir preferencias de notificaciones por usuario.
- [ ] **CFG-11** — Configurar impuestos y numeración de cotizaciones y facturas.
- [ ] **CFG-12** — Configurar las reglas generales de asignación de contactos y conversaciones.
- [ ] **CFG-13** — Configurar cuándo se pausa o reactiva el agente durante la atención humana.
- [ ] **CFG-14** — Definir qué información del CRM puede consultar cada agente y qué acciones puede ejecutar.
