# Sistema documental de Quantum CRM

Esta carpeta separa alcance, plan, operacion, estado y reglas para que cada dato tenga una sola autoridad.

## Fuentes de verdad

| Tema | Archivo autorizado | Funcion |
|---|---|---|
| Comportamiento esperado | `01-producto/funcionalidades.md` | Define que debe hacer Quantum CRM |
| Descomposicion del trabajo | `02-plan/trabajo.md` | Contiene requisitos, subtareas y comprobaciones |
| Infraestructura y despliegue | `03-operaciones/despliegues.md` | Define el trabajo operativo `OPS` |
| Estado vigente y evidencia | `04-proceso/estado.md` | Indica que esta activo, bloqueado o terminado |
| Forma de trabajar | `04-proceso/flujo-de-trabajo.md` | Define el ciclo de una tarea |
| Criterio de cierre | `04-proceso/definicion-de-terminado.md` | Impide cierres parciales o sin pruebas |
| Reglas de ingenieria | `05-reglas/` | Establece practicas obligatorias |
| Git y GitHub | `05-reglas/05-git-y-github.md` | Define ramas, commits, PR, merges y recuperacion |
| Decisiones estructurales | `06-decisiones/` | Conserva las razones mediante ADR |

No se deben crear listas paralelas de funcionalidades o estados. Los tableros externos, si se usan, deben referenciar los mismos identificadores y reflejar este repositorio.

## Orden de consulta

1. Buscar el identificador en `01-producto/funcionalidades.md`.
2. Leer todas sus subtareas en `02-plan/trabajo.md`.
3. Si afecta infraestructura, revisar `03-operaciones/despliegues.md`.
4. Consultar `04-proceso/estado.md` para saber si alguien ya trabaja en ello o si existe evidencia de cierre.
5. Buscar implementacion y pruebas con `rg "IDENTIFICADOR" .` y por los conceptos funcionales relacionados.
6. Aplicar las reglas y la definicion de terminado.

## Resolucion de diferencias

- Funcionalidades decide el comportamiento de producto aprobado.
- Un ADR aprobado decide la arquitectura dentro de ese alcance.
- El checklist decide las comprobaciones necesarias, pero no puede reducir silenciosamente el alcance funcional.
- Estado registra hechos actuales y siempre debe enlazar evidencia.
- Una necesidad nueva se agrega primero a funcionalidades y despues al checklist; no se implementa como requisito oculto.

## Procedencia inicial

Los tres documentos base fueron importados el 2026-09-16 sin eliminar los originales de `Downloads`.

| Destino | SHA-256 del archivo de origen |
|---|---|
| `01-producto/funcionalidades.md` | `35486755101A6425E9C9AAFCEDD0F2940B64451A48BDC799D5A3A84BCAA210D7` |
| `02-plan/trabajo.md` | `C9A514970821CC864F9DCEF1FBF3C6D441A1C0A3311B03075C4EE481B10210C3` |
| `03-operaciones/despliegues.md` | `2280A93B62D5B18112758771BD9F8BF7C50BDA37BAD85049643736B30DC0C346` |

El hash del checklist corresponde a su version importada; la copia de trabajo puede cambiar al registrar avances.
