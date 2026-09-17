# ADR 0002 Límites de módulos y dependencias

- Estado: aceptado
- Fecha: 2026-09-16
- Responsables: propietario del proyecto
- Requisitos relacionados: BASE-02, BASE-04, BASE-05, BASE-06 y todos los módulos funcionales

## Contexto

Quantum CRM se construye como un monolito modular. Aunque los módulos se ejecuten inicialmente dentro de los mismos procesos, cada uno debe poseer sus datos, reglas y contratos.

Sin límites explícitos, los módulos terminarían consultando y modificando directamente las tablas de los demás, dificultando pruebas, migraciones, permisos y futuras extracciones de servicios.

## Decisión

El backend se divide en módulos de dominio con propiedad exclusiva sobre sus datos. La comunicación entre módulos ocurre mediante contratos públicos, servicios de aplicación y eventos versionados.

Ningún módulo puede importar repositorios, entidades internas o adaptadores de infraestructura pertenecientes a otro módulo.

## Módulos del CRM

| Módulo | Responsabilidad | Datos que posee |
|---|---|---|
| `iam` | Usuarios, equipos, membresías, roles y permisos | Usuarios internos, equipos, roles y alcances |
| `settings` | Configuración de empresa y definiciones compartidas | Campos personalizados, etiquetas, reglas y preferencias |
| `contacts` | Identidad comercial de las personas | Contactos, canales conocidos, asignaciones e historial básico |
| `conversations` | Atención multicanal | Conversaciones, mensajes, notas, asignación y modo humano o IA |
| `sales` | Procesos comerciales | Pipelines, etapas, oportunidades y movimientos |
| `tasks` | Trabajo pendiente y seguimientos | Tareas, recurrencias, comentarios y recordatorios |
| `scheduling` | Calendarios y reservas | Calendarios, disponibilidad, citas y bloqueos |
| `forms` | Formularios y respuestas | Formularios, versiones, preguntas, respuestas y archivos relacionados |
| `catalog` | Productos, servicios e inventario | Catálogos, productos, variantes, movimientos y reservas de alquiler |
| `documents` | Cotizaciones y documentos comerciales | Plantillas, bloques, versiones, aceptación y PDF |
| `billing` | Facturas, cuotas y pagos | Facturas, pagos, reembolsos, numeración y saldos |
| `automation` | Flujos automáticos | Definiciones, ejecuciones, pasos, esperas y resultados |
| `agent-gateway` | Comunicación con agentes LangGraph | Configuración, ejecuciones, callbacks y herramientas autorizadas |
| `integrations` | Adaptadores de proveedores externos | Conexiones, credenciales referenciadas, webhooks y estados |
| `reporting` | Lectura analítica | Proyecciones, métricas, tableros y resultados preparados |
| `audit` | Trazabilidad inmutable | Eventos de auditoría permitidos |
| `files` | Acceso controlado al almacenamiento | Metadatos, claves de objetos y políticas de acceso |

## Módulos de la plataforma central

La administración de Quantum vive en una aplicación y base separadas:

| Módulo | Responsabilidad |
|---|---|
| `platform-iam` | Operadores de Quantum y permisos de plataforma |
| `tenants` | Registro y ciclo de vida de clientes |
| `infrastructure` | VPS, capacidad y recursos |
| `releases` | Versiones, imágenes, digests y compatibilidad |
| `deployments` | Altas, actualizaciones, rollback y bloqueos |
| `backups` | Respaldos y recuperaciones |
| `platform-monitoring` | Estado observado de perfiles y servidores |
| `platform-audit` | Auditoría de operaciones administrativas |

La plataforma central no consulta directamente las tablas comerciales de los clientes.

## Capas internas de cada módulo

Cada módulo utiliza cuatro capas:

```text
module/
  domain/
  application/
  infrastructure/
  interface/
```

### domain

Contiene entidades, value objects, invariantes, servicios y eventos de dominio. No importa NestJS, Prisma, Redis, HTTP ni implementaciones de otros módulos.

### application

Contiene casos de uso, comandos, consultas, puertos requeridos, coordinación de transacciones y autorización del caso de uso. Puede depender únicamente de su dominio y de contratos públicos.

### infrastructure

Contiene repositorios Prisma, clientes Redis, adaptadores S3, adaptadores de proveedores e implementación de puertos. No contiene reglas comerciales.

### interface

Contiene controladores HTTP, gateways WebSocket, consumidores de cola, validación de entrada y mapeo entre DTO y casos de uso. No accede directamente a Prisma.

## Contratos públicos

Cada módulo expone únicamente comandos públicos, consultas públicas, eventos públicos, esquemas Zod y tipos TypeScript derivados de esos esquemas.

Los contratos viven en:

```text
packages/contracts/src/<module>/
```

Cada módulo tiene un único punto público de entrada. Queda prohibido importar archivos internos usando rutas profundas.

Permitido:

```typescript
import { CreateContactCommand } from '@quantum/contracts/contacts'
```

Prohibido:

```typescript
import { ContactRepository } from '../../contacts/infrastructure/repository'
```

## Propiedad de datos

- Cada tabla tiene un único módulo propietario.
- Solo el módulo propietario puede escribirla.
- Otros módulos guardan el identificador estable del registro relacionado.
- No se comparten modelos Prisma como contratos de dominio o API.
- Los DTO no exponen automáticamente todas las columnas.
- Cada base de cliente usa esquemas PostgreSQL separados por módulo cuando sea viable.
- Las migraciones se publican juntas, pero identifican claramente su módulo.
- Se permiten claves foráneas entre módulos únicamente hacia identificadores raíz estables y sin eliminaciones en cascada entre módulos.

## Comunicación sincrónica

Se usa cuando otro módulo necesita una respuesta inmediata:

```text
Controlador
    -> Caso de uso
        -> Puerto público de otro módulo
            -> Caso de uso del módulo propietario
```

Un módulo nunca escribe directamente en el repositorio de otro.

Ejemplos:

- `documents` consulta productos mediante el contrato público de `catalog`.
- `sales` consulta un contacto mediante `contacts`.
- `billing` genera una factura desde una versión aceptada de `documents`.

## Comunicación asíncrona

Se utiliza para efectos derivados que no pertenecen a la transacción original:

```text
Transacción comercial
    -> registro de dominio
    -> evento en outbox
    -> worker
    -> consumidor idempotente
```

Por ejemplo, cuando una oportunidad cambia de etapa, `automation` puede ejecutar una regla, `reporting` actualizar una proyección y `audit` registrar la acción.

Los módulos comerciales no dependen de `automation`, `reporting` ni `audit`. Estos módulos reaccionan a sus eventos.

## Transacciones

- Una operación de un solo módulo usa una transacción propiedad de ese módulo.
- Los efectos externos se ejecutan después del commit mediante outbox.
- Un caso de uso que coordine varios módulos utiliza sus APIs públicas.
- Una transacción entre módulos solo se admite cuando existe una invariante comercial que no puede quedar temporalmente inconsistente.
- Las excepciones transaccionales se documentan y prueban explícitamente.
- No se mantiene una transacción abierta mientras se llama a proveedores, agentes, correo, pagos o almacenamiento externo.

## Dependencias especiales

### automation

Puede consumir eventos y solicitar comandos públicos. Ningún módulo comercial puede importar el motor de automatizaciones.

### reporting

No modifica datos de negocio. Usa eventos, proyecciones y vistas de lectura diseñadas explícitamente. Ningún módulo depende de reportes.

### agent-gateway

Posee conexiones, ejecuciones agentivas, estados, intentos, callbacks y asociaciones de threads. Puede consultar o solicitar operaciones mediante herramientas autorizadas. No posee contactos, oportunidades, mensajes, productos, documentos ni memoria comercial de otros modulos.

### integrations

Implementa adaptadores. Los módulos de dominio dependen de puertos como `MessageSender` o `PaymentProvider`, nunca de WhatsApp, Stripe u otro proveedor concreto.

### audit

Es append-only. Un registro de auditoría no reemplaza el estado comercial ni se utiliza para reconstruirlo automáticamente.

## Shared kernel

El código compartido se limita a conceptos realmente universales:

- Identificadores.
- Dinero y moneda.
- Fechas y zonas horarias.
- Resultados y errores base.
- Paginación.
- Contexto autenticado.
- Contexto del cliente.
- Correlation IDs.

No se crea una carpeta general `utils` donde cualquier módulo deposite lógica.

## Reglas de dependencia

Permitido:

```text
interface -> application -> domain
infrastructure -> application y domain
application -> contratos públicos
```

Prohibido:

```text
domain -> NestJS, Prisma, Redis o HTTP
módulo A -> infrastructure del módulo B
frontend -> database
worker -> controladores HTTP
reporting -> escrituras comerciales
agente externo -> base de datos
administrador central -> tablas de clientes
```

Estas reglas se verifican mediante ESLint, análisis de dependencias y pruebas arquitectónicas en CI.

## Alternativas consideradas

### Capas globales para toda la aplicación

Se rechaza porque agrupar todos los controladores, servicios y repositorios por tipo oculta la propiedad funcional y aumenta el acoplamiento.

### Acceso directo entre repositorios

Se rechaza porque permite que varios módulos modifiquen las mismas tablas y rompe las invariantes del propietario.

### Microservicio por módulo

Se rechaza inicialmente por el costo de red, despliegues, observabilidad y consistencia distribuida. Los límites adoptados permiten extraer módulos si las mediciones lo requieren.

### Compartir modelos Prisma

Se rechaza porque acopla contratos públicos con persistencia y facilita exponer campos internos accidentalmente.

## Consecuencias positivas

- Cada dato tiene un propietario identificable.
- Las reglas comerciales pueden probarse sin infraestructura.
- Se reducen cambios accidentales entre módulos.
- Los agentes e integraciones utilizan contratos controlados.
- Será posible extraer servicios posteriormente.

## Consecuencias negativas

- Algunos casos de uso necesitan orquestadores.
- Los contratos públicos requieren mantenimiento y versionado.
- Puede existir duplicación intencional en modelos de lectura.
- Las operaciones entre módulos requieren más diseño que una consulta directa.

## Validación

La decisión se considera aplicada cuando:

- La estructura del monorepo contiene los módulos definidos.
- Cada módulo expone un único punto público.
- CI rechaza importaciones internas entre módulos.
- Ningún controlador accede directamente a Prisma.
- Dos módulos se comunican mediante un contrato público.
- Un evento atraviesa outbox y un consumidor idempotente.
- `reporting` construye una proyección sin modificar datos comerciales.
- Un agente ejecuta una herramienta sin acceder a infraestructura interna.
