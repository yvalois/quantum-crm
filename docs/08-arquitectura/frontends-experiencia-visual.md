# Frontends y referencia visual

- Estado: referencia aprobada; primera integracion funcional de `crm-web` desplegada
- Ultima actualizacion: 2026-09-30
- Trabajo relacionado: `PROY-020`, `PROY-025`
- Decision: [ADR-0014](../06-decisiones/ADR-0014-arquitectura-frontends-sistema-visual.md)

## Proyecto visual

| Campo | Valor |
|---|---|
| Nombre | **Quantum CRM Enterprise Platform** |
| Herramienta | Google Stitch |
| Enlace | <https://stitch.withgoogle.com/projects/7483537794480558185?pli=1> |
| Alcance | `crm-web`, `portal-web` y `admin-web` |
| Datos | Organizaciones, personas, metricas e identificadores ficticios |
| Autoridad | Referencia de UX/UI; no sustituye requisitos, ADR, contratos ni pruebas |

Este enlace es la entrada estable para volver al boceto. Si el proyecto se duplica, mueve o reemplaza, esta tabla se actualiza en el mismo cambio y se conserva la relacion con el proyecto anterior.

## Como debe utilizarse

Antes de implementar o cambiar una pantalla:

1. Identificar los requisitos funcionales y la aplicacion propietaria.
2. Consultar el flujo y la pantalla relacionados en Stitch.
3. Verificar permisos, aislamiento, estados y contratos en la documentacion del repositorio.
4. Registrar en el plan de implementacion que pantalla se uso como referencia y cualquier diferencia deliberada.
5. Probar comportamiento real, responsive y accesibilidad; la similitud visual no acredita el requisito.

No se copian del prototipo secretos, nombres reales, metricas supuestamente reales ni decisiones tecnicas que contradigan un ADR. Los textos y datos visibles son contenido de demostracion.

## Productos y audiencias

| Aplicacion | Usuario | Proposito | Limite principal |
|---|---|---|---|
| `crm-web` | Asesor, supervisor y administrador de empresa | Operar conversaciones, ventas, tareas, agenda, catalogo, documentos, automatizaciones, reportes y el agente | No contiene administracion de la plataforma Quantum |
| `portal-web` | Cliente final de la empresa | Consultar y ejecutar acciones propias mediante una experiencia simple, movil y white-label | No muestra pipelines internos, telemetria, infraestructura ni datos de otros clientes |
| `admin-web` | Operador interno de Quantum | Administrar tenants, infraestructura, releases y continuidad operativa | No consulta contactos, conversaciones, oportunidades ni documentos comerciales |

## Inventario visual actual

El lienzo conserva tres grupos separados. Los conteos describen pantallas de referencia, no funcionalidades implementadas.

### `crm-web` — 13 pantallas

- Resumen.
- Conversaciones.
- Contactos.
- Oportunidades.
- Tareas.
- Calendario.
- Formularios.
- Catalogo e inventario.
- Documentos y facturacion.
- Automatizaciones.
- Reportes.
- Agente Quantum.
- Configuracion de empresa.

### `portal-web` — 13 pantallas y variantes

El conjunto cubre inicio, mensajes y soporte, citas, documentos, pagos, cuenta y estados de autoservicio. Incluye variantes moviles explicitas para Inicio, Mensajes y Citas. La experiencia evita exponer el modelo operativo interno del CRM.

### `admin-web` — 17 pantallas

Pantallas base:

- Resumen de plataforma.
- Tenants y organizaciones.

Pantallas complementarias:

- Acceso reforzado, MFA, dispositivos y sesiones.
- Detalle operativo de tenant.
- Asistente para crear tenant.
- Releases, digests, SBOM y procedencia.
- Detalle de release y rollback de aplicacion separado de datos.
- Despliegues y operaciones.
- Detalle de operacion.
- Infraestructura y VPS.
- Backups y politicas.
- Asistente de restauracion independiente.
- Incidentes y mantenimiento.
- Operadores y roles.
- Auditoria append-only.
- Configuracion de plataforma sin secretos.
- Estados transversales y recuperacion segura.

## Direccion visual

- `crm-web`: shell de productividad claro, denso cuando la tarea lo requiere y centrado en el trabajo diario.
- `portal-web`: interfaz calida, simple, responsive y adaptable a la marca de cada empresa.
- `admin-web`: control plane grafito con acentos cian, ambar y rojo reservado para riesgo o fallo.
- Tipografia de interfaz: Instrument Sans; IBM Plex Mono solo para identificadores, digests, auditoria y datos tecnicos.
- Accesibilidad minima: WCAG AA, foco visible, operacion por teclado, etiquetas y estados que no dependan solo del color.

## Estado de implementacion

`crm-web` ya implementa el shell compartido Quantum Precision, un dashboard conectado a las APIs existentes y las rutas funcionales de conversaciones, contactos, oportunidades, tareas y equipo. La misma imagen candidata fue validada y desplegada en el perfil piloto; calendario, formularios, catalogo, documentos, automatizaciones, reportes, agente y configuracion permanecen identificados como proximos y no se presentan como terminados.

`portal-web` y las pantallas restantes conservan a Stitch como referencia pendiente de implementacion. La existencia de una pantalla o su similitud visual no acredita por si sola un requisito funcional; el estado comprobable permanece en [estado.md](../04-proceso/estado.md).
