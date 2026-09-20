# ADM-01-f - Renovacion segura de sesion administrativa

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado, y sus casillas no reemplazan `docs/02-plan/trabajo.md`.

## Identificacion

- Requisito principal: `ADM-01`
- Requisitos relacionados: `OPS-01`, `OPS-23`
- Fase del MVP: 2. Plataforma Quantum
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: `ADM-01-a` a `ADM-01-e`, ADR-0004 y ADR-0008
- Bloquea a: aprovisionamiento persistente y E2E administrativo completo
- ADR, arquitectura o diseno aplicables: autenticacion, configuracion, seguridad, pruebas y monorepo

## Resultado esperado

La sesion opaca de `admin-web` renueva el access token antes de expirar sin entregar tokens al navegador, serializa la rotacion del refresh token entre replicas y se invalida de forma cerrada cuando ya no puede renovarse.

## Lectura obligatoria aplicada

- [x] Requisito, MVP, subtareas, estado y ficha anterior.
- [x] Reglas de seguridad, pruebas, configuracion y Git.
- [x] ADR de autenticacion y configuracion, arquitectura y documentacion oficial pertinente.

## Auditoria del trabajo existente

- Busquedas realizadas: sesion web, access token, refresh token, Redis, BFF, proveedor OIDC y pruebas de integracion.
- Codigo o documentacion encontrados: sesion Redis opaca y server-side, Authorization Code con PKCE/MFA, revocacion en logout y BFF fijo; no existe expiracion registrada ni renovacion.
- Pruebas e historial encontrados: pruebas unitarias del servicio y prueba de integracion Redis; `ADM-01-e` excluyo expresamente la renovacion.
- Decision: extender las abstracciones existentes; conservar el limite absoluto, rotar credenciales dentro de Redis y usar un lease atomico por sesion para impedir el uso concurrente del mismo refresh token.

## Alcance

### Incluido

- Registrar y validar la expiracion del access token.
- Renovar server-side dentro de una ventana acotada antes del vencimiento.
- Serializar la renovacion por sesion con lease Redis de propietario verificable.
- Conservar el limite absoluto e invalidar la sesion si la renovacion falla.
- Pruebas unitarias y de integracion Redis, con validacion final en VPS.

### No incluido

- Aprovisionamiento persistente de Keycloak, Redis u operador inicial.
- E2E real con OTP, DNS o TLS.
- Interfaz visual o cierre completo de `ADM-01`.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | Servicio de autenticacion de `admin-web` y adaptador OIDC |
| Contratos y eventos | Contratos internos de sesion y proveedor; sin API publica nueva |
| Datos y migraciones | Schema efimero Redis compatible; sesiones antiguas fallan cerradas |
| Permisos y aislamiento | Sin cambio; sesion ligada al operador de plataforma |
| Configuracion y secretos | Sin secreto nuevo; tokens permanecen server-side |
| Observabilidad y operacion | Fallo uniforme sin registrar tokens |
| Documentacion | Ficha y estado oficial |

## Plan de implementacion

- [x] Extender el token set y la sesion con expiracion verificable.
- [x] Implementar refresh grant y rotacion estricta en el proveedor OIDC.
- [x] Implementar lease Redis y actualizacion de sesion solo por su propietario.
- [x] Renovar desde el servicio antes de devolver la sesion al BFF.
- [x] Cubrir expiracion, rotacion, concurrencia y fallo cerrado.
- [x] Ejecutar CI en VPS y registrar evidencia.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Dos replicas reutilizan el refresh token | Lease Redis NX con propietario y liberacion compare-delete | Prueba concurrente y de propietario incorrecto |
| Token vencido llega a `admin-api` | Margen de renovacion previo al vencimiento | Prueba en el borde temporal |
| Refresh revocado deja sesion utilizable | Borrado fail-closed ante cualquier fallo | Prueba de proveedor fallido |
| El refresh extiende indefinidamente la sesion | TTL limitado por expiracion absoluta original | Prueba del limite absoluto |
| Tokens aparecen en cliente o logs | Persistencia y uso exclusivamente server-side | Inspeccion de respuestas y codigo |

## Criterios de aceptacion

- [x] Una sesion con token vigente se reutiliza sin llamar al proveedor.
- [x] Una sesion proxima a expirar se renueva y guarda de forma server-side.
- [x] La rotacion conserva el sujeto y el limite absoluto y exige un refresh token nuevo.
- [x] Solo el propietario del lease puede actualizar, invalidar o liberarlo.
- [x] Si el lease esta ocupado o el proveedor falla no se reutiliza el refresh token ni se acepta una credencial vencida.
- [x] Las pruebas y CI aplicables aprueban en el VPS.

## Plan de verificacion

- Pruebas unitarias: servicio OIDC y decisiones temporales.
- Pruebas de integracion o contratos: Redis real para lease, actualizacion y TTL.
- Pruebas E2E: diferidas a la rebanada persistente siguiente.
- Comprobacion manual: inspeccion de que navegador y respuestas no contienen tokens.
- Seguridad, permisos y aislamiento: fallo cerrado, propietario del lease y rotacion estricta.
- Idempotencia, concurrencia y recuperacion: exclusividad por sesion y liberacion segura.
- Comandos que deben aprobar: pruebas focalizadas, `pnpm run ci` en VPS.

## Recuperacion

- Compatibilidad o migracion: las sesiones previas sin expiracion se invalidan y requieren nuevo login.
- Rollback de aplicacion: revertir conjuntamente servicio, schema y adaptador Redis.
- Recuperacion de datos, si aplica: no aplica; Redis conserva estado efimero revocable.

## Evidencia de cierre

- Archivos, commits o PR: implementacion `21a4eb1` y plan `1ee14f3` sobre `feat/ADM-01-session-refresh`; no existe remoto configurado para push o PR.
- Comandos y resultados: sobre el commit exacto `21a4eb1`, `pnpm run ci` aprobo en el VPS dentro de `node:24-bookworm`: formato, lint, typecheck de 17 workspaces, 41 pruebas de configuracion, 136 pruebas generales, 14 pruebas de arquitectura y build de los 17 workspaces aplicables. La prueba focalizada aprobo 3/3 escenarios contra Redis real y aislado, incluida la exclusion y mutacion condicionada por propietario.
- Documentacion actualizada: ficha y estado oficial. El ADR-0004 ya establece tokens server-side, access tokens breves, rotacion y limites de sesion, por lo que no fue necesaria una decision nueva.
- Desviaciones del plan: ninguna funcional. La validacion local uso Node 20 solo como señal rapida; la evidencia oficial se ejecuto con Node 24 en el VPS. El intento inicial de transmitir el archivo tar por la canalizacion de PowerShell altero el flujo binario; se repitio con un archivo temporal verificable y se limpio junto con los artefactos remotos.
- Pendientes o decisiones nuevas: aprovisionamiento persistente de Keycloak y Redis, operador inicial y E2E OTP permanecen en la siguiente rebanada. `ADM-01` continua abierto.
