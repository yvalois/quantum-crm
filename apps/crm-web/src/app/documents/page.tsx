"use client";

import type {
  CommercialDocument,
  CommercialDocumentKind,
  Contact,
  DocumentBlock,
  DocumentTemplate,
  Opportunity,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CrmShell } from "../crm-shell";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}

const blockLabels: Record<DocumentBlock["type"], string> = {
  TEXT: "Texto",
  IMAGE: "Imagen",
  TABLE: "Tabla",
  COLUMNS: "Columnas",
  DIVIDER: "Separador",
  TERMS: "Condiciones",
  VARIABLE: "Variable",
  SIGNATURE: "Firma",
};

function newBlock(type: DocumentBlock["type"]): DocumentBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case "TEXT":
      return { id, type, locked: false, content: "Escribe aquí el contenido.", align: "LEFT" };
    case "IMAGE":
      return {
        id,
        type,
        locked: false,
        label: "Imagen editable",
        alt: "",
        caption: "",
        fileId: null,
        checksum: null,
      };
    case "TABLE":
      return {
        id,
        type,
        locked: false,
        columns: ["Concepto", "Cantidad", "Valor"],
        rows: [["Servicio", "1", "$ 0"]],
      };
    case "COLUMNS":
      return { id, type, locked: false, columns: ["Columna izquierda", "Columna derecha"] };
    case "DIVIDER":
      return { id, type, locked: false, style: "SOLID" };
    case "TERMS":
      return {
        id,
        type,
        locked: false,
        title: "Condiciones comerciales",
        content: "Describe vigencia, garantías y observaciones.",
      };
    case "VARIABLE":
      return {
        id,
        type,
        locked: false,
        key: "contact.name",
        label: "Nombre del contacto",
        fallback: "Cliente",
      };
    case "SIGNATURE":
      return { id, type, locked: false, label: "Firma del cliente", fileId: null, checksum: null };
  }
}

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

function interpolate(value: string, contact: Contact | null): string {
  return value
    .replaceAll("{{contact.name}}", contact?.displayName ?? "Cliente")
    .replaceAll("{{contact.email}}", contact?.email ?? "correo@cliente.com")
    .replaceAll("{{company.name}}", "Quantum Demo");
}

export default function DocumentsPage(): React.JSX.Element {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CommercialDocument[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommercialDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | CommercialDocumentKind>("");

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === draft?.contactId) ?? null,
    [contacts, draft?.contactId],
  );
  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return documents.filter(
      (document) =>
        (!kindFilter || document.kind === kindFilter) &&
        (!term || document.title.toLocaleLowerCase("es").includes(term)),
    );
  }, [documents, kindFilter, search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sessionResponse.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/documents");
        return;
      }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const responses = await Promise.all([
        fetch("/api/documents", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/documents/templates", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/opportunities", { cache: "no-store", credentials: "same-origin" }),
      ]);
      for (const response of responses)
        if (!response.ok) throw new Error(await responseTitle(response));
      const nextDocuments = ((await responses[0]!.json()) as List<CommercialDocument>).data;
      setDocuments(nextDocuments);
      setTemplates(((await responses[1]!.json()) as List<DocumentTemplate>).data);
      setContacts(((await responses[2]!.json()) as List<Contact>).data);
      setOpportunities(((await responses[3]!.json()) as List<Opportunity>).data);
      const current =
        nextDocuments.find((item) => item.id === selectedId) ?? nextDocuments[0] ?? null;
      setSelectedId(current?.id ?? null);
      setDraft(current ? structuredClone(current) : null);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar Documentos.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, []);

  function selectDocument(document: CommercialDocument): void {
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")) return;
    setSelectedId(document.id);
    setDraft(structuredClone(document));
    setDirty(false);
    setError(null);
    setNotice(null);
  }

  function patchDraft(patch: Partial<CommercialDocument>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  function updateBlock(id: string, updater: (block: DocumentBlock) => DocumentBlock): void {
    if (!draft) return;
    patchDraft({ blocks: draft.blocks.map((block) => (block.id === id ? updater(block) : block)) });
  }

  function moveBlock(index: number, offset: -1 | 1): void {
    if (!draft) return;
    const target = index + offset;
    if (target < 0 || target >= draft.blocks.length || draft.blocks[index]?.locked) return;
    const next = [...draft.blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    patchDraft({ blocks: next });
  }

  async function mutate(
    url: string,
    body: unknown,
    options: { readonly method?: "POST" | "PATCH"; readonly version?: string } = {},
  ): Promise<Response> {
    if (!csrf) throw new Error("La sesión todavía no está lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, {
      method: options.method ?? "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    return response;
  }

  async function createDocument(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const templateId = String(form.get("templateId") || "");
      const response = await mutate("/api/documents", {
        kind: form.get("kind"),
        title: form.get("title"),
        contactId: String(form.get("contactId") || "") || null,
        opportunityId: String(form.get("opportunityId") || "") || null,
        ...(templateId ? { templateId } : {}),
      });
      const created = ((await response.json()) as { data: CommercialDocument }).data;
      setDocuments((current) => [created, ...current]);
      setSelectedId(created.id);
      setDraft(created);
      setDirty(false);
      setShowCreate(false);
      setNotice("Borrador creado y listo para editar.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el documento.");
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await mutate(
        `/api/documents/${draft.id}`,
        {
          title: draft.title,
          contactId: draft.contactId,
          opportunityId: draft.opportunityId,
          blocks: draft.blocks,
          design: draft.design,
        },
        { method: "PATCH", version: draft.version },
      );
      const updated = ((await response.json()) as { data: CommercialDocument }).data;
      setDraft(updated);
      setDocuments((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDirty(false);
      setNotice(`Guardado · revisión ${updated.revision}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await mutate(`/api/documents/${draft.id}/duplicate`, {});
      const copy = ((await response.json()) as { data: CommercialDocument }).data;
      setDocuments((current) => [copy, ...current]);
      setSelectedId(copy.id);
      setDraft(copy);
      setDirty(false);
      setNotice("Copia independiente creada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible duplicar.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate("/api/documents/templates", {
        name: form.get("name"),
        sourceDocumentId: draft.id,
      });
      const created = ((await response.json()) as { data: DocumentTemplate }).data;
      setTemplates((current) => [...current, created]);
      setShowTemplate(false);
      setNotice("Plantilla reutilizable creada sin alterar el documento.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la plantilla.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShell className="documents-shell">
      <section className="documents-page">
        <header className="documents-topbar">
          <div>
            <p className="eyebrow">CIERRE COMERCIAL</p>
            <h1>Documentos</h1>
            <p>Cotizaciones y facturas que se sienten hechas a medida.</p>
          </div>
          <div className="documents-top-actions">
            <button className="button-secondary" type="button" onClick={() => setShowCreate(true)}>
              Nueva plantilla o documento
            </button>
            <button
              className="button-primary"
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="document-alert document-alert-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="document-alert" role="status">
            {notice}
          </div>
        ) : null}

        <div className="document-studio">
          <aside className="document-library">
            <div className="library-heading">
              <div>
                <span>Biblioteca</span>
                <strong>{documents.length}</strong>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                aria-label="Crear documento"
              >
                +
              </button>
            </div>
            <label className="document-search">
              <span className="sr-only">Buscar documentos</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre…"
              />
            </label>
            <div className="document-kind-tabs">
              <button
                className={!kindFilter ? "active" : ""}
                type="button"
                onClick={() => setKindFilter("")}
              >
                Todos
              </button>
              <button
                className={kindFilter === "QUOTE" ? "active" : ""}
                type="button"
                onClick={() => setKindFilter("QUOTE")}
              >
                Cotizaciones
              </button>
              <button
                className={kindFilter === "INVOICE" ? "active" : ""}
                type="button"
                onClick={() => setKindFilter("INVOICE")}
              >
                Facturas
              </button>
            </div>
            <div className="document-list">
              {loading ? (
                <p className="empty-copy">Cargando documentos…</p>
              ) : filteredDocuments.length === 0 ? (
                <div className="library-empty">
                  <span>□</span>
                  <strong>Aún no hay documentos</strong>
                  <p>Crea un borrador desde cero o usa una plantilla.</p>
                </div>
              ) : (
                filteredDocuments.map((document) => (
                  <button
                    className={document.id === selectedId ? "active" : ""}
                    type="button"
                    key={document.id}
                    onClick={() => selectDocument(document)}
                  >
                    <span className={`document-kind-mark ${document.kind.toLowerCase()}`}>
                      {document.kind === "QUOTE" ? "C" : "F"}
                    </span>
                    <span>
                      <strong>{document.title}</strong>
                      <small>
                        {document.kind === "QUOTE" ? "Cotización" : "Factura"} · Rev.{" "}
                        {document.revision}
                      </small>
                    </span>
                    <time>
                      {new Intl.DateTimeFormat("es", { day: "2-digit", month: "short" }).format(
                        new Date(document.updatedAt),
                      )}
                    </time>
                  </button>
                ))
              )}
            </div>
            {templates.length ? (
              <div className="template-shelf">
                <span>PLANTILLAS DISPONIBLES</span>
                {templates.slice(0, 4).map((template) => (
                  <div key={template.id}>
                    <i style={{ background: template.design.accentColor }} />
                    <strong>{template.name}</strong>
                    <small>{template.kind === "QUOTE" ? "Cotización" : "Factura"}</small>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>

          {draft ? (
            <>
              <section className="document-editor" aria-label="Editor de documento">
                <div className="editor-meta-row">
                  <label>
                    <span>Título</span>
                    <input
                      value={draft.title}
                      onChange={(event) => patchDraft({ title: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Contacto</span>
                    <select
                      value={draft.contactId ?? ""}
                      onChange={(event) => patchDraft({ contactId: event.target.value || null })}
                    >
                      <option value="">Sin contacto</option>
                      {contacts.map((contact) => (
                        <option value={contact.id} key={contact.id}>
                          {contact.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Oportunidad</span>
                    <select
                      value={draft.opportunityId ?? ""}
                      onChange={(event) =>
                        patchDraft({ opportunityId: event.target.value || null })
                      }
                    >
                      <option value="">Sin oportunidad</option>
                      {opportunities.map((opportunity) => (
                        <option value={opportunity.id} key={opportunity.id}>
                          {opportunity.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="editor-actions-row">
                  <span>
                    <i />
                    BORRADOR · REV. {draft.revision}
                  </span>
                  <div>
                    <button type="button" onClick={() => void duplicate()}>
                      Duplicar
                    </button>
                    <button type="button" onClick={() => setShowTemplate(true)}>
                      Guardar como plantilla
                    </button>
                  </div>
                </div>
                <div className="block-insert-bar">
                  <span>Insertar bloque</span>
                  {(
                    [
                      "TEXT",
                      "IMAGE",
                      "TABLE",
                      "COLUMNS",
                      "DIVIDER",
                      "TERMS",
                      "VARIABLE",
                      "SIGNATURE",
                    ] as const
                  ).map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => patchDraft({ blocks: [...draft.blocks, newBlock(type)] })}
                    >
                      {blockLabels[type]}
                    </button>
                  ))}
                </div>
                <div className="document-block-list">
                  {draft.blocks.map((block, index) => (
                    <article
                      className={`document-block ${block.locked ? "locked" : ""}`}
                      key={block.id}
                    >
                      <header>
                        <span className="block-handle">⋮⋮</span>
                        <strong>{blockLabels[block.type]}</strong>
                        {block.locked ? <small>PROTEGIDO</small> : null}
                        <div>
                          <button
                            type="button"
                            onClick={() => moveBlock(index, -1)}
                            disabled={index === 0 || block.locked}
                            aria-label="Mover arriba"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBlock(index, 1)}
                            disabled={index === draft.blocks.length - 1 || block.locked}
                            aria-label="Mover abajo"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              patchDraft({
                                blocks: draft.blocks.filter((item) => item.id !== block.id),
                              })
                            }
                            disabled={block.locked}
                            aria-label="Eliminar"
                          >
                            ×
                          </button>
                        </div>
                      </header>
                      <BlockEditor
                        block={block}
                        onChange={(next) => updateBlock(block.id, () => next)}
                      />
                    </article>
                  ))}
                </div>
              </section>

              <aside className="document-preview-panel">
                <div className="preview-heading">
                  <span>VISTA PREVIA</span>
                  <small>{draft.design.pageSize} · página 1</small>
                </div>
                <DocumentPreview document={draft} contact={selectedContact} />
                <div className="design-panel">
                  <label>
                    <span>Color principal</span>
                    <input
                      type="color"
                      value={draft.design.accentColor}
                      onChange={(event) =>
                        patchDraft({ design: { ...draft.design, accentColor: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    <span>Tipografía</span>
                    <select
                      value={draft.design.fontFamily}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            fontFamily: event.target
                              .value as CommercialDocument["design"]["fontFamily"],
                          },
                        })
                      }
                    >
                      <option value="INSTRUMENT_SANS">Instrument Sans</option>
                      <option value="SERIF">Editorial Serif</option>
                      <option value="MONO">IBM Plex Mono</option>
                    </select>
                  </label>
                  <label>
                    <span>Encabezado</span>
                    <input
                      value={draft.design.headerText}
                      onChange={(event) =>
                        patchDraft({ design: { ...draft.design, headerText: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    <span>Pie de página</span>
                    <input
                      value={draft.design.footerText}
                      onChange={(event) =>
                        patchDraft({ design: { ...draft.design, footerText: event.target.value } })
                      }
                    />
                  </label>
                </div>
              </aside>
            </>
          ) : (
            <section className="document-welcome">
              <span>DOC</span>
              <h2>Crea tu primer documento</h2>
              <p>Empieza desde cero o utiliza una plantilla reutilizable.</p>
              <button className="button-primary" type="button" onClick={() => setShowCreate(true)}>
                Crear documento
              </button>
            </section>
          )}
        </div>
      </section>

      {showCreate ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowCreate(false)}
        >
          <form
            className="calendar-modal document-create-modal"
            onSubmit={(event) => void createDocument(event)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>NUEVO DOCUMENTO</span>
                <h2>Prepara una base sólida</h2>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Cerrar">
                ×
              </button>
            </header>
            <label>
              Título
              <input
                name="title"
                required
                maxLength={240}
                placeholder="Propuesta comercial octubre"
              />
            </label>
            <div className="form-grid-2">
              <label>
                Tipo
                <select name="kind" defaultValue="QUOTE">
                  <option value="QUOTE">Cotización</option>
                  <option value="INVOICE">Factura</option>
                </select>
              </label>
              <label>
                Plantilla
                <select name="templateId" defaultValue="">
                  <option value="">Documento en blanco</option>
                  {templates.map((template) => (
                    <option value={template.id} key={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid-2">
              <label>
                Contacto
                <select name="contactId" defaultValue="">
                  <option value="">Sin contacto</option>
                  {contacts.map((contact) => (
                    <option value={contact.id} key={contact.id}>
                      {contact.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Oportunidad
                <select name="opportunityId" defaultValue="">
                  <option value="">Sin oportunidad</option>
                  {opportunities.map((opportunity) => (
                    <option value={opportunity.id} key={opportunity.id}>
                      {opportunity.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancelar
              </button>
              <button className="button-primary" disabled={saving}>
                {saving ? "Creando…" : "Crear borrador"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {showTemplate && draft ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowTemplate(false)}
        >
          <form
            className="calendar-modal document-template-modal"
            onSubmit={(event) => void saveTemplate(event)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>PLANTILLA REUTILIZABLE</span>
                <h2>Conserva diseño y estructura</h2>
              </div>
              <button type="button" onClick={() => setShowTemplate(false)} aria-label="Cerrar">
                ×
              </button>
            </header>
            <p>
              Los bloques marcados como protegidos no podrán cambiarse en documentos creados desde
              esta plantilla.
            </p>
            <label>
              Nombre de la plantilla
              <input name="name" required maxLength={180} defaultValue={`${draft.title} · Base`} />
            </label>
            <footer>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowTemplate(false)}
              >
                Cancelar
              </button>
              <button className="button-primary" disabled={saving}>
                Crear plantilla
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </CrmShell>
  );
}

function BlockEditor({
  block,
  onChange,
}: {
  readonly block: DocumentBlock;
  readonly onChange: (block: DocumentBlock) => void;
}): React.JSX.Element {
  if (block.type === "TEXT")
    return (
      <div className="block-editor-grid">
        <textarea
          value={block.content}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, content: event.target.value })}
        />
        <select
          value={block.align}
          disabled={block.locked}
          onChange={(event) =>
            onChange({ ...block, align: event.target.value as typeof block.align })
          }
        >
          <option value="LEFT">Izquierda</option>
          <option value="CENTER">Centro</option>
          <option value="RIGHT">Derecha</option>
        </select>
      </div>
    );
  if (block.type === "TERMS")
    return (
      <div className="block-editor-grid">
        <input
          value={block.title}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
        <textarea
          value={block.content}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, content: event.target.value })}
        />
      </div>
    );
  if (block.type === "IMAGE")
    return (
      <div className="image-slot-editor">
        <div>
          <span>IMAGEN</span>
          <strong>{block.fileId ? "Referencia vinculada" : "Espacio editable"}</strong>
          <small>La carga segura de archivos se conectará al módulo Files.</small>
        </div>
        <label>
          Etiqueta
          <input
            value={block.label}
            disabled={block.locked}
            onChange={(event) => onChange({ ...block, label: event.target.value })}
          />
        </label>
        <label>
          Texto alternativo
          <input
            value={block.alt}
            disabled={block.locked}
            onChange={(event) => onChange({ ...block, alt: event.target.value })}
          />
        </label>
      </div>
    );
  if (block.type === "COLUMNS")
    return (
      <div className="columns-editor">
        {block.columns.map((column, index) => (
          <textarea
            key={index}
            value={column}
            disabled={block.locked}
            onChange={(event) =>
              onChange({
                ...block,
                columns: block.columns.map((value, columnIndex) =>
                  columnIndex === index ? event.target.value : value,
                ),
              })
            }
          />
        ))}
      </div>
    );
  if (block.type === "TABLE")
    return (
      <div className="table-editor">
        <input
          value={block.columns.join(" | ")}
          disabled={block.locked}
          onChange={(event) => {
            const columns = event.target.value
              .split("|")
              .map((value) => value.trim())
              .filter(Boolean)
              .slice(0, 8);
            onChange({
              ...block,
              columns,
              rows: block.rows.map((row) => columns.map((_, index) => row[index] ?? "")),
            });
          }}
        />
        <textarea
          value={block.rows.map((row) => row.join(" | ")).join("\n")}
          disabled={block.locked}
          onChange={(event) =>
            onChange({
              ...block,
              rows: event.target.value
                .split("\n")
                .filter(Boolean)
                .slice(0, 100)
                .map((row) => {
                  const values = row.split("|").map((value) => value.trim());
                  return block.columns.map((_, index) => values[index] ?? "");
                }),
            })
          }
        />
      </div>
    );
  if (block.type === "VARIABLE")
    return (
      <div className="form-grid-2">
        <label>
          Variable
          <select
            value={block.key}
            disabled={block.locked}
            onChange={(event) =>
              onChange({
                ...block,
                key: event.target.value,
                label: event.target.selectedOptions[0]?.text ?? block.label,
              })
            }
          >
            <option value="contact.name">Nombre del contacto</option>
            <option value="contact.email">Correo del contacto</option>
            <option value="company.name">Nombre de la empresa</option>
            <option value="document.title">Título del documento</option>
          </select>
        </label>
        <label>
          Valor alternativo
          <input
            value={block.fallback}
            disabled={block.locked}
            onChange={(event) => onChange({ ...block, fallback: event.target.value })}
          />
        </label>
      </div>
    );
  if (block.type === "SIGNATURE")
    return (
      <label className="signature-editor">
        Etiqueta de firma
        <input
          value={block.label}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, label: event.target.value })}
        />
      </label>
    );
  if (block.type === "DIVIDER")
    return (
      <label className="divider-editor">
        Estilo
        <select
          value={block.style}
          disabled={block.locked}
          onChange={(event) =>
            onChange({ ...block, style: event.target.value as typeof block.style })
          }
        >
          <option value="SOLID">Sólido</option>
          <option value="DASHED">Guiones</option>
          <option value="DOTTED">Puntos</option>
        </select>
      </label>
    );
  return <div />;
}

function DocumentPreview({
  document,
  contact,
}: {
  readonly document: CommercialDocument;
  readonly contact: Contact | null;
}): React.JSX.Element {
  const fontClass =
    document.design.fontFamily === "SERIF"
      ? "preview-serif"
      : document.design.fontFamily === "MONO"
        ? "preview-mono"
        : "";
  return (
    <div className={`document-paper ${fontClass}`} style={{ color: document.design.textColor }}>
      <header style={{ borderColor: document.design.accentColor }}>
        <span>{document.design.headerText || "QUANTUM DEMO"}</span>
        <small>{document.kind === "QUOTE" ? "COTIZACIÓN" : "FACTURA"}</small>
      </header>
      <section className="paper-title">
        <p>PREPARADO PARA</p>
        <h2>{contact?.displayName ?? "Cliente"}</h2>
        <h1>{document.title}</h1>
      </section>
      <div className="paper-blocks">
        {document.blocks.map((block) => {
          if (block.type === "TEXT")
            return (
              <p
                key={block.id}
                style={{ textAlign: block.align.toLowerCase() as "left" | "center" | "right" }}
              >
                {interpolate(block.content, contact)}
              </p>
            );
          if (block.type === "TERMS")
            return (
              <section className="paper-terms" key={block.id}>
                <strong>{block.title}</strong>
                <p>{interpolate(block.content, contact)}</p>
              </section>
            );
          if (block.type === "IMAGE")
            return (
              <figure className="paper-image" key={block.id}>
                <span>IMAGEN</span>
                <strong>{block.label}</strong>
                {block.caption ? <figcaption>{block.caption}</figcaption> : null}
              </figure>
            );
          if (block.type === "DIVIDER")
            return (
              <hr
                key={block.id}
                style={{ borderTopStyle: block.style === "DASHED" ? "dashed" : "solid" }}
              />
            );
          if (block.type === "COLUMNS")
            return (
              <div className="paper-columns" key={block.id}>
                {block.columns.map((column, index) => (
                  <p key={index}>{interpolate(column, contact)}</p>
                ))}
              </div>
            );
          if (block.type === "TABLE")
            return (
              <table key={block.id}>
                <thead>
                  <tr>
                    {block.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          if (block.type === "VARIABLE")
            return (
              <p className="paper-variable" key={block.id}>
                <small>{block.label}</small>
                <strong>
                  {interpolate(`{{${block.key}}}`, contact) === `{{${block.key}}}`
                    ? block.fallback
                    : interpolate(`{{${block.key}}}`, contact)}
                </strong>
              </p>
            );
          return (
            <div className="paper-signature" key={block.id}>
              <span />
              <small>{block.label}</small>
            </div>
          );
        })}
      </div>
      <footer style={{ borderColor: document.design.accentColor }}>
        <span>{document.design.footerText}</span>
        {document.design.showPageNumbers ? <small>01 / 01</small> : null}
      </footer>
    </div>
  );
}
