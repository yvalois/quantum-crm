# ADM-04-j - Identidad OIDC por perfil

> Esta ficha es un plan derivado. No sustituye el alcance, estado ni definición de terminado de `ADM-04` y `USR-01`.

## Identificación

- Requisito principal: `ADM-04`
- Requisitos relacionados: `USR-01`, `USR-03`, `OPS-04`, `OPS-23` y `OPS-24`
- Fase del MVP: Plataforma Quantum / Base del CRM
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `CREATE_SECRETS`, `WRITE_CONFIGURATION`, `START_CONTAINERS` y `CONFIGURE_HTTPS`; hostname reservado y Keycloak persistente.
- Bloquea a: `CREATE_ADMINISTRATOR`, `VERIFY`, `ACTIVATE` y acceso real de `USR-01`.
- ADR, arquitectura o diseño aplicables: `ADR-0003`, `ADR-0004`, `ADR-0008`, `ADR-0011`, `ADR-0017`, `ADR-0018`, `ADR-0021` y `mapa-del-sistema.md`.

## Resultado esperado

El aprovisionador puede reconciliar la identidad aislada de un perfil: realm, cliente OIDC CRM, audiencia de API, configuración de sesión y referencias a secretos privados. No crea un usuario inicial ni marca el perfil activo hasta que la rebanada siguiente entregue su activación por un canal autorizado y de un solo uso.

## Lectura obligatoria aplicada

- [x] Requisito en `docs/01-producto/funcionalidades.md`.
- [x] Fase y dependencias en `docs/02-plan/mvp-piloto.md`.
- [x] Subtareas en `docs/02-plan/trabajo.md`.
- [x] Estado y evidencia previa en `docs/04-proceso/estado.md`.
- [x] Reglas, ADR y arquitectura pertinentes.

## Auditoría del trabajo existente

- Búsquedas realizadas: `CREATE_ADMINISTRATOR`, `Keycloak`, `realm`, `OIDC`, `CREATE_SECRETS`, `WRITE_CONFIGURATION` y `tenant`.
- Código o documentación encontrados: el ejecutor implementa hasta `CONFIGURE_HTTPS`; Keycloak de plataforma y el BFF CRM existen, pero ninguna ruta de aprovisionamiento posee el API administrativo de Keycloak ni una credencial Redis por perfil.
- Pruebas e historial encontrados: los realms y sesiones de plataforma tienen cobertura propia; la prueba de integración de identidad por perfil estaba pendiente y se ejecutó en un Keycloak y Redis desechables del VPS.
- Decisión de reutilización, extensión o reemplazo: extender los puertos tipados de `platform-domain` y el ejecutor; no duplicar el BFF ni permitir SDK administrativo dentro del CRM.

## Alcance

### Incluido

- Puerto tipado de identidad por perfil y adaptador Keycloak exclusivo de `deploy-executor`.
- Identidad determinista del realm, cliente, audiencia, mappers, PKCE, TOTP y sesiones.
- Internacionalizacion habilitada con espanol como unico idioma soportado y predeterminado en las pantallas de identidad del perfil.
- Referencias privadas para secreto OIDC y Redis ACL del perfil; configuración exacta para `crm-web` y configuración pública para API.
- Reconciliación, conflictos de identidad, timeout, resultados saneados y pruebas de dos perfiles.

### No incluido

- Entrega de enlace o contraseña de activación, invitaciones, SMTP, autoservicio de recuperación o UI de miembros.
- Activar el perfil, desplegar datos reales o exponer la API administrativa de Keycloak.

## Plan de implementación

- [x] Añadir el puerto, identidad derivada y errores tipados en `platform-domain`.
- [x] Crear el adaptador de Keycloak y el provisionador de secretos Redis/OIDC, sin valores en la base ni resultados.
- [x] Añadir referencias y configuración de perfil; montar cada secreto solo en `crm-web` y conectar issuer/audience en API.
- [x] Conectar el paso durable sin avanzar a activación de administrador hasta la operación de entrega segura.
- [x] Probar contratos, reintentos, conflicto, aislamiento A/B y ausencia de secretos en VPS.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Un perfil administra Keycloak ajeno | Solo executor usa adaptador y realm derivado | CRM no posee credencial ni endpoint admin |
| Sesión cruza perfiles | Realm, audiencia, ACL Redis y secreto distintos | Token/credencial A falla en B |
| Activación se filtra | No se persiste ni retorna en este paso | Revisión de contratos, logs y resultados |
| Reintento cambia identidad | Reconcilia identidad determinista antes de crear | Dos ejecuciones convergen o fallan por conflicto |

## Criterios de aceptación

- [x] Cada perfil obtiene un realm y cliente derivado sin entradas libres.
- [x] `crm-web` recibe solo sus dos secretos por archivo y API no recibe secretos de sesión.
- [x] Una diferencia observada no se sobreescribe; queda como fallo tipado y reanudable.
- [x] Ningún usuario o activación se presenta como completado antes de la operación de entrega segura.

## Plan de verificación

- Pruebas unitarias: identidad derivada, schemas, conflicto y redacción.
- Pruebas de integración: Keycloak y Redis desechables en VPS con dos perfiles.
- Seguridad y aislamiento: token, realm, audiencia, URL, client secret y ACL cruzados.
- Idempotencia y recuperación: caída entre creación y registro, dos workers y lease vencido.
- Comandos que deben aprobar: comprobación afectada única en VPS y matriz CI del commit candidato.

## Recuperación

- Rollback de aplicación: no elimina realms, clientes ni secretos; deja la operación para reconciliación por versión compatible.
- Recuperación de datos: la eliminación o restauración de identidad requiere operación explícita y restauración aislada conforme a ADR-0015.

## Evidencia de cierre

- Archivos y commit: `137dd1c` incorpora el puerto, el adaptador, la configuración y el wiring durable; `2c7b32c` registra la prueba de integración y su evidencia en `tests/integration/tenant-identity-provisioner.test.ts`.
- Comandos y resultados: en el VPS autorizado, un Keycloak y Redis desechables validaron los tres escenarios de la prueba (aislamiento A/B y reintento, conflicto tipado por divergencia y concurrencia reanudable): **3/3 aprobados**. El principal `quantum-provisioner` se obtuvo mediante bootstrap de servicio y su secreto solo se montó desde un archivo temporal con modo `0600`; la prueba no lo devuelve ni lo persiste. No se ejecutó comprobación técnica local.
- Documentación actualizada: ADR-0021, índice ADR, esta ficha, estado, plantilla Compose y reglas operativas de infraestructura.
- Desviaciones del plan: la activación inicial queda separada para no almacenar o exponer un secreto.
- Pendientes o decisiones nuevas: entrega de activación, UI de miembros y cierre de `VERIFY`/`ACTIVATE` contra un realm CRM real; la integración desechable y el bootstrap del provisionador ya cuentan con evidencia en VPS.
