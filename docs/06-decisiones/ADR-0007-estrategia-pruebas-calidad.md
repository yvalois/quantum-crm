# ADR 0007 Estrategia de pruebas y puertas de calidad

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: todos los requisitos funcionales, operativos y de plataforma

## Contexto

Quantum combina dos aplicaciones web, APIs, workers, PostgreSQL, Redis, Keycloak, almacenamiento S3, integraciones y agentes externos JavaScript o Python. Los riesgos principales no se limitan a funciones aisladas: incluyen aislamiento entre perfiles, permisos, concurrencia, reintentos, migraciones, compatibilidad de contratos y recorridos que atraviesan varios procesos.

El monorepo necesita una estrategia comun que produzca retroalimentacion rapida sin sustituir las pruebas reales por mocks. Tambien debe impedir que la cobertura numerica, los reintentos o una suite E2E excesiva oculten defectos y lentitud.

## Decision

Vitest es el ejecutor comun para pruebas unitarias, de componentes sincronicos, integracion, contratos y arquitectura. Playwright prueba los recorridos E2E y los comportamientos web que requieren un navegador o componentes asincronos de Next.js.

Las integraciones con infraestructura se prueban contra servicios desechables mediante Testcontainers. MSW simula fronteras HTTP controladas, pero no reemplaza PostgreSQL, Redis ni los componentes internos cuya integracion se quiere comprobar.

Las puertas de calidad se dividen por costo: cada pull request recibe comprobaciones rapidas y deterministas; `main` y las releases agregan migraciones, aislamiento completo, matrices E2E y recorridos de recuperacion.

## Herramientas

| Necesidad | Herramienta aprobada | Alcance |
|---|---|---|
| Unitarias y aplicacion | Vitest | Dominio, casos de uso, transformaciones, permisos y calculos |
| NestJS | Vitest con `@nestjs/testing` | Modulos, inyeccion, guards, filtros y composicion |
| HTTP de NestJS | Supertest | Aplicacion iniciada y contrato HTTP observable |
| Componentes React sincronicos | React Testing Library sobre Vitest | Comportamiento, accesibilidad e interaccion del usuario |
| Red simulada | MSW | APIs externas o escenarios controlados en frontend y Node |
| Infraestructura | Testcontainers for Node.js | PostgreSQL, Redis y servicios compatibles desechables |
| E2E web | Playwright Test | CRM, administrador y recorridos criticos en navegador real |
| Cobertura | Proveedor V8 de Vitest | Medicion del codigo propio incluido explicitamente |

Las versiones exactas se fijan en el lockfile al crear el monorepo. Cambiar de herramienta principal requiere un ADR que demuestre la necesidad y una ruta de migracion.

## Niveles de prueba

### Unitarias

- Prueban dominio y aplicacion sin NestJS, red, reloj real ni base de datos.
- Cubren reglas puras, estados, permisos, redondeos, transiciones e idempotencia logica.
- Usan fakes pequenos para puertos propios; no replican el comportamiento interno de PostgreSQL o Redis.
- Viven junto al codigo como `*.test.ts`.

### Componentes

- Prueban componentes React desde roles, nombres accesibles, texto y acciones observables.
- Evitan consultar estado interno, clases CSS o estructura incidental.
- Los componentes sincronicos pueden usar React Testing Library.
- Los Server Components asincronos y los flujos dependientes de App Router se prueban mediante E2E hasta que la herramienta aprobada los soporte de forma fiable.
- `data-testid` se reserva para elementos sin selector semantico estable.

### Integracion

- Prueban repositorios, migraciones, transacciones, outbox, inbox, colas, sesiones y adaptadores contra componentes reales desechables.
- PostgreSQL y Redis se levantan con Testcontainers; Keycloak y un servicio S3 compatible se agregan cuando el caso de uso los necesite.
- Cada suite recibe datos y namespaces aislados y destruye sus recursos al terminar.
- Las pruebas de migracion reconstruyen una base vacia y actualizan una base de la version anterior.
- Un mock no acredita una caracteristica propia del motor, como constraints, locks, aislamiento, expiracion o semantica de cola.

### Contratos

- Validan solicitudes, respuestas, errores, eventos, webhooks y herramientas de agentes contra los schemas versionados.
- Comprueban OpenAPI, AsyncAPI y JSON Schema generados desde `packages/contracts`.
- Ejecutan ejemplos validos e invalidos, compatibilidad hacia atras y consumidores JavaScript, TypeScript o Python cuando corresponda.
- Un proveedor simulado reproduce solo el contrato documentado y conserva fixtures sin datos reales.
- Se adopta consumer-driven contract testing solo cuando exista un consumidor independiente que justifique su operacion.

### Arquitectura

- Comprueban imports permitidos, puntos publicos, capas y dependencias entre aplicaciones y paquetes.
- Fallan ante imports profundos entre modulos, acceso web a `database`, dominio dependiente de frameworks o CRM dependiente del ejecutor.
- Complementan ESLint y las restricciones de exports; no dependen solo de revision manual.

### Extremo a extremo

- Playwright prueba pocos recorridos de alto valor mediante interfaz y APIs reales del entorno de prueba.
- Cada prueba crea o reserva sus propios datos y puede ejecutarse independientemente y en cualquier orden.
- Los selectores priorizan rol, etiqueta y texto visible.
- Las esperas se basan en estados observables, respuestas o readiness; se prohiben pausas temporales arbitrarias.
- Fixtures y page objects encapsulan navegacion o preparacion repetida, no las afirmaciones comerciales del escenario.
- En pull requests se ejecutan smoke tests criticos en Chromium.
- En `main` y antes de una release, los recorridos criticos se ejecutan en Chromium, Firefox y WebKit; la matriz se reduce solo con evidencia y decision documentada.

## Matriz minima de riesgos

Todo cambio cubre los riesgos aplicables, aunque ya alcance el porcentaje numerico:

- Camino esperado y validacion de entrada.
- Principal sin permiso y recurso fuera de su alcance.
- Dos perfiles con intentos cruzados de lectura y escritura.
- Solicitud, webhook, evento o trabajo repetido.
- Concurrencia sobre el mismo recurso.
- Fallo parcial, reanudacion y resultado observable.
- Version anterior y nueva conviviendo durante despliegue o migracion.
- Limites, valores vacios, fechas, zona horaria, moneda y redondeo.
- Archivo, respuesta de proveedor o payload de agente malformado.
- Redaccion de secretos y datos sensibles en errores y artefactos.

Una correccion de defecto incluye una prueba de regresion que falla antes del arreglo y pasa despues.

## Cobertura

La cobertura mide huecos; no demuestra por si sola correccion.

- `domain` y `application` deben alcanzar al menos 90% de lineas, sentencias y funciones, y 85% de ramas.
- Los umbrales se aplican a las rutas correspondientes del codigo propio; no se diluyen con codigo generado, fixtures o otros paquetes.
- Interfaces y adaptadores se miden desde el inicio y no pueden reducir su linea base sin justificacion aprobada.
- Codigo generado, declaraciones de tipos y composition roots sin logica pueden excluirse mediante una lista explicita revisada.
- No se agregan pruebas sin afirmaciones utiles para aumentar un porcentaje.
- Un riesgo critico sin escenario impide el cierre aunque los umbrales se cumplan.

Los umbrales pueden aumentar sin ADR. Reducirlos o ampliar exclusiones requiere justificacion en el cambio y aprobacion explicita; una reduccion estructural requiere sustituir esta decision.

## Datos, tiempo y aislamiento de pruebas

- Se usan factories y builders tipados con datos sinteticos minimos.
- Cada prueba declara los datos relevantes; no depende del residuo de otra prueba.
- Reloj, UUID, aleatoriedad y zona horaria se controlan cuando influyen en el resultado.
- Ningun fixture, captura, traza o reporte contiene secretos o datos de clientes.
- No se ejecutan suites normales contra produccion ni contra proveedores reales con efectos comerciales.
- Las pruebas que verifican dos perfiles usan credenciales, bases, realms, archivos y colas separados conforme a ADR-0003.
- Los puertos dinamicos y recursos unicos permiten ejecucion paralela sin colisiones.

## Dobles de prueba

- Un fake implementa un puerto propio con semantica pequena y explicita.
- Un stub controla una respuesta puntual; un spy verifica una interaccion realmente contractual.
- No se simulan clases internas solo para igualar su implementacion.
- MSW intercepta en la frontera de red y comparte handlers cuando frontend y Node consumen el mismo contrato.
- Los errores, latencia, duplicados y respuestas malformadas de proveedores tienen escenarios dedicados.
- Una prueba que pretende validar SQL, migraciones, locks o Redis usa el servicio real desechable.

## Determinismo y pruebas intermitentes

- Las pruebas obligatorias no usan reintentos automaticos para convertir un fallo en exito.
- Los reintentos diagnosticos se ejecutan fuera de la puerta o se reportan como `flaky`; nunca autorizan el merge.
- Una prueba intermitente se trata como defecto con ID, responsable y evidencia.
- Una cuarentena necesita ID, motivo, propietario y condicion de retiro; no puede cubrir un recorrido critico sin reemplazo.
- `skip`, `fixme`, `.only` y exclusiones condicionadas fallan o se auditan en CI.
- La lentitud se resuelve separando niveles, paralelizando datos aislados y midiendo cuellos de botella, no borrando escenarios obligatorios.

## Puertas de calidad

### Pull request

Antes de integrar deben pasar:

1. `format:check`.
2. `lint`, incluidos limites de imports.
3. `typecheck` estricto.
4. Pruebas unitarias y `test:coverage` con sus umbrales.
5. Pruebas de arquitectura.
6. Pruebas de contratos y artefactos generados afectados.
7. Pruebas de integracion de los paquetes afectados.
8. Build de todas las aplicaciones consumidoras afectadas.
9. Smoke E2E en Chromium cuando el cambio toca un recorrido desplegable.

La seleccion por impacto optimiza ejecucion, pero un cambio de paquete compartido incluye todos sus consumidores. La CI completa sigue siendo invocable con un comando raiz estable.

### Rama principal

Ademas de las puertas del pull request:

- Se ejecuta la suite de integracion completa.
- Se reconstruyen las historias de migracion desde cero.
- Se prueba al menos una actualizacion desde la version anterior soportada.
- Se comprueba aislamiento real entre dos perfiles.
- Se ejecutan los recorridos E2E criticos y se publican resultados saneados.

### Release

Antes de autorizar una release:

- Todas las puertas de `main` corresponden al commit y digests candidatos.
- Los recorridos criticos pasan en Chromium, Firefox y WebKit.
- Se validan migraciones, compatibilidad de contratos y rollback de aplicacion permitido.
- No existen pruebas fallidas, intermitentes o en cuarentena que cubran el cambio sin una excepcion aprobada.
- Los artefactos de prueba identifican commit, entorno y versiones sin contener secretos.

## Artefactos de fallo

- Vitest produce reportes de consola y formatos aptos para CI.
- Playwright conserva traza y reporte HTML ante fallos; capturas o video se habilitan cuando aporten diagnostico adicional.
- Logs de aplicaciones y contenedores se asocian al test mediante correlacion.
- Los artefactos tienen retencion limitada y se sanean como cualquier otro log.
- La traza no se habilita para todas las pruebas exitosas si su costo no aporta evidencia.

## Alternativas consideradas

### Jest como ejecutor unico

NestJS lo integra de forma predeterminada y tiene un ecosistema amplio. Se rechaza como estandar porque Vitest ofrece soporte directo de TypeScript, ESM, proyectos de monorepo y cobertura V8, y Next.js mantiene una guia oficial para usarlo. `@nestjs/testing` no obliga a conservar Jest.

### Playwright para todos los niveles

Se rechaza porque un navegador completo hace mas lentas y dificiles de localizar las pruebas de reglas puras, repositorios y contratos.

### Cypress para E2E

Es una alternativa valida, pero se elige Playwright por su soporte directo de Chromium, Firefox y WebKit, aislamiento de contextos y trazas adecuadas para CI.

### Simular toda la infraestructura

Se rechaza porque mocks de PostgreSQL, Redis, Keycloak o S3 no reproducen constraints, locks, expiracion, protocolos ni migraciones reales.

### Probar contra entornos compartidos

Se rechaza como suite normal porque introduce datos residuales, colisiones, indisponibilidad y dependencia de estado externo.

### Exigir 100% de cobertura global

Se rechaza porque incentiva pruebas superficiales y mezcla codigo critico con adaptadores o composicion. Se usan umbrales altos en dominio y una matriz de riesgos obligatoria.

## Consecuencias positivas

- Un solo ejecutor cubre la mayor parte del codigo TypeScript.
- Los defectos de infraestructura y contratos se detectan antes del E2E.
- Los recorridos web conservan evidencia reproducible de sus fallos.
- La cobertura se concentra en reglas con mayor costo de error.
- El aislamiento multi-tenant y la recuperacion se vuelven criterios comprobables.
- La suite puede crecer por niveles sin convertir cada cambio en un despliegue completo.

## Costos y riesgos

- Testcontainers requiere un runtime de contenedores en desarrollo y CI.
- La matriz de navegadores y los servicios reales aumentan tiempo y consumo.
- Mantener fixtures, factories y contratos exige disciplina.
- Los limites de cobertura pueden incentivar pruebas debiles si se revisan sin la matriz de riesgos.
- Las trazas pueden capturar informacion sensible si los datos de prueba o logs no se sanean.
- Vitest y Playwright comparten parte del espacio de pruebas web; la ubicacion incorrecta de escenarios puede duplicar esfuerzo.

## Validacion

La decision se considera aplicada cuando:

- `pnpm test` ejecuta unitarias deterministas en todos los workspaces aplicables.
- `pnpm test:coverage` falla por debajo de los umbrales de dominio y aplicacion.
- `pnpm test:integration` levanta PostgreSQL y Redis desechables sin depender de estado previo.
- Una migracion se prueba desde base vacia y desde la version anterior soportada.
- `pnpm test:contracts` valida HTTP, eventos y al menos un contrato de agente desde JavaScript o Python.
- `pnpm test:architecture` rechaza un import profundo intencional entre modulos.
- `pnpm test:e2e` ejecuta recorridos independientes y conserva una traza saneada al provocar un fallo.
- Una prueba con espera temporal arbitraria, `.only` o cuarentena sin ID es rechazada.
- Dos perfiles no pueden cruzar datos, archivos, sesiones ni trabajos durante la suite.
- El mismo commit candidato supera las puertas de pull request, `main` y release que le correspondan.

## Referencias

- [Vitest: guia](https://vitest.dev/guide/)
- [Vitest: cobertura](https://vitest.dev/guide/coverage)
- [Next.js: pruebas con Vitest](https://nextjs.org/docs/app/guides/testing/vitest)
- [Next.js: vision general de pruebas](https://nextjs.org/docs/app/guides/testing)
- [NestJS: testing](https://docs.nestjs.com/fundamentals/testing)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW](https://mswjs.io/)
- [Testcontainers for Node.js](https://node.testcontainers.org/)
- [Playwright: buenas practicas](https://playwright.dev/docs/best-practices)
- [Playwright: Trace Viewer](https://playwright.dev/docs/trace-viewer)

Se revisa esta decision si el costo de CI impide retroalimentacion util, cambia el soporte de componentes asincronos de Next.js, aparece un consumidor independiente que requiera consumer-driven contracts o la matriz de navegadores deja de representar a los usuarios reales.
