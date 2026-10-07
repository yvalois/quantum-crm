# ADM-02-d - Recrear un perfil eliminado

> Esta ficha deriva `ADM-02` y `ADM-03`; no sustituye las fuentes oficiales de alcance ni presenta la eliminacion fisica diferida como terminada.

## Identificacion

- Requisito principal: `ADM-02`
- Requisitos relacionados: `ADM-03`, `ADM-04`, `ADM-05`, `OPS-04`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-02-a`, `ADM-03-b`, ADR-0003 y ADR-0006
- Bloquea a: recreacion operativa de InterAmerican desde Quantum Admin
- ADR, arquitectura o diseno aplicables: ADR-0003, ADR-0006 y reglas de persistencia

## Resultado esperado

Cuando el perfil anterior esta en `DELETED`, Quantum Admin permite crear otro perfil con el mismo slug. El nuevo perfil recibe un UUID distinto y por tanto identidad, base, almacenamiento, configuracion, red y runtime propios; el registro eliminado permanece como auditoria historica.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-02`, `ADM-03`, `TenantProfile`, `tenant_profiles`, slug, `DELETED` y recursos derivados del perfil.
- Codigo o documentacion encontrados: la restriccion global `tenant_profiles_slug_key` incluye tombstones; los recursos tecnicos se derivan del UUID, salvo el hostname que la baja ya retira antes de `DELETED`.
- Pruebas e historial encontrados: la integracion comprueba slug unico y el flujo de baja conserva tombstones fuera del listado normal.
- Decision de reutilizacion, extension o reemplazo: sustituir la restriccion global por un indice unico parcial para estados distintos de `deleted`, sin reutilizar el UUID ni mutar la auditoria anterior.

## Alcance

### Incluido

- Migracion forward-only que libera el slug de tombstones y conserva unicidad entre perfiles operativos.
- Schema Prisma alineado con el indice parcial.
- Regresion integrada para recreacion y rechazo de duplicado operativo.
- Mensaje de conflicto comprensible cuando realmente existe un perfil operativo con ese slug.
- Despliegue y comprobacion de la recreacion desde el VPS.

### No incluido

- Restaurar o reutilizar el perfil, UUID, datos o secretos eliminados.
- Retirar fisicamente los residuos diferidos de tombstones anteriores.
- Crear InterAmerican en nombre del propietario; la interfaz debe quedar lista para que lo cree.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | BFF administrativo conserva el alta y mejora el conflicto visible |
| Contratos y eventos | Sin cambio de version ni payload |
| Datos y migraciones | Restriccion global reemplazada por indice unico parcial de perfiles no eliminados |
| Permisos y aislamiento | Nuevo UUID; ningun recurso tecnico historico se reutiliza |
| Configuracion y secretos | Sin cambios |
| Observabilidad y operacion | Migracion controlada antes del despliegue de Admin |
| Documentacion | Estado y ficha actualizados en el mismo bloque |

## Plan de implementacion

- [ ] Crear migracion y alinear Prisma.
- [ ] Agregar regresion de perfil eliminado recreable y duplicado operativo rechazado.
- [ ] Desplegar la migracion y Admin en el VPS.
- [ ] Comprobar el alta con el mismo slug sin crear el perfil definitivo del propietario.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Reutilizar recursos de otro perfil | Todo recurso se deriva del UUID nuevo; el tombstone no se reactiva | Comparar UUID y comprobar alta nueva |
| Dos perfiles operativos con igual hostname | Indice parcial unico para todo estado distinto de `deleted` | Carrera/duplicado rechazado por PostgreSQL |
| Deriva Prisma/SQL | Schema declara el mismo indice parcial y la migracion es forward-only | Validacion Prisma y migracion en VPS |

## Criterios de aceptacion

- [ ] Un slug de un perfil `DELETED` puede crear un perfil `PENDING` nuevo.
- [ ] Un slug de cualquier perfil no eliminado sigue devolviendo conflicto.
- [ ] El tombstone conserva su UUID e historial y el perfil nuevo usa otro UUID.
- [ ] Quantum Admin muestra un error util solo para un conflicto operativo real.

## Plan de verificacion

- Pruebas unitarias: frontera BFF del mensaje de conflicto.
- Pruebas de integracion o contratos: PostgreSQL real con tombstone, recreacion y duplicado vivo.
- Pruebas E2E: alta sintentica temporal con el mismo slug eliminado en VPS y retiro posterior si se crea.
- Comprobacion manual: formulario administrativo acepta el slug liberado.
- Seguridad, permisos y aislamiento: comprobar UUID nuevo y nombres de recursos derivados del UUID.
- Idempotencia, concurrencia y recuperacion: el indice parcial impide dos perfiles operativos con el mismo slug.
- Comandos que deben aprobar: solo formato, tipos, pruebas y build afectados en el VPS.

## Recuperacion

- Compatibilidad o migracion: el cambio es compatible; lectores anteriores toleran el indice parcial.
- Rollback de aplicacion: la aplicacion anterior sigue operando; una correccion de datos usa otra migracion forward-only.
- Recuperacion de datos, si aplica: no se borran ni transforman filas.

## Evidencia de cierre

- Archivos, commits o PR: pendiente.
- Comandos y resultados: pendiente.
- Documentacion actualizada: esta ficha y estado oficial.
- Desviaciones del plan: ninguna.
- Pendientes o decisiones nuevas: retiro fisico completo de recursos historicos permanece en `ADM-03-b`.
