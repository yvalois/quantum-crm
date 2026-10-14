# REP-01 — Tablero operativo dinámico

## Identificación

- Requisito principal: REP-01.
- Relacionados: REP-03, REP-06, REP-12, REP-14, REP-26.
- Fase: 9, reportes y tableros.
- Estado: [estado](../../04-proceso/estado.md).
- Decisiones: ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0007.

## Resultado esperado

`/` muestra conteos comerciales completos, no los primeros elementos de listas paginadas. El período y las visualizaciones se pueden ajustar, y la selección permanece al regresar. Los datos respetan el alcance y los permisos de cada miembro en el servidor.

## Auditoría y alcance

- Existente: `crm-dashboard.tsx` calcula cuatro indicadores a partir de listados acotados y asume COP cuando no hay oportunidades. No existe módulo de reportes ni consulta agregada.
- Incluido: métricas base, período global, visualizaciones básicas y disposición editable; prueba de alcance, contrato y ruta autenticada.
- Excluido de este bloque: fórmulas, campos personalizados arbitrarios, exportación, tableros compartidos, automatización, pronósticos y todos los demás REP no mencionados.

## Impacto

- Reporting solo lee datos comerciales mediante una consulta explícita; la configuración editable es propiedad de reporting.
- Contrato versionado y API autenticada; el cliente nunca envía un perfil ni un alcance confiado.
- Migración aditiva para configuración, sin backfill ni alteración de datos comerciales.
- El monto conserva moneda; no se suman monedas diferentes.

## Implementación y verificación

- [x] Contrato y repositorio de agregación con alcance y período acotado.
- [x] Preferencias persistentes validadas con control de concurrencia.
- [x] Interfaz de indicadores/gráficos con controles de edición y estados vacíos.
- [x] Pruebas focalizadas en VPS, migración aislada, CI y smoke público de InterAmerican.
- [ ] Comprobación autenticada de datos y personalización en InterAmerican.

## Recuperación

Migración forward-only compatible. Una reversión de aplicación deja la tabla de preferencias inerte y conserva datos; no sustituye una restauración. La falta de respaldo externo verificado en este entorno de desarrollo es una excepción temporal ya documentada, no una prueba de recuperación.

## Evidencia de cierre

VPS, candidato `ac8c2ef1` (2026-10-14): typecheck de contratos, dominio, base, API y CRM web; seis pruebas unitarias focalizadas; ESLint afectado; compilación de API y build de CRM web. PostgreSQL 18 sintético: 34 migraciones aplicadas, tabla reporting utilizable por rol runtime, agregaciones de los cinco dominios con alcances `ASSIGNED` y `PROFILE`, y preferencias con versión optimista. Los siete checks CI del PR #157 pasaron. Imágenes construidas desde el archivo Git del commit exacto. InterAmerican: migración `20261014030000_rep_01_dashboard_preferences` aplicada; API y CRM web `healthy`; readiness 200; `/` sin sesión 307; BFF y API de tablero sin sesión 401. No se insertaron datos ficticios en el perfil. Pendiente: verificar lectura y guardado autenticados con un usuario real; la candidata temporal no equivale a promoción registrada.
