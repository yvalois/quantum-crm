# ADM-09-b - Control operativo del catálogo de releases

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificación

- Requisito principal: `ADM-09`
- Requisitos relacionados: `ADM-10`, `OPS-10`, `OPS-11`, `OPS-12`
- Fase del MVP: fase 2, administración de la plataforma
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: catálogo `platform-release/v1`, sesión OIDC de operador con MFA y permisos `deployments:read`/`deployments:execute`
- Bloquea a: validación y promoción operativa de una release candidata al perfil piloto
- ADR aplicables: ADR-0004, ADR-0005, ADR-0009 y ADR-0020

## Resultado esperado

El operador autenticado puede consultar candidatas, marcar una release como `VALIDATED` con control optimista y ver el identificador de la release validada para usarlo en la promoción del perfil desde el mismo panel Admin.

## Lectura obligatoria aplicada

- [x] Requisito, fase, subtareas, estado y ficha `ADM-09-a` revisados.
- [x] Reglas de autenticación, contratos, CI/CD y releases revisadas.
- [x] ADR de autorización humana y separación CI/operador revisados.

## Auditoría del trabajo existente

- El `admin-api` ya expone listado, consulta y transición de releases con `If-Match` y permisos server-side.
- `admin-web` ya tiene sesión opaca, CSRF y la acción de promoción de perfil, pero no tiene BFF ni control visual para validar candidatas.
- Se reutilizan los contratos existentes; no se duplican DTO ni se habilita validación desde GitHub Actions.

## Alcance

### Incluido

- BFF seguro para listar releases y cambiar `CANDIDATE` a `VALIDATED`.
- Panel visible de releases en `admin-web` con estado, commit, versión, `If-Match` y acción de validación.
- Enlace del release validado con la acción de promoción del perfil piloto.
- Pruebas proporcionales de autorización, CSRF, ETag y transición.

### No incluido

- Cambios en el catálogo, digests, migraciones o ejecutor.
- Validación automática por CI, retiro de releases o promociones globales.

## Criterios de aceptación

- [ ] La sesión sin MFA/permisos no puede listar ni validar releases.
- [ ] La interfaz no permite validar sin `If-Match` vigente.
- [ ] Una transición exitosa muestra `VALIDATED` y habilita la promoción del perfil.
- [ ] La operación no expone secretos ni permite seleccionar digests desde el navegador.

## Verificación y evidencia

- Comprobaciones técnicas: formato, lint, typecheck, pruebas afectadas y build en el VPS autorizado.
- Comprobación manual autenticada: listar candidata `464104c1-cfb2-5729-b978-03be83664bdb`, validarla y dejar visible el botón de promoción.
- Evidencia de cierre: commit, PR, checks verdes, revisión del Admin y estado del perfil en el VPS.
