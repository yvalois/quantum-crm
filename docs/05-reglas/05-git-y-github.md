# Git y GitHub

Esta politica mantiene un historial comprensible, evita sobrescrituras y establece como se crean, publican, revisan e integran los cambios de Quantum CRM.

## Modelo de ramas

Se utiliza desarrollo basado en `main` con ramas cortas. No se mantiene una rama `develop` permanente.

- `main` siempre debe representar una version integrada y verificable.
- Nadie desarrolla directamente sobre `main` cuando el remoto y su proteccion ya existen.
- Cada cambio se realiza en una rama creada desde `main` actualizado.
- Las ramas viven solo mientras su pull request esta activo y se eliminan despues del merge.
- Las versiones publicadas se identifican con tags; no con ramas permanentes por cliente.
- Una rama `release/*` solo se crea si un proceso de estabilizacion real la necesita y debe tener fecha de retiro.

La unica excepcion a los pull requests es el bootstrap local anterior a la creacion del remoto. La excepcion termina al publicar el repositorio en GitHub.

## Nombres de ramas

Formato:

```text
tipo/IDENTIFICADOR-descripcion-corta
```

Tipos permitidos:

| Tipo | Uso |
|---|---|
| `feat` | Funcionalidad nueva |
| `fix` | Correccion de defecto |
| `hotfix` | Correccion urgente de produccion |
| `refactor` | Cambio interno sin comportamiento nuevo |
| `test` | Pruebas sin cambio funcional |
| `docs` | Documentacion |
| `chore` | Mantenimiento del repositorio |
| `ci` | Automatizacion de integracion o despliegue |

Ejemplos:

```text
feat/CHAT-17-evitar-respuestas-simultaneas
fix/CAL-06-bloquear-reserva-duplicada
docs/PROY-003-flujo-git-github
ci/OPS-10-validaciones-release
```

Usar minusculas en tipo y descripcion, guiones simples y el identificador exacto. No usar nombres personales como `fernando-cambios`, nombres vagos como `prueba`, ni ramas reutilizadas para varios objetivos.

## Inicio seguro de una tarea

Confirmar primero que el arbol de trabajo no contiene cambios inesperados:

```bash
git status --short --branch
```

Actualizar `main` sin crear merges automaticos:

```bash
git switch main
git fetch origin
git pull --ff-only origin main
```

Crear la rama:

```bash
git switch -c feat/CHAT-17-evitar-respuestas-simultaneas
```

Si existen cambios locales antes de crear la rama, no hay que descartarlos: se crea la rama correcta desde el punto actual y luego se revisa el diff.

## Preparacion de commits

Revisar antes de agregar archivos:

```bash
git status --short
git diff
```

Agregar archivos de forma explicita o interactiva:

```bash
git add ruta/al/archivo
git add -p
```

`git add .` no esta prohibido, pero solo se usa despues de revisar todo el arbol. No se debe incluir por accidente configuracion local, archivos generados, respaldos, datos, binarios o cambios ajenos.

Revisar exactamente lo que entrara al commit:

```bash
git diff --staged
git diff --staged --check
```

Cada commit contiene un cambio logico, deja el proyecto en un estado verificable y no mezcla formato masivo con comportamiento.

## Mensajes de commit

Se usa Conventional Commits:

```text
tipo(alcance): descripcion breve (IDENTIFICADOR)
```

Tipos usuales: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf` y `revert`.

Ejemplos:

```text
feat(chat): bloquear respuesta de IA durante toma humana (CHAT-17)
fix(calendar): impedir reservas concurrentes del mismo horario (CAL-06)
docs(process): documentar flujo de GitHub (PROY-003)
test(tenancy): comprobar aislamiento de archivos (BASE-06)
```

Reglas:

- Usar verbo en infinitivo o una descripcion consistente del resultado.
- Mantener el asunto breve, concreto y sin punto final.
- Explicar en el cuerpo el motivo y las consecuencias cuando el asunto no sea suficiente.
- Agregar `BREAKING CHANGE:` en el cuerpo si un contrato deja de ser compatible.
- No usar mensajes como `cambios`, `arreglos`, `update`, `final` o `prueba 2`.
- No declarar una funcion completa en el mensaje si aun depende de mocks o tareas pendientes.

## Verificacion antes del push

Antes de publicar una rama:

1. Revisar `git status`, `git diff` y los commits locales.
2. Confirmar la evidencia aplicable obtenida en el VPS y dejar la suite completa al unico ciclo final de GitHub Actions; ninguna comprobacion tecnica se ejecuta localmente.
3. Confirmar que no hay secretos ni datos reales.
4. Actualizar estado, checklist y documentacion cuando corresponda.
5. Sincronizar con `origin/main` y resolver conflictos conscientemente.

Agrupar codigo, pruebas, fixtures y documentacion antes del primer push. La frecuencia, invalidacion y reutilizacion de evidencia cumplen [Ejecucion eficiente de verificaciones](15-ejecucion-verificaciones-vps.md).

Para una rama privada puede usarse rebase:

```bash
git fetch origin
git rebase origin/main
```

No se rebasa una rama compartida sin coordinarlo. Si un rebase obliga a reemplazar una rama ya publicada, se detiene el push y se solicita una decision explicita; esta politica no autoriza force push automatico.

Publicar por primera vez:

```bash
git push -u origin feat/CHAT-17-evitar-respuestas-simultaneas
```

Despues del primer push basta `git push`. Siempre verificar la rama actual y el remoto antes de publicar.

## Pull requests

Todo cambio a `main` entra mediante pull request cuando GitHub este configurado.

El PR debe:

- Referenciar el identificador del requisito.
- Explicar resultado, alcance y decisiones relevantes.
- Identificar codigo existente revisado y reutilizado.
- Incluir comandos y resultados de verificacion.
- Mostrar riesgos, migraciones y forma de recuperacion.
- Mantener un tamaño revisable y un unico objetivo principal.
- Usar la plantilla `.github/pull_request_template.md`.

Un PR en borrador puede publicarse para obtener retroalimentacion, pero no se integra. Los comentarios pendientes se resuelven con cambios o una respuesta tecnica, nunca marcandolos como resueltos sin atenderlos.

## Integracion

La estrategia predeterminada es **Squash and merge**:

- Produce un commit claro en `main` por PR.
- El titulo final sigue Conventional Commits e incluye el identificador.
- Las comprobaciones obligatorias deben estar en verde.
- Las conversaciones deben estar resueltas.
- Debe existir la aprobacion requerida por las reglas de GitHub.
- Se vuelve a verificar el resultado integrado cuando el riesgo lo justifique.
- La rama remota se elimina despues del merge.

No se usa `Merge commit` salvo que una decision documentada requiera conservar la topologia. No se integra codigo con pruebas fallidas ni se omiten checks para ahorrar tiempo.

## Proteccion de main en GitHub

Al crear el remoto se debe configurar un ruleset para `main` con:

- Pull request obligatorio antes de merge.
- Al menos una aprobacion cuando haya otro revisor disponible.
- Invalidacion de aprobaciones cuando cambie codigo relevante.
- Resolucion obligatoria de conversaciones.
- Checks de CI obligatorios.
- Rama actualizada antes del merge cuando GitHub detecte incompatibilidad.
- Historial lineal.
- Bloqueo de force push.
- Bloqueo de eliminacion de `main`.
- Restriccion de bypass a emergencias documentadas.

En un proyecto de una sola persona, el PR y los checks siguen siendo obligatorios aunque temporalmente no pueda exigirse un segundo aprobador.

## Conflictos

- Leer ambos lados y comprender el comportamiento antes de editar.
- No aceptar automaticamente todo `ours` o todo `theirs`.
- Ejecutar las pruebas de los modulos afectados despues de resolver.
- Revisar que el conflicto no haya eliminado migraciones, validaciones, permisos o cambios de documentacion.
- Si dos ramas implementan la misma funcion, detener la integracion y consolidar una sola ruta.

## Hotfixes

Un hotfix parte de `main`, usa `hotfix/ID-descripcion` y conserva el mismo nivel de pruebas y revision posible.

1. Reproducir el problema.
2. Agregar una prueba de regresion.
3. Implementar la correccion minima.
4. Abrir PR urgente con riesgos y recuperacion.
5. Integrar, etiquetar y desplegar una nueva version.

Nunca se corrige produccion editando contenedores o archivos directamente sin trasladar el cambio al repositorio.

## Recuperacion de errores

Usar operaciones recuperables:

- Archivo agregado por error al staging: `git restore --staged ruta`.
- Commit compartido incorrecto: crear un nuevo commit o usar `git revert <commit>`.
- Cambios hechos en la rama equivocada pero aun no confirmados: crear la rama correcta sin descartar el arbol.
- Mensaje del ultimo commit incorrecto y todavia no publicado: `git commit --amend` despues de revisar.

No usar `git reset --hard`, `git clean -fd`, `git checkout --`, eliminar ramas con `-D` ni reescribir historia compartida sin identificar exactamente lo que se perdera y obtener confirmacion explicita. Nunca usar `git push --force`; una excepcion coordinada solo puede considerar `--force-with-lease` y requiere autorizacion expresa.

## Tags y versiones

- Los tags de release siguen versionado semantico cuando exista una primera version publicable: `vMAJOR.MINOR.PATCH`.
- Los tags se crean sobre commits integrados y verificados de `main`.
- Cada release registra commit, artefactos, migraciones y compatibilidad.
- Un tag publicado no se mueve para apuntar a otro commit; una correccion produce una nueva version.

## Limpieza posterior

Despues del merge:

```bash
git switch main
git pull --ff-only origin main
git branch -d nombre-de-la-rama
git fetch --prune
```

Solo se elimina una rama local despues de confirmar que el PR fue integrado y que no contiene commits exclusivos necesarios.

## Creacion del remoto inicial

Este repositorio local ya tiene historial. El repositorio de GitHub debe crearse vacio, sin README, licencia ni `.gitignore` generados por GitHub, para evitar dos historias iniciales.

Antes del primer push:

1. Confirmar organizacion, nombre, visibilidad y responsables.
2. Agregar y verificar `origin`.
3. Revisar que no existan secretos en todo el historial local.
4. Publicar `main` una sola vez.
5. Activar inmediatamente el ruleset de proteccion.
6. Probar el flujo siguiente con una rama y un PR pequeno.

No se debe reemplazar un remoto que ya contenga trabajo sin inspeccionar primero su historial.
