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
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addColumnItem,
  addTableColumn,
  addTableRow,
  canMoveBlock,
  changeColumnsLayout,
  createColumnItem,
  createColumnsBlock,
  documentColumnLayouts,
  imageFrameWidth,
  type ImageResizeHandle,
  moveImageFocalPoint,
  moveColumnItem,
  moveColumnItemToCell,
  moveDocumentBlock,
  moveDocumentBlockTo,
  normalizeDocumentBlocks,
  removeColumnItem,
  removeTableColumn,
  removeTableRow,
  resizeImageFrame,
  resizeImageFrameHeight,
  rotateImageFromPointer,
  setTableColumnWidth,
  splitTextBlock,
  tableColumnWidths,
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

type DocumentImageDragSource =
  | { readonly kind: "BLOCK"; readonly blockId: string }
  | { readonly kind: "COLUMN_ITEM"; readonly blockId: string; readonly itemId: string };

const documentImageDragType = "application/x-quantum-document-image";

type EditableDocumentImage =
  | Extract<DocumentBlock, { readonly type: "IMAGE" }>
  | Extract<DocumentColumnItem, { readonly type: "IMAGE" }>;
type ImagePresentationPatch = Partial<
  Pick<
    EditableDocumentImage,
    | "width"
    | "widthPercent"
    | "heightPx"
    | "align"
    | "fit"
    | "aspectRatio"
    | "focalX"
    | "focalY"
    | "rotation"
    | "opacity"
    | "cornerRadius"
    | "flow"
  >
>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function imageComposerStyle(image: EditableDocumentImage): CSSProperties {
  return {
    "--image-frame-width": `${imageFrameWidth(image)}%`,
    "--image-frame-height": image.heightPx ? `${image.heightPx}px` : undefined,
    "--image-focal-x": `${image.focalX ?? 50}%`,
    "--image-focal-y": `${image.focalY ?? 50}%`,
    "--image-opacity": `${(image.opacity ?? 100) / 100}`,
    "--image-corner-radius": `${image.cornerRadius ?? 0}px`,
    "--image-rotation": `${image.rotation ?? 0}deg`,
  } as CSSProperties;
}

function beginImageResize(
  event: ReactPointerEvent<HTMLButtonElement>,
  image: EditableDocumentImage,
  handle: ImageResizeHandle,
  onPatch: (patch: ImagePresentationPatch) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const container = event.currentTarget.closest<HTMLElement>(
    ".image-slot-editor, .column-image-editor",
  );
  if (!container) return;
  const availableWidth = Math.max(container.getBoundingClientRect().width, 1);
  const media = container.querySelector<HTMLElement>(".document-image-media");
  const originHeight = media?.getBoundingClientRect().height ?? image.heightPx ?? 220;
  const originX = event.clientX;
  const originY = event.clientY;
  const originWidth = imageFrameWidth(image);

  const move = (pointerEvent: PointerEvent): void => {
    const patch: ImagePresentationPatch = {};
    if (handle.includes("E") || handle.includes("W")) {
      patch.widthPercent = resizeImageFrame(
        originWidth,
        pointerEvent.clientX - originX,
        availableWidth,
        handle,
      );
    }
    if (handle.includes("N") || handle.includes("S")) {
      patch.heightPx = resizeImageFrameHeight(originHeight, pointerEvent.clientY - originY, handle);
      patch.aspectRatio = "FREE";
    }
    onPatch(patch);
  };
  const finish = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}

function beginImageFocalAdjustment(
  event: ReactPointerEvent<HTMLElement>,
  image: EditableDocumentImage,
  onPoint: (x: number, y: number) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const media = event.currentTarget.closest<HTMLElement>(".document-image-media");
  if (!media) return;

  const bounds = media.getBoundingClientRect();
  const originPointerX = event.clientX;
  const originPointerY = event.clientY;
  const originFocalX = image.focalX ?? 50;
  const originFocalY = image.focalY ?? 50;

  const update = (pointerEvent: Pick<PointerEvent, "clientX" | "clientY">): void => {
    const point = moveImageFocalPoint(
      originFocalX,
      originFocalY,
      pointerEvent.clientX - originPointerX,
      pointerEvent.clientY - originPointerY,
      bounds.width,
      bounds.height,
    );
    onPoint(point.x, point.y);
  };
  const move = (pointerEvent: PointerEvent): void => update(pointerEvent);
  const finish = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}

function beginImageRotation(
  event: ReactPointerEvent<HTMLButtonElement>,
  image: EditableDocumentImage,
  onRotation: (rotation: number) => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  const card = event.currentTarget.closest<HTMLElement>(".document-image-card");
  if (!card) return;
  const bounds = card.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const originPointerX = event.clientX;
  const originPointerY = event.clientY;
  const originRotation = image.rotation ?? 0;

  const move = (pointerEvent: PointerEvent): void =>
    onRotation(
      rotateImageFromPointer(
        originRotation,
        centerX,
        centerY,
        originPointerX,
        originPointerY,
        pointerEvent.clientX,
        pointerEvent.clientY,
      ),
    );
  const finish = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
  window.addEventListener("pointercancel", finish, { once: true });
}

function textPresentationStyle(
  text: Pick<Extract<DocumentBlock, { readonly type: "TEXT" }>, "fontFamily" | "fontSize">,
): CSSProperties {
  const fontFamily =
    text.fontFamily === "SERIF"
      ? 'Georgia, "Times New Roman", serif'
      : text.fontFamily === "MONO"
        ? '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace'
        : text.fontFamily === "SANS"
          ? '"Instrument Sans", Inter, sans-serif'
          : undefined;
  return {
    ...(text.fontSize ? { fontSize: `${text.fontSize}pt` } : {}),
    ...(fontFamily ? { fontFamily } : {}),
  };
}

function setImageDragData(event: DragEvent<HTMLElement>, source: DocumentImageDragSource): void {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(documentImageDragType, JSON.stringify(source));
}

function imageDragData(event: DragEvent<HTMLElement>): DocumentImageDragSource | null {
  const serialized = event.dataTransfer.getData(documentImageDragType);
  if (!serialized) return null;
  try {
    const source = JSON.parse(serialized) as Partial<DocumentImageDragSource>;
    if (source.kind === "BLOCK" && typeof source.blockId === "string") {
      return { kind: "BLOCK", blockId: source.blockId };
    }
    if (
      source.kind === "COLUMN_ITEM" &&
      typeof source.blockId === "string" &&
      typeof source.itemId === "string"
    ) {
      return { kind: "COLUMN_ITEM", blockId: source.blockId, itemId: source.itemId };
    }
  } catch {
    return null;
  }
  return null;
}

function uploadTargetId(target: DocumentFileTarget): string {
  if (target.kind === "LOGO") return "design:logo";
  if (target.kind === "COLUMN_ITEM") return `column:${target.blockId}:${target.itemId}`;
  return `block:${target.blockId}`;
}

function normalizeDocumentForEditor(document: CommercialDocument): CommercialDocument {
  return {
    ...document,
    design: {
      ...document.design,
      margins: document.design.margins ?? { top: 20, right: 18, bottom: 20, left: 18 },
      identityEnabled: document.design.identityEnabled ?? true,
    },
    blocks: normalizeDocumentBlocks(document.blocks),
  };
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
        fontFamily: "INHERIT",
        fontSize: 12,
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
        widthPercent: 100,
        align: "CENTER",
        fit: "CONTAIN",
        aspectRatio: "AUTO",
        focalX: 50,
        focalY: 50,
        rotation: 0,
        opacity: 100,
        cornerRadius: 0,
        flow: "INLINE",
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
  const [pageCount, setPageCount] = useState(1);
  const pageRef = useRef<HTMLElement | null>(null);

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
    const page = pageRef.current;
    if (!page || !draft) {
      setPageCount(1);
      return;
    }
    const updatePageCount = (): void => {
      const rootFontSize = Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      );
      const pageHeightRem = draft.design.pageSize === "LETTER" ? 64.7 : 70.7;
      const pageHeight = pageHeightRem * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
      setPageCount(Math.max(1, Math.ceil(page.scrollHeight / pageHeight)));
    };
    const frame = window.requestAnimationFrame(updatePageCount);
    const observer = new ResizeObserver(updatePageCount);
    observer.observe(page);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [draft, zoom]);

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

  function moveImageToColumn(
    source: DocumentImageDragSource,
    targetBlockId: string,
    targetCellId: string,
  ): void {
    if (!draft) return;
    let image: Extract<DocumentColumnItem, { readonly type: "IMAGE" }> | null = null;
    const withoutSource = draft.blocks.flatMap((block) => {
      if (source.kind === "BLOCK" && block.id === source.blockId && block.type === "IMAGE") {
        if (block.locked) return [block];
        image = { ...block, locked: false };
        return [];
      }
      if (
        source.kind === "COLUMN_ITEM" &&
        block.id === source.blockId &&
        block.type === "COLUMNS"
      ) {
        if (block.locked) return [block];
        const candidate = block.cells
          ?.flatMap((cell) => cell.items)
          .find((item) => item.id === source.itemId);
        if (candidate?.type !== "IMAGE") return [block];
        image = { ...candidate, locked: false };
        return [removeColumnItem(block, source.itemId)];
      }
      return [block];
    });
    if (!image) return;
    const next = withoutSource.map((block) =>
      block.id === targetBlockId && block.type === "COLUMNS" && !block.locked
        ? addColumnItem(block, targetCellId, image as DocumentColumnItem)
        : block,
    );
    const inserted = next.some(
      (block) =>
        block.id === targetBlockId &&
        block.type === "COLUMNS" &&
        block.cells?.some((cell) => cell.items.some((item) => item.id === image?.id)),
    );
    if (!inserted) return;
    patchDraft({ blocks: next });
    setSelectedBlockId(targetBlockId);
  }

  function moveImageToPage(source: DocumentImageDragSource, targetIndex: number): void {
    if (!draft || source.kind !== "COLUMN_ITEM") return;
    const sourceBlock = draft.blocks.find(
      (block) => block.id === source.blockId && block.type === "COLUMNS",
    );
    if (!sourceBlock || sourceBlock.type !== "COLUMNS" || sourceBlock.locked) return;
    const candidate = sourceBlock.cells
      ?.flatMap((cell) => cell.items)
      .find((item) => item.id === source.itemId);
    if (candidate?.type !== "IMAGE") return;
    const image: Extract<DocumentBlock, { readonly type: "IMAGE" }> = {
      ...candidate,
      locked: false,
    };
    const withoutSource = draft.blocks.map((block) =>
      block.id === sourceBlock.id && block.type === "COLUMNS"
        ? removeColumnItem(block, source.itemId)
        : block,
    );
    const insertionIndex = Math.max(0, Math.min(targetIndex, withoutSource.length));
    const next = [
      ...withoutSource.slice(0, insertionIndex),
      image,
      ...withoutSource.slice(insertionIndex),
    ];
    patchDraft({ blocks: next });
    setSelectedBlockId(image.id);
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
    const csrfToken = csrf;
    if (!draft || !csrfToken || uploadingTargetId) return;
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
      uploadBody.append("qcrm-upload-url", intent.data.upload.url);
      uploadBody.append("file", file, file.name);
      const uploadResponse = await fetch("/api/files/upload", {
        method: "POST",
        body: uploadBody,
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
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
              ? (
                  [
                    ["HOME", "Inicio"],
                    ["INSERT", "Insertar"],
                    ["LAYOUT", "Diseño"],
                  ] as const
                ).map(([tab, label]) => (
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
                    <div
                      className="document-toolbar-group"
                      role="group"
                      aria-label="Formato del texto"
                    >
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
                      <select
                        aria-label="Familia tipografica"
                        value={selectedBlock.fontFamily ?? "INHERIT"}
                        disabled={selectedBlock.locked}
                        onChange={(event) =>
                          updateBlock(selectedBlock.id, (block) =>
                            block.type === "TEXT"
                              ? {
                                  ...block,
                                  fontFamily: event.target.value as NonNullable<
                                    typeof block.fontFamily
                                  >,
                                }
                              : block,
                          )
                        }
                      >
                        <option value="INHERIT">Fuente del documento</option>
                        <option value="SANS">Sans serif</option>
                        <option value="SERIF">Serif</option>
                        <option value="MONO">Monoespaciada</option>
                      </select>
                      <label className="document-font-size-control">
                        <span className="sr-only">Tamaño del texto</span>
                        <input
                          type="number"
                          min={8}
                          max={96}
                          value={selectedBlock.fontSize ?? 12}
                          disabled={selectedBlock.locked}
                          onChange={(event) =>
                            updateBlock(selectedBlock.id, (block) =>
                              block.type === "TEXT"
                                ? {
                                    ...block,
                                    fontSize: Math.min(
                                      96,
                                      Math.max(8, Number(event.target.value) || 12),
                                    ),
                                  }
                                : block,
                            )
                          }
                        />
                        pt
                      </label>
                      {(
                        [
                          ["bold", "Negrita", "B"],
                          ["italic", "Cursiva", "I"],
                          ["underline", "Subrayado", "U"],
                        ] as const
                      ).map(([property, label, character]) => (
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
                    <div
                      className="document-toolbar-group"
                      role="group"
                      aria-label="Organizar bloque"
                    >
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
                            blocks: draft.blocks.filter((block) => block.id !== selectedBlock.id),
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
                        <span>
                          Combina texto, imagenes, variables y lineas dentro de cada columna.
                        </span>
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
                  <div className="document-toolbar-group document-margin-controls">
                    <span>Margenes (mm)</span>
                    {(
                      [
                        ["top", "Superior"],
                        ["right", "Derecho"],
                        ["bottom", "Inferior"],
                        ["left", "Izquierdo"],
                      ] as const
                    ).map(([side, label]) => (
                      <label key={side} title={`Margen ${label.toLocaleLowerCase("es")}`}>
                        <span>{label.slice(0, 3)}</span>
                        <input
                          type="number"
                          min={8}
                          max={60}
                          value={draft.design.margins[side]}
                          aria-label={`Margen ${label.toLocaleLowerCase("es")} en milimetros`}
                          onChange={(event) =>
                            patchDraft({
                              design: {
                                ...draft.design,
                                margins: {
                                  ...draft.design.margins,
                                  [side]: Math.min(
                                    60,
                                    Math.max(8, Number(event.target.value) || 8),
                                  ),
                                },
                              },
                            })
                          }
                        />
                      </label>
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
                      className={draft.design.identityEnabled ? "is-active" : ""}
                      onClick={() =>
                        patchDraft({
                          design: {
                            ...draft.design,
                            identityEnabled: !draft.design.identityEnabled,
                          },
                        })
                      }
                    >
                      Datos del documento
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
                <span>
                  {draft.design.pageSize} · {pageCount === 1 ? "1 pagina" : `${pageCount} paginas`}
                </span>
                <span>{draft.blocks.length} bloques</span>
              </div>
              <div className="document-canvas-scroll">
                <div
                  className="document-zoom-layer document-pages"
                  style={
                    {
                      "--document-zoom": zoom / 100,
                      "--document-page-height":
                        draft.design.pageSize === "LETTER" ? "64.7rem" : "70.7rem",
                    } as CSSProperties
                  }
                >
                  <article
                    ref={pageRef}
                    className={`document-page document-page-sheet ${
                      draft.design.fontFamily === "SERIF"
                        ? "preview-serif"
                        : draft.design.fontFamily === "MONO"
                          ? "preview-mono"
                          : ""
                    }`}
                    style={
                      {
                        color: draft.design.textColor,
                        "--document-margin-top": `${draft.design.margins.top}mm`,
                        "--document-margin-right": `${draft.design.margins.right}mm`,
                        "--document-margin-bottom": `${draft.design.margins.bottom}mm`,
                        "--document-margin-left": `${draft.design.margins.left}mm`,
                      } as CSSProperties
                    }
                  >
                    {pageCount > 1 ? (
                      <div className="document-page-breaks" aria-hidden="true">
                        {Array.from({ length: pageCount - 1 }, (_, pageIndex) => (
                          <span
                            className="document-page-break"
                            style={{
                              top: `calc(var(--document-page-height) * ${pageIndex + 1})`,
                            }}
                            key={pageIndex}
                          >
                            Pagina {pageIndex + 1} / {pageCount}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {draft.design.headerEnabled ? (
                      <header
                        className={`document-page-region document-page-header region-${draft.design.headerSpacing.toLowerCase()} layout-${draft.design.headerLayout.toLowerCase()} align-${draft.design.headerAlign.toLowerCase()}`}
                        style={{ borderColor: draft.design.accentColor }}
                        title="Doble clic para configurar el encabezado"
                        onDoubleClick={() => openInspectorSection("document-header-settings")}
                      >
                        <span className="document-region-label">ENCABEZADO</span>
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
                          Opciones de encabezado
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
                    {draft.design.identityEnabled ? (
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
                        <button
                          className="document-region-settings"
                          type="button"
                          onClick={() =>
                            patchDraft({
                              design: { ...draft.design, identityEnabled: false },
                            })
                          }
                        >
                          Quitar datos del documento
                        </button>
                      </section>
                    ) : (
                      <button
                        className="document-region-hidden identity-hidden"
                        type="button"
                        onClick={() =>
                          patchDraft({
                            design: { ...draft.design, identityEnabled: true },
                          })
                        }
                      >
                        + Agregar datos del documento
                      </button>
                    )}
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
                          className={`document-block document-block-${block.type.toLowerCase()} ${block.locked ? "locked" : ""} ${selectedBlockId === block.id ? "selected" : ""} ${draggedBlockId === block.id ? "dragging" : ""} ${block.type === "IMAGE" ? `document-block-image image-block-flow-${(block.flow ?? "INLINE").toLowerCase()}` : ""}`}
                          style={
                            block.type === "IMAGE"
                              ? ({
                                  "--image-frame-width": `${imageFrameWidth(block)}%`,
                                } as CSSProperties)
                              : undefined
                          }
                          key={block.id}
                          onClick={() => setSelectedBlockId(block.id)}
                          onFocus={() => setSelectedBlockId(block.id)}
                          onDragOver={(event) => {
                            if (event.dataTransfer.types.includes(documentImageDragType)) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              return;
                            }
                            const sourceIndex = draft.blocks.findIndex(
                              (item) => item.id === draggedBlockId,
                            );
                            if (moveDocumentBlockTo(draft.blocks, sourceIndex, index) !== null) {
                              event.preventDefault();
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const imageSource = imageDragData(event);
                            if (imageSource?.kind === "COLUMN_ITEM") {
                              moveImageToPage(imageSource, index);
                              return;
                            }
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
                                if (block.type === "IMAGE") {
                                  setImageDragData(event, { kind: "BLOCK", blockId: block.id });
                                }
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
                            <button
                              className="document-block-delete"
                              type="button"
                              disabled={block.locked}
                              aria-label={`Eliminar ${blockLabels[block.type]}`}
                              title={
                                block.locked
                                  ? "Desprotege el elemento para eliminarlo"
                                  : "Eliminar del lienzo"
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                patchDraft({
                                  blocks: draft.blocks.filter((item) => item.id !== block.id),
                                });
                                setSelectedBlockId(null);
                              }}
                            >
                              <span aria-hidden="true">×</span>
                              Eliminar
                            </button>
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
                            onImageDropToColumn={(source, cellId) =>
                              moveImageToColumn(source, block.id, cellId)
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
                        <span className="document-region-label">PIE DE PAGINA</span>
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
                        {draft.design.showPageNumbers ? (
                          <small>01 / {String(pageCount).padStart(2, "0")}</small>
                        ) : null}
                        <button
                          className="document-region-settings"
                          type="button"
                          onClick={() => openInspectorSection("document-footer-settings")}
                        >
                          Opciones de pie
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

function ImagePresentationControls({
  image,
  locked,
  allowFlow,
  onPatch,
}: {
  readonly image: EditableDocumentImage;
  readonly locked: boolean;
  readonly allowFlow: boolean;
  readonly onPatch: (patch: ImagePresentationPatch) => void;
}): React.JSX.Element {
  const width = imageFrameWidth(image);
  const height = image.heightPx;
  const aspectRatio = image.aspectRatio ?? "AUTO";
  const focalX = image.focalX ?? 50;
  const focalY = image.focalY ?? 50;
  const rotation = image.rotation ?? 0;
  const opacity = image.opacity ?? 100;
  const cornerRadius = image.cornerRadius ?? 0;

  return (
    <section className="image-composer-panel" aria-label="Composicion de la imagen">
      <header className="image-composer-panel-heading">
        <div>
          <span>MARCO DE IMAGEN</span>
          <strong>Composicion</strong>
        </div>
        <output>{width}%</output>
      </header>

      <div className="image-composer-quickbar">
        <label>
          Proporcion
          <select
            value={aspectRatio}
            disabled={locked}
            onChange={(event) =>
              onPatch(
                event.target.value === "FREE"
                  ? { aspectRatio: "FREE", heightPx: height ?? 220 }
                  : {
                      aspectRatio: event.target.value as NonNullable<
                        EditableDocumentImage["aspectRatio"]
                      >,
                      heightPx: undefined,
                    },
              )
            }
          >
            <option value="AUTO">Original</option>
            <option value="FREE">Libre</option>
            <option value="SQUARE">1:1</option>
            <option value="LANDSCAPE_4_3">4:3</option>
            <option value="WIDE_16_9">16:9</option>
            <option value="PORTRAIT_3_4">3:4</option>
            <option value="CIRCLE">Circular</option>
          </select>
        </label>
        <label>
          Ajuste
          <select
            value={image.fit}
            disabled={locked}
            onChange={(event) =>
              onPatch({ fit: event.target.value as EditableDocumentImage["fit"] })
            }
          >
            <option value="CONTAIN">Imagen completa</option>
            <option value="COVER">Recortar para llenar</option>
          </select>
        </label>
        <label>
          Alineacion
          <select
            value={image.align}
            disabled={locked}
            onChange={(event) =>
              onPatch({ align: event.target.value as EditableDocumentImage["align"] })
            }
          >
            <option value="LEFT">Izquierda</option>
            <option value="CENTER">Centro</option>
            <option value="RIGHT">Derecha</option>
          </select>
        </label>
        {allowFlow ? (
          <label>
            Flujo
            <select
              value={image.flow ?? "INLINE"}
              disabled={locked}
              onChange={(event) =>
                onPatch({
                  flow: event.target.value as NonNullable<EditableDocumentImage["flow"]>,
                })
              }
            >
              <option value="INLINE">Renglon</option>
              <option value="FLOAT_LEFT">Izquierda</option>
              <option value="FLOAT_RIGHT">Derecha</option>
            </select>
          </label>
        ) : null}
      </div>

      <details className="image-composer-advanced">
        <summary>Ajustes precisos</summary>

        <div className="image-composer-section image-size-section">
          <span className="image-composer-section-title">Tamano</span>
          <div className="image-width-presets" role="group" aria-label="Anchos predefinidos">
            {[
              [100, "Completo"],
              [80, "Amplio"],
              [60, "Medio"],
              [40, "Compacto"],
            ].map(([preset, label]) => (
              <button
                type="button"
                key={preset}
                disabled={locked}
                className={width === preset ? "is-active" : ""}
                aria-pressed={width === preset}
                title={`${label} (${preset}%)`}
                onClick={() => onPatch({ widthPercent: Number(preset) })}
              >
                {preset}%
              </button>
            ))}
          </div>
          <label className="image-range-control">
            <span>Ancho exacto</span>
            <input
              type="range"
              min={10}
              max={100}
              value={width}
              disabled={locked}
              onChange={(event) => onPatch({ widthPercent: Number(event.target.value) })}
            />
            <output>{width}%</output>
          </label>
          <label className="image-range-control">
            <span>Alto exacto</span>
            <input
              type="range"
              min={80}
              max={800}
              value={height ?? 220}
              disabled={locked}
              onChange={(event) =>
                onPatch({ heightPx: Number(event.target.value), aspectRatio: "FREE" })
              }
            />
            <output>{height ? `${height}px` : "Auto"}</output>
          </label>
          <button
            className="image-auto-size"
            type="button"
            disabled={locked || (height === undefined && aspectRatio === "AUTO")}
            onClick={() => onPatch({ heightPx: undefined, aspectRatio: "AUTO", fit: "CONTAIN" })}
          >
            Ajustar al tamaño original
          </button>
        </div>

        <div className="image-composer-section image-layout-section">
          <span className="image-composer-section-title">Marco y disposicion</span>
          <div className="image-composer-grid">
            <label>
              Proporcion
              <select
                value={aspectRatio}
                disabled={locked}
                onChange={(event) =>
                  onPatch(
                    event.target.value === "FREE"
                      ? { aspectRatio: "FREE", heightPx: height ?? 220 }
                      : {
                          aspectRatio: event.target.value as NonNullable<
                            EditableDocumentImage["aspectRatio"]
                          >,
                          heightPx: undefined,
                        },
                  )
                }
              >
                <option value="AUTO">Original</option>
                <option value="FREE">Libre</option>
                <option value="SQUARE">Cuadrada 1:1</option>
                <option value="LANDSCAPE_4_3">Horizontal 4:3</option>
                <option value="WIDE_16_9">Panoramica 16:9</option>
                <option value="PORTRAIT_3_4">Vertical 3:4</option>
                <option value="CIRCLE">Circular</option>
              </select>
            </label>
            <label>
              Ajuste
              <select
                value={image.fit}
                disabled={locked}
                onChange={(event) =>
                  onPatch({ fit: event.target.value as EditableDocumentImage["fit"] })
                }
              >
                <option value="CONTAIN">Mostrar imagen completa</option>
                <option value="COVER">Recortar para llenar</option>
              </select>
            </label>
            <label>
              Alineacion
              <select
                value={image.align}
                disabled={locked}
                onChange={(event) =>
                  onPatch({ align: event.target.value as EditableDocumentImage["align"] })
                }
              >
                <option value="LEFT">Izquierda</option>
                <option value="CENTER">Centro</option>
                <option value="RIGHT">Derecha</option>
              </select>
            </label>
            {allowFlow ? (
              <label>
                Texto alrededor
                <select
                  value={image.flow ?? "INLINE"}
                  disabled={locked}
                  onChange={(event) =>
                    onPatch({
                      flow: event.target.value as NonNullable<EditableDocumentImage["flow"]>,
                    })
                  }
                >
                  <option value="INLINE">En su propio renglon</option>
                  <option value="FLOAT_LEFT">Rodear por la derecha</option>
                  <option value="FLOAT_RIGHT">Rodear por la izquierda</option>
                </select>
              </label>
            ) : null}
          </div>
        </div>

        {image.fit === "COVER" && aspectRatio !== "AUTO" ? (
          <div className="image-composer-section image-focal-section">
            <span className="image-composer-section-title">Punto focal</span>
            <div className="image-focal-controls">
              <div className="image-focal-grid" role="group" aria-label="Punto focal rapido">
                {[0, 50, 100].flatMap((y) =>
                  [0, 50, 100].map((x) => (
                    <button
                      type="button"
                      key={`${x}-${y}`}
                      disabled={locked}
                      className={
                        Math.abs(focalX - x) < 18 && Math.abs(focalY - y) < 18 ? "is-active" : ""
                      }
                      aria-label={`Punto focal ${x} por ${y}`}
                      onClick={() => onPatch({ focalX: x, focalY: y })}
                    />
                  )),
                )}
              </div>
              <div className="image-focal-ranges">
                <label>
                  <span>Horizontal</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={focalX}
                    disabled={locked}
                    onChange={(event) => onPatch({ focalX: Number(event.target.value) })}
                  />
                  <output>{focalX}</output>
                </label>
                <label>
                  <span>Vertical</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={focalY}
                    disabled={locked}
                    onChange={(event) => onPatch({ focalY: Number(event.target.value) })}
                  />
                  <output>{focalY}</output>
                </label>
              </div>
            </div>
          </div>
        ) : null}

        <div className="image-composer-section image-finish-section">
          <span className="image-composer-section-title">Acabado</span>
          <div className="image-finish-controls">
            <label className="image-range-control">
              <span>Giro</span>
              <input
                type="range"
                min={-15}
                max={15}
                value={clamp(rotation, -15, 15)}
                disabled={locked}
                onChange={(event) => onPatch({ rotation: Number(event.target.value) })}
              />
              <output>{rotation}deg</output>
            </label>
            <button
              className="image-auto-size"
              type="button"
              disabled={locked || rotation === 0}
              onClick={() => onPatch({ rotation: 0 })}
            >
              Enderezar a 0deg
            </button>
            <label className="image-range-control">
              <span>Opacidad</span>
              <input
                type="range"
                min={20}
                max={100}
                value={opacity}
                disabled={locked}
                onChange={(event) => onPatch({ opacity: Number(event.target.value) })}
              />
              <output>{opacity}%</output>
            </label>
            <label className="image-range-control">
              <span>Esquinas</span>
              <input
                type="range"
                min={0}
                max={48}
                value={cornerRadius}
                disabled={locked || aspectRatio === "CIRCLE"}
                onChange={(event) => onPatch({ cornerRadius: Number(event.target.value) })}
              />
              <output>{aspectRatio === "CIRCLE" ? "Circulo" : `${cornerRadius}px`}</output>
            </label>
          </div>
        </div>
      </details>
    </section>
  );
}

const imageResizeHandles = ["NW", "N", "NE", "E", "SE", "S", "SW", "W"] as const;

function ImageDirectManipulationControls({
  image,
  locked,
  onPatch,
}: {
  readonly image: EditableDocumentImage;
  readonly locked: boolean;
  readonly onPatch: (patch: ImagePresentationPatch) => void;
}): React.JSX.Element | null {
  if (locked) return null;
  const width = imageFrameWidth(image);
  const height = image.heightPx ?? 220;
  const rotation = image.rotation ?? 0;

  return (
    <>
      <button
        className="document-image-rotation-handle"
        type="button"
        aria-label="Girar imagen"
        title="Arrastra para girar. Doble clic o Inicio para volver a 0 grados."
        onDoubleClick={() => onPatch({ rotation: 0 })}
        onPointerDown={(event) =>
          beginImageRotation(event, image, (nextRotation) => onPatch({ rotation: nextRotation }))
        }
        onKeyDown={(event) => {
          if (event.key === "Home") {
            event.preventDefault();
            onPatch({ rotation: 0 });
            return;
          }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.shiftKey ? 15 : 1;
          const direction = event.key === "ArrowRight" ? 1 : -1;
          onPatch({ rotation: clamp(rotation + step * direction, -180, 180) });
        }}
      >
        <span aria-hidden="true" />
      </button>
      {imageResizeHandles.map((handle) => (
        <button
          className={`document-image-resize-handle handle-${handle.toLowerCase()}`}
          type="button"
          key={handle}
          aria-label={
            handle === "N" || handle === "S"
              ? `Ajustar alto desde ${handle}`
              : handle === "E" || handle === "W"
                ? `Ajustar ancho desde ${handle}`
                : `Ajustar ancho y alto desde ${handle}`
          }
          title="Arrastra para cambiar ancho y alto"
          onPointerDown={(event) => beginImageResize(event, image, handle, onPatch)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 5 : 1;
            if (
              (handle.includes("E") || handle.includes("W")) &&
              (event.key === "ArrowLeft" || event.key === "ArrowRight")
            ) {
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              onPatch({ widthPercent: clamp(width + step * direction, 10, 100) });
            }
            if (
              (handle.includes("N") || handle.includes("S")) &&
              (event.key === "ArrowUp" || event.key === "ArrowDown")
            ) {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              onPatch({
                heightPx: clamp(height + step * 4 * direction, 80, 1200),
                aspectRatio: "FREE",
              });
            }
          }}
        />
      ))}
    </>
  );
}

function BlockEditor({
  block,
  selected,
  onChange,
  uploading,
  uploadingItemId,
  onFileSelected,
  onImageDropToColumn,
  csrf,
}: {
  readonly block: DocumentBlock;
  readonly selected: boolean;
  readonly onChange: (block: DocumentBlock) => void;
  readonly uploading: boolean;
  readonly uploadingItemId: string | null;
  readonly onFileSelected: (file: File, itemId?: string) => void;
  readonly onImageDropToColumn: (source: DocumentImageDragSource, cellId: string) => void;
  readonly csrf: string | null;
}): React.JSX.Element {
  if (block.type === "TEXT")
    return (
      <div className="document-prose-editor">
        <textarea
          className={`document-prose-input align-${block.align.toLowerCase()} text-style-${(block.style ?? "BODY").toLowerCase()} text-font-${(block.fontFamily ?? "INHERIT").toLowerCase()} ${block.bold ? "is-bold" : ""} ${block.italic ? "is-italic" : ""} ${block.underline ? "is-underlined" : ""}`}
          style={textPresentationStyle(block)}
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
        className={`image-slot-editor document-image-composer image-width-${block.width.toLowerCase()} image-align-${block.align.toLowerCase()} image-fit-${block.fit.toLowerCase()} image-aspect-${(block.aspectRatio ?? "AUTO").toLowerCase()} ${block.heightPx ? "image-height-custom" : ""} image-flow-${(block.flow ?? "INLINE").toLowerCase()}`}
        style={imageComposerStyle(block)}
      >
        <div className="document-image-card">
          <div
            className={`document-image-media ${selected && block.fileId && block.fit === "COVER" && (block.aspectRatio ?? "AUTO") !== "AUTO" && !block.locked ? "is-direct-crop" : ""}`}
            onPointerDown={(event) => {
              if (
                !selected ||
                !block.fileId ||
                block.fit !== "COVER" ||
                (block.aspectRatio ?? "AUTO") === "AUTO" ||
                block.locked
              )
                return;
              beginImageFocalAdjustment(event, block, (focalX, focalY) =>
                onChange({ ...block, focalX, focalY }),
              );
            }}
          >
            {block.fileId && csrf ? (
              <AuthorizedFileImage
                fileId={block.fileId}
                alt={block.alt || block.label}
                csrf={csrf}
              />
            ) : (
              <div className="document-image-empty">
                <span>IMAGEN</span>
                <strong>Agrega una imagen al documento</strong>
                <small>JPEG, PNG o WebP. Se valida antes de mostrarla.</small>
              </div>
            )}
            {selected &&
            block.fileId &&
            block.fit === "COVER" &&
            (block.aspectRatio ?? "AUTO") !== "AUTO" &&
            !block.locked ? (
              <>
                <span className="document-image-focus-point" aria-hidden="true" />
                <span className="document-image-crop-hint">Arrastra para reencuadrar</span>
              </>
            ) : null}
          </div>
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
          {selected ? (
            <ImageDirectManipulationControls
              image={block}
              locked={block.locked}
              onPatch={(patch) => onChange({ ...block, ...patch })}
            />
          ) : null}
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
                  <option value="CONTAIN">Imagen completa</option>
                  <option value="COVER">Recortar para llenar</option>
                </select>
              </label>
            </div>
            <ImagePresentationControls
              image={block}
              locked={block.locked}
              allowFlow
              onPatch={(patch) => onChange({ ...block, ...patch })}
            />
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
                <section
                  className="document-column-cell document-drop-zone"
                  key={cell.id}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(documentImageDragType)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDragEnter={(event) => {
                    if (event.dataTransfer.types.includes(documentImageDragType)) {
                      event.currentTarget.classList.add("is-drag-over");
                    }
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      event.currentTarget.classList.remove("is-drag-over");
                    }
                  }}
                  onDrop={(event) => {
                    const source = imageDragData(event);
                    if (!source) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.classList.remove("is-drag-over");
                    onImageDropToColumn(source, cell.id);
                  }}
                >
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
                        className={`document-column-item item-${item.type.toLowerCase()} ${selected && item.type === "IMAGE" ? "selected" : ""}`}
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
                          {item.type === "IMAGE" && !block.locked ? (
                            <span
                              className="document-image-handle document-image-move-handle"
                              draggable
                              role="button"
                              tabIndex={0}
                              title="Arrastra desde aqui para mover la imagen"
                              onDragStart={(event) => {
                                event.stopPropagation();
                                setImageDragData(event, {
                                  kind: "COLUMN_ITEM",
                                  blockId: block.id,
                                  itemId: item.id,
                                });
                              }}
                            >
                              Arrastrar
                            </span>
                          ) : null}
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
  if (block.type === "TABLE") {
    const widths = tableColumnWidths(block);
    const rowTemplate = `${widths.map((width) => `${width}fr`).join(" ")} ${selected ? "2.25rem" : "0"}`;
    return (
      <div className="table-editor document-table-composer">
        <div className="document-table-grid">
          <div
            className="document-table-row document-table-head"
            style={{ gridTemplateColumns: rowTemplate }}
          >
            {block.columns.map((column, columnIndex) => (
              <div className="document-table-heading-cell" key={columnIndex}>
                <input
                  className="document-table-column-control"
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
                {selected ? (
                  <div className="document-table-column-tools document-inline-controls">
                    <label>
                      <span className="sr-only">Ancho de {column}</span>
                      <input
                        className="document-table-resizer"
                        type="range"
                        min={5}
                        max={100 - 5 * (block.columns.length - 1)}
                        value={widths[columnIndex] ?? 5}
                        disabled={block.locked || block.columns.length === 1}
                        onChange={(event) =>
                          onChange(
                            setTableColumnWidth(block, columnIndex, Number(event.target.value)),
                          )
                        }
                      />
                    </label>
                    <output>{widths[columnIndex]}%</output>
                    <button
                      type="button"
                      disabled={block.locked || block.columns.length === 1}
                      onClick={() => onChange(removeTableColumn(block, columnIndex))}
                      aria-label={`Eliminar columna ${columnIndex + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {selected ? <span aria-hidden="true" /> : null}
          </div>
          {block.rows.map((row, rowIndex) => (
            <div
              className="document-table-row"
              style={{ gridTemplateColumns: rowTemplate }}
              key={rowIndex}
            >
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
              {selected ? (
                <button
                  type="button"
                  disabled={block.locked}
                  onClick={() => onChange(removeTableRow(block, rowIndex))}
                  aria-label={`Eliminar fila ${rowIndex + 1}`}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {selected ? (
          <div className="document-table-actions document-table-toolbar document-inline-controls">
            <button
              className="document-add-row"
              type="button"
              disabled={block.locked || block.rows.length >= 100}
              onClick={() => onChange(addTableRow(block))}
            >
              + Fila
            </button>
            <button
              type="button"
              disabled={block.locked || block.columns.length >= 8}
              onClick={() => onChange(addTableColumn(block))}
            >
              + Columna
            </button>
          </div>
        ) : null}
      </div>
    );
  }
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
          className={`document-prose-input align-${item.align.toLowerCase()} text-style-${(item.style ?? "BODY").toLowerCase()} text-font-${(item.fontFamily ?? "INHERIT").toLowerCase()} ${item.bold ? "is-bold" : ""} ${item.italic ? "is-italic" : ""} ${item.underline ? "is-underlined" : ""}`}
          style={textPresentationStyle(item)}
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
            <select
              value={item.fontFamily ?? "INHERIT"}
              disabled={locked}
              aria-label="Familia tipografica"
              onChange={(event) =>
                onChange({
                  ...item,
                  fontFamily: event.target.value as NonNullable<typeof item.fontFamily>,
                })
              }
            >
              <option value="INHERIT">Fuente del documento</option>
              <option value="SANS">Sans serif</option>
              <option value="SERIF">Serif</option>
              <option value="MONO">Monoespaciada</option>
            </select>
            <label className="document-font-size-control">
              <span className="sr-only">Tamaño del texto</span>
              <input
                type="number"
                min={8}
                max={96}
                value={item.fontSize ?? 12}
                disabled={locked}
                onChange={(event) =>
                  onChange({
                    ...item,
                    fontSize: Math.min(96, Math.max(8, Number(event.target.value) || 12)),
                  })
                }
              />
              pt
            </label>
            {(
              [
                ["bold", "Negrita", "B"],
                ["italic", "Cursiva", "I"],
                ["underline", "Subrayado", "U"],
              ] as const
            ).map(([property, label, character]) => (
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
        className={`column-image-editor document-image-composer image-width-${item.width.toLowerCase()} image-align-${item.align.toLowerCase()} image-fit-${item.fit.toLowerCase()} image-aspect-${(item.aspectRatio ?? "AUTO").toLowerCase()} ${item.heightPx ? "image-height-custom" : ""} ${item.visible ? "" : "image-hidden"}`}
        style={imageComposerStyle(item)}
      >
        <div className="column-image-frame document-image-card">
          <div
            className={`column-image-preview document-image-media ${selected && item.fileId && item.fit === "COVER" && (item.aspectRatio ?? "AUTO") !== "AUTO" && !locked ? "is-direct-crop" : ""}`}
            onPointerDown={(event) => {
              if (
                !selected ||
                !item.fileId ||
                item.fit !== "COVER" ||
                (item.aspectRatio ?? "AUTO") === "AUTO" ||
                locked
              )
                return;
              beginImageFocalAdjustment(event, item, (focalX, focalY) =>
                onChange({ ...item, focalX, focalY }),
              );
            }}
          >
            {item.fileId && csrf ? (
              <AuthorizedFileImage fileId={item.fileId} alt={item.alt || item.label} csrf={csrf} />
            ) : (
              <div className="document-image-empty">
                <span>IMAGEN</span>
                <strong>Agrega una imagen</strong>
              </div>
            )}
            {selected &&
            item.fileId &&
            item.fit === "COVER" &&
            (item.aspectRatio ?? "AUTO") !== "AUTO" &&
            !locked ? (
              <>
                <span className="document-image-focus-point" aria-hidden="true" />
                <span className="document-image-crop-hint">Arrastra para reencuadrar</span>
              </>
            ) : null}
          </div>
          {item.caption ? <small className="document-image-caption">{item.caption}</small> : null}
          {selected ? (
            <ImageDirectManipulationControls
              image={item}
              locked={locked}
              onPatch={(patch) => onChange({ ...item, ...patch })}
            />
          ) : null}
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
                  <option value="CONTAIN">Imagen completa</option>
                  <option value="COVER">Recortar para llenar</option>
                </select>
              </label>
            </div>
            <ImagePresentationControls
              image={item}
              locked={locked}
              allowFlow={false}
              onPatch={(patch) => onChange({ ...item, ...patch })}
            />
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
  const [authorizationGeneration, setAuthorizationGeneration] = useState(0);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | null = null;
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
      .then((response) => {
        if (controller.signal.aborted) return;
        setSource(response.data.url);
        refreshTimer = window.setTimeout(
          () => setAuthorizationGeneration((current) => current + 1),
          45_000,
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSource(null);
        refreshTimer = window.setTimeout(
          () => setAuthorizationGeneration((current) => current + 1),
          5_000,
        );
      });
    return () => {
      controller.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [authorizationGeneration, csrf, fileId]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  function recoverExpiredPreview(): void {
    setSource(null);
    if (retryTimerRef.current !== null) return;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setAuthorizationGeneration((current) => current + 1);
    }, 1_000);
  }

  return source ? (
    <img src={source} alt={alt} onError={recoverExpiredPreview} />
  ) : (
    <small>Renovando vista previa...</small>
  );
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
