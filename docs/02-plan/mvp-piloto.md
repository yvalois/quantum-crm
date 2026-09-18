# MVP integral para cliente piloto

- Estado del alcance: aprobado
- Fecha: 2026-09-16
- Responsable de la decision: propietario del proyecto
- Seguimiento del cierre documental: `PROY-002`

## Proposito

La primera entrega de Quantum CRM debe quedar lista para operar con un cliente piloto y datos reales. En este proyecto, `MVP` no significa una demostracion reducida ni un subconjunto del CRM: incluye todo el alcance funcional importado, las capacidades comunes de agentes y automatizaciones, el administrador central y la operacion tecnica necesaria para sostenerlos.

Las fases de este documento ordenan dependencias y permiten comprobar avances internos. No autorizan liberar un piloto parcial, presentar mocks como funciones terminadas ni retirar silenciosamente requisitos.

## Autoridad y trazabilidad

Este documento define que entra en la primera entrega y cuando puede liberarse. No duplica el detalle de los requisitos:

- [Funcionalidades](../01-producto/funcionalidades.md) define el comportamiento esperado.
- [Plan de trabajo](trabajo.md) contiene las subtareas y casillas verificables.
- [Operaciones y despliegues](../03-operaciones/despliegues.md) contiene los requisitos `OPS`.
- [Estado](../04-proceso/estado.md) registra trabajo activo, bloqueos y evidencia.
- [Definicion de terminado](../04-proceso/definicion-de-terminado.md) decide cuando una funcion puede cerrarse.
- [ADR](../06-decisiones/README.md) y [arquitectura](../08-arquitectura/README.md) gobiernan las decisiones tecnicas.

Si dos fuentes discrepan, se aplica la jerarquia documentada en [el sistema documental](../README.md). Este archivo no permite marcar una funcion terminada sin satisfacer sus subtareas originales.

## Alcance cuantificado

El MVP contiene **249 requisitos de producto** y **24 requisitos operativos**.

| Grupo | Rango | Cantidad | Incluido en MVP |
|---|---|---:|---|
| Administrador central | `ADM-01` a `ADM-20` | 20 | Si, completo |
| Usuarios y permisos | `USR-01` a `USR-11` | 11 | Si, completo |
| Configuracion | `CFG-01` a `CFG-14` | 14 | Si, completo |
| Base comun | `BASE-01` a `BASE-06` | 6 | Si, completo |
| Contactos | `CON-01` a `CON-14` | 14 | Si, completo |
| Pipelines | `PIPE-01` a `PIPE-15` | 15 | Si, completo |
| Chat multicanal | `CHAT-01` a `CHAT-21` | 21 | Si, completo |
| Tareas y seguimientos | `TAR-01` a `TAR-16` | 16 | Si, completo |
| Calendario | `CAL-01` a `CAL-19` | 19 | Si, completo |
| Formularios | `FORM-01` a `FORM-20` | 20 | Si, completo |
| Catalogos e inventarios | `CAT-01` a `CAT-30` | 30 | Si, completo |
| Cotizaciones y facturacion | `DOC-01` a `DOC-37` | 37 | Si, completo |
| Reportes | `REP-01` a `REP-26` | 26 | Si, completo |
| Operacion tecnica | `OPS-01` a `OPS-24` | 24 | Si, completo |

Los 223 requisitos de las once secciones comerciales, los seis `BASE` y los veinte `ADM` suman los 249 requisitos de producto. Los `OPS` son adicionales y obligatorios para usar datos reales.

## Sin exclusiones de la linea base

No se excluye ningun requisito de los tres documentos importados ni de las capacidades `BASE` y `ADM` incorporadas al proyecto. En particular, el MVP incluye:

- administrador central, perfiles, despliegues y operaciones;
- usuarios, equipos, roles, permisos y configuracion;
- agentes LangGraph JavaScript y Python y automatizaciones;
- contactos, pipelines, oportunidades y tareas;
- chat multicanal y continuidad entre agente y asesor;
- calendario y sincronizacion externa;
- formularios y respuestas;
- catalogos, variantes, inventario, servicios y alquileres;
- cotizaciones, documentos, facturacion y pagos;
- reportes base y configurables;
- CI/CD, seguridad, observabilidad, backups, restauracion y recuperacion.

Una necesidad nueva que no aparezca en esas fuentes pasa por control de alcance. No se incorpora automaticamente al MVP por guardar relacion tematica con un modulo.

## Interpretacion de listo para piloto

`Listo para piloto` significa que el cliente puede usar el producto con datos y efectos reales dentro de los proveedores seleccionados. Exige:

- interfaces, APIs, workers e integraciones reales;
- permisos y aislamiento aplicados en servidor;
- migraciones y datos persistentes;
- proveedores productivos o sandboxes aprobados segun la prueba;
- errores, estados vacios, reintentos y recuperacion visibles;
- despliegue reproducible por digest y configuracion separada;
- monitoreo, alertas, auditoria y soporte operativo;
- respaldo externo y restauracion comprobada;
- documentacion y evidencia de pruebas.

No cuentan como terminados botones sin operacion, rutas vacias, respuestas fijas, datos hardcodeados, mocks, simuladores, pasos manuales ocultos ni confirmaciones de efectos no observados. Los simuladores se permiten en desarrollo y pruebas, pero no sustituyen la integracion elegida para el piloto.

## Fases de construccion

Las fases son secuenciales por dependencia, aunque una rama corta puede preparar trabajo futuro sin declarar terminada la fase. Cada requisito conserva su identificador original.

### 1. Bootstrap tecnico

Crear el monorepo, las siete aplicaciones, paquetes, contratos, bases, autenticacion, configuracion, pruebas, CI/CD, imagenes y observabilidad segun los criterios de [la especificacion del monorepo](../08-arquitectura/monorepo.md).

Trabajo operativo principal: `OPS-01`, `OPS-03`, `OPS-04`, `OPS-07` y `OPS-10` a `OPS-12`. `OPS-02` debe aportar la ficha real antes de instalar el VPS.

Puerta interna: los criterios de bootstrap compilan y se verifican, sin presentar todavia funciones comerciales como terminadas.

### 2. Plataforma Quantum

Implementar `ADM-01` a `ADM-20` y completar la operacion necesaria de `OPS-02`, `OPS-05`, `OPS-06`, `OPS-08`, `OPS-09`, `OPS-13` a `OPS-15` y `OPS-17` a `OPS-23`.

Puerta interna: Quantum puede registrar infraestructura, crear dos perfiles aislados, aprovisionarlos, observarlos y ejecutar una operacion tipada sin shell arbitrario.

### 3. Base del CRM

Implementar `USR-01` a `USR-11` y `CFG-01` a `CFG-14`.

Puerta interna: administrador, supervisor y asesor tienen identidades y alcances comprobados; la empresa conserva configuracion tipada, versionada y separada de secretos.

### 4. Nucleo comercial

Implementar `CON-01` a `CON-14`, `PIPE-01` a `PIPE-15` y `TAR-01` a `TAR-16`.

Puerta interna: un usuario autorizado puede llevar un contacto desde captura hasta oportunidad y seguimiento, con historial, concurrencia y permisos reales.

### 5. Interaccion inteligente

Implementar `BASE-01` a `BASE-06`, `CHAT-01` a `CHAT-21` y completar `OPS-16`.

Puerta interna: un canal seleccionado intercambia mensajes reales; agentes JavaScript y Python superan el contrato; la toma humana impide respuestas o seguimientos simultaneos y conserva contexto.

`BASE-04`, `BASE-05`, `CHAT-03` y `CHAT-06` conservan abiertas las subtareas que dependan de modulos posteriores. Una puerta interna no permite marcarlos completos antes de que sus acciones reales existan.

### 6. Agenda y captura

Implementar `CAL-01` a `CAL-19` y `FORM-01` a `FORM-20`. Conectar sus eventos y acciones con chat, agentes y automatizaciones.

Puerta interna: disponibilidad, reservas, sincronizacion externa, formularios publicados y respuestas vinculadas funcionan sin duplicados.

### 7. Oferta comercial

Implementar `CAT-01` a `CAT-30`, incluidas variantes, inventario, servicios, alquileres y contexto dinamico para agentes.

Puerta interna: ventas, servicios y alquileres aplican reglas distintas de disponibilidad y el agente consulta la estructura configurada, no campos programados especialmente.

### 8. Cierre comercial

Implementar `DOC-01` a `DOC-37`, incluyendo editor, plantillas, PDF, aceptacion versionada, facturacion, cuotas, pagos y permisos del agente.

Puerta interna: una cotizacion aceptada produce una factura coherente y los pagos se registran o concilian sin duplicar efectos.

### 9. Analisis

Implementar `REP-01` a `REP-26` y cerrar las consultas de agentes y automatizaciones que dependan de reportes.

Puerta interna: los tableros configurables coinciden con datos conocidos, no duplican conteos y respetan alcance y frescura.

### 10. Preparacion del piloto

Completar integraciones cruzadas, pruebas de rendimiento y seguridad, migraciones, observabilidad, runbooks, objetivos de servicio, backup externo, restauracion aislada y `OPS-24`.

Puerta interna: todas las casillas principales, subtareas y comprobaciones integradas tienen evidencia; no quedan excepciones vencidas, funciones ocultas ni diferencias documentales.

### 11. Liberacion

Desplegar al cliente piloto la misma release validada por digest, cargar solo datos autorizados, ejecutar smoke productivo y activar soporte y alertas.

Esta es la unica fase que permite declarar el MVP entregado.

## Dependencias cruzadas

Asignar un requisito a una fase indica donde comienza su responsabilidad principal, no permite cerrarlo antes de sus consumidores:

- automatizaciones permanecen abiertas hasta conectar todas las acciones prometidas;
- herramientas de agentes permanecen abiertas hasta que catalogo, documentos, calendario y reportes existan;
- chat permanece abierto hasta conectar formularios, archivos, plantillas y estados del proveedor elegido;
- reportes permanecen abiertos hasta medir todos los modulos incluidos;
- administrador y despliegues permanecen abiertos hasta operar la release completa;
- backups no cierran hasta restaurar datos, archivos, identidad y configuracion de forma comprobada.

Las capacidades incompletas se protegen con feature flags en interfaz, API, workers y herramientas de agentes. Ocultar una pantalla no equivale a terminarla.

## Decisiones de proveedor con fecha limite funcional

Estas elecciones son deliberadamente diferidas, pero tienen una condicion objetiva de cierre:

El almacenamiento de objetos ya fue resuelto por [ADR-0013](../06-decisiones/ADR-0013-archivos-almacenamiento-objetos.md): SeaweedFS dentro del VPS, buckets privados por perfil, cuarentena ClamAV, objetos inmutables, URLs firmadas breves y borrado durable.

| Decision | Debe resolverse antes de | Evidencia requerida |
|---|---|---|
| VPS, region y sistema operativo | Instalar staging o produccion | Ficha `OPS-02`, acceso y capacidad verificados |
| Canales y cuentas iniciales | Completar `CFG-04`, `CHAT-04` y `CHAT-05` | Matriz de canales, sandbox, webhooks, limites, costos y datos permitidos |
| Agente productivo JavaScript o Python | Activar el primer canal real | Endpoint, contrato, permisos, evaluacion y procedimiento de escalamiento |
| Calendario externo | Completar `CAL-19` | OAuth, recurrencia, zonas horarias, conflictos, webhooks y sandbox |
| Correo y notificaciones | Enviar invitaciones, avisos o documentos reales | Identidad remitente, entrega, rebotes, plantillas y limites |
| Pasarela de pagos | Completar `DOC-27` a `DOC-31` | Pais, monedas, sandbox, firmas, conciliacion, reembolsos y costos |
| Proveedor fiscal y pais, si se habilita facturacion electronica | Presentarla como capacidad disponible | Requisitos legales, numeracion, impuestos, firma, anulacion y ambiente de pruebas |
| Backend de observabilidad | Desplegar staging persistente | Capacidad o contrato, retencion, residencia, alertas y control de acceso |
| Objetivos SLO, RPO y RTO | Aceptar datos reales del piloto | Valores, ventanas, responsables y runbooks aprobados |

WhatsApp es obligatorio si se pretende cerrar `CHAT-05`; la matriz de canales define el conjunto finito adicional que representa `multicanal`. No se interpreta el requisito como compatibilidad con todos los proveedores existentes.

Aunque el agente productivo use un solo lenguaje, `BASE-01` exige que un agente JavaScript y otro Python superen la misma prueba contractual.

## Recorrido final obligatorio

La aceptacion conecta todo el producto:

1. Quantum registra el VPS, publica una release y crea dos perfiles aislados desde el administrador.
2. Se configura la empresa piloto, usuarios, equipos, roles, permisos, horarios, moneda, impuestos, campos, etiquetas y canales.
3. Se conectan el agente LangGraph, calendario externo, canal, correo y pasarela seleccionados; si se habilita facturacion electronica, tambien su proveedor fiscal aprobado.
4. Se configura un catalogo con productos, servicios, variantes, inventario y un recurso de alquiler con disponibilidad.
5. Entra una conversacion real; el CRM identifica o crea el contacto y conserva mensajes y archivos.
6. El agente consulta informacion autorizada, envia un formulario, interpreta la respuesta y crea una oportunidad.
7. Una automatizacion asigna asesor, crea tareas y agenda una cita sin duplicar efectos.
8. El asesor toma la conversacion; se bloquean respuestas y seguimientos del agente, se realizan cambios y posteriormente se reactiva con el contexto actualizado.
9. Se genera una cotizacion versionada con productos, impuestos y diseno; el cliente la recibe, comenta, acepta o rechaza.
10. Una cotizacion aceptada se convierte en factura; se registran pagos parciales y finales y se concilian sin duplicados.
11. Los reportes reflejan conversaciones, agentes, contactos, oportunidades, tareas, agenda, documentos, inventario y pagos respetando permisos.
12. Quantum actualiza solo un perfil, despues ejecuta una promocion global controlada y verifica que configuraciones y datos particulares sobreviven.
13. Se provoca un fallo controlado, se comprueba el rollback compatible y se restaura un respaldo en un entorno aislado.
14. Se valida aislamiento entre los dos perfiles, auditoria, alertas, rendimiento, seguridad y ausencia de secretos o datos sensibles en telemetria.

Este recorrido no reemplaza las comprobaciones individuales y por seccion de [trabajo.md](trabajo.md).

## Puerta final de liberacion

El MVP solo puede pasar a cliente piloto cuando existe evidencia de todo lo siguiente:

- los 249 requisitos de producto tienen su casilla principal y todas sus subtareas completas;
- `OPS-01` a `OPS-24` estan completos;
- todas las comprobaciones integradas por seccion y el recorrido final pasan;
- las siete aplicaciones y procesos auxiliares usan la release aprobada por digest;
- no quedan migraciones, artefactos contractuales ni configuraciones pendientes;
- los proveedores elegidos funcionan en sus entornos previstos y sus fallos son recuperables;
- dos perfiles demuestran aislamiento de datos, archivos, identidades, colas, secretos y agentes;
- permisos, idempotencia, concurrencia, reintentos y toma humana superan pruebas de riesgo;
- pruebas unitarias, integracion, contratos, arquitectura, E2E, seguridad y rendimiento estan aprobadas;
- observabilidad, alertas y runbooks estan activos;
- un respaldo externo se restaura y valida en aislamiento;
- los objetivos SLO, RPO y RTO y la respuesta a incidentes estan aprobados;
- no existen secretos, datos sensibles o mocks de entrega en repositorio, imagenes, logs o artefactos;
- estado, checklist, contratos, notas de release y evidencia describen el mismo resultado.

Una excepcion temporal de seguridad u operacion debe tener propietario, mitigacion y vencimiento y no puede contradecir una condicion esencial de aislamiento, integridad o recuperacion.

## Estrategia de planificacion

Este alcance contiene subsistemas independientes y no debe convertirse en un unico plan de implementacion ni en una rama de larga vida. Cada fase se descompone en planes pequenos por recorrido o capacidad, con un requisito activo, pruebas y cierre verificable.

El orden de las fases es la ruta de integracion; no impide preparar decisiones diferidas justo antes de necesitarlas. Las decisiones pendientes por capacidad se resuelven desde [el backlog documental](documentacion-tecnica.md) antes de implementar el modulo correspondiente; sus numeros reservados no se tratan como ADR existentes hasta que se aprueben y registren.

## Riesgos aceptados y mitigacion

| Riesgo | Mitigacion obligatoria |
|---|---|
| El alcance integral retrasa la validacion con el piloto | Demostraciones internas por fase sin llamarlas MVP ni usar datos reales antes de los controles |
| Integraciones externas bloquean funciones tardias | Matrices de proveedor y sandboxes resueltos antes de cada fecha limite funcional |
| Varias areas avanzan sin integrarse | Recorridos verticales internos y checks contractuales en cada fase |
| Se marca avance por cantidad y no por comportamiento | Definicion de terminado, evidencia y casillas solo al completar subtareas |
| Feature flags ocultan deuda | Inventario de flags con propietario, estado y condicion de retiro |
| Datos reales llegan antes de continuidad y privacidad | Prohibir admision del piloto hasta aprobar backup, restore, retencion, acceso y respuesta a incidentes |

## Cambio de alcance

Cambiar esta definicion requiere aprobacion explicita del propietario y actualizar este documento, las funcionalidades y el plan cuando corresponda. Reordenar trabajo no elimina requisitos. Una nueva necesidad no se implementa como requisito oculto y una limitacion tecnica no se presenta como exclusion aprobada.
