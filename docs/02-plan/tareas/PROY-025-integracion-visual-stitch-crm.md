# PROY-025 - Integracion visual de Stitch en crm-web

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `PROY-025` (trabajo interno de interfaz).
- Requisitos relacionados: `CHAT-01` a `CHAT-21`, `CON-01` a `CON-14`, `PIPE-01` a `PIPE-15`, `TAR-01` a `TAR-16` y `USR-01` a `USR-06`.
- Fase del MVP: rebanadas verticales visibles previas al piloto.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: funcionalidades existentes de `crm-web` y referencia visual aprobada.
- Bloquea a: presentacion del producto al cliente piloto.
- ADR, arquitectura o diseno aplicables: [ADR-0014](../../06-decisiones/ADR-0014-arquitectura-frontends-sistema-visual.md) y [Frontends y referencia visual](../../08-arquitectura/frontends-experiencia-visual.md).

## Resultado esperado

Las rutas funcionales de `crm-web` usan de forma consistente el sistema visual **Quantum Precision** de Stitch: navegacion completa, jerarquia, densidad, colores, tipografia, componentes, estados y comportamiento responsive, sin sustituir datos reales por mocks ni presentar modulos pendientes como terminados.

## Lectura obligatoria aplicada

- [x] Requisitos en `docs/01-producto/funcionalidades.md`.
- [x] Fases y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `rg -n -i "stitch|sistema visual|crm-shell" docs apps packages` y revision del proyecto Stitch **Quantum CRM Enterprise Platform**.
- Codigo o documentacion encontrados: estilos parciales independientes en `globals.css`, shells duplicados en cinco pantallas, tablero de oportunidades y tareas inspirados parcialmente en Stitch.
- Pruebas e historial encontrados: builds y recorridos anteriores acreditan comportamiento; no existe evidencia de una integracion visual completa de `crm-web`.
- Decision de reutilizacion, extension o reemplazo: conservar casos de uso, BFF, contratos y componentes funcionales; centralizar la navegacion y reemplazar la capa visual duplicada.

## Alcance

### Incluido

- Shell compartido de `crm-web` alineado con Stitch.
- Dashboard real basado en las APIs existentes.
- Rutas funcionales actuales: conversaciones, contactos, oportunidades, tareas y equipo.
- Navegacion visible de los 13 modulos con estado honesto para los aun no implementados.
- Responsive, foco visible y estados de carga/error/vacio existentes.

### No incluido

- Implementar comportamiento nuevo de calendario, formularios, catalogo, documentos, automatizaciones, reportes o agente.
- Copiar datos ficticios del prototipo al entorno funcional.
- Cambiar contratos, persistencia, permisos, aislamiento o autenticacion.

## Impacto tecnico

| Area                       | Impacto previsto                              |
| -------------------------- | --------------------------------------------- |
| Aplicaciones y modulos     | `apps/crm-web`                                |
| Contratos y eventos        | Sin cambios                                   |
| Datos y migraciones        | Sin cambios                                   |
| Permisos y aislamiento     | Se conservan controles existentes             |
| Configuracion y secretos   | Sin cambios                                   |
| Observabilidad y operacion | Nueva imagen de `crm-web` y smoke autenticado |
| Documentacion              | Estado, ficha y referencia visual             |

## Plan de implementacion

- [x] Crear shell y navegacion compartidos con los tokens de Quantum Precision.
- [x] Incorporar dashboard y mover la administracion del equipo a su ruta propia.
- [x] Integrar todas las rutas funcionales existentes sin duplicar su logica.
- [x] Validar el candidato en el VPS y desplegar la misma imagen aprobada.
- [x] Comprobar visualmente el recorrido autenticado y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo                                         | Mitigacion                                          | Verificacion                         |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Romper acciones existentes al cambiar el shell | No modificar handlers ni contratos                  | Suite afectada y smoke autenticado   |
| Presentar modulos pendientes como funcionales  | Mostrar su estado como proximo, sin enlaces activos | Revision visual y semantica          |
| Regresion responsive                           | Navegacion adaptable y anchos fluidos               | Smoke en escritorio y viewport movil |

## Criterios de aceptacion

- [x] El CRM desplegado refleja la direccion visual de Stitch en todas sus rutas actuales.
- [x] No hay navegacion duplicada ni elementos repetidos.
- [x] Las funciones actuales conservan sus handlers, contratos y almacenamiento existentes.
- [x] Los modulos no implementados se distinguen claramente.
- [ ] El candidato validado en VPS se publica mediante PR sin checks fallidos.

## Plan de verificacion

- Pruebas unitarias: reutilizar suite afectada; agregar solo si aparece logica nueva aislable.
- Pruebas de integracion o contratos: no cambian contratos.
- Pruebas E2E: recorrido autenticado de dashboard y rutas funcionales.
- Comprobacion manual: comparacion con las pantallas `Quantum CRM` del proyecto Stitch.
- Seguridad, permisos y aislamiento: confirmar que el shell no expone capacidades ni datos nuevos.
- Idempotencia, concurrencia y recuperacion: no aplica a la capa visual; rollback al digest anterior de `crm-web`.
- Comandos que deben aprobar: formato/lint/tipos de `crm-web`, pruebas afectadas y build en el VPS.

## Recuperacion

- Compatibilidad o migracion: cambio aditivo sin migracion.
- Rollback de aplicacion: restaurar el digest anterior de `crm-web`.
- Recuperacion de datos, si aplica: no aplica.

## Evidencia de cierre

- Archivos, commits o PR: implementacion base `909662b`, integrada en `main` mediante PR #74; refinamiento del sidebar en el candidato `2395632` de la rama `feat/CAL-01-18-calendar-booking` (PR #75). Afecta `crm-shell.tsx` y `globals.css` sin cambiar rutas, contratos ni handlers.
- Comandos y resultados: la implementacion base aprobo Prettier, ESLint, tipos y build en el VPS, se desplego por el digest `sha256:67f2b5d3e19ed4a862c415db1b345677d546bb9a0975457b3d3ac0cc36b5992f` y quedo saludable. El refinamiento `2395632` aprobo en el VPS Prettier, ESLint y typecheck de `crm-web`, ademas del build de `crm-web` con sus dependencias. La correccion elimina los controles visuales duplicados causados por estilos heredados, usa iconos SVG consistentes, reduce la densidad de estados pendientes y permite contraer la navegacion en escritorio manteniendo la variante horizontal movil.
- Documentacion actualizada: esta ficha, `docs/04-proceso/estado.md` y `docs/08-arquitectura/frontends-experiencia-visual.md`.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: acreditar los checks del refinamiento en PR #75 y desplegarlo tras su integracion.
