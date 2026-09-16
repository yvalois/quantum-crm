# Backlog de documentacion tecnica

Este archivo ordena las decisiones y documentos tecnicos que faltan antes y durante la implementacion. No acepta soluciones por anticipado: cada decision estructural se convierte en ADR, se revisa y se aprueba antes de declararse vigente.

## Como usar este backlog

- `Aceptado`: existe un ADR aceptado y una referencia aplicable.
- `Pendiente bloqueante`: debe resolverse antes del bootstrap o del primer recorrido vertical.
- `Pendiente por capacidad`: se resuelve antes de implementar el modulo indicado, no necesariamente antes de crear el monorepo.
- `Documento generado`: nace de codigo o configuracion real y no debe inventarse antes de existir.
- Una propuesta no cambia arquitectura hasta ser aprobada y registrada.
- Si una decision nueva contradice otra aceptada, debe sustituirla explicitamente mediante ADR.

## Base ya resuelta

| Tema | Estado | Fuente vigente |
|---|---|---|
| Stack y procesos ejecutables | Aceptado | [ADR-0001](../06-decisiones/ADR-0001-stack-base.md) |
| Limites de modulos y dependencias | Aceptado | [ADR-0002](../06-decisiones/ADR-0002-limites-modulos-dependencias.md) |
| Aislamiento multi-tenant | Aceptado | [ADR-0003](../06-decisiones/ADR-0003-aislamiento-multi-tenant.md) |
| Identidad, sesiones y autorizacion | Aceptado | [ADR-0004](../06-decisiones/ADR-0004-autenticacion-autorizacion.md) |
| APIs, eventos y contratos | Aceptado | [ADR-0005](../06-decisiones/ADR-0005-diseno-contratos-api.md) |
| Persistencia, concurrencia y migraciones | Aceptado | [ADR-0006](../06-decisiones/ADR-0006-persistencia-transacciones-migraciones.md) |
| Estrategia de pruebas y puertas de calidad | Aceptado | [ADR-0007](../06-decisiones/ADR-0007-estrategia-pruebas-calidad.md) |
| Componentes, fronteras y flujos | Documentado | [Mapa del sistema](../08-arquitectura/mapa-del-sistema.md) |
| Estructura objetivo del repositorio | Documentado | [Especificacion del monorepo](../08-arquitectura/monorepo.md) |
| Git, ramas, commits, PR y recuperacion | Documentado | [Git y GitHub](../05-reglas/05-git-y-github.md) |

## Bloqueantes antes de escribir codigo de producto

| Orden | Documento o decision | Preguntas que debe cerrar | Resultado esperado | Estado |
|---|---|---|---|---|
| 1 | Alcance del primer recorrido vertical | Que casos de uso entran, que se excluye y como se demuestra valor de extremo a extremo | Fase MVP con requisitos, exclusiones y criterios de aceptacion identificables | Pendiente; bloqueado como `PROY-002` |
| 2 | ADR-0008: entornos, configuracion y secretos | Entornos admitidos, precedencia, validacion, rotacion, acceso local y separacion por perfil | Contrato de configuracion sin secretos en Git | Pendiente bloqueante |
| 3 | ADR-0009: integracion, entrega y releases | Jobs de CI, artefactos, versionado, promociones, migraciones, rollback y protecciones | Pipeline reproducible y politica de release | Pendiente bloqueante |
| 4 | ADR-0010: observabilidad y manejo de fallos | Logs, trazas, metricas, correlacion, redaccion, alertas y catalogo de errores | Convenciones verificables desde el primer servicio | Pendiente bloqueante |

El monorepo puede crearse despues de aprobar estos puntos y el alcance inicial. No se exige seleccionar todos los proveedores comerciales para preparar la base tecnica.

## Decisiones antes de su capacidad

| Orden sugerido | Documento o decision | Se requiere antes de | Preguntas principales | Estado |
|---|---|---|---|---|
| 6 | ADR-0011: trabajos asincronos y automatizaciones | Workers, reintentos y flujos automaticos | Estados, leases, prioridades, reintentos, compensacion y operacion manual | Pendiente por capacidad |
| 7 | ADR-0012: integracion de agentes LangGraph | Primera herramienta o respuesta del agente | Contrato JS/Python, ejecuciones, permisos, contexto, limites, evaluacion y escalamiento humano | Pendiente por capacidad |
| 8 | ADR-0013: archivos y objetos | Formularios, documentos o adjuntos | Proveedor S3, claves, cifrado, antivirus, limites, URLs firmadas, retencion y borrado | Pendiente por capacidad |
| 9 | ADR-0014: arquitectura frontend y sistema visual | Primera interfaz productiva | Estado de servidor y cliente, formularios, componentes, accesibilidad, errores y pruebas visuales | Pendiente por capacidad |
| 10 | ADR-0015: respaldo, restauracion y continuidad | Primer entorno con datos valiosos | RPO, RTO, alcance, cifrado, ubicacion externa, restauracion y evidencia | Pendiente por capacidad |
| 11 | Seleccion de proveedores de canales | Chat multicanal | Canal inicial, webhooks, sandbox, limites, plantillas, costos y cumplimiento | Pendiente por capacidad |
| 12 | Calendario externo | Sincronizacion de agenda | Proveedor, OAuth, recurrencia, zonas horarias, conflictos y webhooks | Pendiente por capacidad |
| 13 | Pagos y facturacion fiscal | Cobros o emision fiscal | Pais, proveedor, monedas, impuestos, conciliacion, devoluciones y requisitos legales | Pendiente por capacidad |
| 14 | Busqueda y reportes | Volumen que exceda consultas transaccionales simples | Motor, frescura, indices, autorizacion, exportaciones y consistencia | Pendiente por capacidad |
| 15 | Retencion y privacidad | Uso de datos reales | Clasificacion, consentimiento, exportacion, eliminacion, plazos y auditoria | Pendiente por capacidad |

Los numeros de ADR posteriores son reservas de orden, no decisiones aceptadas. Se pueden dividir o reordenar antes de crearlos si aparece una frontera mas clara.

## Fichas operativas pendientes

| Documento | Datos faltantes | Momento limite |
|---|---|---|
| Inventario real del VPS | Proveedor, region, sistema, arquitectura, CPU, RAM, disco, red y acceso | Antes de desplegar servicios compartidos |
| Objetivos de servicio | SLO, ventanas, capacidad, RPO y RTO | Antes de comprometer disponibilidad o conservar datos valiosos |
| Matriz de entornos | Responsables, URLs, datos permitidos y controles por entorno | Antes de crear staging o produccion |
| Runbooks | Alta, despliegue, rollback, restauracion, rotacion y respuesta a incidentes | Antes de operar la accion correspondiente |
| Matriz de proveedores | Contrato, credenciales, sandbox, limites, webhooks, costos y contacto | Antes de integrar cada proveedor |

## Documentacion que debe generarse desde la implementacion

Estos artefactos no se redactan manualmente como si ya existieran:

- OpenAPI del HTTP publico y administrativo.
- AsyncAPI de eventos y webhooks.
- JSON Schema de herramientas y agentes.
- Catalogo real de variables por aplicacion y `.env.example` sin secretos.
- Diagramas de esquema o diccionario de datos derivados de migraciones.
- SBOM, inventario de dependencias y reporte de vulnerabilidades.
- Notas de release, matriz de compatibilidad y digests de imagenes.
- Tableros, alertas y runbooks enlazados a señales reales.

La CI debe detectar diferencias entre la fuente y los artefactos generados cuando exista codigo suficiente para producirlos.

## Orden recomendado de cierre

1. Aprobar el primer recorrido vertical y sus exclusiones.
2. Resolver ADR-0008 a ADR-0010.
3. Crear el monorepo y comprobar sus criterios de bootstrap.
4. Desarrollar un recorrido vertical pequeno con contratos, datos, autorizacion, pruebas y observabilidad.
5. Resolver cada decision por capacidad justo antes de necesitarla.
6. Completar fichas operativas antes de usar infraestructura o datos reales.

Este orden evita tanto el codigo prematuro como documentar en detalle capacidades que todavia no tienen una necesidad comprobable.
