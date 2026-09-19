# PROY-022 - Fichas de implementacion por requisito

> Esta ficha es un plan derivado. El alcance, el estado y el cierre oficiales viven en las fuentes enlazadas; sus casillas no sustituyen `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `PROY-022`
- Requisitos relacionados: ninguno
- Fase: preparacion documental
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: sistema documental y flujo de trabajo existentes
- Bloquea a: ninguna entrega; prepara futuras implementaciones
- ADR, arquitectura o diseno aplicables: no requiere una decision estructural nueva

## Resultado esperado

Cada implementacion relevante puede prepararse y cerrarse con una ficha rastreable al requisito original, sin crear otra fuente de alcance, estado o terminado.

## Lectura obligatoria aplicada

- [x] [`docs/README.md`](../../README.md)
- [x] [`docs/02-plan/mvp-piloto.md`](../mvp-piloto.md)
- [x] [`docs/02-plan/trabajo.md`](../trabajo.md)
- [x] [`docs/04-proceso/estado.md`](../../04-proceso/estado.md)
- [x] [`docs/04-proceso/flujo-de-trabajo.md`](../../04-proceso/flujo-de-trabajo.md)
- [x] [`docs/05-reglas/04-documentacion-y-cambios.md`](../../05-reglas/04-documentacion-y-cambios.md)

## Auditoria del trabajo existente

- Busquedas realizadas: `rg "PROY-022|docs/02-plan/tareas|plantillas/tarea" .`
- Codigo o documentacion encontrados: plantilla basica de tarea, flujo, reglas de documentacion y fuentes de verdad.
- Pruebas e historial encontrados: no existe codigo de producto; el estado acredita la preparacion documental previa.
- Decision: ampliar y conectar lo existente; no duplicar el checklist ni crear identificadores `TASK-NNN`.

## Alcance

### Incluido

- Crear la guia de fichas de implementacion.
- Ampliar la plantilla de tarea.
- Integrar las fichas con el sistema documental, el flujo y `AGENTS.md`.
- Definir condiciones de uso, trazabilidad, mantenimiento y cierre.

### No incluido

- Implementar funcionalidades del CRM.
- Crear un sistema de orquestacion de agentes.
- Cambiar el alcance o las fases del MVP.
- Introducir una herramienta externa de gestion de tareas.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Ninguno |
| Contratos y eventos | Ninguno |
| Datos y migraciones | Ninguno |
| Permisos y aislamiento | Ninguno |
| Configuracion y secretos | Ninguno |
| Observabilidad y operacion | Ninguno |
| Documentacion | Guia, plantilla, flujo, reglas e instrucciones del repositorio |

## Plan de implementacion

- [x] Definir la autoridad y el ciclo de vida de las fichas.
- [x] Ampliar la plantilla con auditoria, impacto, plan, riesgos y evidencia.
- [x] Integrar el uso de la ficha en el flujo de trabajo.
- [x] Prohibir que la ficha duplique o suplante las fuentes canonicas.
- [x] Incorporar su lectura y cierre en `AGENTS.md`.
- [x] Ejecutar verificaciones documentales y registrar el cierre.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Crear un segundo backlog | Reutilizar el ID original y enlazar las fuentes canonicas | No existen IDs `TASK-NNN` |
| Estado contradictorio | Mantener el estado solo en `estado.md` | La plantilla enlaza el estado oficial |
| Planes abandonados | Actualizarlos ante desviaciones y completar evidencia al cerrar | Flujo y reglas lo exigen |
| Burocracia para cambios triviales | Hacer la ficha opcional para cambios documentales o mecanicos pequenos | Excepcion delimitada en la guia |

## Criterios de aceptacion

- [x] Existe una guia que explica cuando y como crear una ficha.
- [x] La plantilla obliga a revisar trabajo existente antes de proponer codigo.
- [x] La plantilla cubre dependencias, impacto, riesgos, recuperacion, pruebas y evidencia.
- [x] `AGENTS.md` y el flujo incorporan las fichas sin alterar las fuentes de verdad.
- [x] No se adopta el modelo de orquestacion de agentes del documento analizado.
- [x] Los enlaces, formato y ausencia de secretos se verifican localmente.

## Plan de verificacion

- Formato: `git diff --check`.
- Enlaces: comprobar los enlaces Markdown relativos de los documentos modificados.
- Trazabilidad: buscar `PROY-022`, referencias a `docs/02-plan/tareas` y posibles IDs `TASK-NNN`.
- Seguridad: revisar patrones de secretos en los archivos agregados o modificados.
- Comprobacion manual: confirmar que la ficha no declara alcance, estado ni terminado por encima de los documentos canonicos.

## Recuperacion

El cambio es documental y reversible. Si el proceso añade friccion sin mejorar trazabilidad, se ajustan la guia y la plantilla conservando esta ficha como evidencia de la decision original.

## Evidencia de cierre

- Archivos, commits o PR: `docs/02-plan/tareas/README.md`, `docs/07-plantillas/tarea.md`, `docs/04-proceso/flujo-de-trabajo.md`, `docs/05-reglas/04-documentacion-y-cambios.md`, `docs/README.md`, `AGENTS.md` y `docs/04-proceso/estado.md`; no existe remoto ni PR.
- Comandos y resultados: `git diff --check` sin errores; 52 archivos Markdown comprobados sin enlaces relativos rotos; busqueda de IDs paralelos sin coincidencias reales; patrones comunes de secretos sin hallazgos en archivos cambiados.
- Documentacion actualizada: guia de fichas, plantilla, flujo, regla documental, indice del sistema, instrucciones y estado.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: ninguno; `docs/02-plan/trabajo.md` no cambia porque `PROY-022` es una mejora interna sin comportamiento de producto.
