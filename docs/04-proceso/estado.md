# Estado del proyecto

Actualizado: 2026-09-16

Este archivo registra trabajo activo, bloqueos y cierres con evidencia. No sustituye el checklist.

## Resumen

- Fase: preparacion del proyecto.
- Aplicacion implementada: no existe todavia en este repositorio.
- Requisitos funcionales completados: ninguno acreditado.
- Requisitos operativos completados: ninguno acreditado.
- Trabajo activo: ninguno registrado.

## En curso

| ID | Descripcion | Responsable | Rama o PR | Inicio | Ultima actualizacion | Siguiente paso |
|---|---|---|---|---|---|---|

## Bloqueado

| ID | Descripcion | Bloqueo | Responsable | Desde | Condicion para continuar |
|---|---|---|---|---|---|
| PROY-002 | Definir los limites del primer lanzamiento | El stack ya esta aprobado, pero falta seleccionar el alcance exacto del MVP | Por asignar | 2026-09-16 | Aprobar requisitos incluidos y excluidos del MVP |
| PROY-004 | Publicar y proteger el repositorio en GitHub | No existe un remoto `origin` ni se ha definido organizacion, nombre o visibilidad | Por asignar | 2026-09-16 | Crear el repositorio remoto, hacer el primer push y activar el ruleset de `main` |
| OPS-02 | Validar el VPS | No se han proporcionado recursos ni acceso del servidor | Por asignar | 2026-09-16 | Completar la ficha real del VPS |

## Terminado

| ID | Resultado | Fecha | Evidencia | Verificacion |
|---|---|---|---|---|
| PROY-001 | Documentacion base organizada y reglas iniciales creadas | 2026-09-16 | `README.md`, `AGENTS.md`, `docs/` | Estructura y referencias verificadas localmente |
| PROY-003 | Politica de Git y GitHub definida e integrada con las reglas del proyecto | 2026-09-16 | `docs/05-reglas/05-git-y-github.md`, `AGENTS.md`, `.github/pull_request_template.md` | Sin enlaces rotos, sin errores de whitespace y sin remoto configurado |
| PROY-005 | Stack base aprobado y registrado | 2026-09-16 | `docs/06-decisiones/ADR-0001-stack-base.md`, `docs/06-decisiones/README.md` | TypeScript obligatorio para el producto; agentes externos JavaScript o Python; referencias y reglas verificadas |

## Decisiones pendientes

- Alcance exacto del MVP y sus fases.
- Proveedores iniciales de canales, calendario, pagos y facturacion fiscal.
- Recursos, sistema operativo y acceso del VPS.
- Objetivos de rendimiento, disponibilidad, respaldo y recuperacion.

## Regla de mantenimiento

Una fila activa se actualiza cuando cambia el estado o al finalizar una sesion de trabajo. Al cerrar, se elimina de `En curso`, se agrega a `Terminado` con evidencia y se actualizan las casillas correspondientes del checklist.
