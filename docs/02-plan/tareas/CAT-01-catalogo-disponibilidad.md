# CAT-01 - Catálogo de ítems y disponibilidad

> Plan derivado de CAT-01, CAT-03, CAT-05, CAT-13, CAT-16, CAT-17 y CAL-12. No cierra la sección CAT-01..30.

## Identificación

- Requisito principal: CAT-01.
- Requisitos relacionados: CAT-02, CAT-03, CAT-04, CAT-05, CAT-06, CAT-13, CAT-14, CAT-16, CAT-17, CAT-18, CAT-20, CAL-12.
- Fase del MVP: 6, catálogo y comercio.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Responsable: Codex.
- Dependencias: IAM, Files para adjuntos, calendario para citas.
- Bloquea a: selección de productos en documentos y consulta del agente.
- ADR aplicables: 0002, 0003, 0004, 0005, 0006, 0013.

## Resultado esperado

Desde `/catalog`, un administrador crea categorías y fichas de producto o servicio, define campos propios, controla existencias o cupo por intervalo y puede vincular un servicio agendable al calendario sin vender ni consumir como stock las unidades alquiladas.

## Lectura obligatoria aplicada

- [x] Requisitos en funcionalidades.md, fase en mvp-piloto.md y subtareas en trabajo.md.
- [x] Estado, código, historial y pruebas existentes inspeccionados: menú deshabilitado y sin módulo CAT implementado.
- [x] Reglas de API, persistencia y límites de módulos revisadas.

## Alcance

### Incluido

- Ficha diferenciada de producto y servicio con precio, categoría, tipo y estado.
- Definiciones y valores dinámicos de características, reutilizables por tipo y específicos por ítem.
- Modos de disponibilidad independientes de producto/servicio: sin límite, existencias consumibles y cupo por intervalo.
- Movimientos idempotentes de stock y reservas de capacidad por período con comprobación concurrente.
- Vínculo explícito de un servicio agendable a calendario y liberación/revalidación de cupo al cancelar o reprogramar.
- Contratos, API, permisos de servidor, interfaz y migración forward-only.

### No incluido

- Variantes combinatorias, varios catálogos, importación/exportación, uso en cotizaciones y tools del agente; quedan en sus requisitos CAT propios.
- Conexión a proveedores de agenda externos.

## Impacto técnico

| Área | Impacto previsto |
|---|---|
| Aplicaciones y módulos | `catalog` en dominio, base, API y CRM web; coordinación pública con `scheduling` |
| Contratos | Schemas Zod v1 para ficha, categorías, campos, movimientos y reservas |
| Datos | Schema `catalog` y migración aditiva; referencia estable de calendario a ítem |
| Permisos | `crm:catalog:*` de mínimo privilegio; servidor comprueba cada acción |
| Configuración | Sin secretos nuevos |
| Operación | Migrador por perfil, candidata verificada en VPS antes de publicación |

## Plan de implementación

- [ ] Contratos y reglas puras para modos de disponibilidad y atributos.
- [ ] Migración, repositorios con transacciones, idempotencia y concurrencia.
- [ ] Casos de uso, permisos y endpoints; vínculo de agenda mediante contrato público.
- [ ] Interfaz de catálogo y flujo de alta/edición.
- [ ] Pruebas de permisos, aislamiento, validación, cupo y concurrencia.
- [ ] Despliegue y comprobación autenticada en VPS.

## Riesgos y mitigaciones

| Riesgo | Mitigación | Verificación |
|---|---|---|
| Doble reserva de un auto o cupo | Bloqueo transaccional por ítem/intervalo y comprobación antes de confirmar | Dos solicitudes simultáneas, una sola adjudicación final |
| Descontar alquiler como venta | Modos separados y movimientos exclusivos de `STOCK` | Prueba de alquiler y cancelación sin alterar saldo físico |
| Campos arbitrarios inválidos | Definiciones tipadas y validación de opciones/valores | Pruebas de cada tipo de campo |
| Cita y reserva quedan divergentes | Coordinación idempotente con compensación o transacción explícita | Reprogramación y cancelación concurrentes |

## Criterios de aceptación

- [ ] Fichas y categorías funcionan en InterAmerican con persistencia y permisos.
- [ ] Un servicio con dos unidades permite dos reservas simultáneas y rechaza la tercera para el mismo intervalo.
- [ ] Al cancelar o mover la cita se libera el intervalo anterior; una venta sí descuenta existencias mediante movimiento.
- [ ] Los campos específicos aparecen y se validan en la ficha sin nombres fijos como «tipo de vehículo».

## Plan de verificación

- Unitarias: tipos, atributos, disponibilidad y estados.
- Integración: PostgreSQL real con permisos, idempotencia y carreras concurrentes.
- E2E: crear categoría, servicio con cupo, agendar, cancelar y verificar cupo.
- Manual: `/catalog` y `/calendar` autenticados en InterAmerican.

## Recuperación

- Migración aditiva y forward-only; el código anterior ignora las tablas nuevas.
- Rollback de aplicación no borra datos; corrección de esquema mediante otra migración.
- Antes de migrar datos reales, comprobar respaldo y ruta de recuperación permitida.

## Evidencia de cierre

- Pendiente.
