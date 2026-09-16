# Documentacion y cambios

## Trazabilidad

- Todo cambio referencia un ID funcional, operativo o `PROY-NNN`.
- El mismo ID aparece en rama, PR, pruebas o registro de estado cuando las herramientas lo permitan.
- La evidencia describe que se verifico y con que resultado; no usa frases vagas como "listo" o "funciona".
- Una casilla marcada debe poder rastrearse hasta codigo, pruebas y verificacion.

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

## Reutilizacion antes de creacion

Antes de agregar un componente, servicio, tabla, endpoint o utilidad:

1. Buscar por ID y por vocabulario del dominio.
2. Revisar implementaciones similares y sus pruebas.
3. Extender el contrato existente si mantiene una responsabilidad coherente.
4. Crear algo nuevo solo si la diferencia es real y queda clara en el nombre y la arquitectura.

Duplicar para avanzar rapido traslada el costo a permisos, errores, migraciones y mantenimiento; por eso requiere justificacion explicita.
