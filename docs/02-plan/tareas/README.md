# Fichas de implementacion

Esta carpeta contiene los planes ejecutables de cada trabajo. Una ficha traduce un requisito aprobado a una secuencia concreta de cambios, riesgos y verificaciones antes de escribir codigo.

## Autoridad y limites

Las fichas son documentos derivados. No crean alcance ni reemplazan las fuentes de verdad:

- `docs/01-producto/funcionalidades.md` define el comportamiento esperado.
- `docs/02-plan/mvp-piloto.md` define el alcance y las fases del MVP.
- `docs/02-plan/trabajo.md` define subtareas y comprobaciones.
- `docs/04-proceso/estado.md` registra el estado vigente y la evidencia final.
- los ADR y `docs/08-arquitectura/` definen las decisiones tecnicas aprobadas.

Si una ficha discrepa con una fuente de verdad, se detiene el trabajo y se corrige la fuente correspondiente. No se cambia el alcance silenciosamente dentro de la ficha.

## Cuando es obligatoria

Se crea una ficha antes de programar cuando el trabajo:

- cambia comportamiento de producto;
- modifica contratos, datos, migraciones, permisos o aislamiento;
- toca una integracion externa, despliegue o recuperacion;
- afecta mas de un modulo o aplicacion;
- necesita varias etapas, una estrategia de compatibilidad o una recuperacion explicita.

Para una correccion documental o mecanica pequena puede bastar el registro en `estado.md`, siempre que el alcance y la verificacion sean evidentes. Ante la duda, se crea la ficha.

## Identificacion y nombre

- Se reutiliza el identificador funcional, operativo o `PROY-NNN` ya asignado.
- No se crea una numeracion paralela como `TASK-NNN`.
- El archivo usa `<ID>-<descripcion-corta>.md`, por ejemplo `CON-04-crear-editar-contactos.md`.
- Si un requisito exige varias fichas independientes, se conserva el ID y se agrega un sufijo descriptivo, por ejemplo `CON-04-a-api-contactos.md` y `CON-04-b-interfaz-contactos.md`.
- Cada ficha enumera todos los requisitos relacionados, pero declara uno como principal.

## Ciclo de vida

1. Copiar [`../../07-plantillas/tarea.md`](../../07-plantillas/tarea.md) cuando el requisito este preparado.
2. Completar lectura, auditoria del trabajo existente, dependencias, alcance, impacto, plan, riesgos y verificacion.
3. Registrar el trabajo como `EN_CURSO` en [`../../04-proceso/estado.md`](../../04-proceso/estado.md) y enlazar la ficha en la fila.
4. Mantener la ficha al dia cuando aparezca una diferencia relevante entre el plan y la implementacion.
5. Antes de cerrar, completar la evidencia, ejecutar las verificaciones y actualizar las fuentes de verdad afectadas.
6. Conservar la ficha cerrada para que una persona o agente futuro pueda entender que se hizo y por que, sin tener que reconstruir la sesion original.

Las casillas de una ficha controlan su plan local. Nunca sustituyen las casillas canonicas de `trabajo.md` ni autorizan marcar un requisito como terminado.

