# CON-01 - Importar y exportar contactos

> Plan derivado de `CON-01`; no sustituye el alcance, checklist ni estado oficiales.

## Identificacion

- Requisito principal: `CON-01`.
- Requisitos relacionados: `CON-04`, `CON-12`, `USR-06`, `USR-11`.
- Fase del MVP: Fase 4 — Nucleo comercial.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: contactos persistentes, permisos CRM y alcance server-side ya integrados.
- Bloquea a: comprobacion integrada de Contactos.
- ADR, arquitectura o diseño aplicables: ADR-0002, ADR-0003, ADR-0005, ADR-0006 y ADR-0007.

## Resultado esperado

Un usuario autorizado puede cargar un CSV o XLSX, revisar un resumen de filas validas, errores y coincidencias por correo/teléfono antes de aplicar cambios, y exportar únicamente contactos que puede ver. La importación es idempotente por operación y nunca permite elegir un perfil o saltarse el alcance del servidor.

## Lectura obligatoria aplicada

- [x] Requisito y subtareas en `funcionalidades.md` y `trabajo.md`.
- [x] Fase, dependencias y puerta del MVP en `mvp-piloto.md`.
- [x] Estado y evidencia previa en `estado.md`.
- [x] Reglas, ADR y arquitectura de módulos aplicables.

## Auditoria del trabajo existente

- Los contactos ya tienen dominio, repositorio PostgreSQL, API `/api/v1/contacts`, BFF protegido y panel CRM.
- No existe importador/exportador ni parser de archivos; se reutilizarán el contrato público y el propietario `contacts` sin acceder desde otros módulos a sus tablas.
- El alcance se obtiene del actor autenticado mediante el repositorio existente; el cliente no envía `tenant_id`, propietario ni filtro SQL.

## Alcance

### Incluido

- Previsualización y aplicación de CSV y XLSX con columnas `displayName`, `email` y `phone`.
- Validación por fila, coincidencias normalizadas y creación/actualización explícita tras confirmación.
- Exportación CSV de campos autorizados y contactos visibles para el actor.
- Límites de tamaño, filas, columnas y contenido; errores seguros y sin secretos.
- Idempotencia de la operación de aplicación y auditoría del resultado por fila.

### No incluido

- Etiquetas, campos personalizados, asignación comercial, combinación definitiva de duplicados o automatizaciones.
- Exportación de datos fuera del alcance del usuario o de módulos ajenos.

## Impacto tecnico

| Área                       | Impacto previsto                                                         |
| -------------------------- | ------------------------------------------------------------------------ |
| Aplicaciones y módulos     | `contacts`, `api`, `crm-web` y BFF CRM.                                  |
| Contratos y eventos        | Schemas Zod versionados para preview, apply y exportación.               |
| Datos y migraciones        | Sin tablas nuevas; usa contactos y una operación durable de importación. |
| Permisos y aislamiento     | Permisos de lectura/creación/edición y alcance del actor en servidor.    |
| Configuración y secretos   | Sin secretos nuevos.                                                     |
| Observabilidad y operación | Correlación, conteos por resultado y errores RFC 9457.                   |
| Documentación              | Ficha, estado y checklist de `CON-01`.                                   |

## Plan de implementación

- [x] Definir contratos de preview, aplicación y exportación.
- [x] Implementar parser y validación bounded de CSV/XLSX en el módulo propietario.
- [x] Implementar preview sin efectos y aplicación idempotente por operación.
- [x] Exponer API/BFF y controles en el panel CRM.
- [x] Añadir pruebas de validación, alcance, coincidencias, reintento y límites.
- [x] Validar el commit candidato una vez en el VPS y publicar un único PR.

## Criterios de aceptación

- [ ] Una previsualización no modifica contactos y reporta filas validas, errores y coincidencias.
- [ ] Una aplicación confirmada crea o actualiza solo filas autorizadas y repetida no duplica efectos.
- [ ] Un usuario sin permiso recibe `403`; un contacto fuera de su alcance nunca aparece en preview ni exportación.
- [ ] CSV y XLSX con columnas desconocidas o tamaño excesivo se rechazan sin leer rutas arbitrarias.
- [ ] La exportación produce un CSV descargable con solo campos públicos autorizados.

## Plan de verificación

- Pruebas unitarias: parser, normalización, validación y coincidencias.
- Pruebas de integración o contratos: preview/apply/export con PostgreSQL desechable.
- Pruebas E2E: carga, revisión, confirmación y descarga desde `crm-web`.
- Seguridad, permisos y aislamiento: alcance `PROFILE`, `TEAM`, `ASSIGNED` y perfil cruzado.
- Idempotencia, concurrencia y recuperación: misma operación repetida y dos aplicaciones simultáneas.
- Comandos que deben aprobar: formato, typecheck y pruebas afectadas en el VPS; matriz completa en GitHub.

## Recuperación

- Compatibilidad o migración: no cambia el esquema; los contratos nuevos usan versionado aditivo.
- Rollback de aplicación: retirar rutas sin borrar contactos existentes ni resultados de auditoría.
- Recuperación de datos: restauración aislada conforme a ADR-0015 si una importación autorizada requiere recuperación.

## Evidencia de cierre

- Archivos, commits o PR: commit candidato `00bc24a` en `feat/CON-01-import-export`; pendiente publicar el PR.
- Comandos y resultados: en `/opt/quantum/builds/con01-final5` del VPS se aprobaron Prettier para los archivos afectados, los typechecks de `contracts`, `domain`, `database`, `api` y `crm-web`, y 15 pruebas afectadas en 4 archivos.
- Documentación actualizada: esta ficha, `estado.md` y checklist de `CON-01`.
- Desviaciones del plan: se implementó un lector XLSX acotado con APIs nativas de Node para evitar una dependencia con alerta de seguridad; no se añadieron paquetes ni migraciones.
- Pendientes o decisiones nuevas: publicar el commit, aprobar la matriz completa de GitHub y ejecutar la comprobación integrada/E2E antes de marcar los criterios de aceptación.
