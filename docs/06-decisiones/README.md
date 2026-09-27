# Decisiones de arquitectura

Los registros ADR explican decisiones estructurales y evitan discutir o implementar varias veces la misma cuestion.

## Indice

| ADR | Titulo | Estado | Fecha |
|---|---|---|---|
| [0001](ADR-0001-stack-base.md) | Stack base de Quantum CRM | aceptado | 2026-09-16 |
| [0002](ADR-0002-limites-modulos-dependencias.md) | Límites de módulos y dependencias | aceptado | 2026-09-16 |
| [0003](ADR-0003-aislamiento-multi-tenant.md) | Aislamiento multi-tenant por perfil | aceptado | 2026-09-16 |
| [0004](ADR-0004-autenticacion-autorizacion.md) | Autenticación y autorización | aceptado | 2026-09-16 |
| [0005](ADR-0005-diseno-contratos-api.md) | Diseño, versionado y contratos de API | aceptado | 2026-09-16 |
| [0006](ADR-0006-persistencia-transacciones-migraciones.md) | Persistencia, transacciones y evolución de datos | aceptado | 2026-09-16 |
| [0007](ADR-0007-estrategia-pruebas-calidad.md) | Estrategia de pruebas y puertas de calidad | aceptado | 2026-09-16 |
| [0008](ADR-0008-entornos-configuracion-secretos.md) | Entornos, configuracion y secretos | aceptado | 2026-09-16 |
| [0009](ADR-0009-integracion-entrega-releases.md) | Integracion, entrega y releases | aceptado | 2026-09-16 |
| [0010](ADR-0010-observabilidad-manejo-fallos.md) | Observabilidad y manejo de fallos | aceptado | 2026-09-16 |
| [0011](ADR-0011-trabajos-asincronos-automatizaciones.md) | Trabajos asincronos y automatizaciones durables | aceptado | 2026-09-16 |
| [0012](ADR-0012-integracion-agentes-langgraph-mcp.md) | Integracion nativa de agentes LangGraph mediante MCP | aceptado | 2026-09-16 |
| [0013](ADR-0013-archivos-almacenamiento-objetos.md) | Archivos y almacenamiento de objetos | aceptado | 2026-09-18 |
| [0014](ADR-0014-arquitectura-frontends-sistema-visual.md) | Arquitectura de frontends y sistema visual | aceptado | 2026-09-18 |
| [0015](ADR-0015-respaldo-restauracion-continuidad.md) | Respaldo, restauracion y continuidad | aceptado | 2026-09-18 |
| [0016](ADR-0016-aprovisionamiento-bases-perfil.md) | Aprovisionamiento idempotente de bases por perfil | aceptado | 2026-09-21 |
| [0017](ADR-0017-secretos-perfil.md) | Secretos idempotentes de base por perfil | aceptado | 2026-09-21 |
| [0018](ADR-0018-ejecucion-restringida-compose-perfil.md) | Ejecución restringida de Compose por perfil | aceptado | 2026-09-21 |

| [0019](ADR-0019-rutas-https-por-perfil.md) | Rutas HTTPS por perfil | aceptado | 2026-09-22 |
| [0020](ADR-0020-identidad-oidc-github-actions-releases.md) | Identidad OIDC de GitHub Actions para candidatas de release | aceptado | 2026-09-22 |
| [0021](ADR-0021-identidad-oidc-por-perfil.md) | Identidad OIDC y sesiones por perfil | aceptado | 2026-09-22 |
| [0022](ADR-0022-entrega-interna-activacion-inicial.md) | Entrega interna de activacion inicial | aceptado | 2026-09-26 |

## Convencion

- Nombre: `ADR-0001-titulo-breve.md`.
- Estados: `propuesto`, `aceptado`, `sustituido` o `rechazado`.
- Una decision aceptada no se edita para cambiar su conclusion; se crea otro ADR que la sustituya.
- El ADR describe contexto, decision, alternativas, consecuencias y plan de validacion.

Copiar `ADR-0000-plantilla.md` para iniciar una decision.
