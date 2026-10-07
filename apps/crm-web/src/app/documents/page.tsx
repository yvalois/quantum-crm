"use client";

import type {
  CommercialDocument,
  CommercialDocumentKind,
  Contact,
  DocumentBlock,
  DocumentTemplate,
  Opportunity,
} from "@quantum-crm/contracts";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { CrmShell } from "../crm-shell";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}

interface FileUploadIntent {
  readonly data: {
    readonly file: { readonly id: string; readonly status: string; readonly sha256: string };
    readonly upload: {
      readonly method: "POST";
      readonly url: string;
      readonly fields: Readonly<Record<string, string>>;
      readonly expiresAt: string;
    };
  };
}

interface FileMetadataResponse {
  readonly data: {
    readonly id: string;
    readonly status: string;
    readonly sha256: string;
  };
}

interface FileDownloadAuthorizationResponse {
  readonly data: { readonly url: string; readonly expiresAt: string; readonly method: "GET" };
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
  ATTACHMENT: "Adjunto",
};

const documentBlockTypes = [
  "TEXT",
  "IMAGE",
  "TABLE",
  "COLUMNS",
  "DIVIDER",
  "TERMS",
  "VARIABLE",
  "SIGNATURE",
  "ATTACHMENT",
] as const satisfies readonly DocumentBlock["type"][];

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
        replaceable: false,
        visible: true,
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
        value: null,
        editable: false,
      };
    case "SIGNATURE":
      return { id, type, locked: false, label: "Firma del cliente", fileId: null, checksum: null };
    case "ATTACHMENT":
      return {
        id,
        type,
        locked: false,
        label: "Ficha técnica",
        originalName: "",
        mimeType: "application/pdf",
        fileId: null,
        checksum: null,
      };
  }
}

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

async function loadJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    return (await response.json()) as T;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw new Error("La carga de Documentos tardó demasiado. Intenta de nuevo.");
    }
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function documentChecksum(base64Checksum: string): string {
  const bytes = Uint8Array.from(atob(base64Checksum), (character) => character.charCodeAt(0));
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function uploadVersionId(response: Response, body: string): string | null {
  const header = response.headers.get("x-amz-version-id");
  if (header) return header;
  return body.match(/<VersionId>([^<]+)<\/VersionId>/u)?.[1] ?? null;
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
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | CommercialDocumentKind>("");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [zoom, setZoom] = useState(90);

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
      const [documentList, templateList, contactList, opportunityList] = await Promise.all([
          loadJson<List<CommercialDocument>>("/api/documents"),
          loadJson<List<DocumentTemplate>>("/api/documents/templates"),
          loadJson<List<Contact>>("/api/contacts"),
          loadJson<List<Opportunity>>("/api/opportunities"),
        ]);
      const nextDocuments = documentList.data;
      setDocuments(nextDocuments);
      setTemplates(templateList.data);
      setContacts(contactList.data);
      setOpportunities(opportunityList.data);
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

  async function uploadDocumentFile(blockId: string, file: File): Promise<void> {
    if (!draft) return;
    setUploadingBlockId(blockId);
    setError(null);
    setNotice("Reservando carga segura...");
    try {
      const checksum = await sha256Base64(file);
      const intentResponse = await mutate("/api/files", {
        owner: {
          kind: "existing",
          module: "documents",
          type: "commercial_document",
          id: draft.id,
        },
        fileClass: file.type.startsWith("image/") ? "IMAGE" : "DOCUMENT",
        originalName: file.name,
        declaredMime: file.type || "application/octet-stream",
        declaredSize: file.size,
        expectedSha256: checksum,
      });
      const intent = (await intentResponse.json()) as FileUploadIntent;
      const uploadBody = new FormData();
      for (const [name, value] of Object.entries(intent.data.upload.fields)) {
        uploadBody.append(name, value);
      }
      uploadBody.append("file", file, file.name);
      const uploadResponse = await fetch(intent.data.upload.url, {
        method: intent.data.upload.method,
        body: uploadBody,
      });
      const uploadResponseBody = await uploadResponse.text();
      if (!uploadResponse.ok) throw new Error("El almacenamiento rechazó la carga.");
      const versionId = uploadVersionId(uploadResponse, uploadResponseBody);
      const receipt = uploadResponse.headers.get("etag");
      await mutate(`/api/files/${intent.data.file.id}/complete`, {
        checksum,
        ...(versionId ? { versionId } : {}),
        ...(receipt ? { receipt } : {}),
      });
      setNotice("Archivo recibido. Quantum está validando y escaneando su contenido...");
      let available: FileMetadataResponse["data"] | null = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const response = await fetch(`/api/files/${intent.data.file.id}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(await responseTitle(response));
        const metadata = (await response.json()) as FileMetadataResponse;
        if (metadata.data.status === "AVAILABLE") {
          available = metadata.data;
          break;
        }
        if (["REJECTED", "FAILED", "DELETED"].includes(metadata.data.status)) {
          throw new Error("El archivo no superó la validación de seguridad.");
        }
      }
      if (!available) throw new Error("La validación continúa. Intenta nuevamente en un momento.");
      const verifiedChecksum = documentChecksum(available.sha256);
      setDraft((current) =>
        current
          ? {
              ...current,
              blocks: current.blocks.map((block) => {
                if (block.id !== blockId) return block;
                if (block.type === "IMAGE")
                  return { ...block, fileId: available.id, checksum: verifiedChecksum };
                if (block.type === "ATTACHMENT")
                  return {
                    ...block,
                    fileId: available.id,
                    checksum: verifiedChecksum,
                    originalName: file.name,
                    mimeType: file.type || "application/octet-stream",
                  };
                return block;
              }),
            }
          : current,
      );
      setDirty(true);
      setNotice("Imagen verificada y vinculada. Guarda el documento para conservarla.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el archivo.");
      setNotice(null);
    } finally {
      setUploadingBlockId(null);
    }
  }

  return (
    <CrmShell className="documents-shell">
      <section className="documents-page">
        <header className="document-commandbar">
          <div className="document-command-title">
            <span className="document-app-mark" aria-hidden="true">
              QD
            </span>
            <div>
              <p>DOCUMENTOS</p>
              <strong>{draft?.title ?? "Biblioteca documental"}</strong>
            </div>
            {draft ? (
              <span className={`document-save-state ${dirty ? "is-dirty" : ""}`}>
                <i />
                {dirty ? "Cambios sin guardar" : `Guardado · revision ${draft.revision}`}
              </span>
            ) : null}
          </div>
          <div className="document-command-actions">
            {draft ? (
              <>
                <button type="button" onClick={() => void duplicate()} disabled={saving}>
                  Duplicar
                </button>
                <button type="button" onClick={() => setShowTemplate(true)} disabled={saving}>
                  Guardar como plantilla
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => setShowCreate(true)}>
              Nuevo
            </button>
            <button
              className="document-save-button"
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </header>

        <div className="document-toolbar" role="toolbar" aria-label="Herramientas del documento">
          <div className="document-toolbar-group">
            <button
              type="button"
              className={libraryOpen ? "is-active" : ""}
              onClick={() => setLibraryOpen((open) => !open)}
              aria-expanded={libraryOpen}
              aria-label="Mostrar u ocultar biblioteca"
            >
              <span aria-hidden="true">☰</span>
              Biblioteca
            </button>
          </div>
          {draft ? (
            <>
              <div className="document-toolbar-group document-insert-tools">
                <span>Insertar</span>
                {documentBlockTypes.map((type) => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => patchDraft({ blocks: [...draft.blocks, newBlock(type)] })}
                    title={`Insertar ${blockLabels[type].toLocaleLowerCase("es")}`}
                  >
                    {blockLabels[type]}
                  </button>
                ))}
              </div>
              <div className="document-toolbar-group document-view-tools">
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.max(60, value - 10))}
                  disabled={zoom <= 60}
                  aria-label="Reducir zoom"
                >
                  −
                </button>
                <output aria-label="Nivel de zoom">{zoom}%</output>
                <button
                  type="button"
                  onClick={() => setZoom((value) => Math.min(120, value + 10))}
                  disabled={zoom >= 120}
                  aria-label="Aumentar zoom"
                >
                  +
                </button>
                <button
                  type="button"
                  className={inspectorOpen ? "is-active" : ""}
                  onClick={() => setInspectorOpen((open) => !open)}
                  aria-expanded={inspectorOpen}
                >
                  Propiedades
                </button>
              </div>
            </>
          ) : null}
        </div>

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

        <div
          className={`document-workbench ${libraryOpen ? "has-library" : ""} ${draft && inspectorOpen ? "has-inspector" : ""}`}
        >
          {libraryOpen ? (
            <aside className="document-library" aria-label="Biblioteca de documentos">
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
          ) : null}

          {draft ? (
            <main className="document-canvas" aria-label="Editor de documento">
              <div className="document-canvas-meta">
                <span>
                  {draft.design.pageSize} · Pagina 1
                </span>
                <span>{draft.blocks.length} bloques</span>
              </div>
              <div className="document-canvas-scroll">
                <div
                  className="document-zoom-layer"
                  style={{ "--document-zoom": zoom / 100 } as CSSProperties}
                >
                  <article
                    className={`document-page ${
                      draft.design.fontFamily === "SERIF"
                        ? "preview-serif"
                        : draft.design.fontFamily === "MONO"
                          ? "preview-mono"
                          : ""
                    }`}
                    style={{ color: draft.design.textColor }}
                  >
                    <header style={{ borderColor: draft.design.accentColor }}>
                      <input
                        aria-label="Texto del encabezado"
                        value={draft.design.headerText}
                        placeholder="Nombre de la empresa"
                        onChange={(event) =>
                          patchDraft({
                            design: { ...draft.design, headerText: event.target.value },
                          })
                        }
                      />
                      <strong>{draft.kind === "QUOTE" ? "COTIZACION" : "FACTURA"}</strong>
                    </header>
                    <section className="document-page-title">
                      <p>PREPARADO PARA</p>
                      <span>{selectedContact?.displayName ?? "Selecciona un contacto"}</span>
                      <textarea
                        aria-label="Titulo del documento"
                        value={draft.title}
                        rows={2}
                        onChange={(event) => patchDraft({ title: event.target.value })}
                      />
                    </section>
                    <div className="document-block-list document-page-blocks">
                      {draft.blocks.length === 0 ? (
                        <button
                          className="document-empty-page"
                          type="button"
                          onClick={() =>
                            patchDraft({ blocks: [...draft.blocks, newBlock("TEXT")] })
                          }
                        >
                          <span>+</span>
                          Empieza a escribir
                        </button>
                      ) : null}
                      {draft.blocks.map((block, index) => (
                        <article
                          className={`document-block ${block.locked ? "locked" : ""}`}
                          key={block.id}
                        >
                          <header className="document-block-tools">
                            <span className="block-handle" aria-hidden="true">
                              ⋮⋮
                            </span>
                            <strong>{blockLabels[block.type]}</strong>
                            {block.locked ? <small>Protegido</small> : null}
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, (current) => ({
                                    ...current,
                                    locked: !current.locked,
                                  }))
                                }
                              >
                                {block.locked ? "Desproteger" : "Proteger"}
                              </button>
                              <button
                                type="button"
                                onClick={() => moveBlock(index, -1)}
                                disabled={index === 0 || block.locked}
                                aria-label="Mover bloque arriba"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveBlock(index, 1)}
                                disabled={index === draft.blocks.length - 1 || block.locked}
                                aria-label="Mover bloque abajo"
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
                                aria-label="Eliminar bloque"
                              >
                                ×
                              </button>
                            </div>
                          </header>
                          <BlockEditor
                            block={block}
                            onChange={(next) => updateBlock(block.id, () => next)}
                            uploading={uploadingBlockId === block.id}
                            onFileSelected={(file) => void uploadDocumentFile(block.id, file)}
                            csrf={csrf}
                          />
                        </article>
                      ))}
                    </div>
                    <footer style={{ borderColor: draft.design.accentColor }}>
                      <input
                        aria-label="Texto del pie de pagina"
                        value={draft.design.footerText}
                        placeholder="Pie de pagina"
                        onChange={(event) =>
                          patchDraft({
                            design: { ...draft.design, footerText: event.target.value },
                          })
                        }
                      />
                      {draft.design.showPageNumbers ? <small>01 / 01</small> : null}
                    </footer>
                  </article>
                </div>
              </div>
            </main>
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

          {draft && inspectorOpen ? (
            <aside className="document-inspector" aria-label="Propiedades del documento">
              <header>
                <div>
                  <span>PROPIEDADES</span>
                  <strong>Documento</strong>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorOpen(false)}
                  aria-label="Cerrar propiedades"
                >
                  ×
                </button>
              </header>
              <section>
                <h2>Datos vinculados</h2>
                <label>
                  Contacto
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
                  Oportunidad
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
              </section>
              <section>
                <h2>Apariencia</h2>
                <div className="document-color-field">
                  <label>
                    Color principal
                    <input
                      type="color"
                      value={draft.design.accentColor}
                      onChange={(event) =>
                        patchDraft({ design: { ...draft.design, accentColor: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    Color del texto
                    <input
                      type="color"
                      value={draft.design.textColor}
                      onChange={(event) =>
                        patchDraft({ design: { ...draft.design, textColor: event.target.value } })
                      }
                    />
                  </label>
                </div>
                <label>
                  Tipografia
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
                <label className="document-toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.design.showPageNumbers}
                    onChange={(event) =>
                      patchDraft({
                        design: { ...draft.design, showPageNumbers: event.target.checked },
                      })
                    }
                  />
                  Mostrar numero de pagina
                </label>
              </section>
              <section className="document-inspector-summary">
                <h2>Resumen</h2>
                <dl>
                  <div>
                    <dt>Tipo</dt>
                    <dd>{draft.kind === "QUOTE" ? "Cotizacion" : "Factura"}</dd>
                  </div>
                  <div>
                    <dt>Estado</dt>
                    <dd>Borrador</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>{draft.revision}</dd>
                  </div>
                </dl>
              </section>
            </aside>
          ) : null}
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
  uploading,
  onFileSelected,
  csrf,
}: {
  readonly block: DocumentBlock;
  readonly onChange: (block: DocumentBlock) => void;
  readonly uploading: boolean;
  readonly onFileSelected: (file: File) => void;
  readonly csrf: string | null;
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
          {block.fileId && csrf ? (
            <AuthorizedFileImage
              fileId={block.fileId}
              alt={block.alt || block.label}
              csrf={csrf}
            />
          ) : (
            <>
              <span>IMAGEN</span>
              <strong>Arrastra la atencion hacia una imagen</strong>
              <small>JPEG, PNG o WebP. Quantum la valida antes de mostrarla.</small>
            </>
          )}
          <label className="document-file-button">
            {uploading
              ? "Validando archivo..."
              : block.fileId
                ? "Sustituir imagen"
                : "Cargar imagen"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={(block.locked && !block.replaceable) || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileSelected(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
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
        <label className="instance-editability">
          <input
            type="checkbox"
            checked={block.replaceable}
            disabled={!block.locked}
            onChange={(event) => onChange({ ...block, replaceable: event.target.checked })}
          />
          Permitir cambiar esta imagen al usar la plantilla
        </label>
      </div>
    );
  if (block.type === "ATTACHMENT")
    return (
      <div className="image-slot-editor attachment-slot-editor">
        <div>
          <span>ARCHIVO</span>
          <strong>{block.fileId ? block.originalName : "Ficha o documento"}</strong>
          <small>
            {block.fileId
              ? "Archivo verificado y vinculado."
              : "PDF o documento permitido; nunca se publica antes del scan."}
          </small>
          <label className="document-file-button">
            {uploading
              ? "Validando archivo..."
              : block.fileId
                ? "Sustituir archivo"
                : "Cargar archivo"}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={block.locked || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFileSelected(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {block.fileId && csrf ? (
            <AuthorizedFileDownload fileId={block.fileId} csrf={csrf} />
          ) : null}
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
          Nombre
          <input value={block.originalName} disabled readOnly />
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
        <div className="document-table-grid">
          <div className="document-table-row document-table-head">
            {block.columns.map((column, columnIndex) => (
              <input
                key={columnIndex}
                value={column}
                disabled={block.locked}
                aria-label={`Encabezado ${columnIndex + 1}`}
                onChange={(event) =>
                  onChange({
                    ...block,
                    columns: block.columns.map((value, index) =>
                      index === columnIndex ? event.target.value : value,
                    ),
                  })
                }
              />
            ))}
          </div>
          {block.rows.map((row, rowIndex) => (
            <div className="document-table-row" key={rowIndex}>
              {block.columns.map((_, columnIndex) => (
                <input
                  key={columnIndex}
                  value={row[columnIndex] ?? ""}
                  disabled={block.locked}
                  aria-label={`Fila ${rowIndex + 1}, columna ${columnIndex + 1}`}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      rows: block.rows.map((currentRow, currentRowIndex) =>
                        currentRowIndex === rowIndex
                          ? currentRow.map((value, currentColumnIndex) =>
                              currentColumnIndex === columnIndex ? event.target.value : value,
                            )
                          : currentRow,
                      ),
                    })
                  }
                />
              ))}
              <button
                type="button"
                disabled={block.locked || block.rows.length === 1}
                onClick={() =>
                  onChange({
                    ...block,
                    rows: block.rows.filter((_, currentRowIndex) => currentRowIndex !== rowIndex),
                  })
                }
                aria-label={`Eliminar fila ${rowIndex + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          className="document-add-row"
          type="button"
          disabled={block.locked || block.rows.length >= 100}
          onClick={() =>
            onChange({ ...block, rows: [...block.rows, block.columns.map(() => "")] })
          }
        >
          + Agregar fila
        </button>
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
            <option value="contact.phone">TelÃ©fono del contacto</option>
            <option value="advisor.name">Nombre del asesor</option>
            <option value="advisor.email">Correo del asesor</option>
            <option value="company.name">Nombre de la empresa</option>
            <option value="opportunity.title">Nombre de la oportunidad</option>
            <option value="opportunity.amount">Valor de la oportunidad</option>
            <option value="opportunity.currency">Moneda de la oportunidad</option>
            <option value="opportunity.status">Estado de la oportunidad</option>
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
        <label>
          Valor de esta instancia
          <input
            value={block.value ?? ""}
            disabled={block.locked && !block.editable}
            placeholder="Se completa al crear desde plantilla"
            onChange={(event) => onChange({ ...block, value: event.target.value })}
          />
        </label>
        <label className="instance-editability">
          <input
            type="checkbox"
            checked={block.editable}
            disabled={!block.locked}
            onChange={(event) => onChange({ ...block, editable: event.target.checked })}
          />
          Permitir retocar este dato al usar la plantilla
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

function AuthorizedFileImage({
  fileId,
  alt,
  csrf,
}: {
  readonly fileId: string;
  readonly alt: string;
  readonly csrf: string;
}): React.JSX.Element {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/files/${fileId}/download-authorizations`, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("file-not-available");
        return (await response.json()) as FileDownloadAuthorizationResponse;
      })
      .then((response) => setSource(response.data.url))
      .catch(() => setSource(null));
    return () => controller.abort();
  }, [csrf, fileId]);
  return source ? <img src={source} alt={alt} /> : <small>Preparando vista previa...</small>;
}

function AuthorizedFileDownload({
  fileId,
  csrf,
}: {
  readonly fileId: string;
  readonly csrf: string;
}): React.JSX.Element {
  const [preparing, setPreparing] = useState(false);
  async function download(): Promise<void> {
    setPreparing(true);
    try {
      const response = await fetch(`/api/files/${fileId}/download-authorizations`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() },
      });
      if (!response.ok) throw new Error("file-not-available");
      const authorization = (await response.json()) as FileDownloadAuthorizationResponse;
      window.location.assign(authorization.data.url);
    } finally {
      setPreparing(false);
    }
  }
  return (
    <button type="button" onClick={() => void download()} disabled={preparing}>
      {preparing ? "Preparando..." : "Descargar"}
    </button>
  );
}
