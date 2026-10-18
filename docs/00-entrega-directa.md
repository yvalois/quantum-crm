# Entrega directa

> Regla operativa vigente desde 2026-10-18. Sustituye, para el trabajo cotidiano de todos los modulos, la preparacion documental y las matrices extensas conservadas en `99-archivo/`. No elimina la proteccion de datos, identidad, aislamiento por perfil, secretos ni integridad del VPS.

## El flujo unico

1. **Cambios solicitados**: identificar lo que el propietario pidio y revisar solamente la implementacion relacionada para no duplicarla.
2. **Hacer el cambio**: entregar la ruta completa que fue solicitada (interfaz, comportamiento real, datos o integracion cuando correspondan) y subirla al VPS si el propietario pide que quede activa.
3. **Entrega**: comprobar solo el resultado pedido en la ruta real y comunicar que ya esta activo. Una linea breve en `estado.md` basta si hay algo que registrar.

No son pasos cotidianos obligatorios: fichas de tarea, ADR, checklist exhaustivo, cobertura, pruebas unitarias/integracion/E2E generales, lint, typecheck, build repetido, CI, PR, documentacion extensa, refactorizacion o auditorias que el propietario no haya pedido.

## Minimos que no se omiten

Solo se aplica el minimo ligado directamente al tipo de cambio:

| Cambio solicitado | Minimo necesario |
| --- | --- |
| Vista, diseno o texto | Ver la pantalla/ruta solicitada. |
| Funcion de producto | Ejecutar el caso que el propietario pidio. |
| Datos o migracion | No destruir ni mezclar datos de perfiles; usar una migracion controlada si cambia el esquema. |
| Acceso, usuario o permisos | Comprobar que el acceso real no concede datos de otro usuario o perfil. |
| Archivo, mensaje, pago o proveedor | Evitar duplicar el efecto y confirmar el resultado real, no uno supuesto. |
| Despliegue | Servicio listo y ruta solicitada disponible. |

Si un control no tiene relacion directa con el cambio solicitado, se difiere. No se amplian requisitos, no se reabre una auditoria y no se detiene una entrega por trabajo de estabilizacion no pedido.

## Chat, pipelines y demas modulos

Se aplica la misma regla a todos los componentes. Ejemplos:

- Si se pide que un audio se reproduzca: recibir o abrir un audio real y comprobar el reproductor.
- Si se pide reasignar un chat: reasignarlo y confirmar la visibilidad del asesor indicada.
- Si se pide un filtro de pipeline: usar el filtro solicitado y comprobar el resultado.
- Si se pide un agente: probar el mensaje, respuesta, memoria o pausa que se haya solicitado, sin ejecutar una matriz completa de agente.

La entrega se considera lista cuando el cambio solicitado funciona en el VPS. Los documentos historicos solo se consultan si el cambio afecta directamente seguridad, datos, aislamiento, secretos o recuperacion.
