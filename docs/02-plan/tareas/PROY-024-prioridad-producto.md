# PROY-024 - Prioridad de construccion del producto

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificacion

- Requisito principal: `PROY-024` (proceso interno).
- Requisitos relacionados: todos los requisitos de producto y `OPS-01` a `OPS-24`.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: alcance vigente en `mvp-piloto.md` y reglas de ejecucion eficiente.

## Resultado esperado

La documentacion separa con claridad lo que se construye durante cada rebanada funcional de lo que se reserva para la preparacion final del piloto. El diferimiento ordena el trabajo, no elimina alcance ni reduce las condiciones de liberacion.

## Auditoria y decision

- Encontrado: la fase 10 ya concentra rendimiento, recuperacion, observabilidad y liberacion, pero no prohibia de forma explicita interrumpir una rebanada funcional por refinamientos electivos de esas areas.
- Decision: durante la construccion se prioriza una ruta vertical de producto. Solo permanece en cada rebanada la calidad que protege su comportamiento: persistencia, permisos, aislamiento, validacion de servidor, manejo de errores y una verificacion afectada. El resto se ejecuta en su fase final o cuando sea prerequisito real del requisito activo.

## Alcance

- Incluido: `mvp-piloto.md`, `flujo-de-trabajo.md` y `estado.md`.
- No incluido: eliminar requisitos, rebajar la puerta de piloto, desactivar seguridad, omitir migraciones, aislamiento o pruebas afectadas.

## Criterios de aceptacion

- [ ] La lista de trabajo diferible y sus limites aparece en una fuente de plan autorizada.
- [ ] El flujo obliga a no interrumpir una rebanada funcional por refinamientos no necesarios.
- [ ] Estado registra la decision y su aplicacion.

## Verificacion y evidencia de cierre

- PR, revision de enlaces y `git diff --check`: pendiente.
- No requiere ejecucion tecnica: cambio exclusivo de prioridades documentales.
