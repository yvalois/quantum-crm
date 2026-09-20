# ADM-05-a - Registro durable de servidores y capacidad

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-05`
- Requisitos relacionados: `ADM-04`, `ADM-06`, `ADM-10`, `ADM-12`, `OPS-02`, `OPS-23`
- Fase del MVP: 2. Plataforma administrativa
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: autenticacion de `ADM-01`, persistencia de plataforma de `OPS-04-a`
- Bloquea a: validacion de capacidad de `ADM-04`, ubicacion de perfiles y despliegues por servidor
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0005, ADR-0006, ADR-0008, ADR-0009 y mapa del sistema

## Resultado esperado

El administrador registra servidores confirmados con identidad, ubicacion, plataforma, capacidad total y reservada y una referencia opaca a sus credenciales. La API permite consultar capacidad disponible sin devolver secretos ni aceptar valores inconsistentes.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoria del trabajo existente

- Busquedas realizadas: `ADM-05`, `serverId`, `capacidad`, `VPS`, `credential`, `deployments:read` y `deployments:execute`.
- Codigo o documentacion encontrados: `serverId` sin FK en perfiles y operaciones, PostgreSQL de plataforma, contratos v1, control optimista con ETag y permisos de despliegue existentes.
- Pruebas e historial encontrados: patrones de dominio, repositorio PostgreSQL, controlador protegido e integracion real usados por `ADM-02` a `ADM-04`.
- Decision de reutilizacion, extension o reemplazo: extender `platform-domain`, `contracts`, `database` y `admin-api`; el registro pertenece al modulo de infraestructura de plataforma y no expone el valor de la referencia de credencial.

## Alcance

### Incluido

- Registro, consulta, listado y actualizacion condicional de servidores.
- IP publica, proveedor, region, sistema operativo, arquitectura, CPU, RAM y almacenamiento confirmados.
- Estado operativo y capacidad total, reservada y disponible con invariantes en dominio y base.
- Referencia opaca `secret://...` guardada y reducida a `credentialConfigured` en respuestas.
- Migracion forward-only, privilegios minimos, contratos, permisos y pruebas.
- Registro del VPS de staging con datos observados despues del despliegue.

### No incluido

- Asignar todavia perfiles o slots candidatos a recursos concretos.
- Admitir una operacion de aprovisionamiento usando esta capacidad; requiere enlazar la reserva con `ADM-04` y el catalogo de `ADM-09`.
- Descubrir capacidad automaticamente ni conectarse al host desde `admin-api`.
- Mostrar o almacenar claves privadas, passwords o tokens.
- Marcar `ADM-05` terminado.

## Impacto tecnico

| Area                       | Impacto previsto                                                          |
| -------------------------- | ------------------------------------------------------------------------- |
| Aplicaciones y modulos     | `admin-api`, `platform-domain` y adaptador PostgreSQL                     |
| Contratos y eventos        | Contratos HTTP `infrastructure-server/v1` y listado v1                    |
| Datos y migraciones        | Schema `infrastructure`, tabla de servidores e invariantes de capacidad   |
| Permisos y aislamiento     | Lectura con `deployments:read`; escritura con `deployments:execute`       |
| Configuracion y secretos   | Solo referencia opaca; el secreto permanece fuera de la base y respuesta  |
| Observabilidad y operacion | Version optimista, estado y capacidad visibles; sin efectos sobre el host |
| Documentacion              | Ficha, estado e inventario del VPS                                        |

## Plan de implementacion

- [ ] Modelar servidor, capacidad e invariantes en dominio y contratos.
- [ ] Crear migracion, modelo Prisma y privilegios del runtime.
- [ ] Implementar repositorio, servicio y API protegida con ETag.
- [ ] Cubrir normalizacion, secretos, conflictos, permisos y persistencia real.
- [ ] Verificar, migrar y desplegar por digest en el VPS.
- [ ] Registrar el VPS observado y documentar evidencia sin cerrar `ADM-05`.

## Riesgos y mitigaciones

| Riesgo                                                | Mitigacion                                                                      | Verificacion                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| Capacidad reservada supera el total                   | Invariantes duplicadas en dominio y `CHECK` de PostgreSQL                       | Pruebas unitarias e integracion |
| Una respuesta filtra acceso operativo                 | Contrato solo devuelve `credentialConfigured`                                   | Prueba contractual y HTTP       |
| Dos operadores pisan cambios                          | Version y `If-Match` obligatorios                                               | Prueba de version obsoleta      |
| Se confunde capacidad registrada con admision atomica | Campo confirmado y alcance explicito; integracion se reserva para otra rebanada | Revision de ficha y estado      |
| IP o referencia mal formadas                          | Validacion runtime y restricciones de base                                      | Pruebas negativas               |

## Criterios de aceptacion

- [ ] Un operador autorizado registra y consulta un servidor confirmado.
- [ ] La capacidad disponible nunca es negativa y se deriva de total menos reservado.
- [ ] Arquitectura, estado e IP se validan y normalizan.
- [ ] La API nunca devuelve la referencia ni el secreto de operacion.
- [ ] Una actualizacion obsoleta devuelve precondicion fallida.
- [ ] El VPS de staging queda registrado con datos observados, no estimados.

## Plan de verificacion

- Pruebas unitarias: normalizacion, capacidad, cronologia y valores invalidos.
- Pruebas de integracion o contratos: Zod, migracion PostgreSQL, restricciones, CRUD y conflicto optimista.
- Pruebas E2E: frontera HTTP protegida y respuestas saneadas en la suite de `admin-api`.
- Comprobacion manual: consultar por API/base el servidor de staging y comparar con el host.
- Seguridad, permisos y aislamiento: permisos `deployments:read`/`deployments:execute`; referencia ausente de respuestas y logs.
- Idempotencia, concurrencia y recuperacion: nombre unico y ETag; migracion aditiva.
- Comandos que deben aprobar: CI completa, integracion en PostgreSQL 18 desechable y migracion real del VPS.

## Recuperacion

- Compatibilidad o migracion: schema y tabla aditivos; no se agrega aun FK a identificadores historicos.
- Rollback de aplicacion: restaurar el digest anterior de `admin-api`; conservar la migracion aplicada.
- Recuperacion de datos, si aplica: corregir por nueva actualizacion versionada; no editar ni borrar manualmente registros confirmados.

## Evidencia de cierre

- Archivos, commits o PR:
- Comandos y resultados:
- Documentacion actualizada:
- Desviaciones del plan:
- Pendientes o decisiones nuevas:
