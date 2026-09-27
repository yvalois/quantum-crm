# Flujo de trabajo

## Estados permitidos

| Estado | Significado |
|---|---|
| `PENDIENTE` | El requisito existe, pero no esta preparado ni asignado |
| `LISTO` | Alcance, dependencias y aceptacion estan claros |
| `EN_CURSO` | Hay una persona o agente trabajando activamente |
| `BLOQUEADO` | Existe una condicion concreta que impide avanzar |
| `EN_REVISION` | La implementacion termino y espera verificacion |
| `HECHO` | Cumple la definicion de terminado y tiene evidencia |
| `DESCARTADO` | Se decidio no realizarlo y existe una decision documentada |

Las casillas del checklist solo distinguen pendiente y hecho. Los estados intermedios viven en `estado.md`.

## Preparacion

1. Elegir un requisito con identificador.
2. Leer el requisito principal, todas sus subtareas y su comprobacion integrada.
3. Revisar dependencias funcionales y operativas.
4. Buscar el identificador, nombres de dominio, rutas, tablas, eventos y pruebas relacionados.
5. Clasificar lo encontrado: inexistente, parcial, funcional con deuda o terminado con evidencia.
6. Si ya funciona, verificarlo y completar el seguimiento; no crear una segunda implementacion.
7. Si falta una decision estructural, crear un ADR antes del codigo irreversible.
8. Crear una ficha desde [`../07-plantillas/tarea.md`](../07-plantillas/tarea.md) cuando se cumplan las condiciones de [`../02-plan/tareas/README.md`](../02-plan/tareas/README.md).
9. Completar en la ficha el impacto, el plan, los riesgos y la verificacion antes de escribir codigo.

## Inicio

- Registrar una fila `EN_CURSO` con responsable, ficha aplicable y siguiente paso.
- Usar una rama corta cuando Git tenga un remoto y flujo colaborativo definidos.
- Mantener un alcance demostrable: un requisito o una rebanada vertical que agrupe requisitos dependientes bajo un unico resultado visible. Cada identificador conserva sus propias casillas y no se marca completo por pertenecer a la rebanada.
- No mezclar arreglos, formato o refactorizaciones ajenos.

## Coordinacion por agentes

Una rebanada grande puede usar tres roles que comparten un solo objetivo, rama y pull request:

| Rol | Responsabilidad | No hace |
| --- | --- | --- |
| Orquestador | Delimita el resultado, entrega contexto, resuelve dependencias, mantiene estado/evidencia, integra cambios y decide la verificacion minima. | Duplicar implementaciones ni ordenar comprobaciones sin una causa tecnica. |
| Desarrollo | Inspecciona lo existente, implementa una sola ruta vertical y sus pruebas afectadas en la rama acordada. Comunica contratos, archivos y decisiones al resto. | Crear una segunda ruta para la misma funcion, cambiar alcance o ejecutar validaciones locales. |
| Testeo | Audita evidencia vigente, comunica criterios y riesgos antes de la implementacion y revisa el cambio contra esos criterios. | Ejecutar por separado pruebas ya cubiertas por la CI o release del mismo commit. |

- El orquestador conecta los mensajes entre roles antes de que desarrollo cierre el cambio; testeo puede preparar los criterios mientras desarrollo inspecciona o implementa, pero solo un agente modifica una misma zona del arbol a la vez.
- Los tres roles registran en la ficha el alcance, contratos reutilizados, pruebas nuevas y evidencia reutilizable. La ficha sigue siendo derivada: `trabajo.md`, `estado.md` y las funcionalidades siguen siendo las autoridades.
- Una rebanada consolidada usa una sola rama corta y un solo PR cuando los cambios pertenecen al mismo recorrido visible. Sus commits internos pueden separar shell, datos, API y pruebas sin disparar CI intermedia.
- La unica matriz completa se ejecuta sobre el commit candidato del PR; tras el merge, la unica release y smoke aplicable se ejecutan sobre el commit integrado. Los resultados se comparten entre los roles y no se repiten si commit, alcance, entorno e inputs no cambiaron.

## Implementacion

- Construir la ruta vertical minima que produzca comportamiento real.
- Mantener el foco en el requisito activo: no interrumpirlo por refinamientos de release, observabilidad, rendimiento, recuperacion, pulido visual o documentacion final, salvo que sean un prerequisito tecnico concreto de esa ruta.
- Reutilizar servicios y componentes existentes cuando sus contratos sean correctos.
- Validar entradas y permisos en el servidor.
- Agregar pruebas mientras se implementa, no despues del cierre.
- Actualizar documentacion cuando cambien contratos, configuracion u operacion.
- Actualizar la ficha cuando la implementacion se aparte materialmente del plan; una desviacion de alcance se resuelve primero en la fuente de verdad correspondiente.

## Revision y cierre

1. Transferir el commit candidato al VPS y ejecutar una sola vez las pruebas automaticas y comprobaciones manuales pertinentes en los lugares definidos por [`15-ejecucion-verificaciones-vps.md`](../05-reglas/15-ejecucion-verificaciones-vps.md); nunca en el equipo local. El push a GitHub ocurre despues de esa evidencia.
2. Revisar seguridad, aislamiento, errores, idempotencia y observabilidad segun el riesgo.
3. Cumplir `definicion-de-terminado.md`.
4. Registrar archivos, pruebas, comandos y resultados como evidencia.
5. Completar la evidencia y los pendientes de la ficha, si existe.
6. Marcar solo las subtareas demostradas; marcar el requisito principal cuando todas esten completas.
7. Mover el registro a `Terminado` y conservar la ficha para trazabilidad.

Un cierre documental no invalida evidencia tecnica vigente. Antes de repetir una comprobacion se compara commit, alcance, entorno y entradas con la evidencia registrada.

## Ficha de implementacion

La ficha conecta un requisito con su ejecucion tecnica, pero no es un backlog ni un registro de estado alternativo. Usa el identificador existente, enlaza las fuentes canonicas y contiene solo el detalle necesario para implementar y verificar ese trabajo.

Es obligatoria para cambios de comportamiento, contratos, datos, migraciones, seguridad, integraciones, despliegue, recuperacion o varios componentes. Puede omitirse en una correccion documental o mecanica pequena cuando `estado.md` ya expresa sin ambiguedad el alcance y la evidencia.

## Correcciones

Una regresion se vincula al requisito original. Si la funcion estaba marcada como terminada y deja de cumplir, se desmarca, se registra el defecto y vuelve a `EN_CURSO` o `BLOQUEADO`. El historial no se borra; se agrega la nueva evidencia.
