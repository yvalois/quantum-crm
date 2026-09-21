# Ejecucion eficiente de verificaciones

Esta politica evita ejecutar la misma comprobacion varias veces y protege el equipo local del propietario. Complementa las reglas de pruebas, Git, CI/CD y despliegue.

## Equipo local

- El equipo local se usa unicamente para leer y editar archivos y para operaciones de Git que no ejecuten codigo del proyecto.
- No se ejecutan localmente gestores de paquetes, scripts del repositorio, pruebas, lint, typecheck, builds, generadores, Prisma, navegadores E2E, Docker ni Compose.
- `git status`, `git diff`, inspeccion de historial, ramas, commits y push si estan permitidos porque no validan ni ejecutan la aplicacion.
- Ningun resultado producido anteriormente en Node 20 local se usa como evidencia del proyecto.

## Lugares y responsabilidades

| Lugar | Responsabilidad unica |
| --- | --- |
| VPS autorizado de desarrollo o pruebas | Comprobacion afectada que necesita runtime real, PostgreSQL, contenedores, imagenes, migraciones, staging o smoke. |
| GitHub Actions | Suite final completa y controles independientes del pull request. |
| Equipo local | Edicion, revision de diff y Git; nunca ejecucion tecnica del proyecto. |

GitHub Actions no sustituye las comprobaciones operativas que solo puede acreditar el VPS. El VPS no repite manualmente toda la matriz que ejecutara CI.

## Una ejecucion por evidencia

- Antes de ejecutar algo, buscar evidencia del mismo commit, comando o check, entorno y alcance.
- Una evidencia aprobada se reutiliza mientras no cambie ninguna entrada que pueda alterar su resultado.
- La clave minima de evidencia es: commit, alcance, entorno, comando o check y resultado.
- No se repite una comprobacion para obtener tranquilidad adicional, generar una captura distinta o volver a confirmar un resultado ya verde.
- Si una ejecucion falla, se diagnostica el paso fallido; no se reinicia toda la secuencia salvo que el arreglo afecte sus entradas.

## Que invalida evidencia

Repetir solo las comprobaciones directamente afectadas cuando cambie alguno de estos elementos:

- codigo ejecutable o prueba relacionada;
- dependencias o lockfile;
- schema, migracion o datos de fixture relevantes;
- Dockerfile, manifiesto, configuracion o secreto referenciado;
- runtime, motor o entorno que forma parte explicita de la prueba;
- una evidencia anterior incompleta, fallida o asociada a otro commit funcional.

Un cambio exclusivo de documentacion, estado, enlaces o texto del PR no invalida pruebas, builds, imagenes, migraciones, despliegues ni smoke tests ya aprobados. Debe agruparse antes del push final siempre que sea posible.

## Secuencia unica de una entrega

1. Auditar el trabajo existente y definir el alcance afectado.
2. Agrupar implementacion, pruebas y documentacion antes de verificar.
3. Ejecutar en el VPS solo las pruebas afectadas que aporten informacion durante el desarrollo.
4. Corregir en un lote coherente y repetir unicamente lo invalidado.
5. Publicar la rama una vez que codigo y documentacion esten estables.
6. Dejar que GitHub ejecute una sola matriz completa para el commit candidato.
7. Despues de CI verde, construir cada imagen una sola vez, desplegar exactamente sus digests y ejecutar un solo smoke aplicable.
8. Registrar la evidencia y no volver a ejecutar pasos verdes durante el cierre.

## Migraciones, imagenes y staging

- Las migraciones desechables se prueban en PostgreSQL real dentro del VPS y se agrupan en una sola sesion por commit candidato.
- Una imagen se construye una vez por commit funcional aceptado y su digest se reutiliza en smoke, staging y promocion.
- Cambios documentales o de pruebas que no alteren el runtime no autorizan reconstruir ni redesplegar la imagen.
- Staging se modifica una sola vez, despues de las puertas previas aplicables, y se comprueba con readiness y el smoke minimo del cambio.
- No se crean perfiles, releases u otros datos sinteticos en staging cuando un entorno desechable acredita el comportamiento.

## GitHub y seguimiento

- Los commits se consolidan antes del primer push para evitar cancelar y reiniciar CI por cambios previsibles.
- El estado de CI se consulta de forma resumida. No se transmiten logs completos mientras los jobs siguen normalmente.
- Un nuevo push se hace solo para corregir un defecto real o completar evidencia necesaria; no para ajustar texto que pudo incluirse antes.
- Una advertencia no relacionada se registra una vez y no provoca repetir una suite aprobada.

## Excepciones

Solo se repite evidencia vigente cuando existe una razon tecnica concreta: posible corrupcion, cambio externo relevante, resultado incierto o requisito de recuperacion. La ficha o el estado registra que evidencia se invalido, por que y cual fue la repeticion minima.
