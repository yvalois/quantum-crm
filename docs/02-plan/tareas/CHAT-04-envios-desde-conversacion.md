# CHAT-04 - Envíos reales desde la conversación

> Plan derivado de CHAT-04, CHAT-06, FORM-12 y DOC-18; no sustituye requisitos ni estado.

## Identificación

- Requisito principal: `CHAT-04`.
- Relacionados: `CHAT-06`, `FORM-12`, `DOC-17`, `DOC-18`, `CHAT-05`.
- Fases: chat multicanal, formularios y cierre comercial del MVP.
- Estado oficial: [`estado.md`](../../04-proceso/estado.md).
- Dependencias: conversaciones y outbox, Files AVAILABLE, YCloud conectado, formularios publicados y documentos instanciados.
- Reglas: ADR-0002/0003/0004/0005/0006/0011/0013, archivos, contratos, persistencia y releases.

## Resultado esperado

Desde un chat WhatsApp autorizado, el asesor puede adjuntar imagen, audio o documento ya validado —o grabar audio y esperar su validación—, elegir un formulario publicado y enviar una instancia de plantilla como documento real. El hilo muestra contenido y estado de entrega. Fuera de la ventana de servicio, solo procede una plantilla WhatsApp aprobada; no se simula envío libre.

## Auditoría existente

- `Files` reserva, escanea y entrega archivos privados; `/media` permite carga y consulta, sin unión al compositor de conversación.
- `conversations` conserva mensaje/outbox y estado durable; el adaptador YCloud solo admite `TEXT`.
- `forms` publica enlaces, pero el chat no genera una referencia vinculada a contacto/conversación.
- `documents` prepara una instancia desde plantilla; su mensaje `DOCUMENT` se encola pero YCloud lo rechaza. No hay PDF público ni capacidad revocable de entrega.
- Históricos GHL muestran adjuntos disponibles, pero son de consulta.

## Alcance e impacto

API/contratos, dominio, repositorios, worker y CRM web. Se requieren referencias durables por `fileId`, asociación contextual de formulario, conversión verificable a PDF para documentos y adaptador multimedia YCloud. Las migraciones son aditivas y por perfil, sin llamadas externas dentro de transacciones. Solo Files conoce claves S3. No se amplían otros canales ni se implementan plantillas de inicio `CHAT-05` en este bloque.

## Plan

- [ ] Modelar adjunto y envío idempotente con permiso/alcance y archivo AVAILABLE.
- [ ] Completar carga o selección de biblioteca, grabación de audio y vista previa en compositor.
- [ ] Despachar audio, imagen y documento real por YCloud, conservar errores y estado.
- [ ] Vincular formulario publicado y respuesta a contacto/conversación; enviar su enlace.
- [ ] Generar y entregar versión PDF de documento instanciado, con acceso revocable.
- [ ] Validar rutas enfocadas en VPS, checks del PR y smoke autenticado de InterAmerican.

## Riesgos y verificación

| Riesgo                             | Mitigación                                                                                    | Prueba                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Archivo inseguro o ajeno           | Files AVAILABLE, propietario y permiso de chat verificados antes de encolar y antes de enviar | cuarentena, archivo de otro perfil, asesor sin relación |
| Efecto duplicado o incierto        | outbox/lease, ID estable por mensaje y sin reenvío de resultado desconocido                   | repetición, timeout y lease vencido                     |
| Ventana cerrada                    | comprobación atómica al crear y al despachar                                                  | cierre durante espera/scan                              |
| Plantilla o formulario equivocados | versión y contacto validados en servidor                                                      | borrador/cerrado, contacto ajeno                        |

## Recuperación y cierre

Migración forward-only por el migrador controlado; rollback de aplicación no restaura datos. Conservar release anterior compatible. Registrar evidencia, desviaciones y pendientes aquí y en `estado.md`; no marcar el checklist hasta comprobar todas sus subtareas.

## Evidencia y desviaciones del candidato (2026-10-15)

- En el VPS de pruebas se aprobaron typecheck de contratos, dominio, base, Files, API, worker y CRM; 47 pruebas enfocadas; lint de los archivos TS afectados; build de API, worker, CRM web y sus dependencias. Las migraciones `20261015050000` y `20261015060000` se ejecutaron sobre PostgreSQL 18 efímero con esquemas sintéticos, no sobre InterAmerican.
- El envío multimedia usa Files `AVAILABLE`, checksum y versión inmutable antes de subir a YCloud. El archivo de un chat no se puede usar desde otro chat; el resultado incierto del proveedor no se reintenta para evitar duplicados. No hay todavía prueba de entrega real.
- Se implementó el enlace de formulario publicado asociado a un contacto y conversación, con vencimiento y una respuesta máxima. Su envío real y la lectura de respuestas desde la ficha aún requieren smoke y UI complementaria.
- La instancia de documento no produce PDF. Se retiró la acción que decía encolarlo sin archivo entregable; permanece como borrador. No se implementa una representación degradada que pierda el diseño de la plantilla.
- El componente de audio acepta un archivo MP3/OGG validado; aún no graba voz en el navegador. Tampoco selecciona medios ya existentes de la biblioteca.
- **Pendientes de estabilización posterior:** completar PDF fiel, grabación, selector de biblioteca, lectura de respuestas en el chat/agente, CI y smoke autenticado. Antes de migrar el perfil con datos reales, configurar copia cifrada externa y restauración verificada según ADR-0015; no se ha hecho.
