# Documentacion y cambios

## Trazabilidad

- Todo cambio referencia un ID funcional, operativo o `PROY-NNN`.
- El mismo ID aparece en rama, PR, pruebas o registro de estado cuando las herramientas lo permitan.
- La evidencia describe que se verifico y con que resultado; no usa frases vagas como "listo" o "funciona".
- Una casilla marcada debe poder rastrearse hasta codigo, pruebas y verificacion.
- Una ficha de implementacion usa el ID ya existente; no se crean identificadores paralelos como `TASK-NNN`.

## Cambios pequenos

- Cada cambio resuelve un objetivo principal.
- Las refactorizaciones amplias se separan del comportamiento nuevo salvo necesidad demostrable.
- No se formatea masivamente codigo ajeno dentro de una correccion puntual.
- Se conservan compatibilidad y ruta de migracion cuando el cambio afecta datos o contratos existentes.

## Documentacion viva

- Cambiar una API, variable, evento, migracion, permiso o procedimiento exige actualizar su documentacion en el mismo trabajo.
- Los ejemplos deben ser seguros, reproducibles y no contener datos reales.
- Las decisiones irreversibles o costosas usan ADR.
- Los documentos no afirman que una funcion existe si solo esta diseñada.

## Fichas de implementacion

- Para los cambios definidos en [`../02-plan/tareas/README.md`](../02-plan/tareas/README.md), se completa una ficha antes de escribir codigo usando [`../07-plantillas/tarea.md`](../07-plantillas/tarea.md).
- La ficha enlaza el requisito, fase, checklist, estado, ADR y arquitectura aplicables; no copia listas completas ni se convierte en otra fuente de verdad.
- El estado vigente se modifica solo en `docs/04-proceso/estado.md` y el cierre funcional solo en `docs/02-plan/trabajo.md` cuando exista evidencia suficiente.
- Si el trabajo se aparta materialmente del plan, se registra la desviacion. Si cambia comportamiento o arquitectura, primero se actualiza la fuente canonica o se aprueba el ADR correspondiente.
- La ficha cerrada conserva comandos, resultados, archivos, decisiones y pendientes suficientes para evitar que el trabajo se repita por falta de contexto.

## Reutilizacion antes de creacion

Antes de agregar un componente, servicio, tabla, endpoint o utilidad:

1. Buscar por ID y por vocabulario del dominio.
2. Revisar implementaciones similares y sus pruebas.
3. Extender el contrato existente si mantiene una responsabilidad coherente.
4. Crear algo nuevo solo si la diferencia es real y queda clara en el nombre y la arquitectura.

Duplicar para avanzar rapido traslada el costo a permisos, errores, migraciones y mantenimiento; por eso requiere justificacion explicita.
