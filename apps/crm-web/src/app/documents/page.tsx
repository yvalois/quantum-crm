"use client";

import type {
  CommercialDocument,
  CommercialDocumentKind,
  Contact,
  DocumentBlock,
  DocumentColumnItem,
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

import {
  addColumnItem,
  canMoveBlock,
  changeColumnsLayout,
  createColumnItem,
  createColumnsBlock,
  documentColumnLayouts,
  moveColumnItem,
  moveColumnItemToCell,
  moveDocumentBlock,
  moveDocumentBlockTo,
  normalizeDocumentBlocks,
  removeColumnItem,
  splitTextBlock,
  updateColumnItem,
} from "./document-editor-model";

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

type DocumentFileTarget =
  | { readonly kind: "BLOCK"; readonly blockId: string }
  | { readonly kind: "COLUMN_ITEM"; readonly blockId: string; readonly itemId: string }
  | { readonly kind: "LOGO" };

function uploadTargetId(target: DocumentFileTarget): string {
  if (target.kind === "LOGO") return "design:logo";
  if (target.kind === "COLUMN_ITEM") return `column:${target.blockId}:${target.itemId}`;
  return `block:${target.blockId}`;
}

function normalizeDocumentForEditor(document: CommercialDocument): CommercialDocument {
  return { ...document, blocks: normalizeDocumentBlocks(document.blocks) };
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
      return {
        id,
        type,
        locked: false,
        content: "Escribe aquí el contenido.",
        align: "LEFT",
        style: "BODY",
        bold: false,
        italic: false,
        underline: false,
      };
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
        width: "FULL",
        align: "CENTER",
        fit: "COVER",
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
      return createColumnsBlock("EQUAL_2", "Columna izquierda", id);
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
  const [uploadingTargetId, setUploadingTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | CommercialDocumentKind>("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [showColumnLayouts, setShowColumnLayouts] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(90);
  const [ribbonTab, setRibbonTab] = useState<"HOME" | "INSERT" | "LAYOUT">("HOME");

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === draft?.contactId) ?? null,
    [contacts, draft?.contactId],
  );
  const selectedBlock = useMemo(
    () => draft?.blocks.find((block) => block.id === selectedBlockId) ?? null,
    [draft?.blocks, selectedBlockId],
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
      setDraft(current ? normalizeDocumentForEditor(structuredClone(current)) : null);
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

  useEffect(() => {
    function closeTemporaryPanels(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setLibraryOpen(false);
      setInspectorOpen(false);
      setShowColumnLayouts(false);
    }
    window.addEventListener("keydown", closeTemporaryPanels);
    return () => window.removeEventListener("keydown", closeTemporaryPanels);
  }, []);

  function selectDocument(document: CommercialDocument): void {
    if (uploadingTargetId) {
      setNotice("Espera a que termine la validacion del archivo antes de cambiar de documento.");
      return;
    }
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")) return;
    setSelectedId(document.id);
    setDraft(normalizeDocumentForEditor(structuredClone(document)));
    setDirty(false);
    setSelectedBlockId(null);
    setLibraryOpen(false);
    setError(null);
    setNotice(null);
  }

  function patchDraft(patch: Partial<CommercialDocument>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  function openInspectorSection(
    sectionId: "document-header-settings" | "document-footer-settings",
  ): void {
    setInspectorOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function updateBlock(id: string, updater: (block: DocumentBlock) => DocumentBlock): void {
    if (!draft) return;
    patchDraft({ blocks: draft.blocks.map((block) => (block.id === id ? updater(block) : block)) });
  }

  function moveBlock(index: number, offset: -1 | 1): void {
    if (!draft) return;
    const next = moveDocumentBlock(draft.blocks, index, offset);
    if (next) patchDraft({ blocks: next });
  }

  function insertBlock(block: DocumentBlock): void {
    if (!draft) return;
    const selectedIndex = draft.blocks.findIndex((item) => item.id === selectedBlockId);
    const insertionIndex = selectedIndex < 0 ? draft.blocks.length : selectedIndex + 1;
    patchDraft({
      blocks: [
        ...draft.blocks.slice(0, insertionIndex),
        block,
        ...draft.blocks.slice(insertionIndex),
      ],
    });
    setSelectedBlockId(block.id);
    setShowColumnLayouts(false);
  }

  function dropBlock(targetIndex: number): void {
    if (!draft || !draggedBlockId) return;
    const sourceIndex = draft.blocks.findIndex((block) => block.id === draggedBlockId);
    const next = moveDocumentBlockTo(draft.blocks, sourceIndex, targetIndex);
    if (next) patchDraft({ blocks: next });
    setDraggedBlockId(null);
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
      setDraft(normalizeDocumentForEditor(created));
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
      setDraft(normalizeDocumentForEditor(updated));
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
      setDraft(normalizeDocumentForEditor(copy));
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

  async function uploadDocumentFile(target: DocumentFileTarget, file: File): Promise<void> {
    if (!draft || uploadingTargetId) return;
    const uploadDocumentId = draft.id;
    setUploadingTargetId(uploadTargetId(target));
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
        current && current.id === uploadDocumentId
          ? {
              ...current,
              design:
                target.kind === "LOGO"
                  ? {
                      ...current.design,
                      logoFileId: available.id,
                      logoChecksum: verifiedChecksum,
                      headerEnabled: true,
                      headerLayout:
                        current.design.headerLayout === "TEXT"
                          ? "LOGO_TEXT"
                          : current.design.headerLayout,
                    }
                  : current.design,
              blocks: current.blocks.map((block) => {
                if (target.kind === "LOGO" || block.id !== target.blockId) return block;
                if (target.kind === "COLUMN_ITEM" && block.type === "COLUMNS") {
                  return updateColumnItem(block, target.itemId, (item) =>
                    item.type === "IMAGE"
                      ? { ...item, fileId: available.id, checksum: verifiedChecksum }
                      : item,
                  );
                }
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
      setNotice("Archivo verificado y vinculado. Guarda el documento para conservarlo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el archivo.");
      setNotice(null);
    } finally {
      setUploadingTargetId(null);
    }
  }

  return (
    <main className="documents-shell document-studio-shell document-processor">
      <section className="documents-page">
        <header className="document-commandbar">
          <div className="document-command-title">
            <a className="document-back-link" href="/" aria-label="Volver al CRM">
              <span aria-hidden="true">←</span>
              CRM
            </a>
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

        <div className="document-toolbar document-ribbon" aria-label="Herramientas del documento">
          <div className="document-ribbon-tabs" role="group" aria-label="Opciones de edicion">
            <button
              type="button"
              className={libraryOpen ? "is-active" : ""}
              onClick={() => {
                setLibraryOpen((open) => !open);
                setInspectorOpen(false);
                setShowColumnLayouts(false);
              }}
              aria-expanded={libraryOpen}
              aria-controls="document-library-panel"
            >
              Biblioteca
            </button>
            {draft
              ? ([
                  ["HOME", "Inicio"],
                  ["INSERT", "Insertar"],
                  ["LAYOUT", "Diseño"],
                ] as const).map(([tab, label]) => (
                  <button
                    type="button"
                    aria-pressed={ribbonTab === tab}
                    className={`document-ribbon-tab ${ribbonTab === tab ? "is-active" : ""}`}
                    key={tab}
                    onClick={() => {
                      setRibbonTab(tab);
                      setShowColumnLayouts(false);
                    }}
                  >
                    {label}
                  </button>
                ))
              : null}
          </div>
          {draft ? (
            <div className="document-ribbon-content">
              {ribbonTab === "HOME" ? (
                <>
                  <div className="document-selection-tools">
                    <span>SELECCION</span>
                    <strong>
                      {selectedBlock ? blockLabels[selectedBlock.type] : "Selecciona contenido"}
                    </strong>
                  </div>
                  {selectedBlock?.type === "TEXT" ? (
                    <div className="document-toolbar-group" role="group" aria-label="Formato del texto">
                      <span>Texto</span>
                      <select
                        aria-label="Estilo del texto"
                        value={selectedBlock.style ?? "BODY"}
                        disabled={selectedBlock.locked}
                        onChange={(event) =>
                          updateBlock(selectedBlock.id, (block) =>
                            block.type === "TEXT"
                              ? {
                                  ...block,
                                  style: event.target.value as NonNullable<typeof block.style>,
                                }
                              : block,
                          )
                        }
                      >
                        <option value="BODY">Parrafo</option>
                        <option value="TITLE">Titulo</option>
                        <option value="SUBTITLE">Subtitulo</option>
                        <option value="CAPTION">Nota</option>
                      </select>
                      {([
                        ["bold", "Negrita", "B"],
                        ["italic", "Cursiva", "I"],
                        ["underline", "Subrayado", "U"],
                      ] as const).map(([property, label, character]) => (
                        <button
                          type="button"
                          key={property}
                          disabled={selectedBlock.locked}
                          className={selectedBlock[property] ? "is-active" : ""}
                          aria-label={label}
                          aria-pressed={selectedBlock[property] ?? false}
                          onClick={() =>
                            updateBlock(selectedBlock.id, (block) =>
                              block.type === "TEXT"
                                ? { ...block, [property]: !(block[property] ?? false) }
                                : block,
                            )
                          }
                        >
                          {character}
                        </button>
                      ))}
                      <span>Alinear</span>
                      {(["LEFT", "CENTER", "RIGHT"] as const).map((align) => (
                        <button
                          type="button"
                          key={align}
                          disabled={selectedBlock.locked}
                          className={selectedBlock.align === align ? "is-active" : ""}
                          onClick={() =>
                            updateBlock(selectedBlock.id, (block) =>
                              block.type === "TEXT" ? { ...block, align } : block,
                            )
                          }
                          aria-label={
                            align === "LEFT"
                              ? "Alinear a la izquierda"
                              : align === "CENTER"
                                ? "Centrar"
                                : "Alinear a la derecha"
                          }
                        >
                          {align === "LEFT" ? "≡←" : align === "CENTER" ? "≡" : "→≡"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedBlock ? (
                    <div className="document-toolbar-group" role="group" aria-label="Organizar bloque">
                      <span>Organizar</span>
                      <button
                        type="button"
                        onClick={() =>
                          moveBlock(
                            draft.blocks.findIndex((block) => block.id === selectedBlock.id),
                            -1,
                          )
                        }
                        disabled={
                          !canMoveBlock(
                            draft.blocks,
                            draft.blocks.findIndex((block) => block.id === selectedBlock.id),
                            -1,
                          )
                        }
                      >
                        Subir
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          moveBlock(
                            draft.blocks.findIndex((block) => block.id === selectedBlock.id),
                            1,
                          )
                        }
                        disabled={
                          !canMoveBlock(
                            draft.blocks,
                            draft.blocks.findIndex((block) => block.id === selectedBlock.id),
                            1,
                          )
                        }
                      >
                        Bajar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(selectedBlock.id, (block) => ({
                            ...block,
                            locked: !block.locked,
                          }))
                        }
                      >
                        {selectedBlock.locked ? "Desproteger" : "Proteger"}
                      </button>
                      {selectedBlock.type === "TEXT" && !selectedBlock.locked ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateBlock(selectedBlock.id, (block) =>
                              block.type === "TEXT" ? splitTextBlock(block) : block,
                            )
                          }
                        >
                          Dividir texto
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ribbon-danger"
                        disabled={selectedBlock.locked}
                        onClick={() => {
                          patchDraft({
                            blocks: draft.blocks.filter(
                              (block) => block.id !== selectedBlock.id,
                            ),
                          });
                          setSelectedBlockId(null);
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  ) : null}
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
                  </div>
                </>
              ) : null}
              {ribbonTab === "INSERT" ? (
              <div className="document-toolbar-group document-insert-tools">
                <span>Agregar despues de la seleccion</span>
                {documentBlockTypes
                  .filter((type) => type !== "COLUMNS")
                  .map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => insertBlock(newBlock(type))}
                      title={`Insertar ${blockLabels[type].toLocaleLowerCase("es")}`}
                    >
                      <i aria-hidden="true">+</i>
                      {blockLabels[type]}
                    </button>
                  ))}
                <div className="document-layout-trigger">
                  <button
                    type="button"
                    className={showColumnLayouts ? "is-active" : ""}
                    onClick={() => setShowColumnLayouts((open) => !open)}
                    aria-expanded={showColumnLayouts}
                    aria-controls="column-layout-picker"
                  >
                    Columnas
                  </button>
                  {showColumnLayouts ? (
                    <div
                      className="column-layout-picker"
                      id="column-layout-picker"
                      role="dialog"
                      aria-label="Elegir disposición de columnas"
                    >
                      <strong>Composicion del renglon</strong>
                      <span>Combina texto, imagenes, variables y lineas dentro de cada columna.</span>
                      <div>
                        {documentColumnLayouts.map((layout) => (
                          <button
                            type="button"
                            key={layout.id}
                            onClick={() => insertBlock(createColumnsBlock(layout.id))}
                            aria-label={layout.label}
                          >
                            <i
                              className={`column-layout-icon layout-${layout.id.toLowerCase()}`}
                              aria-hidden="true"
                            >
                              {Array.from({ length: layout.id === "EQUAL_3" ? 3 : 2 }).map(
                                (_, index) => (
                                  <b key={index} />
                                ),
                              )}
                            </i>
                            <small>{layout.label}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              ) : null}
              {ribbonTab === "LAYOUT" ? (
                <>
                  <div className="document-toolbar-group">
                    <span>Pagina</span>
                    {(["A4", "LETTER"] as const).map((pageSize) => (
                      <button
                        type="button"
                        className={draft.design.pageSize === pageSize ? "is-active" : ""}
                        key={pageSize}
                        onClick={() => patchDraft({ design: { ...draft.design, pageSize } })}
                      >
                        {pageSize === "LETTER" ? "Carta" : "A4"}
                      </button>
                    ))}
                  </div>
                  <div className="document-toolbar-group">
                    <span>Regiones</span>
                    <button
                      type="button"
                      className={draft.design.headerEnabled ? "is-active" : ""}
                      onClick={() =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            headerEnabled: !draft.design.headerEnabled,
                          },
                        })
                      }
                    >
                      Encabezado
                    </button>
                    <button
                      type="button"
                      className={draft.design.footerEnabled ? "is-active" : ""}
                      onClick={() =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            footerEnabled: !draft.design.footerEnabled,
                          },
                        })
                      }
                    >
                      Pie de pagina
                    </button>
                  </div>
                  <div className="document-toolbar-group document-view-tools">
                <button
                  type="button"
                  className={inspectorOpen ? "is-active" : ""}
                  onClick={() => {
                    setInspectorOpen((open) => !open);
                    setLibraryOpen(false);
                    setShowColumnLayouts(false);
                  }}
                  aria-expanded={inspectorOpen}
                  aria-controls="document-inspector-panel"
                >
                  Propiedades avanzadas
                </button>
              </div>
                </>
              ) : null}
            </div>
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

        <div className="document-workbench">
          {libraryOpen ? (
            <aside
              className="document-library"
              id="document-library-panel"
              role="dialog"
              aria-modal="false"
              aria-label="Biblioteca de documentos"
            >
              <div className="library-heading">
                <div>
                  <span>Biblioteca</span>
                  <strong>{documents.length}</strong>
                </div>
                <div className="library-heading-actions">
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    aria-label="Crear documento"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(false)}
                    aria-label="Cerrar biblioteca"
                  >
                    ×
                  </button>
                </div>
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
            <section className="document-canvas" aria-label="Editor de documento">
              <div className="document-canvas-meta">
                <span>{draft.design.pageSize} · Pagina 1</span>
                <span>{draft.blocks.length} bloques</span>
              </div>
              <div className="document-canvas-scroll">
                <div
                  className="document-zoom-layer"
                  style={
                    {
                      "--document-zoom": zoom / 100,
                      "--document-page-height":
                        draft.design.pageSize === "LETTER" ? "64.7rem" : "70.7rem",
                    } as CSSProperties
                  }
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
                    {draft.design.headerEnabled ? (
                      <header
                        className={`document-page-region document-page-header region-${draft.design.headerSpacing.toLowerCase()} layout-${draft.design.headerLayout.toLowerCase()} align-${draft.design.headerAlign.toLowerCase()}`}
                        style={{ borderColor: draft.design.accentColor }}
                        title="Doble clic para configurar el encabezado"
                        onDoubleClick={() => openInspectorSection("document-header-settings")}
                      >
                        <div className="document-header-content">
                          {draft.design.logoFileId && csrf ? (
                            <span className="document-header-logo">
                              <AuthorizedFileImage
                                fileId={draft.design.logoFileId}
                                alt="Logotipo de la empresa"
                                csrf={csrf}
                              />
                            </span>
                          ) : null}
                          <textarea
                            aria-label="Texto del encabezado"
                            value={draft.design.headerText}
                            rows={2}
                            placeholder="Nombre de la empresa"
                            onChange={(event) =>
                              patchDraft({
                                design: { ...draft.design, headerText: event.target.value },
                              })
                            }
                          />
                        </div>
                        {draft.design.showDocumentKind ? (
                          <strong>{draft.kind === "QUOTE" ? "COTIZACION" : "FACTURA"}</strong>
                        ) : null}
                        <button
                          className="document-region-settings"
                          type="button"
                          onClick={() => openInspectorSection("document-header-settings")}
                        >
                          Configurar encabezado
                        </button>
                      </header>
                    ) : (
                      <button
                        className="document-region-hidden"
                        type="button"
                        onClick={() =>
                          patchDraft({
                            design: { ...draft.design, headerEnabled: true },
                          })
                        }
                      >
                        + Agregar encabezado
                      </button>
                    )}
                    <section className="document-page-title">
                      <p>PREPARADO PARA</p>
                      <span>{selectedContact?.displayName ?? "Selecciona un contacto"}</span>
                      <textarea
                        className="document-title-input"
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
                          className={`document-block ${block.locked ? "locked" : ""} ${selectedBlockId === block.id ? "selected" : ""} ${draggedBlockId === block.id ? "dragging" : ""}`}
                          key={block.id}
                          onClick={() => setSelectedBlockId(block.id)}
                          onFocus={() => setSelectedBlockId(block.id)}
                          onDragOver={(event) => {
                            const sourceIndex = draft.blocks.findIndex(
                              (item) => item.id === draggedBlockId,
                            );
                            if (moveDocumentBlockTo(draft.blocks, sourceIndex, index) !== null) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            dropBlock(index);
                          }}
                        >
                          <header className="document-block-gutter">
                            <span
                              className="block-handle"
                              draggable={!block.locked}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", block.id);
                                setDraggedBlockId(block.id);
                              }}
                              onDragEnd={() => setDraggedBlockId(null)}
                              title={block.locked ? "Bloque protegido" : "Arrastrar para reordenar"}
                              aria-hidden="true"
                            >
                              ⋮⋮
                            </span>
                            <strong>{blockLabels[block.type]}</strong>
                            {block.locked ? <small aria-label="Bloque protegido">●</small> : null}
                          </header>
                          <BlockEditor
                            block={block}
                            selected={selectedBlockId === block.id}
                            onChange={(next) => updateBlock(block.id, () => next)}
                            uploading={uploadingTargetId === `block:${block.id}`}
                            uploadingItemId={
                              uploadingTargetId?.startsWith(`column:${block.id}:`)
                                ? (uploadingTargetId.split(":")[2] ?? null)
                                : null
                            }
                            onFileSelected={(file, itemId) =>
                              void uploadDocumentFile(
                                itemId
                                  ? { kind: "COLUMN_ITEM", blockId: block.id, itemId }
                                  : { kind: "BLOCK", blockId: block.id },
                                file,
                              )
                            }
                            csrf={csrf}
                          />
                        </article>
                      ))}
                    </div>
                    {draft.design.footerEnabled ? (
                      <footer
                        className={`document-page-region document-page-footer region-${draft.design.footerSpacing.toLowerCase()} align-${draft.design.footerAlign.toLowerCase()}`}
                        style={{ borderColor: draft.design.accentColor }}
                        title="Doble clic para configurar el pie de pagina"
                        onDoubleClick={() => openInspectorSection("document-footer-settings")}
                      >
                        <textarea
                          aria-label="Texto del pie de pagina"
                          value={draft.design.footerText}
                          rows={2}
                          placeholder="Pie de pagina"
                          onChange={(event) =>
                            patchDraft({
                              design: { ...draft.design, footerText: event.target.value },
                            })
                          }
                        />
                        {draft.design.showPageNumbers ? <small>01 / 01</small> : null}
                        <button
                          className="document-region-settings"
                          type="button"
                          onClick={() => openInspectorSection("document-footer-settings")}
                        >
                          Configurar pie
                        </button>
                      </footer>
                    ) : (
                      <button
                        className="document-region-hidden footer-hidden"
                        type="button"
                        onClick={() =>
                          patchDraft({
                            design: { ...draft.design, footerEnabled: true },
                          })
                        }
                      >
                        + Agregar pie de pagina
                      </button>
                    )}
                  </article>
                </div>
              </div>
            </section>
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
            <aside
              className="document-inspector"
              id="document-inspector-panel"
              role="dialog"
              aria-modal="false"
              aria-label="Propiedades del documento"
            >
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
                    onChange={(event) => patchDraft({ opportunityId: event.target.value || null })}
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
              <section className="document-region-inspector" id="document-header-settings">
                <h2>Encabezado</h2>
                <label className="document-toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.design.headerEnabled}
                    onChange={(event) =>
                      patchDraft({
                        design: { ...draft.design, headerEnabled: event.target.checked },
                      })
                    }
                  />
                  Mostrar encabezado
                </label>
                <div className="document-inspector-grid">
                  <label>
                    Distribucion
                    <select
                      value={draft.design.headerLayout}
                      disabled={!draft.design.headerEnabled}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            headerLayout: event.target
                              .value as CommercialDocument["design"]["headerLayout"],
                          },
                        })
                      }
                    >
                      <option value="TEXT">Texto y tipo, sin logo</option>
                      <option value="LOGO_TEXT">Logo y texto, tipo debajo</option>
                      <option value="SPLIT">Logo y texto, tipo separado</option>
                    </select>
                  </label>
                  <label>
                    Alineacion del texto
                    <select
                      value={draft.design.headerAlign}
                      disabled={!draft.design.headerEnabled}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            headerAlign: event.target
                              .value as CommercialDocument["design"]["headerAlign"],
                          },
                        })
                      }
                    >
                      <option value="LEFT">Izquierda</option>
                      <option value="CENTER">Centro</option>
                      <option value="RIGHT">Derecha</option>
                    </select>
                  </label>
                  <label>
                    Espacio
                    <select
                      value={draft.design.headerSpacing}
                      disabled={!draft.design.headerEnabled}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            headerSpacing: event.target
                              .value as CommercialDocument["design"]["headerSpacing"],
                          },
                        })
                      }
                    >
                      <option value="COMPACT">Compacto</option>
                      <option value="NORMAL">Normal</option>
                      <option value="SPACIOUS">Amplio</option>
                    </select>
                  </label>
                </div>
                <label className="document-toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.design.showDocumentKind}
                    disabled={!draft.design.headerEnabled}
                    onChange={(event) =>
                      patchDraft({
                        design: { ...draft.design, showDocumentKind: event.target.checked },
                      })
                    }
                  />
                  Mostrar Cotizacion o Factura
                </label>
                <div className="document-logo-control">
                  {draft.design.logoFileId && csrf ? (
                    <AuthorizedFileImage
                      fileId={draft.design.logoFileId}
                      alt="Logotipo del encabezado"
                      csrf={csrf}
                    />
                  ) : (
                    <span>LOGO</span>
                  )}
                  <label className="document-file-button">
                    {uploadingTargetId === "design:logo"
                      ? "Validando logo..."
                      : draft.design.logoFileId
                        ? "Sustituir logo"
                        : "Cargar logo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={uploadingTargetId === "design:logo"}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadDocumentFile({ kind: "LOGO" }, file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {draft.design.logoFileId ? (
                    <button
                      type="button"
                      onClick={() =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            logoFileId: null,
                            logoChecksum: null,
                          },
                        })
                      }
                    >
                      Quitar
                    </button>
                  ) : null}
                </div>
              </section>
              <section className="document-region-inspector" id="document-footer-settings">
                <h2>Pie de pagina</h2>
                <label className="document-toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.design.footerEnabled}
                    onChange={(event) =>
                      patchDraft({
                        design: { ...draft.design, footerEnabled: event.target.checked },
                      })
                    }
                  />
                  Mostrar pie de pagina
                </label>
                <div className="document-inspector-grid">
                  <label>
                    Alineacion del texto
                    <select
                      value={draft.design.footerAlign}
                      disabled={!draft.design.footerEnabled}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            footerAlign: event.target
                              .value as CommercialDocument["design"]["footerAlign"],
                          },
                        })
                      }
                    >
                      <option value="LEFT">Izquierda</option>
                      <option value="CENTER">Centro</option>
                      <option value="RIGHT">Derecha</option>
                    </select>
                  </label>
                  <label>
                    Espacio
                    <select
                      value={draft.design.footerSpacing}
                      disabled={!draft.design.footerEnabled}
                      onChange={(event) =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            footerSpacing: event.target
                              .value as CommercialDocument["design"]["footerSpacing"],
                          },
                        })
                      }
                    >
                      <option value="COMPACT">Compacto</option>
                      <option value="NORMAL">Normal</option>
                      <option value="SPACIOUS">Amplio</option>
                    </select>
                  </label>
                </div>
                <label className="document-toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.design.showPageNumbers}
                    disabled={!draft.design.footerEnabled}
                    onChange={(event) =>
                      patchDraft({
                        design: { ...draft.design, showPageNumbers: event.target.checked },
                      })
                    }
                  />
                  Mostrar numero de pagina
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
    </main>
  );
}

function BlockEditor({
  block,
  selected,
  onChange,
  uploading,
  uploadingItemId,
  onFileSelected,
  csrf,
}: {
  readonly block: DocumentBlock;
  readonly selected: boolean;
  readonly onChange: (block: DocumentBlock) => void;
  readonly uploading: boolean;
  readonly uploadingItemId: string | null;
  readonly onFileSelected: (file: File, itemId?: string) => void;
  readonly csrf: string | null;
}): React.JSX.Element {
  if (block.type === "TEXT")
    return (
      <div className="document-prose-editor">
        <textarea
          className={`document-prose-input align-${block.align.toLowerCase()} text-style-${(block.style ?? "BODY").toLowerCase()} ${block.bold ? "is-bold" : ""} ${block.italic ? "is-italic" : ""} ${block.underline ? "is-underlined" : ""}`}
          aria-label="Texto del documento"
          value={block.content}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, content: event.target.value })}
        />
      </div>
    );
  if (block.type === "TERMS")
    return (
      <div className="document-terms-editor">
        <input
          className="document-prose-heading"
          aria-label="Titulo de condiciones"
          value={block.title}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
        <textarea
          className="document-prose-input"
          aria-label="Contenido de condiciones"
          value={block.content}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, content: event.target.value })}
        />
      </div>
    );
  if (block.type === "IMAGE")
    return (
      <div
        className={`image-slot-editor image-width-${block.width.toLowerCase()} image-align-${block.align.toLowerCase()} image-fit-${block.fit.toLowerCase()}`}
      >
        <div>
          {block.fileId && csrf ? (
            <AuthorizedFileImage fileId={block.fileId} alt={block.alt || block.label} csrf={csrf} />
          ) : (
            <>
              <span>IMAGEN</span>
              <strong>Arrastra la atencion hacia una imagen</strong>
              <small>JPEG, PNG o WebP. Quantum la valida antes de mostrarla.</small>
            </>
          )}
          {block.caption ? <small className="document-image-caption">{block.caption}</small> : null}
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
        {selected ? (
          <div className="document-inline-controls" aria-label="Propiedades de la imagen">
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
            <label>
              Pie de imagen
              <input
                value={block.caption}
                disabled={block.locked}
                onChange={(event) => onChange({ ...block, caption: event.target.value })}
              />
            </label>
          <div className="image-presentation-controls">
          <label>
            Ancho
            <select
              value={block.width}
              disabled={block.locked}
              onChange={(event) =>
                onChange({ ...block, width: event.target.value as typeof block.width })
              }
            >
              <option value="FULL">Completo</option>
              <option value="WIDE">Amplio</option>
              <option value="MEDIUM">Mediano</option>
              <option value="SMALL">Pequeño</option>
            </select>
          </label>
          <label>
            Alineacion
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
          </label>
          <label>
            Ajuste
            <select
              value={block.fit}
              disabled={block.locked}
              onChange={(event) =>
                onChange({ ...block, fit: event.target.value as typeof block.fit })
              }
            >
              <option value="COVER">Recortar</option>
              <option value="CONTAIN">Contener</option>
            </select>
          </label>
          </div>
          <label className="instance-editability">
            <input
              type="checkbox"
              checked={block.replaceable}
              disabled={block.locked}
              onChange={(event) => onChange({ ...block, replaceable: event.target.checked })}
            />
            Permitir cambiar esta imagen al usar la plantilla
          </label>
          </div>
        ) : null}
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
      <div className="columns-block-editor">
        {selected ? (
        <div
          className="column-layout-controls document-inline-controls"
          role="group"
          aria-label="Disposición del renglón"
        >
          <span>Distribución</span>
          {documentColumnLayouts.map((layout) => (
            <button
              type="button"
              key={layout.id}
              className={block.layout === layout.id ? "active" : ""}
              disabled={block.locked}
              onClick={() => onChange(changeColumnsLayout(block, layout.id))}
              aria-label={layout.label}
              aria-pressed={block.layout === layout.id}
              title={layout.label}
            >
              <i
                className={`column-layout-icon layout-${layout.id.toLowerCase()}`}
                aria-hidden="true"
              >
                {Array.from({ length: layout.id === "EQUAL_3" ? 3 : 2 }).map((_, index) => (
                  <b key={index} />
                ))}
              </i>
            </button>
          ))}
        </div>
        ) : null}
        <div
          className="columns-editor"
          style={
            {
              "--document-columns":
                documentColumnLayouts.find((layout) => layout.id === block.layout)?.template ??
                "1fr 1fr",
            } as CSSProperties
          }
        >
          {!block.cells
            ? block.columns.map((content, columnIndex) => (
                <section className="document-column-cell legacy-column-cell" key={columnIndex}>
                  <span>Columna {columnIndex + 1}</span>
                  <p>{content || "Columna vacia"}</p>
                </section>
              ))
            : block.cells.map((cell, columnIndex) => (
                <section className="document-column-cell" key={cell.id}>
                  <header className="document-column-head document-column-insert">
                    <span>Agregar en columna {columnIndex + 1}</span>
                    <div aria-label={`Agregar contenido a la columna ${columnIndex + 1}`}>
                      <button
                        type="button"
                        disabled={block.locked}
                        onClick={() =>
                          onChange(addColumnItem(block, cell.id, createColumnItem("TEXT")))
                        }
                      >
                        + Texto
                      </button>
                      <button
                        type="button"
                        disabled={block.locked}
                        onClick={() =>
                          onChange(addColumnItem(block, cell.id, createColumnItem("IMAGE")))
                        }
                      >
                        + Imagen
                      </button>
                      <button
                        type="button"
                        disabled={block.locked}
                        onClick={() =>
                          onChange(addColumnItem(block, cell.id, createColumnItem("VARIABLE")))
                        }
                      >
                        + Variable
                      </button>
                      <button
                        type="button"
                        disabled={block.locked}
                        onClick={() =>
                          onChange(addColumnItem(block, cell.id, createColumnItem("DIVIDER")))
                        }
                      >
                        + Linea
                      </button>
                    </div>
                  </header>
                  <div className="document-column-items">
                    {cell.items.length === 0 ? (
                      <button
                        type="button"
                        className="document-column-empty"
                        disabled={block.locked}
                        onClick={() =>
                          onChange(addColumnItem(block, cell.id, createColumnItem("TEXT")))
                        }
                      >
                        + Agregar contenido
                      </button>
                    ) : null}
                    {cell.items.map((item, itemIndex) => (
                      <article
                        className={`document-column-item item-${item.type.toLowerCase()}`}
                        key={item.id}
                      >
                        <header className="document-inline-controls">
                          <strong>
                            {item.type === "TEXT"
                              ? "Texto"
                              : item.type === "IMAGE"
                                ? "Imagen"
                                : item.type === "VARIABLE"
                                  ? "Variable"
                                  : "Separador"}
                          </strong>
                          <div>
                            <button
                              type="button"
                              disabled={block.locked || columnIndex === 0}
                              aria-label="Mover elemento a la columna anterior"
                              onClick={() => {
                                const target = block.cells?.[columnIndex - 1];
                                if (target)
                                  onChange(moveColumnItemToCell(block, item.id, target.id));
                              }}
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={
                                block.locked || columnIndex === (block.cells?.length ?? 0) - 1
                              }
                              aria-label="Mover elemento a la columna siguiente"
                              onClick={() => {
                                const target = block.cells?.[columnIndex + 1];
                                if (target)
                                  onChange(moveColumnItemToCell(block, item.id, target.id));
                              }}
                            >
                              →
                            </button>
                            <button
                              type="button"
                              disabled={block.locked || itemIndex === 0}
                              aria-label="Mover elemento arriba"
                              onClick={() =>
                                onChange(moveColumnItem(block, cell.id, itemIndex, -1))
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={block.locked || itemIndex === cell.items.length - 1}
                              aria-label="Mover elemento abajo"
                              onClick={() => onChange(moveColumnItem(block, cell.id, itemIndex, 1))}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              disabled={block.locked}
                              aria-label="Eliminar elemento de columna"
                              onClick={() => onChange(removeColumnItem(block, item.id))}
                            >
                              ×
                            </button>
                          </div>
                        </header>
                        <ColumnItemEditor
                          item={item}
                          locked={block.locked}
                          selected={selected}
                          uploading={uploadingItemId === item.id}
                          csrf={csrf}
                          onChange={(next) =>
                            onChange(updateColumnItem(block, item.id, () => next))
                          }
                          onFileSelected={(file) => onFileSelected(file, item.id)}
                        />
                      </article>
                    ))}
                  </div>
                </section>
              ))}
        </div>
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
          onClick={() => onChange({ ...block, rows: [...block.rows, block.columns.map(() => "")] })}
        >
          + Agregar fila
        </button>
      </div>
    );
  if (block.type === "VARIABLE")
    return (
      <div className="document-variable-editor">
        <span className="document-variable-value">
          {block.value || block.fallback || block.label}
        </span>
        {selected ? (
        <div className="form-grid-2 document-inline-controls">
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
        ) : null}
      </div>
    );
  if (block.type === "SIGNATURE")
    return (
      <div className="signature-editor">
        <span className="signature-line" aria-hidden="true" />
        <input
          aria-label="Etiqueta de firma"
          value={block.label}
          disabled={block.locked}
          onChange={(event) => onChange({ ...block, label: event.target.value })}
        />
      </div>
    );
  if (block.type === "DIVIDER")
    return (
      <div className={`divider-editor divider-${block.style.toLowerCase()}`}>
        <hr />
        {selected ? (
          <select
            className="document-inline-controls"
            aria-label="Estilo del separador"
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
        ) : null}
      </div>
    );
  return <div />;
}

function ColumnItemEditor({
  item,
  locked,
  selected,
  uploading,
  csrf,
  onChange,
  onFileSelected,
}: {
  readonly item: DocumentColumnItem;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly uploading: boolean;
  readonly csrf: string | null;
  readonly onChange: (item: DocumentColumnItem) => void;
  readonly onFileSelected: (file: File) => void;
}): React.JSX.Element {
  if (item.type === "TEXT") {
    return (
      <div className="column-text-editor">
        <textarea
          className={`document-prose-input align-${item.align.toLowerCase()} text-style-${(item.style ?? "BODY").toLowerCase()} ${item.bold ? "is-bold" : ""} ${item.italic ? "is-italic" : ""} ${item.underline ? "is-underlined" : ""}`}
          value={item.content}
          disabled={locked}
          placeholder="Escribe en esta columna..."
          onChange={(event) => onChange({ ...item, content: event.target.value })}
        />
        {selected ? (
          <div className="document-inline-controls" aria-label="Formato del texto de columna">
            <select
              value={item.style ?? "BODY"}
              disabled={locked}
              aria-label="Estilo del texto"
              onChange={(event) =>
                onChange({
                  ...item,
                  style: event.target.value as NonNullable<typeof item.style>,
                })
              }
            >
              <option value="BODY">Parrafo</option>
              <option value="TITLE">Titulo</option>
              <option value="SUBTITLE">Subtitulo</option>
              <option value="CAPTION">Nota</option>
            </select>
            {([
              ["bold", "Negrita", "B"],
              ["italic", "Cursiva", "I"],
              ["underline", "Subrayado", "U"],
            ] as const).map(([property, label, character]) => (
              <button
                type="button"
                key={property}
                disabled={locked}
                className={item[property] ? "is-active" : ""}
                aria-label={label}
                aria-pressed={item[property] ?? false}
                onClick={() => onChange({ ...item, [property]: !(item[property] ?? false) })}
              >
                {character}
              </button>
            ))}
            <select
              value={item.align}
              disabled={locked}
              aria-label="Alineacion del texto"
              onChange={(event) =>
                onChange({ ...item, align: event.target.value as typeof item.align })
              }
            >
              <option value="LEFT">Izquierda</option>
              <option value="CENTER">Centro</option>
              <option value="RIGHT">Derecha</option>
            </select>
          </div>
        ) : null}
      </div>
    );
  }
  if (item.type === "IMAGE") {
    return (
      <div
        className={`column-image-editor image-width-${item.width.toLowerCase()} image-align-${item.align.toLowerCase()} image-fit-${item.fit.toLowerCase()} ${item.visible ? "" : "image-hidden"}`}
      >
        <div className="column-image-frame">
          <div className="column-image-preview">
            {item.fileId && csrf ? (
              <AuthorizedFileImage fileId={item.fileId} alt={item.alt || item.label} csrf={csrf} />
            ) : (
              <span>IMAGEN</span>
            )}
          </div>
          {item.caption ? <small className="document-image-caption">{item.caption}</small> : null}
        </div>
        <label className="document-file-button">
          {uploading ? "Validando imagen..." : item.fileId ? "Sustituir imagen" : "Cargar imagen"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={(locked && !item.replaceable) || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFileSelected(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {selected ? (
        <div className="document-inline-controls" aria-label="Propiedades de imagen de columna">
          <label>
            Etiqueta
            <input
              value={item.label}
              disabled={locked}
              onChange={(event) => onChange({ ...item, label: event.target.value })}
            />
          </label>
          <label>
            Texto alternativo
            <input
              value={item.alt}
              disabled={locked}
              onChange={(event) => onChange({ ...item, alt: event.target.value })}
            />
          </label>
          <label>
            Pie de imagen
            <input
              value={item.caption}
              disabled={locked}
              onChange={(event) => onChange({ ...item, caption: event.target.value })}
            />
          </label>
          <div className="image-presentation-controls">
          <label>
            Ancho
            <select
              value={item.width}
              disabled={locked}
              onChange={(event) =>
                onChange({ ...item, width: event.target.value as typeof item.width })
              }
            >
              <option value="FULL">Completo</option>
              <option value="WIDE">Amplio</option>
              <option value="MEDIUM">Mediano</option>
              <option value="SMALL">Pequeño</option>
            </select>
          </label>
          <label>
            Alineacion
            <select
              value={item.align}
              disabled={locked}
              onChange={(event) =>
                onChange({ ...item, align: event.target.value as typeof item.align })
              }
            >
              <option value="LEFT">Izquierda</option>
              <option value="CENTER">Centro</option>
              <option value="RIGHT">Derecha</option>
            </select>
          </label>
          <label>
            Ajuste
            <select
              value={item.fit}
              disabled={locked}
              onChange={(event) =>
                onChange({ ...item, fit: event.target.value as typeof item.fit })
              }
            >
              <option value="COVER">Recortar</option>
              <option value="CONTAIN">Contener</option>
            </select>
          </label>
          </div>
          <label className="instance-editability">
          <input
            type="checkbox"
            checked={item.visible}
            disabled={locked && !item.replaceable}
            onChange={(event) => onChange({ ...item, visible: event.target.checked })}
          />
          Mostrar esta imagen en el documento
          </label>
          <label className="instance-editability">
          <input
            type="checkbox"
            checked={item.replaceable}
            disabled={locked}
            onChange={(event) => onChange({ ...item, replaceable: event.target.checked })}
          />
          Permitir cambiar u ocultar esta imagen al usar la plantilla
          </label>
        </div>
        ) : null}
      </div>
    );
  }
  if (item.type === "VARIABLE") {
    return (
      <div className="column-variable-editor">
        <span className="document-variable-value">{item.fallback || item.label}</span>
        {selected ? (
          <div className="document-inline-controls">
            <select
              value={item.key}
              disabled={locked}
              aria-label="Dato automatico de la columna"
              onChange={(event) =>
                onChange({
                  ...item,
                  key: event.target.value,
                  label: event.target.selectedOptions[0]?.text ?? item.label,
                })
              }
            >
              <option value="contact.name">Nombre del contacto</option>
              <option value="contact.email">Correo del contacto</option>
              <option value="contact.phone">Telefono del contacto</option>
              <option value="advisor.name">Nombre del asesor</option>
              <option value="advisor.email">Correo del asesor</option>
              <option value="company.name">Nombre de la empresa</option>
              <option value="opportunity.title">Nombre de la oportunidad</option>
              <option value="opportunity.amount">Valor de la oportunidad</option>
              <option value="document.title">Titulo del documento</option>
            </select>
            <input
              value={item.fallback}
              disabled={locked}
              aria-label="Valor alternativo"
              placeholder="Valor alternativo"
              onChange={(event) => onChange({ ...item, fallback: event.target.value })}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <select
      className="column-divider-editor"
      value={item.style}
      disabled={locked}
      aria-label="Estilo del separador"
      onChange={(event) => onChange({ ...item, style: event.target.value as typeof item.style })}
    >
      <option value="SOLID">Linea solida</option>
      <option value="DASHED">Guiones</option>
      <option value="DOTTED">Puntos</option>
    </select>
  );
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
