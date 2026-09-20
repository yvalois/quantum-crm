# Quantum CRM — Plan de trabajo y checklist

Plan sin tiempos. Cada función completa tiene su propia casilla y mini funciones marcables. Los identificadores corresponden a `Quantum_CRM_Funcionalidades.md` y cubren los 223 puntos del adjunto más seis capacidades comunes y 20 funcionalidades del administrador central de Quantum.

Todos estos requisitos forman parte del [MVP integral para el cliente piloto](mvp-piloto.md). Sus fases ordenan dependencias, pero no excluyen funciones ni permiten liberar un piloto parcial.

> **Uso operativo:** este archivo es la lista autorizada de trabajo. Antes de cambiar una casilla, registrar el estado y la evidencia en `../04-proceso/estado.md` y aplicar `../04-proceso/definicion-de-terminado.md`. Una tarea en curso conserva su casilla vacía; `[x]` significa terminada y verificada, no iniciada ni parcialmente implementada.

Marcar una función principal solo cuando sus mini funciones estén terminadas y su comportamiento esté verificado. Marcar una sección cuando todas sus funciones y su comprobación de integración estén completas. Todas las casillas se entregan pendientes.

## Orden de trabajo por dependencias

- [ ] 1. Definir la base técnica y los datos pendientes del VPS con Quantum_CRM_DevOps_Despliegues.md.
- [ ] 2. Desarrollar el administrador central y el ejecutor mínimo de alta y despliegue; completar sus acciones cuando exista una release desplegable.
- [ ] 3. Usuarios, equipos y permisos de cada CRM.
- [ ] 4. Configuración.
- [ ] 5. Base común de integración y automatizaciones.
- [ ] 6. Contactos.
- [ ] 7. Pipelines.
- [ ] 8. Chat multicanal.
- [ ] 9. Tareas y seguimientos.
- [ ] 10. Calendario.
- [ ] 11. Formularios.
- [ ] 12. Catálogos e inventarios.
- [ ] 13. Cotizaciones y facturación.
- [ ] 14. Reportes.
- [ ] 15. Completar actualizaciones unitarias, globales y recuperación desde el administrador.
- [ ] 16. Verificación del recorrido completo.

Este orden establece dependencias, no plazos. Las integraciones entre secciones se completan cuando ambas partes estén disponibles; no se consideran terminadas por mostrar botones sin una operación real detrás.

## Criterios comunes del alcance

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

Dependencias: contrato de despliegue y diseño de infraestructura de `Quantum_CRM_DevOps_Despliegues.md`. Comenzar por acceso, perfiles y operaciones; verificar las actualizaciones con las primeras releases funcionales del CRM.

- [ ] **Sección completa — Administrador central de Quantum**

- [x] **ADM-01 — Acceso al administrador central de Quantum.**
  - [x] Crear una aplicación administrativa separada del acceso de los clientes.
  - [x] Autenticar a los operadores de Quantum y exigir MFA para las cuentas administrativas.
  - [x] Definir permisos de plataforma para administrar clientes, configuración y despliegues.
  - [x] Impedir que un administrador del CRM de un cliente obtenga permisos de plataforma.

- [ ] **ADM-02 — Crear y administrar perfiles de clientes o tenants.**
  - [x] Registrar identificador inmutable, nombre, slug, contacto administrativo y estado del cliente.
  - [x] Listar, buscar y filtrar clientes por estado, servidor y versión.
  - [ ] Gestionar la pertenencia de usuarios al cliente sin mezclar sus roles con los de Quantum.
  - [x] Distinguir el perfil de empresa de los contactos comerciales que viven dentro de su CRM.

- [ ] **ADM-03 — Gestionar el ciclo de vida de cada perfil.**
  - [x] Mostrar estados pendiente, aprovisionando, activo, suspendido y error.
  - [ ] Activar y suspender acceso y ejecución del cliente conservando sus datos.
  - [ ] Definir el tratamiento de webhooks entrantes durante una suspensión: recepción duradera sin respuesta automática cuando la política elegida lo permita.
  - [ ] Reanudar operaciones pendientes de forma controlada, revalidando las reglas de envío.

- [ ] **ADM-04 — Desplegar un perfil nuevo desde el administrador.**
  - [ ] Seleccionar versión compatible y servidor con capacidad disponible.
  - [ ] Solicitar al ejecutor la creación de base de datos, credenciales, almacenamiento, configuración y contenedores.
  - [ ] Crear de forma idempotente los buckets privados `incoming` y `objects`, sus cuotas y credenciales de mínimo privilegio para el perfil.
  - [ ] Registrar el host temporal nip.io, el estado HTTPS y el administrador inicial del cliente.
  - [ ] Mostrar cada paso y activar el perfil solo cuando sus comprobaciones hayan terminado.
  - [ ] Permitir reanudar un alta fallida sin duplicar bases, contenedores o usuarios.

- [ ] **ADM-05 — Registrar los VPS y la ubicación de cada perfil.**
  - [ ] Guardar IP pública, proveedor, sistema operativo, arquitectura, CPU, RAM y almacenamiento una vez confirmados.
  - [ ] Relacionar cada cliente con su servidor y recursos desplegados.
  - [ ] Consultar capacidad disponible antes de admitir un nuevo perfil o una segunda versión temporal.
  - [ ] Guardar referencias a credenciales de operación, sin mostrar claves privadas o contraseñas en la ficha.

- [ ] **ADM-06 — Consultar la versión instalada y el estado real del despliegue.**
  - [ ] Mostrar versión deseada, versión observada, digest de imágenes y revisión de configuración.
  - [ ] Consultar salud de aplicación, workers, base de datos y conexiones del perfil.
  - [ ] Mostrar versión de esquema y contrato de agente utilizados.
  - [ ] Distinguir una solicitud enviada de un despliegue realmente completado.

- [ ] **ADM-07 — Habilitar módulos y funcionalidades por cliente.**
  - [ ] Configurar módulos y feature flags permitidos para cada perfil.
  - [ ] Validar que la versión instalada soporta la función antes de activarla.
  - [ ] Aplicar el permiso en interfaz, API, automatizaciones y herramientas del agente.
  - [ ] Registrar el cambio sin tratarlo como una actualización de código.

- [ ] **ADM-08 — Administrar configuración global y cambios particulares por perfil.**
  - [ ] Guardar valores globales versionados y las excepciones explícitas de cada cliente.
  - [ ] Mostrar el valor efectivo y si proviene de la plataforma o del perfil.
  - [ ] Aplicar nuevos valores globales sin sobrescribir campos, reglas, plantillas o configuraciones propias.
  - [ ] Previsualizar diferencias y conflictos antes de aplicar una modificación explícita a varios perfiles.
  - [ ] Validar la configuración contra el esquema soportado por la versión de destino.

- [ ] **ADM-09 — Administrar el catálogo de versiones publicadas.**
  - [ ] Recibir de CI/CD el identificador de release, commit y digests de artefactos.
  - [ ] Mostrar notas de cambios, migraciones necesarias y compatibilidad de configuración y agentes.
  - [ ] Distinguir versiones candidatas, validadas y retiradas.
  - [ ] Permitir desplegar únicamente artefactos registrados y autorizados.

- [ ] **ADM-10 — Actualizar un perfil individual.**
  - [ ] Seleccionar cliente y versión de destino desde el panel.
  - [ ] Presentar las comprobaciones de capacidad, respaldo y compatibilidad.
  - [ ] Crear una operación de despliegue y enviarla al ejecutor con identificador único.
  - [ ] Mostrar migración, preparación, comprobación, cambio de tráfico y resultado.
  - [ ] Confirmar la versión observada sin cambiar la versión de los demás clientes.

- [ ] **ADM-11 — Aplicar actualizaciones globales o por grupos.**
  - [ ] Seleccionar perfiles explícitos o todos los perfiles elegibles y conservar esa selección.
  - [ ] Configurar grupo piloto y tamaño de los lotes siguientes según capacidad.
  - [ ] Detener nuevas promociones ante fallos o degradación según la política del despliegue.
  - [ ] Mostrar resultados por perfil y permitir reanudar únicamente los pendientes.
  - [ ] Registrar exclusiones y versiones temporalmente retenidas sin ocultarlas del inventario.

- [ ] **ADM-12 — Controlar operaciones y evitar despliegues simultáneos incompatibles.**
  - [ ] Registrar estados en cola, validando, ejecutando, verificando, completado, fallido y revertido.
  - [ ] Mantener un bloqueo por perfil y otros bloqueos para recursos compartidos cuando corresponda.
  - [ ] Aplicar idempotencia a solicitudes, reintentos y confirmaciones del ejecutor.
  - [ ] Mostrar errores saneados y permitir cancelar antes del cambio de tráfico cuando sea seguro.
  - [ ] Recuperar operaciones interrumpidas consultando el estado real del servidor.

- [ ] **ADM-13 — Consultar y controlar migraciones de datos por perfil.**
  - [ ] Mostrar migraciones pendientes y aplicadas con versión y resultado.
  - [ ] Ejecutar una migración mediante el ejecutor y el rol autorizado, separada del arranque de todas las réplicas.
  - [ ] Bloquear versiones incompatibles con el esquema o los datos actuales.
  - [ ] Diferenciar migraciones del CRM de actualizaciones compartidas del motor PostgreSQL.

- [ ] **ADM-14 — Revertir una versión cuando sea compatible.**
  - [ ] Mostrar la versión anterior y las comprobaciones que permiten o impiden volver.
  - [ ] Solicitar al ejecutor la reversión de aplicación, workers y configuración compatible.
  - [ ] Conservar datos actuales y verificar que la versión anterior puede interpretarlos.
  - [ ] Distinguir rollback de aplicación de restauración de un respaldo.

- [ ] **ADM-15 — Administrar respaldos y recuperaciones por cliente.**
  - [ ] Mostrar fecha, integridad, ubicación externa y resultado de los respaldos.
  - [ ] Iniciar respaldos del perfil incluyendo datos, archivos y referencias de configuración necesarias.
  - [ ] Coordinar el punto de PostgreSQL con el inventario y checksums de objetos para detectar adjuntos ausentes al restaurar.
  - [ ] Restaurar primero en un entorno aislado y presentar la validación obtenida.
  - [ ] Registrar el punto de recuperación y el efecto sobre operaciones posteriores antes de una sustitución de datos.
  - [ ] Separar recuperación de un cliente de recuperación completa del VPS.

- [ ] **ADM-16 — Monitorear la operación de cada perfil y del VPS.**
  - [ ] Mostrar disponibilidad, errores, consumo de recursos y trabajos pendientes.
  - [ ] Asociar registros con tenant_id, release_id, deployment_id y operación.
  - [ ] Alertar sobre poco espacio, falta de memoria, fallos de respaldo o certificados próximos a vencer.
  - [ ] Aplicar límites por cliente para que una carga excesiva no agote todos los recursos compartidos.

- [ ] **ADM-17 — Administrar hosts temporales y certificados HTTPS.**
  - [ ] Generar hosts nip.io a partir de la IP pública verificada y del slug del perfil.
  - [ ] Solicitar al ejecutor rutas explícitas de Caddy y emisión del certificado por host.
  - [ ] Mostrar resolución DNS, estado HTTPS y errores de emisión sin asumir que nip.io emite certificados.
  - [ ] Permitir registrar el dominio definitivo y coordinar URLs, callbacks, cookies y webhooks al migrar.

- [ ] **ADM-18 — Administrar conexiones y agentes por perfil.**
  - [ ] Registrar el `agent-runtime` oficial o endpoint personalizado, contratos `/agent/v1` y MCP compatibles, manifiesto y referencias a secretos.
  - [ ] Verificar conectividad y mostrar errores del perfil correspondiente.
  - [ ] Mantener identificadas las versiones del CRM, runtime, grafo, prompts, tools, politicas y checkpoints compatibles.
  - [ ] Crear, rotar y revocar por perfil las identidades separadas para CRM hacia runtime y runtime hacia MCP sin transportar tokens humanos.
  - [ ] Evitar que una actualización global sustituya credenciales, prompts o endpoints específicos del cliente.

- [ ] **ADM-19 — Conservar auditoría administrativa.**
  - [ ] Registrar operador, perfil, acción, fecha, valores anteriores y nuevos cuando corresponda.
  - [ ] Vincular cambios de configuración y despliegues con su operación y versión.
  - [ ] Consultar el historial por cliente, acción y resultado.
  - [ ] Excluir secretos, tokens y datos innecesarios de los registros de auditoría.

- [ ] **ADM-20 — Conectar el administrador con un ejecutor de despliegues restringido.**
  - [ ] Definir solicitudes tipadas de alta, actualización, reversión, respaldo y consulta de estado.
  - [ ] Autenticar solicitudes y resultados y limitar los recursos y releases admitidos.
  - [ ] Usar el mismo ejecutor para solicitudes del panel y promociones procedentes de CI/CD.
  - [ ] Mantener el socket Docker y credenciales de infraestructura fuera de la aplicación web administrativa y de los CRM.
  - [ ] Implementar el ejecutor y los procedimientos del documento Quantum_CRM_DevOps_Despliegues.md.

- [ ] **Comprobación integrada — Administrador central de Quantum**
  - [ ] Crear dos perfiles con bases y credenciales distintas y comprobar que sus administradores no acceden al otro perfil ni al panel central.
  - [ ] Desplegar la misma release, actualizar solo un perfil y comprobar que el segundo conserva su versión.
  - [ ] Aplicar una actualización global por lotes, provocar un fallo controlado y comprobar que se detienen las siguientes promociones.
  - [ ] Cambiar un valor global y verificar que se conservan las excepciones y configuraciones propias de cada cliente.
  - [ ] Reintentar una operación y comprobar que no se duplican recursos; revertir una release compatible y restaurar un respaldo en un entorno aislado.
  - [ ] Verificar los hosts nip.io y los certificados HTTPS reales una vez se disponga de la IP pública del VPS.

## Usuarios, equipos y permisos

Dependencias: Base de usuarios y sesión; establecer primero roles y alcance de datos.

- [ ] **Sección completa — Usuarios, equipos y permisos**

- [ ] **USR-01 — Crear, invitar, editar y desactivar usuarios.**
  - [ ] Crear usuarios o enviar invitaciones desde la administración.
  - [ ] Permitir aceptar invitación e iniciar y cerrar sesión.
  - [ ] Editar perfiles y desactivar acceso sin borrar historial.

- [ ] **USR-02 — Crear equipos y asignar sus integrantes.**
  - [ ] Crear equipos con nombre.
  - [ ] Agregar y retirar integrantes.
  - [ ] Reflejar cambios en asignaciones y visibilidad.

- [ ] **USR-03 — Definir roles como administrador, supervisor y asesor.**
  - [ ] Crear roles iniciales de administrador, supervisor y asesor.
  - [ ] Definir explícitamente sus permisos.
  - [ ] Asignar roles a usuarios.

- [ ] **USR-04 — Crear roles personalizados.**
  - [ ] Crear roles a partir de una matriz editable.
  - [ ] Guardar nombre y permisos.
  - [ ] Aplicar cambios a usuarios vinculados.

- [ ] **USR-05 — Configurar permisos por sección: consultar, crear, editar, eliminar y exportar.**
  - [ ] Definir permisos de consulta, creación, edición, eliminación y exportación por sección.
  - [ ] Aplicarlos en interfaz y servidor.
  - [ ] Rechazar acciones directas por API sin permiso.

- [ ] **USR-06 — Definir si cada usuario puede ver todos los registros, los de su equipo o únicamente los asignados.**
  - [ ] Configurar alcance de todos, equipo o asignados.
  - [ ] Filtrar listados, búsquedas y detalles con ese alcance.
  - [ ] Aplicar la misma restricción a exportaciones y reportes.

- [ ] **USR-07 — Asignar acceso a canales, bandejas, pipelines y calendarios.**
  - [ ] Seleccionar canales, bandejas, pipelines y calendarios autorizados.
  - [ ] Restringir navegación y operaciones a esos recursos.
  - [ ] Revisar permisos al cambiar un usuario de equipo.

- [ ] **USR-08 — Configurar quién puede asignar o transferir contactos y conversaciones.**
  - [ ] Definir permiso de asignación y transferencia.
  - [ ] Limitar los destinatarios a asesores autorizados.
  - [ ] Registrar cada cambio de propietario.

- [ ] **USR-09 — Configurar quién puede activar, pausar o modificar agentes y automatizaciones.**
  - [ ] Separar permisos para activar, pausar y modificar agentes o automatizaciones.
  - [ ] Validarlos en cada operación.
  - [ ] Registrar quién cambió el estado o configuración.

- [ ] **USR-10 — Reasignar los contactos, oportunidades y tareas pendientes al desactivar un usuario.**
  - [ ] Listar contactos, oportunidades y tareas del usuario a desactivar.
  - [ ] Elegir nuevo responsable para los pendientes.
  - [ ] Completar la reasignación y desactivar el acceso conservando autorías.

- [ ] **USR-11 — Registrar quién realizó cambios, asignaciones o eliminaciones.**
  - [ ] Guardar usuario o agente, acción, fecha y registro afectado.
  - [ ] Conservar valores anteriores y nuevos cuando corresponda.
  - [ ] Permitir consultar el historial autorizado sin modificarlo.

- [ ] **Comprobación integrada — Usuarios, equipos y permisos**
  - [ ] Comprobar que un asesor ve solo sus registros, un supervisor los de su equipo y que la desactivación de un usuario conserva historial y reasigna pendientes.

## Configuración

Dependencias: Usuarios y permisos; algunas conexiones se completan al implementar su módulo.

- [ ] **Sección completa — Configuración**

- [ ] **CFG-01 — Configurar nombre de la empresa, logotipo, datos de contacto y dirección.**
  - [ ] Guardar nombre, logotipo, dirección y datos de contacto de la empresa.
  - [ ] Utilizar estos datos como valores de empresa en documentos y formularios.

- [ ] **CFG-02 — Definir idioma, zona horaria, moneda y formatos de fecha y número.**
  - [ ] Guardar idioma, zona horaria, moneda y formatos.
  - [ ] Aplicarlos a pantallas, fechas y documentos.
  - [ ] Conservar la distinción entre idioma de interfaz e idioma del mensaje del cliente.

- [ ] **CFG-03 — Configurar horarios de atención y días no laborables.**
  - [ ] Configurar franjas de atención y días no laborables.
  - [ ] Exponerlas al calendario, asignación y automatizaciones.
  - [ ] Permitir excepciones por asesor o calendario donde ya estén previstas.

- [ ] **CFG-04 — Conectar y administrar los canales de comunicación.**
  - [ ] Agregar una conexión por canal o cuenta autorizada.
  - [ ] Guardar credenciales de forma protegida.
  - [ ] Conectar entradas y salidas con el chat y permitir desconectar la cuenta.

- [ ] **CFG-05 — Consultar el estado de conexión de cada canal.**
  - [ ] Consultar estado y última comunicación correcta.
  - [ ] Mostrar desconexiones y errores accionables.
  - [ ] Permitir recuperar la conexión desde Configuración.

- [ ] **CFG-06 — Administrar integraciones, credenciales, API y webhooks.**
  - [ ] Administrar credenciales y permisos de acceso de integraciones.
  - [ ] Registrar destinos y eventos de webhooks.
  - [ ] Consultar errores y reintentar sin duplicar operaciones.

- [ ] **CFG-07 — Crear y administrar campos personalizados por sección.**
  - [ ] Definir nombre, identificador, tipo, opciones y obligatoriedad de campos por sección.
  - [ ] Generar controles y validaciones desde esa definición.
  - [ ] Resolver el uso de campos existentes antes de eliminarlos o cambiar su tipo.

- [ ] **CFG-08 — Agregar descripciones a los campos personalizados para que los agentes comprendan su significado.**
  - [ ] Guardar una descripción de significado y uso por campo.
  - [ ] Incluirla en el esquema disponible para agentes.
  - [ ] Actualizar el esquema cuando cambie la configuración.

- [ ] **CFG-09 — Administrar etiquetas.**
  - [ ] Crear, renombrar y administrar etiquetas.
  - [ ] Mantener identificadores estables al renombrar.
  - [ ] Resolver asociaciones al retirar una etiqueta.

- [ ] **CFG-10 — Definir preferencias de notificaciones por usuario.**
  - [ ] Elegir qué eventos notifican a cada usuario y por qué canales disponibles.
  - [ ] Aplicar sus preferencias a tareas, citas y asignaciones.
  - [ ] Evitar avisos duplicados del mismo evento.

- [ ] **CFG-11 — Configurar impuestos y numeración de cotizaciones y facturas.**
  - [ ] Configurar impuestos, porcentajes y si el precio los incluye.
  - [ ] Definir prefijos y secuencias separadas de documentos.
  - [ ] Mantener la numeración única incluso con emisiones simultáneas.

- [ ] **CFG-12 — Configurar las reglas generales de asignación de contactos y conversaciones.**
  - [ ] Definir asignación manual o automática y el equipo elegible.
  - [ ] Aplicar el criterio de reparto configurado.
  - [ ] Mantener coherencia entre propietario de contacto, conversación y oportunidad según la regla elegida.

- [ ] **CFG-13 — Configurar cuándo se pausa o reactiva el agente durante la atención humana.**
  - [ ] Definir eventos que pausan al agente y condiciones de reactivación.
  - [ ] Aplicar la misma política en chat y seguimientos.
  - [ ] Mantener el contexto humano al reactivar.

- [ ] **CFG-14 — Definir qué información del CRM puede consultar cada agente y qué acciones puede ejecutar.**
  - [ ] Definir recursos y campos consultables por cada agente.
  - [ ] Autorizar acciones concretas de creación, edición, envío o reserva.
  - [ ] Hacer cumplir esos permisos en el servidor, incluyendo revisión de cotizaciones cuando corresponda.

- [ ] **Comprobación integrada — Configuración**
  - [ ] Cambiar un campo personalizado, zona horaria y permiso de agente; comprobar que formularios, consultas, agenda y acciones afectadas utilizan la configuración vigente.

## Base común de integración y automatizaciones

Dependencias: usuarios, permisos y configuración. Conectar las herramientas específicas a medida que se implemente cada sección.

- [ ] **Base común completa**

- [ ] **BASE-01 — Conectar agentes LangGraph escritos en Python o JavaScript mediante un contrato común.**
  - [ ] Registrar endpoint, credenciales y agente asociado a cada canal o bandeja.
  - [ ] Implementar `agent-runtime` oficial en TypeScript con LangGraph.js, un agente principal y subagentes internos invisibles.
  - [ ] Hacer que el CRM sea cliente de `/agent/v1` y que cada runtime sea cliente del Quantum MCP Gateway.
  - [ ] Definir entradas comunes con empresa, contacto, conversación, mensaje, archivos y contexto autorizado.
  - [ ] Representar archivos mediante metadatos o referencias MCP autorizadas, sin credenciales S3, paths internos ni bytes no verificados.
  - [ ] Definir resultados comunes con mensajes, acciones solicitadas, estado y solicitud de escalamiento.
  - [ ] Publicar manifiesto con runtime, grafo, prompts, modelo, tools, politicas, contratos y compatibilidad de threads.
  - [ ] Probar el agente oficial, un agente Python y otro JavaScript con la misma suite contractual, sin cambiar el núcleo del CRM.

- [ ] **BASE-02 — Conservar contexto y confirmar las acciones reales del agente.**
  - [ ] Relacionar conversation_id y thread_id del agente de forma estable.
  - [ ] Separar estado comercial, checkpoints por perfil y memoria aprendida; clasificar threads como compatibles, migrables o reiniciables.
  - [ ] Registrar mensajes humanos, respuestas del agente, formularios y resultados de herramientas en orden.
  - [ ] Exponer resources `quantum://v<major>/...`, prompts y tools MCP solo según permisos y validar argumentos en el CRM.
  - [ ] Persistir una deduccion solo mediante una tool del modulo propietario con fuente, alcance, confianza, sensibilidad y caducidad.
  - [ ] Devolver el resultado real de cada acción y evitar cierres o confirmaciones cuando una operación falla.

- [ ] **BASE-03 — Ejecutar agentes sin duplicados ni respuestas posteriores a la toma humana.**
  - [ ] Guardar identificadores de eventos, mensajes y ejecuciones para deduplicar.
  - [ ] Persistir en `agent-gateway` la maquina de estados de ejecucion, intento, lease y fencing generation.
  - [ ] Serializar el procesamiento de cada conversación y conservar orden de mensajes.
  - [ ] Gestionar timeout, reintentos y callback autenticado e idempotente, rechazando intentos, generaciones y transiciones vencidas.
  - [ ] Conciliar un despacho incierto antes de reintentar y normalizar respuestas sincronicas y callbacks mediante la misma transicion condicional.
  - [ ] Revisar la versión y modo de la conversación antes de publicar una respuesta pendiente.
  - [ ] Cancelar o invalidar ejecuciones, respuestas y seguimientos pendientes cuando un asesor tome la conversacion.

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
  - [ ] Resolver cada `fileId` dentro del perfil verificado y denegar referencias, buckets, keys o URLs de otro perfil.
  - [ ] Mantener cada registro asociado a su empresa y evitar cruces si la instalación aloja varias empresas.
  - [ ] Registrar eventos con autor, fecha y referencias para alimentar historiales y reportes.
  - [ ] Devolver errores comprensibles sin registrar credenciales dentro del historial visible.
  - [ ] Aislar entre dos perfiles identidades, tokens, ejecuciones, threads, checkpoints, memoria, resources, tools y callbacks.

- [ ] **Comprobación integrada — Base agentiva y automatizaciones**
  - [ ] Ejecutar una conversacion real donde el agente consulte contexto por MCP, delegue en un subagente, invoque una tool y confirme solo el resultado comercial persistido.
  - [ ] Ejecutar una activacion proactiva duplicada y comprobar una sola ejecucion y un solo efecto.
  - [ ] Interrumpir por aprobacion y por toma humana, reiniciar el runtime y verificar reanudacion o cancelacion desde estado durable.
  - [ ] Ejecutar evaluaciones de respuesta, tool selection, argumentos, trayectoria, escalamiento, prompt injection, exfiltracion, memoria contaminada y loops.
  - [ ] Probar version compatible e incompatible de thread y demostrar que ninguna reanuda silenciosamente un checkpoint no admitido.


## Contactos

Dependencias: Configuración de campos, etiquetas, usuarios y base común.

- [ ] **Sección completa — Contactos**

- [ ] **CON-01 — Exportar e importar contactos.**
  - [ ] Importar CSV y XLSX con mapeo de columnas.
  - [ ] Mostrar filas válidas, errores y coincidencias antes de aplicar la importación.
  - [ ] Exportar los contactos seleccionados y sus campos autorizados.

- [ ] **CON-02 — Filtros por etiquetas, pipeline, asesor, canal y fecha.**
  - [ ] Filtrar por etiquetas, pipeline, asesor, canal y rango de fechas.
  - [ ] Combinar criterios sin duplicar contactos con varias oportunidades.

- [ ] **CON-03 — Activar automatizaciones desde uno o varios contactos.**
  - [ ] Seleccionar una automatización activa y uno o varios contactos.
  - [ ] Registrar una ejecución por contacto.
  - [ ] Mostrar resultados individuales y evitar dobles activaciones accidentales.

- [ ] **CON-04 — Crear y editar contactos.**
  - [ ] Crear la ficha con nombre, teléfono, correo y demás datos definidos.
  - [ ] Editar y validar los datos antes de guardar.
  - [ ] Conservar identificadores estables para sus relaciones.

- [ ] **CON-05 — Campos personalizados.**
  - [ ] Mostrar campos definidos en Configuración según su tipo.
  - [ ] Guardar y validar valores personalizados por contacto.
  - [ ] Conservar etiquetas y descripciones de los campos.

- [ ] **CON-06 — Asignación de contactos a asesores.**
  - [ ] Seleccionar un asesor activo y autorizado.
  - [ ] Actualizar el propietario del contacto.
  - [ ] Aplicar la regla configurada para sus conversaciones sin confundir propietario con seguidor.

- [ ] **CON-07 — Agregar o eliminar etiquetas individualmente o en masa.**
  - [ ] Seleccionar etiquetas existentes o crearlas con permiso.
  - [ ] Agregar o retirar etiquetas en uno o varios contactos.
  - [ ] Informar el resultado por contacto.

- [ ] **CON-08 — Historial de conversaciones, oportunidades, tareas y acciones del contacto.**
  - [ ] Reunir mensajes, oportunidades, tareas y cambios en una línea de tiempo.
  - [ ] Mostrar fecha, autor y enlace al registro de origen.

- [ ] **CON-09 — Detección y combinación de contactos duplicados.**
  - [ ] Detectar coincidencias por identificadores normalizados como teléfono y correo.
  - [ ] Permitir elegir el contacto principal y resolver valores distintos.
  - [ ] Transferir relaciones e historial sin perder registros.

- [ ] **CON-10 — Acciones masivas sobre contactos seleccionados.**
  - [ ] Seleccionar contactos individuales o todos los del filtro aplicado.
  - [ ] Ejecutar asignaciones, etiquetas, archivo o automatizaciones autorizadas.
  - [ ] Mostrar errores parciales sin repetir acciones ya completadas.

- [ ] **CON-11 — Relacionar un contacto con sus conversaciones, oportunidades, cotizaciones, facturas y documentos.**
  - [ ] Mantener relaciones con conversaciones, oportunidades, cotizaciones, facturas y documentos.
  - [ ] Mostrar cada relación desde la ficha.
  - [ ] Conservarlas al archivar o combinar contactos.

- [ ] **CON-12 — Búsqueda por nombre, teléfono, correo o campos personalizados.**
  - [ ] Buscar por nombre, teléfono y correo normalizados.
  - [ ] Incluir campos personalizados habilitados para búsqueda.
  - [ ] Restringir los resultados a contactos visibles para el usuario.

- [ ] **CON-13 — Archivar contactos sin eliminarlos.**
  - [ ] Marcar contactos como archivados y excluirlos de la vista activa.
  - [ ] Consultar y restaurar contactos archivados.
  - [ ] Conservar su historial y relaciones.

- [ ] **CON-14 — Registro del canal y origen del contacto.**
  - [ ] Guardar el canal y origen al crear el contacto.
  - [ ] Conservar referencias de campaña o anuncio cuando estén disponibles.
  - [ ] Distinguir datos conocidos de origen no informado.

- [ ] **Comprobación integrada — Contactos**
  - [ ] Importar y combinar dos registros de la misma persona, conservar sus relaciones, asignarla a un asesor y exportar únicamente los contactos visibles para ese usuario.

## Pipelines

Dependencias: Contactos, usuarios y eventos de automatización.

- [ ] **Sección completa — Pipelines**

- [ ] **PIPE-01 — Crear varios pipelines.**
  - [ ] Crear y editar pipelines con identificador y nombre.
  - [ ] Listar sus etapas y oportunidades por separado.

- [ ] **PIPE-02 — Cada pipeline debe incluir una descripción a la que tendrá acceso el agente para calificar correctamente las oportunidades.**
  - [ ] Exigir una descripción al crear el pipeline.
  - [ ] Permitir actualizarla.
  - [ ] Entregar nombre, descripción e identificador al agente autorizado.

- [ ] **PIPE-03 — Crear etapas con nombre, descripción y orden.**
  - [ ] Crear y editar etapas pertenecientes a un pipeline.
  - [ ] Guardar nombre, descripción y posición.
  - [ ] Reordenarlas conservando las oportunidades vinculadas.

- [ ] **PIPE-04 — El agente tendrá acceso a la descripción de cada etapa para determinar cuándo mover una oportunidad.**
  - [ ] Publicar al agente las etapas y descripciones del pipeline correspondiente.
  - [ ] Permitir que consulte los criterios antes de decidir un movimiento.
  - [ ] Comprobar que la etapa elegida pertenece al pipeline.

- [ ] **PIPE-05 — Crear oportunidades asociadas a contactos.**
  - [ ] Crear una oportunidad vinculada a un contacto existente.
  - [ ] Seleccionar pipeline y etapa inicial.
  - [ ] Mostrar la oportunidad en la ficha del contacto.

- [ ] **PIPE-06 — Asignar oportunidades a asesores.**
  - [ ] Asignar un asesor activo como propietario de la oportunidad.
  - [ ] Coordinar su asignación con la del contacto según la regla elegida.
  - [ ] Evitar registrar al responsable solo como observador.

- [ ] **PIPE-07 — Mover oportunidades manualmente entre etapas.**
  - [ ] Mover mediante arrastre o selección de etapa.
  - [ ] Validar permisos y pertenencia de la etapa.
  - [ ] Registrar el movimiento una sola vez.

- [ ] **PIPE-08 — Permitir que el agente cree, actualice y mueva oportunidades.**
  - [ ] Exponer acciones para crear, editar y mover oportunidades.
  - [ ] Validar permisos y datos recibidos del agente.
  - [ ] Devolver éxito o error real antes de que el agente confirme la acción.

- [ ] **PIPE-09 — Registrar el valor estimado de cada oportunidad.**
  - [ ] Guardar importe estimado y moneda.
  - [ ] Validar valores numéricos.
  - [ ] Mostrar el valor en tarjeta, detalle y reportes.

- [ ] **PIPE-10 — Marcar oportunidades como ganadas, perdidas o abandonadas.**
  - [ ] Mantener el estado comercial abierto, ganado, perdido o abandonado.
  - [ ] Registrar la fecha del cambio.
  - [ ] Permitir filtrar los estados cerrados sin borrarlos.

- [ ] **PIPE-11 — Registrar motivos de pérdida o abandono.**
  - [ ] Capturar el motivo al perder o abandonar una oportunidad.
  - [ ] Asociarlo con la transición correspondiente.
  - [ ] Mostrarlo en detalle y reportes.

- [ ] **PIPE-12 — Visualizar el historial de cambios de cada oportunidad.**
  - [ ] Registrar cambios de etapa, responsable, valor y estado.
  - [ ] Mostrar fecha y autor humano o agente.
  - [ ] Conservar los valores anteriores y nuevos.

- [ ] **PIPE-13 — Activar automatizaciones al crear una oportunidad o cambiarla de etapa.**
  - [ ] Emitir eventos al crear o cambiar de etapa.
  - [ ] Entregar contacto, oportunidad y cambio a la automatización.
  - [ ] Evitar que un mismo evento active dos veces el flujo.

- [ ] **PIPE-14 — Aplicar filtros por pipeline, etapa, asesor, estado, etiqueta y fecha.**
  - [ ] Combinar filtros por pipeline, etapa, asesor, estado, etiqueta y fecha.
  - [ ] Aplicarlos a la vista y a sus resultados sin mezclar oportunidades.

- [ ] **PIPE-15 — Permitir varias oportunidades para un mismo contacto.**
  - [ ] Crear varias oportunidades con identificadores distintos para el mismo contacto.
  - [ ] Permitir seleccionar la oportunidad exacta en cada acción.
  - [ ] Evitar que el agente sobrescriba otra negociación del contacto.

- [ ] **Comprobación integrada — Pipelines**
  - [ ] Crear dos oportunidades para un contacto, mover una mediante agente usando las descripciones y verificar que la otra conserva su estado y que el propietario correcto queda asignado.

## Chat multicanal

Dependencias: Contactos, canales, asesores y conexión con agentes. Las acciones sobre formularios y documentos se completan al terminar esos módulos.

- [ ] **Sección completa — Chat multicanal**

- [ ] **CHAT-01 — Manejo de asesores.**
  - [ ] Mostrar asesores activos y su equipo en la bandeja.
  - [ ] Permitir identificar al responsable actual de cada conversación.

- [ ] **CHAT-02 — Chat mixto: se pausa el agente mientras responde el asesor, pero el agente conserva el contexto de la intervención.**
  - [ ] Guardar el modo de atención humana o IA.
  - [ ] Incorporar mensajes del asesor al historial disponible para el agente.
  - [ ] Mantener pausada la respuesta del agente durante la intervención.

- [ ] **CHAT-03 — El agente puede consultar partes autorizadas del CRM, como inventario, cotizaciones y pautas.**
  - [ ] Consultar inventario, cotizaciones y datos de pauta vinculados al contacto mediante herramientas autorizadas.
  - [ ] Entregar resultados actuales al agente y señalar cuando no hay información.

- [ ] **CHAT-04 — Envío y recepción de audios, imágenes y documentos.**
  - [ ] Recibir archivos y asociarlos con su mensaje y canal.
  - [ ] Someter entradas del navegador y del proveedor a cuarentena, validación y scan antes de asociarlas como disponibles.
  - [ ] Permitir adjuntar, previsualizar, descargar y enviar archivos compatibles.
  - [ ] Entregar al agente el contenido procesado o una referencia MCP autorizada según la versión exacta del archivo.

- [ ] **CHAT-05 — Manejo de plantillas de WhatsApp.**
  - [ ] Consultar las plantillas disponibles y su estado de aprobación.
  - [ ] Completar variables y validar los datos necesarios.
  - [ ] Enviar la plantilla y registrar el resultado del proveedor.

- [ ] **CHAT-06 — Envío de formularios creados en el CRM y acceso del agente a las respuestas.**
  - [ ] Seleccionar un formulario publicado y enviar su enlace.
  - [ ] Vincular el envío y la respuesta con el contacto y la conversación.
  - [ ] Hacer accesibles las respuestas al agente cuando se reciban.

- [ ] **CHAT-07 — Asignación de conversaciones a asesores.**
  - [ ] Asignar manualmente un asesor o aplicar la regla de reparto configurada.
  - [ ] Mostrar conversaciones sin asignar.
  - [ ] Actualizar el propietario y registrar la asignación.

- [ ] **CHAT-08 — Estados de conversación.**
  - [ ] Gestionar estados abierto, pendiente, escalado y cerrado.
  - [ ] Registrar cada transición y reflejarla en los filtros.
  - [ ] Mantener separado el estado del chat del modo humano o IA.

- [ ] **CHAT-09 — Transferencia de conversaciones entre asesores.**
  - [ ] Seleccionar un asesor de destino autorizado.
  - [ ] Transferir el propietario conservando mensajes y contexto.
  - [ ] Notificar al nuevo responsable.

- [ ] **CHAT-10 — Notas internas.**
  - [ ] Crear notas vinculadas a la conversación con autor y fecha.
  - [ ] Distinguir visualmente las notas de los mensajes al cliente.
  - [ ] Impedir su envío al canal externo.

- [ ] **CHAT-11 — Búsqueda y filtros de conversaciones.**
  - [ ] Buscar por contacto y contenido del mensaje.
  - [ ] Combinar filtros por canal, asesor, estado y fecha.
  - [ ] Paginar resultados respetando permisos.

- [ ] **CHAT-12 — Respuestas rápidas.**
  - [ ] Crear y editar respuestas rápidas.
  - [ ] Buscar e insertar una respuesta en el editor.
  - [ ] Permitir revisarla antes de enviarla.

- [ ] **CHAT-13 — Información del contacto visible desde el chat.**
  - [ ] Mostrar datos, etiquetas y responsable del contacto en el panel lateral.
  - [ ] Enlazar sus oportunidades, tareas y documentos.
  - [ ] Actualizar el panel cuando cambie el registro.

- [ ] **CHAT-14 — Historial unificado del contacto.**
  - [ ] Asociar las identidades de canal con el contacto confirmado.
  - [ ] Ordenar mensajes de diferentes canales conservando origen y fecha.
  - [ ] Mantener el canal de destino explícito al responder.

- [ ] **CHAT-15 — Indicadores de envío, entrega, lectura y error.**
  - [ ] Guardar identificadores del mensaje y estados devueltos por el proveedor.
  - [ ] Actualizar enviado, entregado, leído y fallido cuando el canal lo permita.
  - [ ] Mostrar pendiente o estado desconocido sin inventar confirmaciones.

- [ ] **CHAT-16 — Reintento de mensajes fallidos.**
  - [ ] Mostrar el motivo de fallo y la acción de reintentar.
  - [ ] Reutilizar la referencia del envío para prevenir duplicados.
  - [ ] Comprobar el estado previo si el resultado original es incierto.

- [ ] **CHAT-17 — Prevención de respuestas simultáneas entre el agente y el asesor.**
  - [ ] Invalidar respuestas pendientes de IA cuando un asesor toma el chat.
  - [ ] Comprobar el modo de atención justo antes de enviar.
  - [ ] Evitar que dos procesos publiquen la misma respuesta.

- [ ] **CHAT-18 — Resumen automático al escalar la conversación.**
  - [ ] Generar un resumen con motivo, intención y datos recopilados.
  - [ ] Vincularlo al historial que lo originó.
  - [ ] Mostrarlo al asesor junto con el escalamiento.

- [ ] **CHAT-19 — Historial de asignaciones y acciones realizadas.**
  - [ ] Guardar actor, fecha, acción y responsable anterior y nuevo.
  - [ ] Mostrar una línea de tiempo de asignaciones, transferencias y cambios de modo.

- [ ] **CHAT-20 — Activación y reactivación controlada del agente.**
  - [ ] Ofrecer controles de pausa y reactivación según permisos.
  - [ ] Aplicar las reglas configuradas sin reactivar un chat escalado por accidente.
  - [ ] Recuperar el contexto completo antes de una nueva respuesta.

- [ ] **CHAT-21 — Bloqueo de seguimientos automáticos mientras un asesor atiende la conversación.**
  - [ ] Identificar los seguimientos pendientes del chat.
  - [ ] Cancelar o suspender los envíos al entrar en atención humana.
  - [ ] Volver a comprobar el bloqueo al ejecutar un envío programado.

- [ ] **Comprobación integrada — Chat multicanal**
  - [ ] Recibir un mensaje, responder con IA, transferir a un asesor y reactivar el agente con contexto completo; comprobar que ninguna respuesta o seguimiento pendiente se envía durante la atención humana.

## Tareas y seguimientos

Dependencias: Contactos, oportunidades, asesores, chat y motor de automatizaciones.

- [ ] **Sección completa — Tareas y seguimientos**

- [ ] **TAR-01 — Crear tareas asociadas a contactos, conversaciones u oportunidades.**
  - [ ] Crear tareas vinculadas a contacto, conversación u oportunidad.
  - [ ] Mostrar vínculos navegables al registro relacionado.

- [ ] **TAR-02 — Asignar tareas a asesores.**
  - [ ] Seleccionar responsable activo.
  - [ ] Actualizar asignación y notificar al asesor.
  - [ ] Conservar la tarea al cambiar de responsable.

- [ ] **TAR-03 — Definir título, descripción, prioridad y fecha límite.**
  - [ ] Capturar título, descripción, prioridad y vencimiento.
  - [ ] Validar fechas y campos obligatorios.
  - [ ] Mostrar la fecha según la zona horaria configurada.

- [ ] **TAR-04 — Crear tareas manualmente, mediante automatizaciones o desde el agente.**
  - [ ] Usar la misma creación de tareas desde interfaz, automatización y agente.
  - [ ] Identificar el origen de cada tarea.
  - [ ] Devolver el identificador y resultado de la operación.

- [ ] **TAR-05 — Tipos de tarea: llamada, mensaje, reunión, envío de cotización, cobro u otra acción.**
  - [ ] Permitir seleccionar llamada, mensaje, reunión, cotización, cobro u otra acción.
  - [ ] Guardar el tipo y mostrarlo en la lista.

- [ ] **TAR-06 — Estados: pendiente, en proceso, completada, vencida o cancelada.**
  - [ ] Gestionar pendiente, en proceso, completada y cancelada.
  - [ ] Calcular el vencimiento solo para tareas abiertas fuera de plazo.
  - [ ] Registrar cierre y responsable de la acción.

- [ ] **TAR-07 — Recordatorios de tareas próximas o vencidas.**
  - [ ] Programar avisos de proximidad y vencimiento.
  - [ ] Enviarlos al responsable según sus preferencias.
  - [ ] Cancelar avisos cuando la tarea se complete o cancele.

- [ ] **TAR-08 — Tareas recurrentes.**
  - [ ] Configurar repetición y condición de finalización.
  - [ ] Generar cada ocurrencia una sola vez.
  - [ ] Permitir detener futuras repeticiones.

- [ ] **TAR-09 — Agregar comentarios internos.**
  - [ ] Agregar comentarios con autor y fecha.
  - [ ] Mostrar los comentarios dentro de la tarea.
  - [ ] Mantenerlos como información interna.

- [ ] **TAR-10 — Consultar el historial de tareas realizadas.**
  - [ ] Consultar tareas completadas y canceladas.
  - [ ] Mostrar cambios de estado, comentarios y responsables.
  - [ ] Mantener enlaces al contacto y oportunidad.

- [ ] **TAR-11 — Filtrar por asesor, estado, prioridad, tipo y fecha.**
  - [ ] Combinar filtros por asesor, estado, prioridad, tipo y fecha.
  - [ ] Diferenciar tareas vencidas de las próximas.

- [ ] **TAR-12 — Mostrar tareas pendientes directamente desde el contacto.**
  - [ ] Listar tareas abiertas dentro de la ficha del contacto.
  - [ ] Ordenarlas por vencimiento.
  - [ ] Actualizar la lista cuando se completen.

- [ ] **TAR-13 — Permitir que el agente consulte las tareas y seguimientos anteriores.**
  - [ ] Exponer al agente tareas pendientes e historial autorizado.
  - [ ] Incluir resultado, responsable y fecha para evitar preguntas o acciones repetidas.

- [ ] **TAR-14 — Permitir que el agente cree tareas cuando detecte que se necesita seguimiento.**
  - [ ] Permitir al agente proponer título, motivo, vencimiento y responsable.
  - [ ] Crear la tarea mediante la acción autorizada.
  - [ ] Evitar duplicar el mismo seguimiento por reintentos.

- [ ] **TAR-15 — Activar automatizaciones cuando una tarea se cree, se venza o se complete.**
  - [ ] Emitir eventos de creación, vencimiento y finalización.
  - [ ] Incluir datos de la tarea y contacto.
  - [ ] Ejecutar cada transición una sola vez por automatización.

- [ ] **TAR-16 — Evitar seguimientos automáticos cuando la conversación esté siendo atendida por un asesor.**
  - [ ] Consultar el modo de atención del chat antes de un seguimiento.
  - [ ] Suspender envíos automáticos durante la atención humana.
  - [ ] Conservar las tareas del asesor sin convertirlas automáticamente en mensajes.

- [ ] **Comprobación integrada — Tareas y seguimientos**
  - [ ] Crear tareas manuales, recurrentes y desde un agente; completar una, vencer otra y comprobar recordatorios y bloqueo de mensajes automáticos durante atención humana.

## Calendario

Dependencias: Contactos, asesores, horarios, tareas y automatizaciones.

- [ ] **Sección completa — Calendario**

- [ ] **CAL-01 — Crear citas, reuniones y eventos.**
  - [ ] Crear eventos de tipo cita, reunión o evento.
  - [ ] Mostrar agenda y detalle con identificador estable.

- [ ] **CAL-02 — Asociar eventos a contactos y oportunidades.**
  - [ ] Seleccionar contacto y oportunidad relacionados.
  - [ ] Mostrar la cita desde ambos registros.

- [ ] **CAL-03 — Asignar eventos a asesores.**
  - [ ] Seleccionar el asesor responsable.
  - [ ] Reflejar el evento en su disponibilidad.
  - [ ] Notificar asignación o cambio.

- [ ] **CAL-04 — Definir fecha, hora, duración, ubicación y descripción.**
  - [ ] Guardar inicio, fin o duración, ubicación y descripción.
  - [ ] Validar que el fin sea posterior al inicio.
  - [ ] Mostrar la zona horaria utilizada.

- [ ] **CAL-05 — Configurar horarios de atención y disponibilidad de cada asesor.**
  - [ ] Definir franjas disponibles por asesor.
  - [ ] Aplicar días no laborables y excepciones.
  - [ ] Calcular horarios ofrecibles a partir de esa configuración.

- [ ] **CAL-06 — Evitar reservas en horarios ocupados.**
  - [ ] Comprobar cruces al consultar horarios.
  - [ ] Validar de nuevo y reservar el horario al confirmar.
  - [ ] Rechazar una segunda reserva simultánea del mismo recurso.

- [ ] **CAL-07 — Permitir reprogramar o cancelar eventos.**
  - [ ] Cambiar fecha o cancelar conservando el historial.
  - [ ] Liberar el horario anterior cuando corresponda.
  - [ ] Actualizar recordatorios y notificar el cambio.

- [ ] **CAL-08 — Enviar recordatorios al cliente y al asesor.**
  - [ ] Programar recordatorios para cliente y asesor.
  - [ ] Respetar canales y preferencias disponibles.
  - [ ] Cancelar o recalcular recordatorios si cambia la cita.

- [ ] **CAL-09 — Crear eventos manualmente, mediante automatizaciones o desde el agente.**
  - [ ] Compartir la operación de creación entre interfaz, agente y automatización.
  - [ ] Registrar origen y confirmar el resultado real.
  - [ ] Evitar reservas duplicadas por reintentos.

- [ ] **CAL-10 — Permitir que el agente consulte la disponibilidad antes de ofrecer horarios.**
  - [ ] Entregar al agente horarios disponibles con asesor, duración y zona horaria.
  - [ ] Aplicar restricciones y separación entre citas.
  - [ ] Revalidar la disponibilidad al agendar.

- [ ] **CAL-11 — Permitir que el agente agende, reprograme o cancele según sus permisos.**
  - [ ] Exponer acciones autorizadas para reservar, reprogramar y cancelar.
  - [ ] Validar acceso al calendario y al evento.
  - [ ] Devolver confirmación o conflicto al agente.

- [ ] **CAL-12 — Crear calendarios diferentes según servicio, sede o equipo.**
  - [ ] Crear calendarios con nombre y relación a servicio, sede o equipo.
  - [ ] Asociar asesores y reglas de disponibilidad.
  - [ ] Separar eventos por calendario.

- [ ] **CAL-13 — Generar enlaces de reserva.**
  - [ ] Generar un enlace asociado al calendario.
  - [ ] Mostrar horarios realmente disponibles y capturar datos del contacto.
  - [ ] Confirmar la reserva y mostrar el resultado al cliente.

- [ ] **CAL-14 — Definir tiempos de separación entre citas.**
  - [ ] Configurar separación antes o después de cada cita.
  - [ ] Aplicarla al cálculo de disponibilidad y a la validación de nuevas reservas.

- [ ] **CAL-15 — Mostrar tareas y eventos próximos del contacto.**
  - [ ] Mostrar citas futuras y tareas abiertas en la ficha del contacto.
  - [ ] Mantener sus tipos y estados diferenciados.
  - [ ] Enlazar a la edición correspondiente.

- [ ] **CAL-16 — Filtrar por asesor, servicio, estado y fecha.**
  - [ ] Filtrar eventos por asesor, servicio, estado y fecha.
  - [ ] Conservar los filtros al cambiar la vista de agenda.

- [ ] **CAL-17 — Estados: pendiente, confirmada, completada, cancelada o no asistió.**
  - [ ] Gestionar pendiente, confirmada, completada, cancelada y no asistió.
  - [ ] Guardar fecha y autor del cambio.
  - [ ] Actualizar disponibilidad solo cuando corresponda.

- [ ] **CAL-18 — Activar automatizaciones según creación, confirmación, reprogramación, cancelación o inasistencia.**
  - [ ] Emitir eventos de creación, confirmación, reprogramación, cancelación e inasistencia.
  - [ ] Incluir la referencia de la cita y los cambios.
  - [ ] Evitar reactivar el mismo flujo por eventos repetidos.

- [ ] **CAL-19 — Sincronizar con calendarios externos.**
  - [ ] Conectar la cuenta del calendario externo elegido.
  - [ ] Sincronizar eventos y bloqueos de disponibilidad con identificadores de correspondencia.
  - [ ] Procesar cambios y cancelaciones sin duplicar eventos ni crear bucles.

- [ ] **Comprobación integrada — Calendario**
  - [ ] Solicitar el mismo horario simultáneamente desde un asesor y un agente, confirmar solo una reserva y comprobar que reprogramar o cancelar actualiza disponibilidad y recordatorios.

## Formularios

Dependencias: Campos personalizados, contactos, chat y automatizaciones.

- [ ] **Sección completa — Formularios**

- [ ] **FORM-01 — Crear formularios interactivos con una experiencia similar a Google Forms.**
  - [ ] Crear formularios con título, descripción y estructura editable.
  - [ ] Ofrecer vista previa para computadora y móvil.
  - [ ] Permitir completar y enviar el formulario publicado.

- [ ] **FORM-02 — Constructor visual para agregar, eliminar y ordenar preguntas.**
  - [ ] Agregar preguntas desde el constructor.
  - [ ] Editar, eliminar y cambiar su orden.
  - [ ] Conservar identificadores de preguntas aunque se reordenen.

- [ ] **FORM-03 — Manejo de diferentes tipos de campos: texto, número, correo, teléfono, fecha, hora, selección única, selección múltiple, listas, casillas, escalas y campos abiertos.**
  - [ ] Implementar texto corto y largo, número, correo, teléfono, fecha y hora.
  - [ ] Implementar selección única, múltiple, listas, casillas y escalas.
  - [ ] Guardar opciones y validar respuestas según el tipo.

- [ ] **FORM-04 — Agregar títulos, descripciones, imágenes y videos.**
  - [ ] Insertar títulos, descripciones, imágenes y videos.
  - [ ] Permitir ordenar estos elementos entre preguntas.
  - [ ] Mostrar contenido correctamente en la vista pública.
  - [ ] Publicar solo imágenes y videos `AVAILABLE` mediante autorizaciones de lectura de corta duración.

- [ ] **FORM-05 — Permitir la carga de imágenes y documentos por parte del usuario.**
  - [ ] Permitir subir imágenes y documentos con límites definidos.
  - [ ] Crear una intención firmada de corta duración, validar el contenido real y mantenerlo inaccesible hasta quedar `AVAILABLE`.
  - [ ] Asociar cada archivo a su respuesta.
  - [ ] Restringir el acceso a los archivos de respuestas a usuarios autorizados.

- [ ] **FORM-06 — Organizar los formularios mediante secciones.**
  - [ ] Crear y reordenar secciones.
  - [ ] Asociar preguntas con una sección.
  - [ ] Permitir navegación entre secciones conservando respuestas.

- [ ] **FORM-07 — Aplicar lógica condicional para mostrar preguntas según respuestas anteriores.**
  - [ ] Definir condiciones basadas en respuestas anteriores.
  - [ ] Mostrar u ocultar preguntas y secciones según esas condiciones.
  - [ ] Evitar que campos ocultos bloqueen el envío por ser obligatorios.

- [ ] **FORM-08 — Configurar campos obligatorios y validaciones.**
  - [ ] Configurar obligatoriedad y validaciones según tipo.
  - [ ] Mostrar errores junto al campo.
  - [ ] Validar de nuevo las respuestas al recibirlas.

- [ ] **FORM-09 — Personalizar colores, logotipo y mensaje de finalización.**
  - [ ] Configurar colores y logotipo del formulario.
  - [ ] Editar el mensaje final.
  - [ ] Reflejar la configuración en vista previa y publicación.

- [ ] **FORM-10 — Guardar formularios como borrador antes de publicarlos.**
  - [ ] Guardar y recuperar borradores.
  - [ ] Publicar una versión identificable del formulario.
  - [ ] Conservar qué versión respondió cada persona al editar el formulario.

- [ ] **FORM-11 — Compartir formularios mediante enlace.**
  - [ ] Generar un enlace para el formulario publicado.
  - [ ] Permitir acceso sin entrar al CRM.
  - [ ] Comprobar que el formulario sigue abierto al enviarse la respuesta.

- [ ] **FORM-12 — Enviar formularios directamente desde el chat.**
  - [ ] Seleccionar el formulario desde una conversación.
  - [ ] Generar una referencia de envío vinculada al contacto.
  - [ ] Enviar el enlace por el canal activo.

- [ ] **FORM-13 — Asociar cada respuesta con un contacto.**
  - [ ] Vincular la respuesta al contacto mediante la referencia de envío o identificación válida.
  - [ ] Gestionar respuestas sin contacto identificado.
  - [ ] Evitar asociar respuestas a otra persona por coincidencias ambiguas.

- [ ] **FORM-14 — Crear o actualizar contactos automáticamente a partir de las respuestas.**
  - [ ] Mapear preguntas a campos de contacto.
  - [ ] Buscar coincidencias antes de crear un contacto.
  - [ ] Actualizar solo los campos definidos en el mapeo.

- [ ] **FORM-15 — Permitir que el agente consulte las respuestas del formulario.**
  - [ ] Consultar respuestas vinculadas al contacto y formulario.
  - [ ] Entregar preguntas, valores y fecha al agente.
  - [ ] Incorporar las nuevas respuestas al contexto antes de continuar.

- [ ] **FORM-16 — Utilizar las respuestas para actualizar campos, oportunidades o cotizaciones.**
  - [ ] Mapear respuestas a campos de contacto, oportunidad o borrador de cotización.
  - [ ] Validar tipos y registro de destino.
  - [ ] Registrar los cambios aplicados.

- [ ] **FORM-17 — Activar automatizaciones cuando se complete un formulario.**
  - [ ] Emitir un evento al guardar una respuesta completa.
  - [ ] Incluir formulario, versión, respuesta y contacto.
  - [ ] Evitar ejecuciones duplicadas por reenvío de la respuesta.

- [ ] **FORM-18 — Consultar, filtrar y exportar las respuestas.**
  - [ ] Listar respuestas y abrir su detalle.
  - [ ] Filtrar por formulario, fecha y valores de respuesta.
  - [ ] Exportar valores y referencias de archivos respetando permisos.
  - [ ] No persistir ni exportar URLs S3 firmadas; generar acceso nuevo al abrir una referencia autorizada.

- [ ] **FORM-19 — Recibir notificaciones cuando se envíe una nueva respuesta.**
  - [ ] Configurar destinatarios internos de nuevas respuestas.
  - [ ] Notificar con un enlace al detalle.
  - [ ] Evitar notificaciones repetidas del mismo envío.

- [ ] **FORM-20 — Cerrar manual o automáticamente la recepción de respuestas.**
  - [ ] Permitir cierre manual.
  - [ ] Configurar la condición de cierre automático.
  - [ ] Mostrar un mensaje de formulario cerrado y rechazar nuevos envíos.

- [ ] **Comprobación integrada — Formularios**
  - [ ] Publicar un formulario con condiciones y archivos, enviarlo desde un chat y confirmar que la respuesta actualiza el contacto y queda disponible para el agente una sola vez.

## Catálogos e inventarios

Dependencias: Campos personalizados, permisos y herramientas del agente. Su uso en documentos se completa con Cotizaciones y facturación.

- [ ] **Sección completa — Catálogos e inventarios**

- [ ] **CAT-01 — Crear productos o servicios.**
  - [ ] Crear registros diferenciados de producto y servicio.
  - [ ] Editar su ficha y estado.
  - [ ] Elegir el modo de disponibilidad aplicable.

- [ ] **CAT-02 — Registrar nombre, descripción, precio, imágenes y documentos.**
  - [ ] Guardar nombre, descripción y precio.
  - [ ] Adjuntar y ordenar imágenes y documentos.
  - [ ] Sustituir archivos creando versiones inmutables nuevas sin sobrescribir objetos utilizados por otras fichas o documentos.
  - [ ] Mostrar la ficha completa y sus archivos.

- [ ] **CAT-03 — Crear categorías completamente personalizadas.**
  - [ ] Crear y editar categorías con nombres definidos por el usuario.
  - [ ] Asociar productos a categorías.
  - [ ] Evitar categorías fijas dependientes de un sector.

- [ ] **CAT-04 — Crear tipos personalizados, por ejemplo: SUV, sedán, pickup o vehículo de carga.**
  - [ ] Crear tipos con nombre y descripción libre.
  - [ ] Asociar productos con el tipo correspondiente.
  - [ ] Permitir SUV o carga como ejemplos de datos configurados por el usuario.

- [ ] **CAT-05 — Crear atributos personalizados para cada tipo de producto.**
  - [ ] Definir nombre, identificador y descripción de cada atributo.
  - [ ] Asociarlo con uno o varios tipos.
  - [ ] Guardar valores de atributos en la ficha del producto.

- [ ] **CAT-06 — Permitir atributos de selección única, selección múltiple, texto, número, fecha, verdadero/falso y color.**
  - [ ] Implementar selección única y múltiple, texto, número, fecha, booleano y color.
  - [ ] Validar valores según el tipo elegido.
  - [ ] Mostrar el control correspondiente en la ficha.

- [ ] **CAT-07 — Crear opciones personalizadas dentro de cada atributo.**
  - [ ] Crear, editar y ordenar opciones de un atributo.
  - [ ] Asignar identificadores estables a las opciones.
  - [ ] Resolver qué sucede con valores existentes al retirar una opción.

- [ ] **CAT-08 — Permitir que un atributo llamado “Color” tenga opciones como rojo, negro, blanco o azul.**
  - [ ] Permitir crear un atributo llamado Color sin que exista como campo obligatorio fijo.
  - [ ] Agregar opciones con nombre y valor de color.
  - [ ] Asociar opciones a productos o variantes.

- [ ] **CAT-09 — Mostrar un selector visual de color cuando corresponda.**
  - [ ] Mostrar muestras y un selector de color.
  - [ ] Guardar el valor visual junto al nombre.
  - [ ] Mantener disponible el texto para búsqueda y contexto del agente.

- [ ] **CAT-10 — Configurar atributos diferentes según el tipo de producto.**
  - [ ] Configurar el conjunto de atributos de cada tipo.
  - [ ] Mostrar solo los campos aplicables al producto.
  - [ ] Conservar o resolver valores al cambiar de tipo.

- [ ] **CAT-11 — Crear variantes combinando atributos como color, tamaño, modelo o presentación.**
  - [ ] Elegir atributos que generan variantes.
  - [ ] Crear combinaciones seleccionadas.
  - [ ] Evitar variantes repetidas para una misma combinación.

- [ ] **CAT-12 — Establecer precio, código, imágenes y disponibilidad por variante.**
  - [ ] Guardar código, precio e imágenes por variante.
  - [ ] Vincular cada imagen mediante `fileId` disponible y conservar su orden sin exponer claves del almacenamiento.
  - [ ] Asociar disponibilidad con la variante concreta.
  - [ ] Aplicar el precio de la variante al seleccionarla en un documento.

- [ ] **CAT-13 — Controlar existencias generales o por variante.**
  - [ ] Guardar existencias por producto o variante según su configuración.
  - [ ] Distinguir cantidad física, reservada y disponible.
  - [ ] Evitar descontar simultáneamente el mismo saldo.

- [ ] **CAT-14 — Registrar entradas, salidas y ajustes de inventario.**
  - [ ] Registrar entradas, salidas y ajustes con cantidad, motivo, fecha y autor.
  - [ ] Calcular el saldo desde movimientos consistentes.
  - [ ] Impedir que un reintento duplique el movimiento.

- [ ] **CAT-15 — Mostrar productos disponibles, agotados, reservados o inactivos.**
  - [ ] Mostrar estado activo o inactivo y disponibilidad.
  - [ ] Calcular agotado o reservado según cantidades o fechas.
  - [ ] Excluir elementos inactivos de la selección comercial habitual.

- [ ] **CAT-16 — Permitir productos sin control de inventario, como servicios o vehículos de alquiler.**
  - [ ] Permitir servicios sin existencias numéricas.
  - [ ] Separar stock consumible de disponibilidad por fechas.
  - [ ] Mantener unidades o recursos identificables para alquileres cuando sean necesarios.

- [ ] **CAT-17 — Manejar disponibilidad por fechas para productos de renta.**
  - [ ] Registrar el periodo de reserva y el recurso o cantidad alquilada.
  - [ ] Consultar disponibilidad para el intervalo solicitado.
  - [ ] Liberar disponibilidad al cancelar o terminar la reserva.

- [ ] **CAT-18 — Evitar reservas duplicadas durante un mismo periodo.**
  - [ ] Detectar periodos superpuestos sobre el mismo recurso.
  - [ ] Validar y confirmar la reserva de forma indivisible.
  - [ ] Comprobar capacidad suficiente cuando el alquiler se maneje por cantidad.

- [ ] **CAT-19 — Permitir varios catálogos.**
  - [ ] Crear catálogos con nombre y descripción.
  - [ ] Asociar productos a uno o varios catálogos.
  - [ ] Mantener una ficha central para evitar duplicar stock.

- [ ] **CAT-20 — Organizar productos por categorías, tipos y atributos.**
  - [ ] Asignar categorías, tipos y atributos a cada producto.
  - [ ] Guardar el orden dentro del catálogo.
  - [ ] Mostrar agrupaciones configuradas por el usuario.

- [ ] **CAT-21 — Buscar y filtrar utilizando los campos personalizados.**
  - [ ] Construir filtros a partir de los atributos existentes.
  - [ ] Aplicar operadores compatibles con texto, número, opciones o fechas.
  - [ ] Combinar criterios sin perder el filtro de disponibilidad.

- [ ] **CAT-22 — Compartir productos desde el chat.**
  - [ ] Seleccionar un producto desde el chat.
  - [ ] Enviar su información e imágenes por el canal compatible.
  - [ ] Resolver y registrar la versión exacta de cada imagen disponible enviada al canal.
  - [ ] Registrar qué producto se compartió.

- [ ] **CAT-23 — Agregar productos o servicios a cotizaciones y facturas.**
  - [ ] Seleccionar producto y variante desde la cotización o factura.
  - [ ] Copiar descripción, cantidad, precio y atributos necesarios al documento.
  - [ ] Conservar los valores emitidos aunque cambie posteriormente el catálogo.

- [ ] **CAT-24 — Importar y exportar productos e inventario.**
  - [ ] Mapear columnas, categorías, tipos y atributos al importar.
  - [ ] Validar errores y códigos duplicados.
  - [ ] Exportar productos, variantes y existencias sin alterar movimientos al consultar.
  - [ ] Procesar archivos y referencias de medios importados mediante el mismo pipeline seguro y no exportar credenciales ni URLs firmadas persistentes.

- [ ] **CAT-25 — Permitir que el agente consulte categorías, tipos, atributos, variantes, precios, existencias y disponibilidad.**
  - [ ] Exponer al agente esquema de categorías, tipos, atributos y variantes.
  - [ ] Consultar precios y disponibilidad actuales con permisos.
  - [ ] Señalar datos ausentes y resultados vacíos.

- [ ] **CAT-26 — Permitir que el agente filtre productos según lo solicitado por el cliente.**
  - [ ] Traducir requisitos del cliente a filtros usando el esquema configurado.
  - [ ] Ejecutar búsquedas con opciones válidas.
  - [ ] Devolver coincidencias sin inventar productos o atributos.

- [ ] **CAT-27 — Entregar al agente la descripción de cada campo personalizado para que comprenda su significado.**
  - [ ] Entregar al agente el nombre, descripción, tipo y opciones de cada campo.
  - [ ] Usar identificadores estables para consultar valores.
  - [ ] Reflejar cambios de descripción en consultas posteriores.

- [ ] **CAT-28 — Permitir que el agente recomiende productos usando los atributos configurados.**
  - [ ] Comparar necesidades del cliente con atributos y disponibilidad reales.
  - [ ] Devolver las coincidencias y los datos que justifican la recomendación.
  - [ ] Informar cuando no existe una coincidencia adecuada.

- [ ] **CAT-29 — Actualizar el contexto del agente cuando se modifique un producto, atributo, precio o disponibilidad.**
  - [ ] Actualizar o invalidar información almacenada cuando cambien productos o atributos.
  - [ ] Consultar precio y disponibilidad nuevamente antes de confirmar una operación.
  - [ ] Evitar reutilizar valores antiguos como actuales.

- [ ] **CAT-30 — La estructura debería ser completamente dinámica. No debes programar directamente campos como “tipo de vehículo” o “color”. El usuario crea el campo, define qué significa y configura sus opciones; Quantum entrega esa estructura al agente para que pueda interpretarla y utilizarla**
  - [ ] Guardar tipos y atributos como configuración editable.
  - [ ] Construir formularios, filtros y esquema del agente desde esa configuración.
  - [ ] Verificar que un catálogo ajeno a vehículos funciona sin cambiar código.

- [ ] **Comprobación integrada — Catálogos e inventarios**
  - [ ] Configurar un catálogo de vehículos y otro de un rubro distinto sin modificar código; consultar atributos desde el agente y comprobar stock por variante y reservas sin solapamiento.

## Cotizaciones y facturación

Dependencias: Contactos, oportunidades, catálogo, plantillas, agentes e integraciones de pago elegidas.

- [ ] **Sección completa — Cotizaciones y facturación**

- [ ] **DOC-01 — Crear cotizaciones y facturas desde cero o utilizando plantillas.**
  - [ ] Elegir cotización o factura y seleccionar contacto.
  - [ ] Crear un documento vacío o instanciar una plantilla.
  - [ ] Guardar un borrador con sus datos comerciales.

- [ ] **DOC-02 — Constructor de documentos completamente flexible.**
  - [ ] Editar estructura y contenido por bloques sin un formato único obligatorio.
  - [ ] Guardar diseño separado de los datos comerciales.
  - [ ] Previsualizar el documento con datos reales.

- [ ] **DOC-03 — Crear documentos utilizando bloques de texto, imágenes, tablas, columnas, separadores, productos, subtotales, impuestos, descuentos, firmas y campos personalizados.**
  - [ ] Implementar bloques de texto, imágenes, tablas, columnas y separadores.
  - [ ] Implementar productos, subtotales, impuestos, descuentos y campos dinámicos.
  - [ ] Incorporar campos de firma y registrar la firma sobre una versión identificada cuando se utilicen.
  - [ ] Vincular imágenes y firmas al `fileId` y checksum exactos de la versión del documento.

- [ ] **DOC-04 — Mover y ordenar libremente los bloques del documento.**
  - [ ] Insertar, mover y reordenar bloques.
  - [ ] Conservar contenido y configuración al moverlos.
  - [ ] Reflejar el orden en vista previa y PDF.

- [ ] **DOC-05 — Personalizar encabezados, pies de página, colores, tipografías, logotipo y fondos.**
  - [ ] Configurar encabezados, pies, logotipo, fondos y estilos.
  - [ ] Aplicar tipografías y colores a bloques y documento.
  - [ ] Mantener el diseño al exportar.
  - [ ] Vincular logotipos y fondos por `fileId` inmutable y conservar la versión usada por cada documento emitido.

- [ ] **DOC-06 — Crear varias páginas dentro del documento.**
  - [ ] Agregar páginas y saltos de página.
  - [ ] Continuar tablas extensas sin cortar contenido.
  - [ ] Mantener encabezados y pies coherentes entre páginas.

- [ ] **DOC-07 — Agregar productos desde el catálogo.**
  - [ ] Buscar y seleccionar productos y variantes del catálogo.
  - [ ] Copiar sus datos comerciales al documento.
  - [ ] Permitir elegir cantidad y unidad aplicable.

- [ ] **DOC-08 — Agregar conceptos personalizados que no existan en el catálogo.**
  - [ ] Agregar líneas con descripción, cantidad y precio libre.
  - [ ] Calcularlas igual que las líneas del catálogo.
  - [ ] Conservarlas sin crear productos automáticamente.

- [ ] **DOC-09 — Modificar descripción, cantidad, precio, impuesto y descuento de cada concepto.**
  - [ ] Editar los valores permitidos por concepto.
  - [ ] Recalcular importes con precisión decimal y redondeo definido.
  - [ ] Mostrar subtotal, descuento, impuesto y total coherentes.

- [ ] **DOC-10 — Crear fórmulas y cálculos personalizados.**
  - [ ] Configurar fórmulas con campos y operadores permitidos.
  - [ ] Validar referencias y errores como división por cero.
  - [ ] Recalcular dependencias sin ejecutar código arbitrario.

- [ ] **DOC-11 — Insertar información dinámica del contacto, empresa, oportunidad, asesor, cotización o factura.**
  - [ ] Ofrecer un selector de variables de contacto, empresa, oportunidad, asesor y documento.
  - [ ] Sustituir variables usando el registro correcto.
  - [ ] Mostrar valores faltantes antes de enviar.

- [ ] **DOC-12 — Utilizar los campos personalizados del CRM dentro de los documentos.**
  - [ ] Incluir campos personalizados en el selector de variables.
  - [ ] Formatear los valores según su tipo.
  - [ ] Conservar referencias estables si cambia el nombre del campo.

- [ ] **DOC-13 — Agregar condiciones comerciales, términos, garantías y observaciones.**
  - [ ] Agregar bloques editables de términos, condiciones, garantías y observaciones.
  - [ ] Guardar textos reutilizables dentro de la plantilla.
  - [ ] Conservar las condiciones de la versión enviada.

- [ ] **DOC-14 — Adjuntar imágenes, fichas técnicas y otros documentos.**
  - [ ] Adjuntar documentos y fichas técnicas.
  - [ ] Insertar imágenes en el contenido o como adjuntos.
  - [ ] Permitir acceso a los archivos autorizados desde el documento compartido.
  - [ ] Impedir el acceso a adjuntos en cuarentena, rechazados, borrados o pertenecientes a otro perfil.

- [ ] **DOC-15 — Guardar cualquier diseño como plantilla reutilizable.**
  - [ ] Guardar estructura, estilos y variables como plantilla.
  - [ ] Crear documentos nuevos sin modificar la plantilla.
  - [ ] Permitir editar y reutilizar la plantilla.

- [ ] **DOC-16 — Duplicar y editar cotizaciones o facturas existentes.**
  - [ ] Duplicar el contenido en un nuevo borrador con identificador propio.
  - [ ] Permitir editar borradores.
  - [ ] Conservar el original y el historial de los documentos ya enviados.

- [ ] **DOC-17 — Generar documentos en PDF.**
  - [ ] Renderizar el documento como PDF.
  - [ ] Mantener páginas, tablas, imágenes y totales legibles.
  - [ ] Verificar un documento de varias páginas y otro con tabla extensa.
  - [ ] Almacenar el PDF como objeto inmutable validado y vinculado a la versión exacta que lo generó.

- [ ] **DOC-18 — Compartirlos mediante enlace, correo o chat.**
  - [ ] Generar enlace de acceso al documento específico.
  - [ ] Usar una capacidad revocable de Quantum que autorice el recurso y emita una URL de archivo breve, nunca una URL S3 permanente.
  - [ ] Enviarlo por correo o chat y permitir compartir el PDF.
  - [ ] Registrar envío y errores del canal.

- [ ] **DOC-19 — Permitir que el cliente acepte o rechace una cotización.**
  - [ ] Mostrar acciones de aceptar o rechazar sobre la cotización vigente.
  - [ ] Registrar respuesta, fecha y versión aceptada.
  - [ ] Impedir respuestas sobre versiones sustituidas o vencidas.

- [ ] **DOC-20 — Permitir que el cliente agregue comentarios al rechazarla.**
  - [ ] Permitir introducir un comentario al rechazar.
  - [ ] Guardarlo junto con la respuesta del cliente.
  - [ ] Mostrarlo al asesor en el detalle de la cotización.

- [ ] **DOC-21 — Manejar estados: borrador, enviada, vista, aceptada, rechazada, vencida o cancelada.**
  - [ ] Gestionar borrador, enviada, vista, aceptada, rechazada, vencida y cancelada.
  - [ ] Registrar visualización desde el enlace cuando pueda medirse.
  - [ ] Mantener separado el estado de la cotización del estado de pago.

- [ ] **DOC-22 — Establecer fecha de emisión y vencimiento.**
  - [ ] Guardar emisión y vencimiento.
  - [ ] Validar el orden de las fechas.
  - [ ] Aplicar el vencimiento sin alterar documentos ya aceptados o pagados indebidamente.

- [ ] **DOC-23 — Registrar el historial de cambios y versiones.**
  - [ ] Guardar versiones con autor, fecha y cambios.
  - [ ] Mantener una copia de lo enviado o aceptado.
  - [ ] Vincular aceptación y firma a la versión concreta.
  - [ ] Conservar los `fileId` y checksums exactos de imágenes, adjuntos, PDF y firma de cada versión emitida.

- [ ] **DOC-24 — Convertir una cotización aceptada en factura sin volver a ingresar la información.**
  - [ ] Crear una factura desde una cotización aceptada.
  - [ ] Copiar conceptos, importes, impuestos, moneda, cliente y condiciones aplicables.
  - [ ] Conservar el vínculo y evitar doble conversión accidental.

- [ ] **DOC-25 — Asociar cotizaciones y facturas con contactos y oportunidades.**
  - [ ] Vincular documentos con contacto y oportunidad específicos.
  - [ ] Mostrar los documentos relacionados desde cada ficha.
  - [ ] Evitar atribuir una factura a otra oportunidad del mismo contacto.

- [ ] **DOC-26 — Actualizar el valor de la oportunidad utilizando el total de la cotización.**
  - [ ] Usar el total de la cotización elegida como valor de la oportunidad.
  - [ ] Guardar la referencia de la cotización utilizada.
  - [ ] Evitar sumar revisiones o alternativas como si fueran ventas distintas.

- [ ] **DOC-27 — Permitir pagos completos, parciales o por cuotas.**
  - [ ] Definir pagos completos, anticipos, parciales o calendario de cuotas.
  - [ ] Registrar vencimiento e importe de cada cuota.
  - [ ] Calcular saldo pendiente desde pagos confirmados.

- [ ] **DOC-28 — Manejar facturas únicas y recurrentes.**
  - [ ] Crear facturas de emisión única.
  - [ ] Configurar frecuencia, inicio y finalización para recurrencias.
  - [ ] Generar cada factura recurrente una sola vez sin modificar las anteriores.

- [ ] **DOC-29 — Registrar estados de pago: pendiente, parcialmente pagada, pagada, vencida, anulada o reembolsada.**
  - [ ] Separar emisión o anulación, saldo, vencimiento y reembolsos.
  - [ ] Mostrar pendiente, parcial, pagada, vencida, anulada o reembolsada según corresponda.
  - [ ] Conservar pagos y devoluciones en el historial.

- [ ] **DOC-30 — Registrar pagos manuales o recibidos mediante una pasarela.**
  - [ ] Registrar pagos manuales con importe, fecha, método y referencia.
  - [ ] Confirmar pagos de pasarela mediante eventos verificados.
  - [ ] Evitar contabilizar dos veces el mismo pago.

- [ ] **DOC-31 — Generar comprobantes de pago.**
  - [ ] Generar comprobante a partir de un pago confirmado.
  - [ ] Incluir factura, importe, fecha, método y referencia.
  - [ ] Permitir descargarlo y compartirlo.
  - [ ] Conservar el comprobante como archivo inmutable y autorizar cada descarga o envío contra el pago confirmado.

- [ ] **DOC-32 — Configurar monedas, impuestos y numeración de documentos.**
  - [ ] Aplicar moneda, impuestos y secuencia configurados.
  - [ ] Asignar números únicos al emitir.
  - [ ] Mantener importes, numeración y reglas usadas en cada documento.

- [ ] **DOC-33 — Activar automatizaciones según envío, visualización, aceptación, rechazo, vencimiento o pago.**
  - [ ] Emitir eventos de envío, vista, aceptación, rechazo, vencimiento y pago.
  - [ ] Incluir documento, contacto, oportunidad y estado.
  - [ ] Evitar ejecuciones duplicadas por notificaciones repetidas.

- [ ] **DOC-34 — Permitir que el agente consulte cotizaciones, facturas y estados de pago.**
  - [ ] Consultar documentos vinculados al contacto y oportunidad.
  - [ ] Entregar totales, condiciones, vencimientos y saldo actual.
  - [ ] Limitar la consulta según permisos.

- [ ] **DOC-35 — Permitir que el agente cree borradores de cotizaciones utilizando la conversación y el catálogo.**
  - [ ] Extraer necesidades y conceptos de la conversación.
  - [ ] Consultar productos y precios autorizados.
  - [ ] Guardar un borrador calculado por el CRM con sus fuentes de datos.

- [ ] **DOC-36 — Configurar si el agente puede enviar directamente el documento o necesita aprobación de un asesor.**
  - [ ] Configurar permiso de envío directo o revisión humana.
  - [ ] Mantener el borrador pendiente cuando requiera revisión.
  - [ ] Verificar la autorización antes del envío definitivo.

- [ ] **DOC-37 — Permitir que el agente responda preguntas sobre productos, precios, impuestos, condiciones y estado del documento.**
  - [ ] Entregar al agente la versión correspondiente del documento.
  - [ ] Resolver consultas con sus conceptos, impuestos, condiciones y pagos registrados.
  - [ ] Indicar datos faltantes sin inventar importes ni confirmaciones.

- [ ] **Comprobación integrada — Cotizaciones y facturación**
  - [ ] Crear una propuesta con diseño libre, productos y campos personalizados, aceptarla, convertirla una sola vez en factura y registrar pagos parciales hasta saldarla manteniendo sus versiones.

## Reportes

Dependencias: Registros y eventos de los módulos implementados; desarrollar cada reporte base cuando su fuente esté disponible.

- [ ] **Sección completa — Reportes**

- [ ] **REP-01 — Incluir reportes base sobre conversaciones, contactos, oportunidades, ventas, cotizaciones, facturas, tareas, calendarios, agentes y asesores.**
  - [ ] Crear tableros base para conversaciones, contactos, oportunidades, ventas y documentos.
  - [ ] Incluir tareas, citas, agentes y asesores.
  - [ ] Definir qué cuenta cada indicador y su fecha de referencia.

- [ ] **REP-02 — Permitir crear varios tableros personalizados.**
  - [ ] Crear tableros con nombre y descripción.
  - [ ] Guardar gráficos y distribución por tablero.
  - [ ] Permitir consultar y editar cada tablero autorizado.

- [ ] **REP-03 — Agregar, eliminar, duplicar y ordenar gráficos dinámicamente.**
  - [ ] Agregar y eliminar gráficos desde el tablero.
  - [ ] Duplicar su configuración con un identificador nuevo.
  - [ ] Guardar el orden elegido.

- [ ] **REP-04 — Modificar el tamaño y posición de cada gráfico.**
  - [ ] Permitir mover y redimensionar gráficos.
  - [ ] Guardar su posición y tamaño.
  - [ ] Adaptar la distribución a pantallas menores.

- [ ] **REP-05 — Seleccionar la fuente de datos que utilizará cada gráfico.**
  - [ ] Mostrar fuentes de datos disponibles según permisos.
  - [ ] Exponer campos y relaciones compatibles.
  - [ ] Evitar duplicar conteos al relacionar contactos, oportunidades o pagos.

- [ ] **REP-06 — Elegir el tipo de visualización: indicador, tabla, barras, líneas, áreas, pastel, embudo o progreso.**
  - [ ] Implementar indicador, tabla, barras, líneas, áreas, pastel, embudo y progreso.
  - [ ] Solicitar los campos necesarios para cada visualización.
  - [ ] Mostrar estados vacíos sin representar datos inexistentes.

- [ ] **REP-07 — Seleccionar la métrica que se desea calcular.**
  - [ ] Elegir el campo o indicador a medir.
  - [ ] Identificar su entidad y unidad de medida.
  - [ ] Validar que la métrica sea compatible con la visualización.

- [ ] **REP-08 — Configurar operaciones como conteo, suma, promedio, porcentaje, mínimo, máximo o valores únicos.**
  - [ ] Implementar conteo, suma, promedio, porcentaje, mínimo, máximo y conteo único.
  - [ ] Definir numerador y denominador de los porcentajes.
  - [ ] Tratar valores vacíos y divisiones por cero de forma consistente.

- [ ] **REP-09 — Agrupar los resultados por fecha, canal, asesor, agente, pipeline, etapa, producto, etiqueta u otros campos.**
  - [ ] Agrupar por fecha, canal, asesor, agente, pipeline, etapa, producto o etiqueta.
  - [ ] Configurar agrupación temporal por día, semana o mes.
  - [ ] Distinguir valores sin asignar.

- [ ] **REP-10 — Permitir utilizar campos personalizados como métricas, filtros o agrupaciones.**
  - [ ] Exponer campos personalizados de cada fuente.
  - [ ] Permitir métricas solo con tipos adecuados.
  - [ ] Incluirlos en filtros y agrupaciones sin perder sus opciones o etiquetas.

- [ ] **REP-11 — Crear métricas y fórmulas personalizadas.**
  - [ ] Crear fórmulas a partir de métricas y operadores permitidos.
  - [ ] Validar compatibilidad, referencias y dependencias.
  - [ ] Mostrar errores de configuración antes de ejecutar.

- [ ] **REP-12 — Aplicar filtros generales al tablero.**
  - [ ] Definir filtros comunes de fecha, canal, asesor u otros campos compatibles.
  - [ ] Aplicarlos a los gráficos vinculados.
  - [ ] Mostrar los filtros activos.

- [ ] **REP-13 — Aplicar filtros independientes a cada gráfico.**
  - [ ] Configurar criterios propios del gráfico.
  - [ ] Definir si hereda o reemplaza filtros generales.
  - [ ] Mostrar la configuración efectiva para interpretar el resultado.

- [ ] **REP-14 — Configurar periodos de tiempo fijos o dinámicos.**
  - [ ] Seleccionar fechas concretas o periodos relativos.
  - [ ] Elegir el campo de fecha usado por la métrica.
  - [ ] Recalcular periodos dinámicos según la zona horaria.

- [ ] **REP-15 — Comparar información con periodos anteriores.**
  - [ ] Seleccionar el periodo de comparación.
  - [ ] Mostrar valor actual, anterior y variación.
  - [ ] Tratar periodos sin datos o base cero sin porcentajes engañosos.

- [ ] **REP-16 — Elegir si el gráfico se actualiza en tiempo real o en intervalos determinados.**
  - [ ] Elegir actualización por eventos o por intervalo.
  - [ ] Recargar solo los datos afectados cuando corresponda.
  - [ ] Indicar si hay errores o datos pendientes de actualizar.

- [ ] **REP-17 — Permitir que un gráfico filtre otros gráficos al seleccionar un dato.**
  - [ ] Configurar qué gráficos reciben el filtro de una selección.
  - [ ] Aplicar la dimensión seleccionada a fuentes compatibles.
  - [ ] Permitir limpiar el filtro y recuperar la vista anterior.

- [ ] **REP-18 — Permitir abrir el detalle de los registros que componen un resultado.**
  - [ ] Abrir los registros que originan una barra, indicador o celda.
  - [ ] Aplicar exactamente los filtros del resultado.
  - [ ] Mantener permisos y enlazar al registro original.

- [ ] **REP-19 — Definir colores, títulos, leyendas y formato de valores.**
  - [ ] Editar título, colores, leyenda y etiquetas.
  - [ ] Guardar estilos por gráfico.
  - [ ] Previsualizar el resultado configurado.

- [ ] **REP-20 — Mostrar valores como moneda, porcentaje, tiempo o cantidades.**
  - [ ] Seleccionar formato de cantidad, moneda, porcentaje o duración.
  - [ ] Aplicar decimales y unidades definidos.
  - [ ] Evitar sumar monedas distintas como un solo importe sin conversión definida.

- [ ] **REP-21 — Guardar configuraciones como plantillas de reportes.**
  - [ ] Guardar estructura y configuración del tablero como plantilla.
  - [ ] Crear un tablero nuevo desde la plantilla.
  - [ ] Resolver campos o fuentes que no existan en el destino.

- [ ] **REP-22 — Definir qué usuarios o equipos pueden visualizar cada tablero.**
  - [ ] Asignar usuarios o equipos con acceso al tablero.
  - [ ] Restringir edición según permisos.
  - [ ] Aplicar también permisos sobre los datos consultados.

- [ ] **REP-23 — Exportar los datos o gráficos.**
  - [ ] Exportar datos del resultado filtrado.
  - [ ] Exportar el gráfico con su título y periodo.
  - [ ] Aplicar los mismos permisos que en la consulta.

- [ ] **REP-24 — Permitir que el agente consulte métricas autorizadas del CRM.**
  - [ ] Exponer indicadores y filtros autorizados al agente.
  - [ ] Devolver valor, periodo, unidad y fecha de actualización.
  - [ ] Impedir que el agente consulte datos fuera de su alcance.

- [ ] **REP-25 — Incluir información sobre acciones y resultados de los agentes.**
  - [ ] Registrar acciones del agente, resultado, error y escalamiento.
  - [ ] Relacionarlas con conversación y oportunidad cuando exista.
  - [ ] Separar actividad de IA y humana sin atribuir ventas automáticamente sin una regla definida.

- [ ] **REP-26 — Registrar la fecha de última actualización de cada reporte.**
  - [ ] Guardar la fecha de la última consulta completada correctamente.
  - [ ] Mostrarla en cada reporte.
  - [ ] Diferenciar última actualización de última tentativa fallida.

- [ ] **Comprobación integrada — Reportes**
  - [ ] Crear un tablero con gráfico personalizado, filtros globales y locales, comparación y detalle; contrastar sus cifras con registros conocidos y comprobar el acceso de dos roles distintos.

## Verificación del recorrido completo

- [ ] **Recorrido comercial conectado**
  - [ ] Recibir un mensaje de un contacto y resolver su identidad y canal.
  - [ ] Consultar el catálogo dinámico desde el agente y crear la oportunidad usando la descripción del pipeline y su etapa.
  - [ ] Enviar un formulario, recibir su respuesta y utilizarla en el contacto y en el contexto del agente.
  - [ ] Crear una cotización con producto, campos personalizados y diseño propio, y enviarla según el permiso configurado.
  - [ ] Aceptar la cotización, convertirla en factura y registrar un pago parcial y otro final sin duplicados.
  - [ ] Crear una tarea o cita vinculada al mismo contacto y confirmar sus recordatorios.
  - [ ] Comprobar que el reporte refleja los registros reales y que cada asesor ve solo los datos autorizados.
- [ ] **Continuidad entre asesor y agente**
  - [ ] Tomar manualmente un chat mientras existe una respuesta del agente pendiente y confirmar que no se envía.
  - [ ] Mantener bloqueados los seguimientos automáticos durante la atención humana.
  - [ ] Reactivar el agente y comprobar que conoce mensajes, respuestas de formularios y cambios realizados por el asesor.
- [ ] **Recuperación de errores sin duplicados**
  - [ ] Repetir un evento de mensaje, automatización, reserva y pago y comprobar que no se duplican sus efectos.
  - [ ] Simular un fallo de integración y mostrar el error al usuario o agente sin confirmar una acción inexistente.
  - [ ] Recuperar la conexión y reintentar únicamente las operaciones cuyo resultado se haya comprobado.
- [ ] **Operación de la plataforma**
  - [ ] Completar los criterios de puesta en marcha de `Quantum_CRM_DevOps_Despliegues.md` con la capacidad real del VPS.
  - [ ] Comprobar despliegue unitario, promoción global, preservación de cambios por perfil y recuperación verificada.
- [ ] **Cobertura final del alcance**
  - [ ] Revisar que los 223 identificadores del adjunto, los seis identificadores BASE y los 20 identificadores ADM estén implementados.
  - [ ] Resolver la selección de canales, calendario externo y pasarela usados por la entrega.
  - [ ] Confirmar que no quedan funciones marcadas completas con subtareas pendientes.
