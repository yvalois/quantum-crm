# Pruebas y calidad

## Piramide de pruebas

- Pruebas unitarias para reglas puras, transformaciones, permisos y calculos.
- Pruebas de integracion para repositorios, migraciones, APIs, colas, archivos y proveedores simulados.
- Pruebas de extremo a extremo para recorridos comerciales y administrativos criticos.
- Pruebas de contrato para agentes, webhooks y adaptadores de terceros.

## Reglas

- Nombrar cada prueba por el comportamiento y resultado esperado.
- Usar Arrange, Act, Assert o una estructura equivalente claramente visible.
- Las pruebas deben ser deterministas, independientes y capaces de ejecutarse en cualquier orden.
- No depender de servicios reales, hora real o datos de produccion en la suite normal.
- Controlar reloj, identificadores y aleatoriedad cuando afecten el resultado.
- Una correccion de defecto incluye una prueba que falle antes del arreglo y pase despues.
- No reducir cobertura ni desactivar pruebas para aprobar un cambio.

## Riesgos obligatorios

Cuando correspondan, probar:

- Aislamiento entre dos clientes.
- Usuario sin permiso y recurso fuera de su alcance.
- Evento o solicitud repetida.
- Dos operaciones concurrentes sobre el mismo recurso.
- Fallo parcial y reanudacion.
- Version anterior y nueva conviviendo durante un despliegue.
- Entrada malformada, archivo peligroso y respuesta inesperada del proveedor.

## Puertas de calidad

Antes de integrar deben pasar compilacion, tipos, lint, pruebas afectadas y suite acordada. Las pruebas intermitentes se tratan como defectos; no se normalizan mediante reintentos ilimitados.
