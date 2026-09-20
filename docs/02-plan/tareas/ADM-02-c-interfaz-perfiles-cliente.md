# ADM-02-c - Interfaz administrativa de perfiles de cliente

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-02`
- Requisitos relacionados: `ADM-01`, `ADM-03`, `ADM-05`, `ADM-06`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-02-a`, `ADM-02-b`, `ADM-01`, ADR-0004, ADR-0005 y ADR-0014
- Bloquea a: recorrido visual de ciclo de vida, aprovisionamiento y detalle operativo del perfil
- ADR, arquitectura o diseno aplicables: ADR-0014, frontends y referencia visual, contratos API y reglas de seguridad

## Resultado esperado

Un operador autenticado puede consultar, buscar, filtrar, crear y editar perfiles desde `admin-web` mediante un BFF que conserva tokens en el servidor. La experiencia incluye shell administrativo, permisos, carga, vacio, error, conflictos de version y comportamiento responsive.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-02`, rutas de `admin-web`, sesion, BFF, `TenantProfile`, permisos y componentes visuales.
- Codigo o documentacion encontrados: login y sesion opaca reales, BFF de identidad del operador, dashboard minimo, contratos `tenant-profile/v1` y API protegida desplegada.
- Pruebas e historial encontrados: pruebas HTTP del BFF, proxy de sesion, API NestJS, PostgreSQL real y E2E de autenticacion de `ADM-01`.
- Decision de reutilizacion, extension o reemplazo: extender la frontera BFF y convertir el dashboard minimo en un shell accesible; no exponer tokens, duplicar contratos ni introducir otra aplicacion.

## Alcance

### Incluido

- Shell de `admin-web` con navegacion diferenciada para plataforma.
- Pantalla responsive de perfiles con busqueda, filtros y paginacion por cursor.
- Formularios de creacion y edicion segun `tenants:manage`.
- BFF fijo para listar, crear, obtener y editar perfiles.
- CSRF y validacion de origen para escrituras; validacion runtime en ambos sentidos.
- Estados de carga, vacio, error, sesion expirada, permiso insuficiente y conflicto de version.
- Pruebas del BFF, UI, build y recorrido real disponible.

### No incluido

- Membresias de usuarios del perfil.
- Acciones de activacion, suspension, aprovisionamiento o despliegue.
- Inventar servidores, releases, metricas o datos de demostracion en el entorno desplegado.
- Marcar `ADM-02` completo antes de implementar membresias.

## Impacto tecnico

| Area                       | Impacto previsto                                                           |
| -------------------------- | -------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `admin-web`, BFF y shell visual de plataforma                              |
| Contratos y eventos        | Reutiliza contratos v1; sin eventos nuevos                                 |
| Datos y migraciones        | Ninguno                                                                    |
| Permisos y aislamiento     | Render y acciones por permiso; autorizacion final permanece en `admin-api` |
| Configuracion y secretos   | Tokens solo en sesion server-side; sin secretos nuevos                     |
| Observabilidad y operacion | Errores acotados y respuestas `no-store`                                   |
| Documentacion              | Ficha, estado, referencia visual e inventario tras despliegue              |

## Plan de implementacion

- [x] Crear BFF validado y protegido para perfiles.
- [x] Construir shell y pantalla de listado con estados completos.
- [x] Implementar creacion y edicion con permisos, CSRF y ETag.
- [x] Agregar pruebas de frontera, comportamiento y accesibilidad basica.
- [x] Ejecutar CI y desplegar por digest en el VPS.
- [x] Registrar evidencia sin cerrar las membresias de `ADM-02`.

## Riesgos y mitigaciones

| Riesgo                            | Mitigacion                                                         | Verificacion                           |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| Exponer token OIDC al navegador   | BFF usa sesion opaca y agrega bearer solo servidor-servidor        | Pruebas inspeccionan respuestas y HTML |
| Escritura entre sitios            | Origin exacto y CSRF por sesion                                    | Casos negativos y positivos            |
| UI aparenta permiso que no existe | Identidad limitada y `admin-api` vuelve a autorizar cada solicitud | Pruebas 403 y ocultamiento de acciones |
| Sobrescribir cambios              | Conservar `ETag` y enviar `If-Match`                               | Conflicto 412 visible y recarga        |
| Confundir perfil con contacto CRM | Campos exclusivos de empresa y lenguaje de plataforma              | Revision de pantalla y contratos       |
| Romper responsive o teclado       | HTML semantico, foco visible y breakpoints                         | Pruebas y comprobacion visual          |

## Criterios de aceptacion

- [x] El navegador nunca recibe tokens OIDC ni conoce el origen interno de `admin-api`.
- [x] El operador puede buscar, filtrar y recorrer perfiles reales sin listas ilimitadas.
- [x] Solo `tenants:manage` habilita creacion y edicion, y el servidor vuelve a autorizar.
- [x] Crear valida empresa, slug y contacto; editar conserva concurrencia optimista.
- [x] Carga, vacio, error, 401, 403 y 412 tienen una salida comprensible y recuperable.
- [x] La interfaz sigue la direccion visual grafito aprobada, funciona con teclado y responde en movil.
- [x] CI, build, despliegue por digest y smoke aplicable aprueban.

## Plan de verificacion

- Pruebas unitarias: parsing de query/body, CSRF, permisos visuales y estados del cliente.
- Pruebas de integracion o contratos: BFF contra respuestas validas, malformadas y errores de `admin-api`.
- Pruebas E2E: sesion, listado, creacion, edicion y conflicto cuando exista credencial de operador entregada.
- Comprobacion manual: desktop y movil, foco, formularios, contraste, loading, empty y error.
- Seguridad, permisos y aislamiento: token ausente de HTML/JSON, origen fijo, CSRF y 401/403 cerrados.
- Idempotencia, concurrencia y recuperacion: slug unico, `If-Match`, recarga tras 412 y rollback por digest.
- Comandos que deben aprobar: pruebas afectadas, `pnpm run ci`, build de `admin-web` y smoke HTTPS.

## Recuperacion

- Compatibilidad o migracion: cambio aditivo de frontend y BFF sobre API v1; sin migracion.
- Rollback de aplicacion: volver al digest anterior de `admin-web`; `admin-api` y datos permanecen compatibles.
- Recuperacion de datos, si aplica: no hay borrado ni transformacion de datos.

## Evidencia de cierre

- Archivos, commits o PR: commits locales `6319937`, `682a097` y `7ce09af` en `feat/ADM-02-admin-ui`; shell y pagina de perfiles en `apps/admin-web/src/app/dashboard`, rutas BFF en `apps/admin-web/src/app/api/platform/tenant-profiles` y frontera validada en `apps/admin-web/src/server/tenant-profile-http.ts`. No existe remoto ni PR.
- Comandos y resultados: CI final en Node 24 aprobo formato, lint, tipos, 41 pruebas de configuracion, 152 pruebas generales, 19 pruebas de arquitectura y los 17 builds. Las cinco pruebas nuevas cubren ruta fija, filtros, token server-side, Origin, CSRF, ETag, conflicto y respuesta malformada.
- Despliegue: `admin-web` se construyo y desplego exclusivamente en el VPS desde el checkout inmutable `7ce09af36261b0b2eb0a578c2c20078061ebebe9`, por digest `abc0308128eba097f58938ca47243951f73cd76e735a5289e0a4e27fd3c5590e`. Quedo `healthy`; HTTPS aprobo raiz `200`, redireccion del dashboard privado y `401` acotado del BFF sin sesion.
- Documentacion actualizada: esta ficha, estado oficial, subtareas realmente terminadas e inventario operativo del VPS. `ADM-02` permanece abierto por membresias.
- Desviaciones del plan: la primera puerta de build detecto un import `.js` que TypeScript aceptaba pero Turbopack no resolvia; se corrigio y el CI completo se repitio. La inspeccion visual del primer digest detecto la herencia incorrecta de la fuente; se corrigio, reconstruyo, redesplego e inspecciono de nuevo.
- Pendientes o decisiones nuevas: el recorrido autenticado con datos reales se comprobara con la sesion privada del propietario; no se creo una credencial temporal ni se debilito MFA para automatizarlo. La siguiente rebanada de `ADM-02` es pertenencia de usuarios al perfil sin mezclar roles del CRM con permisos de Quantum.
