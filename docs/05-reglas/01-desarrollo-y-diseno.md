# Desarrollo y diseno

## Principios

- Legibilidad antes que ingenio: nombres claros, funciones pequenas y flujo explicito.
- KISS: usar la solucion mas simple que cumpla el requisito y sus riesgos reales.
- DRY con criterio: extraer logica repetida, sin crear abstracciones antes de conocer el patron.
- YAGNI: no implementar posibilidades futuras fuera del alcance aprobado.
- Separar dominio, aplicacion, infraestructura e interfaz para que las reglas comerciales no dependan de frameworks.

## Contratos

- Definir entradas, salidas, errores y efectos antes de conectar modulos.
- Validar datos en cada frontera de confianza: HTTP, webhook, cola, archivo, agente y base de datos.
- Evitar tipos ambiguos y valores magicos; usar nombres, enums o constantes del dominio.
- Mantener compatibilidad durante despliegues cuando convivan clientes, workers o pestañas con versiones distintas.
- Versionar contratos externos y formatos de trabajos cuando un cambio no sea compatible.

## Implementacion

- Una funcion o clase debe tener una responsabilidad reconocible.
- Preferir retornos tempranos a anidamiento profundo.
- No mutar estado compartido de forma accidental.
- No capturar errores para ignorarlos; traducirlos, registrarlos o propagarlos con contexto seguro.
- Paralelizar operaciones independientes y mantener secuenciales las que tengan dependencia o riesgo de carrera.
- Toda fecha se almacena con una referencia temporal inequívoca y se presenta con la zona horaria configurada.
- Importes usan tipos decimales y reglas de redondeo definidas; no flotantes binarios para contabilidad.

## Persistencia

- Cada cambio de esquema usa una migracion versionada; no se modifica produccion manualmente.
- Las restricciones que protegen invariantes tambien viven en la base cuando sea posible.
- Las consultas aplican alcance del cliente y permisos desde su punto de entrada.
- Evitar consultas sin limites y patrones N+1 en caminos de uso normal.
- Una transaccion cubre los cambios que deben confirmarse o fallar juntos.

## Limites modulares

- Aplicar `docs/06-decisiones/ADR-0002-limites-modulos-dependencias.md` en cada modulo nuevo.
- Mantener las capas `domain`, `application`, `infrastructure` e `interface` y la direccion de dependencias aprobada.
- Escribir una tabla solo desde su modulo propietario.
- Usar contratos publicos para comunicacion sincrona y eventos de outbox para efectos derivados.
- No exponer modelos Prisma como contratos de API o dominio.
- Verificar en CI las importaciones prohibidas y dependencias circulares.

## TypeScript obligatorio

- Activar modo estricto y evitar `any`; una excepcion requiere justificacion local.
- Validar datos de runtime aunque exista tipado estatico.
- Usar nombres de funciones con verbo y nombres de dominio, no abreviaturas opacas.
- Mantener componentes de interfaz enfocados; la logica de negocio no vive dentro de la vista.
- Mantener el codigo propio del producto, incluido `agent-runtime`, en archivos TypeScript y TSX; JavaScript se admite solo en configuraciones que la herramienta no permita expresar en TypeScript o en agentes personalizados compatibles.
- No introducir Python en las aplicaciones oficiales del monorepo; Python queda reservado para agentes personalizados que implementen `/agent/v1` y MCP desde su frontera propia.
