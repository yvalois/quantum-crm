# ADR 0020 Identidad OIDC de GitHub Actions para candidatas de release

- Estado: aceptado
- Fecha: 2026-09-22
- Responsables: propietario del proyecto
- Requisitos relacionados: `OPS-10`, `OPS-11`, `OPS-12`, `ADM-09`, `ADM-20` y `ADM-04`

## Contexto

`ADM-09` conserva releases por digest y `ADR-0009` requiere que CI registre el candidato sin conceder acceso al VPS. El `admin-api` actual autentica operadores humanos mediante Keycloak; reutilizar sus tokens desde GitHub, una contraseña de operador o un PAT persistente rompería separación de principales, mínimo privilegio y trazabilidad.

GitHub Actions entrega a un job autorizado un JWT OIDC efímero firmado por `https://token.actions.githubusercontent.com`. Sus claims permiten restringir audiencia, repositorio, visibilidad, referencia, evento, workflow, SHA e intento sin almacenar una credencial de CI.

## Decisión

Quantum introduce un principal de servicio exclusivo `release-publisher` para registrar candidatas completas de release. `admin-api` valida directamente el JWT OIDC de GitHub mediante discovery/JWKS fijados al issuer y acepta solo el endpoint interno tipado de creación de candidata.

El validador exige, como mínimo:

- `iss` exacto de GitHub Actions, firma válida, `kid` reconocido, algoritmo permitido, vigencia, `nbf` y `jti`;
- audiencia explícita `quantum-crm-release-publisher`;
- repositorio `yvalois/quantum-crm`, visibilidad `private`, `ref` `refs/heads/main` y evento de publicación permitido;
- workflow y SHA coincidentes con la ejecución que generó el manifiesto;
- subject compatible con el formato de GitHub, incluyendo identificadores inmutables cuando el repositorio los emita.

El job obtiene el token solo con `id-token: write`; los pull requests conservan permisos de solo lectura. El principal puede crear de forma idempotente una candidata cuyos ocho digests, commit y manifiesto coincidan con sus claims. No puede validar o retirar releases, operar perfiles, llamar al executor, leer secretos, modificar Caddy ni acceder al VPS.

El token no se registra, persiste, reenvía a otros procesos ni se entrega al navegador. La auditoría conserva solo identidad estructurada permitida: repositorio, workflow, run ID, SHA, `jti` hash/identificador seguro y resultado.

## Alternativas consideradas

- Token de operador, PAT o secreto de GitHub: rechazado porque es persistente, mezcla identidades humana/máquina y amplía el impacto de filtración.
- Conceder el `GITHUB_TOKEN` al VPS o acceder por SSH: rechazado por `ADR-0009`; GitHub no ejecuta comandos en el host.
- Configurar un usuario humano de Keycloak para CI: rechazado porque no demuestra procedencia del workflow y dificulta rotación/revocación.
- Registrar la release manualmente: rechazado porque separa el commit de los digests y vuelve a introducir errores de transcripción.

## Consecuencias

- La primera publicación debe incluir configuración pública del issuer, audiencia y política exacta; no hay secreto de CI para crear.
- El `admin-api` obtiene una segunda política de autenticación separada de la humana y de los runtime de perfiles.
- Cambiar repositorio, transferencia, formato de `sub` o workflow requiere actualizar la allowlist antes de publicar; una discrepancia falla cerrada.
- La validación de una candidata, promoción, despliegue y producción siguen siendo operaciones distintas y autorizadas por sus propios principales.

## Validación

- Un JWT válido de `main` y workflow permitido crea una sola candidata completa con el manifiesto exacto.
- Tokens expirados, de PR, de otro repositorio, audience/ref/workflow/SHA incorrectos o con claims incompletos se rechazan antes de persistir.
- El principal de CI no puede usar endpoints de operadores, perfiles, capacidad ni ejecución.
- Una ejecución de PR no obtiene `id-token: write`, `packages: write`, secrets ni acceso al VPS.
- La decisión se revisa al migrar de forja, adoptar un IdP de workload diferente o requerir producción multi-región.
