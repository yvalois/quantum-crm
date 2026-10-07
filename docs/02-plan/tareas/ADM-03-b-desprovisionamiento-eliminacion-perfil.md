# ADM-03-b - Desprovisionamiento y eliminacion de perfil

> Esta ficha deriva `ADM-03`; no sustituye las fuentes de alcance ni presenta una eliminacion parcial como terminada.

## Identificacion

- Requisito principal: `ADM-03`
- Requisitos relacionados: `ADM-02`, `ADM-04`, `ADM-05`, `OPS-04`, `OPS-23`
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Dependencias: `ADM-03-a`, `ADM-04`, `ADM-05`
- ADR aplicables: ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0011 y ADR-0013

## Resultado esperado

Un operador autorizado puede solicitar desde Quantum Admin la eliminacion confirmada de un perfil. La plataforma conserva una operacion durable, detiene el runtime y retira recursos del perfil antes de eliminar su registro operativo y liberar capacidad. Una repeticion no duplica efectos ni puede afectar otro perfil.

## Alcance

### Incluido

- Solicitud confirmada, con `If-Match`, `Idempotency-Key`, permiso de servidor y evidencia del operador.
- Operacion durable y reanudable de desprovisionamiento.
- Retiro ordenado de contenedores, HTTPS, identidad, configuracion, secretos, almacenamiento, base de datos y reservas antes de retirar el perfil.
- Accion visible en Admin solo cuando el servidor admite la operacion.

### No incluido

- Eliminar automaticamente perfiles existentes durante el despliegue.
- Borrar respaldos, auditoria requerida o datos retenidos fuera del dominio de fallo.
- Reutilizar el `tenant_id` o el slug eliminado.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
| --- | --- | --- |
| Retirar solo el registro y dejar recursos | El perfil se conserva hasta confirmar los pasos externos y la liberacion de capacidad | Pruebas de pasos, reintentos y fallo intermedio |
| Borrar otro perfil | El destino se deriva del perfil y el slug debe confirmarse; el servidor valida `tenantProfileId` | Pruebas de identidad y autorizacion |
| Reintentos duplican efectos | Operacion durable, claves idempotentes y reconciliadores cerrados | Prueba de repeticion y lease |

## Plan de verificacion

- Pruebas de dominio, contratos, repositorio, API/BFF e interfaz afectada.
- Comprobacion en VPS con un perfil sintético creado para esta finalidad; no se usa un perfil del propietario sin su confirmacion en la interfaz.
- Verificar que un error conserva estado y evidencia recuperable, y que un reintento no borra otro perfil.

## Recuperacion

- La aplicacion puede revertirse antes de solicitar operaciones nuevas; no revierte efectos externos ya confirmados.
- Una operacion fallida queda visible y reanudable desde su paso seguro; la restauracion de datos se rige por la politica de backup.

## Evidencia de cierre

- Pendiente de implementacion y despliegue del bloque.
