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

No hay trabajo en curso. Antes de empezar una tarea, agregar una fila con estado `EN_CURSO`.

| ID | Descripcion | Responsable | Rama o PR | Inicio | Ultima actualizacion | Siguiente paso |
|---|---|---|---|---|---|---|

## Bloqueado

| ID | Descripcion | Bloqueo | Responsable | Desde | Condicion para continuar |
|---|---|---|---|---|---|
| PROY-002 | Seleccionar la arquitectura de aplicacion | Faltan decisiones de stack y limites del primer lanzamiento | Por asignar | 2026-09-16 | Aprobar MVP y ADR inicial |
| OPS-02 | Validar el VPS | No se han proporcionado recursos ni acceso del servidor | Por asignar | 2026-09-16 | Completar la ficha real del VPS |

## Terminado

| ID | Resultado | Fecha | Evidencia | Verificacion |
|---|---|---|---|---|
| PROY-001 | Documentacion base organizada y reglas iniciales creadas | 2026-09-16 | `README.md`, `AGENTS.md`, `docs/` | Estructura y referencias verificadas localmente |

## Decisiones pendientes

- Alcance exacto del MVP y sus fases.
- Stack de frontend, API, workers y acceso a datos.
- Proveedores iniciales de canales, calendario, pagos y facturacion fiscal.
- Recursos, sistema operativo y acceso del VPS.
- Objetivos de rendimiento, disponibilidad, respaldo y recuperacion.

## Regla de mantenimiento

Una fila activa se actualiza cuando cambia el estado o al finalizar una sesion de trabajo. Al cerrar, se elimina de `En curso`, se agrega a `Terminado` con evidencia y se actualizan las casillas correspondientes del checklist.
