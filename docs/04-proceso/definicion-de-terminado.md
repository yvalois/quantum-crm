# Definicion de terminado

Un requisito se considera `HECHO` solo cuando cumplen todos los puntos aplicables.

## Comportamiento

- Todas las subtareas del requisito funcionan de extremo a extremo.
- No quedan mocks, respuestas fijas, botones sin operacion real ni rutas vacias dentro del alcance cerrado.
- Los estados vacios, errores, reintentos y limites relevantes tienen comportamiento definido.
- La funcion respeta permisos, cliente, configuracion y zona horaria cuando correspondan.

## Calidad

- El codigo es legible, tipado cuando el lenguaje lo permite y no duplica logica existente.
- Las entradas externas se validan y los errores se manejan sin ocultarlos.
- No se agregan advertencias nuevas de compilacion, tipos, lint o analisis estatico.
- No existen secretos ni datos sensibles en codigo, pruebas o logs.

## Pruebas

- Existen pruebas unitarias para reglas con ramificaciones o calculos.
- Existen pruebas de integracion para base de datos, colas, APIs, permisos e integraciones.
- Existe una prueba de recorrido para el camino critico cuando el requisito cruza modulos.
- Se prueban al menos el caso exitoso, un error relevante y una denegacion de permiso cuando aplique.
- Las pruebas relacionadas y la suite obligatoria pasan de forma reproducible.

## Datos y operacion

- Las migraciones se pueden ejecutar de forma controlada y su compatibilidad esta documentada.
- Operaciones repetibles controlan duplicados e idempotencia.
- Logs y metricas permiten identificar cliente, operacion y error sin exponer secretos.
- La configuracion necesaria tiene valores de ejemplo seguros y documentados.

## Evidencia

- La implementacion y sus pruebas pueden localizarse desde el identificador del requisito o su registro de estado.
- Se registran los comandos de verificacion y su resultado.
- El checklist, el estado y la documentacion afectada estan actualizados.
- La revision confirma que la funcion ya existente fue reutilizada o modificada, no duplicada.
