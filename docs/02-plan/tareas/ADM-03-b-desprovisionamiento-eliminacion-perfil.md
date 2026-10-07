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
- Reutilizar el `tenant_id` eliminado o reactivar sus recursos. El slug puede asignarse a un perfil nuevo solo cuando el anterior ya esta `DELETED`; el nuevo perfil recibe otro UUID y recursos aislados.

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

- Candidato funcional `3feca81` validado en el VPS con lint, typecheck de `admin-web`, `admin-api`, `deploy-host` y `deploy-executor`, 47 pruebas focalizadas y build de los cuatro servicios.
- `admin-web`, `admin-api`, `deploy-executor` y `deploy-host` quedaron desplegados y saludables.
- Quantum Admin consulta la operacion vigente cada dos segundos y presenta porcentaje, paso, registro, estimacion, error recuperable y reintento.
- La solicitud permite eliminar un perfil en `PROVISIONING`: cancela primero la operacion de alta y crea una operacion durable de baja. El conflicto ya no se presenta incorrectamente como `Tenant profile already exists`.
- Las operaciones de `quantum-piloto`, `quantum-demo`, `quantum-showcase`, `quantum-demo-jueves` e `interamerican` terminaron en `SUCCEEDED/TOMBSTONE`; los cinco perfiles quedaron `DELETED` y desaparecen del listado operativo normal.
- La creacion de perfiles conserva evidencia funcional: `interamerican` alcanzo `VERIFY` con servidor, release y configuracion antes de que se solicitara su eliminacion.

## Pendientes de estabilizacion posterior

- Completar el retiro fisico de identidad, configuracion, objetos y base de datos por adaptadores propietarios. El flujo actual retira el runtime, la ruta y la red, libera capacidad y conserva los registros tecnicos; por esta diferencia respecto del alcance total, la ficha permanece abierta.
- La ruta HTTPS operativa se elimina de `tenant_https_routes` antes de convertir el perfil en tombstone, de modo que un perfil nuevo con el mismo slug pueda registrar su hostname sin colisionar con el perfil `DELETED`; la operacion y sus resultados conservan la evidencia historica.
