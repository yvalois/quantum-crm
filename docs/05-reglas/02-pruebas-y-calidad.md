# Pruebas y calidad

Estas reglas aplican a todo codigo y contrato. La decision completa vive en `../06-decisiones/ADR-0007-estrategia-pruebas-calidad.md`.

## Piramide de pruebas

- Pruebas unitarias para reglas puras, transformaciones, permisos y calculos.
- Pruebas de integracion para repositorios, migraciones, APIs, colas, archivos y proveedores simulados.
- Pruebas de extremo a extremo para recorridos comerciales y administrativos criticos.
- Pruebas de contrato para agentes, webhooks y adaptadores de terceros.

## Herramientas aprobadas

- Usar Vitest para unitarias, componentes sincronicos, integracion, contratos y arquitectura.
- Usar `@nestjs/testing` y Supertest para modulos y HTTP de NestJS.
- Usar React Testing Library para componentes sincronicos y Playwright para recorridos E2E o componentes asincronos de Next.js.
- Usar Testcontainers para PostgreSQL, Redis y los servicios desechables cuya semantica real se este verificando.
- Usar MSW en fronteras HTTP controladas; no como sustituto de persistencia, colas o migraciones reales.
- Fijar cada version exacta en el lockfile; no descargar ejecutores no declarados durante una prueba.

## Reglas

- Nombrar cada prueba por el comportamiento y resultado esperado.
- Usar Arrange, Act, Assert o una estructura equivalente claramente visible.
- Las pruebas deben ser deterministas, independientes y capaces de ejecutarse en cualquier orden.
- No depender de proveedores vivos, entornos compartidos, hora real o datos de produccion en la suite normal.
- Controlar reloj, identificadores y aleatoriedad cuando afecten el resultado.
- Una correccion de defecto incluye una prueba que falle antes del arreglo y pase despues.
- No reducir cobertura ni desactivar pruebas para aprobar un cambio.
- Cada prueba crea datos propios, limpia recursos y puede ejecutarse en cualquier orden.
- Una prueba de comportamiento del motor usa el servicio real desechable; un mock no acredita SQL, locks, expiracion o migraciones.
- No usar pausas temporales arbitrarias; esperar una condicion, respuesta, evento o estado observable.
- Prohibir `.only` en CI y exigir ID, responsable y condicion de retiro para `skip`, `fixme` o cuarentena.

## Cobertura

- `domain` y `application` mantienen como minimo 90% de lineas, sentencias y funciones y 85% de ramas.
- Los umbrales se aplican a sus rutas y no se diluyen con fixtures, codigo generado u otros paquetes.
- Interfaces y adaptadores no reducen su linea base sin justificacion aprobada.
- Excluir solo codigo generado, declaraciones de tipos o composition roots sin logica mediante una lista explicita.
- No crear pruebas sin afirmaciones utiles para aumentar porcentajes.
- Cumplir el porcentaje no sustituye escenarios de riesgo obligatorios.

## Riesgos obligatorios

Cuando correspondan, probar:

- Aislamiento entre dos clientes.
- Usuario sin permiso y recurso fuera de su alcance.
- Evento o solicitud repetida.
- Dos operaciones concurrentes sobre el mismo recurso.
- Fallo parcial y reanudacion.
- Version anterior y nueva conviviendo durante un despliegue.
- Entrada malformada, archivo peligroso y respuesta inesperada del proveedor.
- Fechas, zonas horarias, moneda, redondeo y valores limite cuando apliquen.
- Ausencia de secretos y datos sensibles en errores, logs y artefactos.

## E2E

- Mantener pocos recorridos independientes de alto valor.
- Priorizar selectores por rol, etiqueta y texto; usar `data-testid` solo sin alternativa semantica estable.
- Encapsular preparacion repetida en fixtures o page objects sin ocultar las afirmaciones comerciales.
- Ejecutar smoke tests afectados en Chromium en pull requests.
- Ejecutar recorridos criticos en Chromium, Firefox y WebKit en `main` y releases.
- Conservar reporte y traza saneados ante fallos; habilitar captura o video solo si aporta diagnostico.

## Intermitencia

- Un reintento diagnostico no convierte una prueba intermitente en aprobada.
- Registrar la prueba intermitente como defecto con ID y responsable.
- No poner en cuarentena un recorrido critico sin una cobertura alternativa aprobada.
- Corregir carreras, aislamiento y readiness; no normalizar fallos con reintentos ilimitados.

## Puertas de calidad

La ubicacion, frecuencia y reutilizacion de cada comprobacion cumplen [Ejecucion eficiente de verificaciones](15-ejecucion-verificaciones-vps.md). Las puertas siguientes deben aprobarse, pero no se ejecutan localmente ni se duplican cuando ya existe evidencia vigente para el mismo commit y entorno.

Antes de integrar deben pasar formato, lint, tipos, unitarias, cobertura, arquitectura, contratos, integracion afectada, build de consumidores afectados y el smoke E2E aplicable.

En `main` tambien pasan la integracion completa, las migraciones desde cero y desde la version anterior, el aislamiento entre dos perfiles y los recorridos E2E criticos. Una release agrega la matriz Chromium, Firefox y WebKit y liga resultados al commit y artefactos candidatos.

Un cambio en un paquete compartido prueba todos sus consumidores. Ninguna puerta fallida, prueba intermitente o cuarentena sin excepcion aprobada permite integrar o publicar.
