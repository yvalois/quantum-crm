# DOC-15 - Plantillas contextuales y composicion antes de enviar

> Esta ficha es un plan derivado. No sustituye las fuentes oficiales de alcance, estado ni terminado.

## Identificacion

- Requisito principal: `DOC-15`
- Requisitos relacionados: `DOC-01`, `DOC-02`, `DOC-03`, `DOC-05`, `DOC-11`, `DOC-13`, `DOC-14`, `DOC-16`, `DOC-18`, `CHAT-04`
- Fase del MVP: 8. Cierre comercial
- Estado oficial: [`estado.md`](../../04-proceso/estado.md)
- Responsable: Codex
- Dependencias: documentos persistentes, contactos, miembros, conversaciones y modulo `files`.
- Bloquea a: envio documental real por canal, PDF, aceptacion y facturacion.
- ADR, arquitectura o diseno aplicables: ADR-0002, ADR-0004, ADR-0005, ADR-0006, ADR-0011, ADR-0013, ADR-0014 y `archivos-objetos.md`.

## Resultado esperado

Una plantilla define estructura protegida y campos editables. Al crear una instancia, Quantum resuelve las variables autorizadas de cliente, asesor, empresa, oportunidad y documento; conserva los valores que se enviaran. Desde una conversacion, un asesor elige una plantilla, revisa esos valores, cambia solo campos e imagenes habilitados y crea un borrador adjuntable al mensaje sin abrir el editor estructural.

## Lectura obligatoria aplicada

- [x] Requisitos y subtareas en `funcionalidades.md` y `trabajo.md`.
- [x] Fase y dependencias en `mvp-piloto.md`.
- [x] Estado, ficha previa, reglas de contratos, archivos y agentes.
- [x] ADR y arquitectura aplicables.

## Auditoria del trabajo existente

- Se encontro `DOC-01` integrado: bloques, plantillas, control optimista y editor; sus variables solo resuelven cliente/empresa en la vista, sin snapshot contextual ni selector de origen.
- `DOC-14` esta en curso: agrega el flujo privado de archivos para imagenes y adjuntos.
- La bandeja `CHAT-01` tiene mensajes tipados y cola durable, pero aun no ofrece una composicion documental ni envio de adjuntos de documento.
- Se extiende el modulo `documents` y se consume el caso de uso publico de conversaciones; no se duplican datos de contactos, miembros ni archivos.

## Alcance

### Incluido

- Variables tipadas para cliente, asesor, empresa, oportunidad y documento, con valor alternativo y si son editables por instancia.
- Snapshot de valores contextuales al crear el documento desde plantilla y panel simple para retocarlos.
- Marcado de bloques de texto, variables e imagenes como protegidos o editables en plantilla.
- Selector de plantilla desde la conversación, composición y ajuste permitido antes de encolarlo como documento del mensaje.
- Enlaces por `fileId` exclusivamente tras disponibilidad de `DOC-14`.

### No incluido

- Entrega a WhatsApp, correo u otro proveedor externo hasta configurar su adaptador real; el mensaje queda en la cola durable y refleja su estado real.
- PDF, enlaces externos, aceptación, facturación, pagos, productos y fórmulas: `DOC-07` a `DOC-10`, `DOC-17` y `DOC-19` a `DOC-37`.

## Impacto tecnico

| Area | Impacto previsto |
|---|---|
| Aplicaciones y modulos | `documents`, `conversations`, `api`, `crm-web`, `worker` |
| Contratos y eventos | Variables, campos de instancia y mensaje documental versionados |
| Datos y migraciones | Snapshot contextual y referencias de documento, migracion expand-only si requiere columnas |
| Permisos y aislamiento | Contexto derivado del actor/conversacion; servidor valida editable, recurso y perfil |
| Configuracion y secretos | Sin secretos ni origenes nuevos |
| Observabilidad y operacion | Operacion durable/idempotente para crear y encolar el envio |
| Documentacion | Estado, ficha, evidencia y checklist solo al cierre comprobado |

## Plan de implementacion

- [ ] Definir contrato de variables y reglas de editabilidad.
- [ ] Resolver y congelar valores contextuales al instanciar plantilla.
- [ ] Completar editor de plantilla con selector de origen y campos protegidos/editables.
- [ ] Crear compositor documental de conversación y mensaje durable.
- [ ] Conectar carga/reemplazo de imágenes con `DOC-14` cuando el archivo sea `AVAILABLE`.
- [ ] Validar una vez el candidato exacto en VPS, publicar y recorrer el flujo autenticado.

## Riesgos y mitigaciones

| Riesgo | Mitigacion | Verificacion |
|---|---|---|
| Sustitucion de un valor protegido | Servidor compara plantilla/snapshot y deniega cambios no editables | intento de mutacion devuelve error |
| Dato de otro cliente o asesor | Actor, conversacion y referencias se validan server-side | intento cruzado rechazado |
| Imagen no segura | Solo `fileId` `AVAILABLE` de `files` | cuarentena no se adjunta ni previsualiza |
| Mensaje duplicado | clave idempotente y outbox del modulo propietario | reintento devuelve la misma operacion |

## Criterios de aceptacion

- [ ] La plantilla permite seleccionar y etiquetar datos de cliente, asesor, empresa, oportunidad o documento.
- [ ] La instancia muestra datos rellenados y conserva un snapshot aunque cambien registros luego.
- [ ] Solo los textos, variables e imagenes marcados editables se pueden cambiar sin abrir el editor estructural.
- [ ] Desde una conversación se puede preparar una instancia y decidir los cambios antes de encolarla.
- [ ] Ninguna ruta expone object keys, secretos, URL permanentes ni permite cruzar perfiles.

## Verificacion y recuperacion

- Contratos, dominio, API/BFF y casos de permisos, snapshot, editabilidad, concurrencia e idempotencia.
- Recorrido autenticado en VPS: plantilla -> instancia con cliente/asesor -> ajuste permitido -> composición en chat.
- Migraciones forward-only; un rollback de aplicación no borra documentos ni archivos.

## Evidencia de cierre

- Pendiente de candidato, validación VPS y despliegue.
