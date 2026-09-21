# ADM-04-g - Escribir configuración privada del perfil

> Ficha derivada para completar el paso `WRITE_CONFIGURATION` del aprovisionamiento. No sustituye el alcance, el estado ni la definición de terminado.

## Identificacion

- Requisito principal: `ADM-04`
- Requisitos relacionados: `OPS-01`, `OPS-04`, `OPS-23`
- Fase del MVP: Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-04-d`, `ADM-04-e` y `ADM-04-f` integrados; base, referencias de secretos y almacenamiento del perfil deben estar listos.
- Bloquea a: `ADM-04` pasos `START_CONTAINERS` y posteriores.
- ADR, arquitectura o diseño aplicables: `ADR-0002`, `ADR-0006`, `ADR-0008`, `ADR-0017`, `monorepo.md`.

## Resultado esperado

El ejecutor materializa de forma idempotente un manifiesto de configuración no secreta para el perfil, con las identidades de base, referencias de secretos, endpoint y buckets de almacenamiento. El archivo queda fuera del checkout, se instala atómicamente y el repositorio registra su referencia y revisión antes de avanzar a `START_CONTAINERS`. Ningún valor secreto se copia a la base, al manifiesto, a Git ni a los logs.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md` y `docs/02-plan/trabajo.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `WRITE_CONFIGURATION`, `TenantDatabase`, `TenantStorage`, referencias `*_FILE`, `tenant.yaml` y rutas de secretos/configuración.
- Codigo o documentacion encontrados: la máquina de aprovisionamiento ya declara el paso; `CREATE_SECRETS` y `CREATE_STORAGE` persisten referencias, pero el ejecutor aún no reclama ni completa `WRITE_CONFIGURATION`.
- Pruebas e historial encontrados: leasing, fencing y finalización de base, secretos y storage ya tienen contratos y pruebas; no existe tabla ni adaptador de configuración.
- Decision de reutilizacion, extension o reemplazo: extender el flujo tipado y el repositorio durable existentes; añadir un manifiesto por perfil y una tabla de referencia, sin crear un segundo orquestador.

## Alcance

### Incluido

- Contrato tipado de materialización y finalización de `WRITE_CONFIGURATION`.
- Manifiesto JSON no secreto, determinista e idempotente por perfil, instalado fuera del checkout mediante temporal y rename atómico.
- Referencia durable de configuración y revisión en PostgreSQL con fencing del paso.
- Montaje privado de configuración para `deploy-executor`, separado del árbol de secretos.
- Rechazo de IDs, rutas, referencias o contenido fuera de las allowlists del perfil.

### No incluido

- Arranque de contenedores, HTTPS, administrador inicial o activación del perfil.
- Configuración comercial editable (`ADM-08`) ni carga de datos reales.
- Copia o exposición de contraseñas, tokens, claves S3 o URLs firmadas.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `deploy-executor`, `platform-domain`, `database` |
| Contratos y eventos | Puerto tipado `TenantConfigurationProvisioner` y finalización con referencia/revisión |
| Datos y migraciones | Tabla `tenants.tenant_configurations` y resultado durable por intento |
| Permisos y aislamiento | Directorio por UUID; solo el ejecutor escribe y ningún perfil comparte manifestos |
| Configuracion y secretos | Manifiesto separado; únicamente referencias relativas a secretos |
| Observabilidad y operacion | Instalación atómica, reintentos idempotentes y errores sin contenido sensible |
| Documentacion | Ficha, estado e inventario del VPS |

## Plan de implementacion

- [x] Añadir tipos de dominio, validadores y exportaciones para `WRITE_CONFIGURATION`.
- [x] Persistir configuración y avanzar con lease, versión e intento.
- [x] Implementar adaptador de filesystem con allowlist, permisos y rename atómico.
- [x] Conectar el paso al ejecutor y al montaje del servicio.
- [x] Ejecutar las comprobaciones afectadas en CI y desplegar una vez en el VPS autorizado tras el merge.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| El reintento deja un manifiesto parcial | Temporal dentro del directorio y rename atómico | Interrumpir/repetir conserva un único archivo válido |
| Se filtra un secreto | El contrato solo acepta referencias y el adaptador nunca lee valores | Búsqueda de secretos y revisión del contenido generado |
| Un perfil escribe fuera de su raíz | Ruta derivada exclusivamente del UUID validado | Prueba de path traversal y symlink rechazada |
| Un resultado tardío sobrescribe otro intento | Fencing durable del repositorio | Lease/version/attempt inválidos no avanzan la operación |

## Criterios de aceptacion

- [ ] Se genera un manifiesto válido y reproducible para un perfil con base, secretos y storage ya creados.
- [ ] Repetir el paso no duplica filas ni cambia referencias válidas.
- [ ] El manifiesto no contiene valores secretos y queda fuera del checkout.
- [ ] Un error o resultado tardío no permite avanzar a `START_CONTAINERS`.
- [ ] La referencia durable identifica la revisión instalada y el perfil propietario.

## Plan de verificacion

- Pruebas unitarias: validación de referencias, allowlist de paths, serialización y renombrado atómico.
- Pruebas de integración o contratos: persistencia y transición a `START_CONTAINERS`.
- Pruebas E2E: se ejecutarán al cerrar el aprovisionamiento vertical completo.
- Comprobacion manual: un manifiesto y un reintento con un perfil piloto autorizado en el VPS.
- Seguridad, permisos y aislamiento: permisos del directorio, symlinks, traversal y ausencia de valores secretos.
- Idempotencia, concurrencia y recuperacion: fencing, lease vencido y reanudación tras archivo temporal.
- Comandos que deben aprobar: puertas CI y la validación mínima del VPS definida para el commit desplegado.

## Recuperacion

- Compatibilidad o migracion: migración aditiva; las referencias existentes de base, secretos y storage permanecen válidas.
- Rollback de aplicacion: volver al digest anterior sin borrar manifiestos válidos.
- Recuperacion de datos, si aplica: reconstruir el manifiesto desde PostgreSQL y las referencias verificadas.

## Evidencia de cierre

- Archivos, commits o PR: PR #9 (`a6235198dd8f664740dd382fa2a9e268a3e464a7`) integrado; `apps/deploy-executor`, `packages/platform-domain`, `packages/database`, `packages/config`, `infra/compose/platform.yaml` y la migración `20260921230000_adm_04_write_configuration`.
- Comandos y resultados: CI del PR #9 verde. En el VPS, las imágenes se construyeron una vez: `deploy-executor@sha256:ff0ce711c4e90759ba484666afa35a3a13a0f40c9dba06889eb9b020090b4c87` y `platform-migrator@sha256:80d61a6b82306dbc157dfe1b04fad529ee833c2f89365fa72d1a8493175baf89`. La migración se aplicó correctamente; `deploy-executor` quedó saludable con el bind mount `/opt/quantum/config/staging/tenants` (modo `0700`, UID/GID `1000:1000`) y los ocho servicios permanecieron saludables.
- Documentacion actualizada: `docs/04-proceso/estado.md` y `docs/03-operaciones/inventario-vps.md` registran el despliegue; `docs/08-arquitectura/mapa-del-sistema.md` ya describe la raíz separada de manifiestos.
- Desviaciones del plan: no se creó un perfil sintético ni se inició `START_CONTAINERS`; se respetó la regla de no contaminar staging con datos ficticios.
- Pendientes o decisiones nuevas: ejecutar la materialización, reintento e aislamiento con el perfil piloto autorizado. Los criterios de aceptación y el requisito `ADM-04` permanecen abiertos hasta esa evidencia y hasta completar los pasos posteriores.
