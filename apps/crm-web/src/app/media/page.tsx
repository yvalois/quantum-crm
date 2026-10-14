"use client";

import type { FileClass, FileContract, MediaFolder } from "@quantum-crm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import styles from "./media.module.css";

type Filter = "ALL" | FileClass;
type FolderSelection = "all" | "root" | string;
interface FilePage {
  readonly data: FileContract[];
  readonly page: { readonly nextCursor: string | null };
}
interface UploadIntent {
  readonly data: {
    readonly file: FileContract;
    readonly upload: {
      readonly url: string;
      readonly fields: Readonly<Record<string, string>>;
    };
  };
}
interface DownloadAuthorization {
  readonly data: { readonly url: string; readonly expiresAt: string };
}
interface FolderPage {
  readonly data: MediaFolder[];
}

const filters: readonly { readonly key: Filter; readonly label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "IMAGE", label: "Imágenes" },
  { key: "VIDEO", label: "Videos" },
  { key: "AUDIO", label: "Audio" },
  { key: "DOCUMENT", label: "Documentos" },
];
const acceptedTypes: Readonly<Record<string, FileClass>> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "audio/mpeg": "AUDIO",
  "audio/ogg": "AUDIO",
  "audio/wav": "AUDIO",
  "audio/webm": "AUDIO",
  "application/pdf": "DOCUMENT",
  "text/plain": "DOCUMENT",
  "text/csv": "DOCUMENT",
};
const maximumBytes: Readonly<Record<FileClass, number>> = {
  IMAGE: 20 * 1024 * 1024,
  AUDIO: 48 * 1024 * 1024,
  VIDEO: 48 * 1024 * 1024,
  DOCUMENT: 48 * 1024 * 1024,
};

function readableSize(bytes: number): string {
  return bytes < 1_048_576
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

async function responseError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const title =
    body && typeof body === "object" && "title" in body && typeof body.title === "string"
      ? body.title
      : "No se pudo completar la operación.";
  return new Error(title);
}

async function checksum(file: File): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function mutate(url: string, csrf: string, body?: unknown): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await responseError(response);
  return response;
}

async function authorizedUrl(fileId: string, csrf: string): Promise<string> {
  const response = await mutate(`/api/files/${fileId}/download-authorizations`, csrf);
  return ((await response.json()) as DownloadAuthorization).data.url;
}

function MediaPreview({ file, csrf }: { readonly file: FileContract; readonly csrf: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.fileClass !== "IMAGE" || file.status !== "AVAILABLE") return;
    let active = true;
    let refresh: number | undefined;
    async function load() {
      try {
        const next = await authorizedUrl(file.id, csrf);
        if (!active) return;
        setUrl(next);
        refresh = window.setTimeout(() => void load(), 45_000);
      } catch {
        if (active) refresh = window.setTimeout(() => void load(), 5_000);
      }
    }
    void load();
    return () => {
      active = false;
      if (refresh !== undefined) window.clearTimeout(refresh);
    };
  }, [file.fileClass, file.id, file.status, csrf]);
  if (file.fileClass === "IMAGE" && url) {
    return <img src={url} alt="" loading="lazy" onError={() => setUrl(null)} />;
  }
  return (
    <span className={styles.fileGlyph} aria-hidden="true">
      {file.fileClass === "IMAGE"
        ? "▧"
        : file.fileClass === "VIDEO"
          ? "▶"
          : file.fileClass === "AUDIO"
            ? "♫"
            : "▤"}
    </span>
  );
}

export default function MediaPage(): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [items, setItems] = useState<FileContract[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<FolderSelection>("all");
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"RECENT" | "NAME">("RECENT");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [folderEditor, setFolderEditor] = useState<{
    readonly mode: "create" | "rename";
    readonly id?: string;
    readonly parentId: string | null;
    readonly name: string;
  } | null>(null);
  const [assetName, setAssetName] = useState("");
  const [assetTags, setAssetTags] = useState("");
  const [assetFolder, setAssetFolder] = useState("");
  const [savingAsset, setSavingAsset] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileContract | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const requestGeneration = useRef(0);

  const load = useCallback(
    async (nextCursor: string | null = null, append = false) => {
      const generation = ++requestGeneration.current;
      setBusy(true);
      setError(null);
      try {
        const parameters = new URLSearchParams({ collection: "library", limit: "40", sort });
        if (filter !== "ALL") parameters.set("fileClass", filter);
        if (folder !== "all") parameters.set("folderId", folder);
        if (search) parameters.set("search", search);
        if (tag) parameters.set("tag", tag);
        if (nextCursor) parameters.set("cursor", nextCursor);
        const response = await fetch(`/api/files?${parameters}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw await responseError(response);
        const page = (await response.json()) as FilePage;
        if (generation !== requestGeneration.current) return;
        setItems((current) => (append ? [...current, ...page.data] : page.data));
        setCursor(page.page.nextCursor);
      } catch (cause) {
        if (generation === requestGeneration.current)
          setError(cause instanceof Error ? cause.message : "No se pudo cargar la biblioteca.");
      } finally {
        if (generation === requestGeneration.current) setBusy(false);
      }
    },
    [filter, folder, search, tag, sort],
  );

  const loadFolders = useCallback(async () => {
    const response = await fetch("/api/media/folders", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw await responseError(response);
    setFolders(((await response.json()) as FolderPage).data);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/media");
          return;
        }
        if (!response.ok) throw await responseError(response);
        const session = (await response.json()) as {
          readonly authenticated: boolean;
          readonly csrfToken?: string;
        };
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no está disponible.");
        if (active) setCsrf(session.csrfToken);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No se pudo iniciar la biblioteca.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (csrf) void load();
  }, [csrf, load]);

  useEffect(() => {
    if (csrf)
      void loadFolders().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar las carpetas."),
      );
  }, [csrf, loadFolders]);

  useEffect(() => {
    if (!selected || !csrf || selected.status !== "AVAILABLE") {
      setSelectedUrl(null);
      return;
    }
    let active = true;
    let refresh: number | undefined;
    async function prepare() {
      try {
        const next = await authorizedUrl(selected!.id, csrf!);
        if (active) {
          setSelectedUrl(next);
          refresh = window.setTimeout(() => void prepare(), 45_000);
        }
      } catch {
        if (active) setSelectedUrl(null);
      }
    }
    void prepare();
    return () => {
      active = false;
      if (refresh !== undefined) window.clearTimeout(refresh);
    };
  }, [selected, csrf]);

  useEffect(() => {
    if (!selected) return;
    setAssetName(selected.name);
    setAssetTags((selected.tags ?? []).join(", "));
    setAssetFolder(selected.folderId ?? "");
  }, [selected]);

  async function saveFolder() {
    if (!csrf || !folderEditor) return;
    const name = folderEditor.name.trim();
    if (!name) return;
    try {
      const response = await mutate(
        folderEditor.mode === "create"
          ? "/api/media/folders"
          : `/api/media/folders/${folderEditor.id}/rename`,
        csrf,
        folderEditor.mode === "create" ? { name, parentId: folderEditor.parentId } : { name },
      );
      const created = ((await response.json()) as { readonly data: MediaFolder }).data;
      await loadFolders();
      if (folderEditor.mode === "create") setFolder(created.id);
      setFolderEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la carpeta.");
    }
  }

  async function removeFolder() {
    if (!csrf || folder === "all" || folder === "root") return;
    try {
      await mutate(`/api/media/folders/${folder}/remove`, csrf);
      setFolder("all");
      await loadFolders();
      setProgress("Carpeta vacía eliminada.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "La carpeta debe estar vacía para eliminarla.",
      );
    }
  }

  async function saveAsset() {
    if (!csrf || !selected || savingAsset) return;
    const tags = assetTags
      .split(",")
      .map((value) => value.trim().toLocaleLowerCase("es"))
      .filter(Boolean);
    setSavingAsset(true);
    try {
      const response = await mutate(`/api/media/assets/${selected.id}/organize`, csrf, {
        folderId: assetFolder || null,
        name: assetName.trim(),
        tags,
      });
      const updated = ((await response.json()) as { readonly data: FileContract }).data;
      setSelected(updated);
      await load();
      setProgress("Archivo organizado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo organizar el archivo.");
    } finally {
      setSavingAsset(false);
    }
  }

  async function upload(files: FileList | readonly File[], destination: FolderSelection = folder) {
    if (!csrf || uploading) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fileClass = acceptedTypes[file.type];
        if (!fileClass) throw new Error(`${file.name}: formato no admitido.`);
        if (!file.size || file.size > maximumBytes[fileClass]) {
          throw new Error(
            `${file.name}: supera el límite de ${readableSize(maximumBytes[fileClass])}.`,
          );
        }
        setProgress(`Preparando ${file.name}…`);
        const digest = await checksum(file);
        const intentResponse = await mutate("/api/files", csrf, {
          owner: { kind: "library" },
          fileClass,
          originalName: file.name,
          declaredMime: file.type,
          declaredSize: file.size,
          expectedSha256: digest,
        });
        const intent = (await intentResponse.json()) as UploadIntent;
        const body = new FormData();
        for (const [name, value] of Object.entries(intent.data.upload.fields))
          body.append(name, value);
        body.append("qcrm-upload-url", intent.data.upload.url);
        body.append("file", file, file.name);
        setProgress(`Subiendo ${file.name}…`);
        const storage = await fetch("/api/files/upload", {
          method: "POST",
          credentials: "same-origin",
          body,
          headers: { "x-csrf-token": csrf },
        });
        const storageBody = await storage.text();
        if (!storage.ok) throw new Error(`${file.name}: el almacenamiento rechazó la carga.`);
        const versionId =
          storage.headers.get("x-amz-version-id") ??
          storageBody.match(/<VersionId>([^<]+)<\/VersionId>/u)?.[1];
        await mutate(`/api/files/${intent.data.file.id}/complete`, csrf, {
          checksum: digest,
          ...(versionId ? { versionId } : {}),
          ...(storage.headers.get("etag") ? { receipt: storage.headers.get("etag") } : {}),
        });
        if (destination !== "all" && destination !== "root") {
          await mutate(`/api/media/assets/${intent.data.file.id}/organize`, csrf, {
            folderId: destination,
            name: file.name,
            tags: [],
          });
        }
        setProgress(`Validando y escaneando ${file.name}…`);
        let terminal = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          const status = await fetch(`/api/files/${intent.data.file.id}`, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (!status.ok) throw await responseError(status);
          const result = (await status.json()) as { readonly data: FileContract };
          if (result.data.status === "AVAILABLE") {
            terminal = true;
            break;
          }
          if (["REJECTED", "FAILED", "DELETED"].includes(result.data.status)) {
            throw new Error(`${file.name}: no superó la validación de seguridad.`);
          }
        }
        if (!terminal)
          setProgress(`${file.name} sigue en validación. Consulta su estado en la biblioteca.`);
      }
      await load();
      setProgress("Carga finalizada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  const visible = items;
  const selectedFolder = folders.find((item) => item.id === folder);
  const folderPath: MediaFolder[] = [];
  let ancestor = selectedFolder;
  while (ancestor && folderPath.length < folders.length) {
    folderPath.unshift(ancestor);
    ancestor = folders.find((item) => item.id === ancestor?.parentId);
  }
  const currentFolders =
    folder === "root"
      ? []
      : folders.filter((item) => item.parentId === (selectedFolder?.id ?? null));
  const showFolders = filter === "ALL" && !query && !tag && currentFolders.length > 0;
  function folderButtons(parentId: string | null, depth = 0): React.JSX.Element[] {
    return folders
      .filter((item) => item.parentId === parentId)
      .flatMap((item) => [
        <button
          key={item.id}
          type="button"
          className={`${styles.folderButton} ${folder === item.id ? styles.folderActive : ""}`}
          style={{ paddingLeft: `${14 + depth * 15}px` }}
          onClick={() => setFolder(item.id)}
        >
          <span aria-hidden="true">▣</span>
          <span>{item.name}</span>
        </button>,
        ...folderButtons(item.id, depth + 1),
      ]);
  }
  return (
    <CrmShell className={styles.shell ?? ""}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1>Biblioteca multimedia</h1>
            <p>Organiza y encuentra los archivos de tu empresa.</p>
          </div>
          <button
            className={styles.primary}
            type="button"
            onClick={() => input.current?.click()}
            disabled={!csrf || uploading}
          >
            ＋ Subir archivos
          </button>
        </header>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={Object.keys(acceptedTypes).join(",")}
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
          }}
        />
        <div className={styles.workspace}>
          <aside className={styles.folderRail} aria-label="Carpetas de multimedia">
            <div className={styles.folderHeading}>
              <strong>Carpetas</strong>
              <button
                type="button"
                onClick={() =>
                  setFolderEditor({
                    mode: "create",
                    parentId: folder !== "all" && folder !== "root" ? folder : null,
                    name: "",
                  })
                }
                disabled={!csrf}
                aria-label="Nueva carpeta"
              >
                ＋
              </button>
            </div>
            <nav className={styles.folderNav}>
              <button
                type="button"
                className={`${styles.folderButton} ${folder === "all" ? styles.folderActive : ""}`}
                onClick={() => setFolder("all")}
              >
                ▦ <span>Todos los archivos</span>
              </button>
              <button
                type="button"
                className={`${styles.folderButton} ${folder === "root" ? styles.folderActive : ""}`}
                onClick={() => setFolder("root")}
              >
                ▢ <span>Sin carpeta</span>
              </button>
              {folderButtons(null)}
            </nav>
            {folderEditor && (
              <form
                className={styles.folderForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveFolder();
                }}
              >
                <label htmlFor="media-folder-name">
                  {folderEditor.mode === "create" ? "Nueva carpeta" : "Renombrar carpeta"}
                </label>
                <input
                  id="media-folder-name"
                  autoFocus
                  maxLength={80}
                  value={folderEditor.name}
                  onChange={(event) =>
                    setFolderEditor({ ...folderEditor, name: event.target.value })
                  }
                  placeholder="Nombre de la carpeta"
                />
                <div>
                  <button type="submit" disabled={!folderEditor.name.trim()}>
                    Guardar
                  </button>
                  <button type="button" onClick={() => setFolderEditor(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            {selectedFolder && !folderEditor && (
              <div className={styles.folderActions}>
                <button
                  type="button"
                  onClick={() =>
                    setFolderEditor({
                      mode: "rename",
                      id: selectedFolder.id,
                      parentId: selectedFolder.parentId,
                      name: selectedFolder.name,
                    })
                  }
                >
                  Renombrar
                </button>
                <button type="button" onClick={() => void removeFolder()}>
                  Eliminar vacía
                </button>
              </div>
            )}
            <p className={styles.folderHint}>
              Las carpetas organizan los archivos; no cambian sus originales.
            </p>
          </aside>
          <section
            className={styles.collection}
            aria-label="Archivos de multimedia"
            onDragEnter={(event) => {
              if (!Array.from(event.dataTransfer.types).includes("Files")) return;
              event.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => {
              if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              if (event.dataTransfer.files.length) void upload(event.dataTransfer.files);
            }}
          >
            <div className={styles.collectionHeading}>
              <div>
                <nav className={styles.breadcrumb} aria-label="Ruta de carpetas">
                  <button type="button" onClick={() => setFolder("all")}>Biblioteca</button>
                  {folder === "root" && <span> / Sin carpeta</span>}
                  {folderPath.map((item) => (
                    <span key={item.id}>
                      <span aria-hidden="true"> / </span>
                      <button type="button" onClick={() => setFolder(item.id)}>{item.name}</button>
                    </span>
                  ))}
                </nav>
                <h2>
                  {selectedFolder?.name ??
                    (folder === "root" ? "Sin carpeta" : "Todos los archivos")}
                </h2>
              </div>
            </div>
            {progress && (
              <p className={styles.notice} role="status">
                {progress}
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.finder}>
              <label className={styles.search}>
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (event.target.value && folder !== "all") setFolder("all");
                  }}
                  placeholder="Buscar en toda la biblioteca"
                  aria-label="Buscar archivos por nombre o etiqueta"
                />
              </label>
              <form
                className={styles.tagFilter}
                onSubmit={(event) => {
                  event.preventDefault();
                  setTag(tagInput.trim().toLocaleLowerCase("es"));
                }}
              >
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="Etiqueta"
                  aria-label="Filtrar por etiqueta"
                  maxLength={32}
                />
                <button type="submit">Filtrar</button>
                {tag && (
                  <button
                    type="button"
                    onClick={() => {
                      setTag("");
                      setTagInput("");
                    }}
                    aria-label="Quitar filtro de etiqueta"
                  >
                    ×
                  </button>
                )}
              </form>
              <select
                className={styles.sort}
                value={sort}
                onChange={(event) => setSort(event.target.value as "RECENT" | "NAME")}
                aria-label="Ordenar archivos"
              >
                <option value="RECENT">Más recientes</option>
                <option value="NAME">Nombre A–Z</option>
              </select>
              <div className={styles.viewSwitch} role="group" aria-label="Vista">
                <button
                  type="button"
                  className={view === "grid" ? styles.active : ""}
                  onClick={() => setView("grid")}
                  aria-label="Vista de cuadrícula"
                >
                  ▦
                </button>
                <button
                  type="button"
                  className={view === "list" ? styles.active : ""}
                  onClick={() => setView("list")}
                  aria-label="Vista de lista"
                >
                  ☷
                </button>
              </div>
            </div>
            <div className={styles.toolbar}>
              <div className={styles.filters} role="group" aria-label="Tipo de archivo">
                {filters.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={filter === option.key ? styles.active : ""}
                    onClick={() => setFilter(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {showFolders && (
              <section className={styles.folderSection} aria-label="Carpetas de esta ubicación">
                <h3>Carpetas</h3>
                <div className={styles.folderTiles}>
                  {currentFolders.map((item) => (
                    <button key={item.id} type="button" onClick={() => setFolder(item.id)}>
                      <span aria-hidden="true">▣</span>
                      <strong title={item.name}>{item.name}</strong>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className={styles.filesHeading}>
              <h3>Archivos</h3>
            <div className={styles.count}>
              {busy
                ? "Cargando archivos…"
                : `${visible.length} archivo${visible.length === 1 ? "" : "s"} mostrado${visible.length === 1 ? "" : "s"}${cursor ? " · hay más resultados" : ""}`}
            </div>
            </div>
            {!busy && visible.length === 0 && !showFolders && (
              <div className={styles.empty}>
                <span aria-hidden="true">▧</span>
                <h2>
                  {query || tag || folder !== "all"
                    ? "Sin coincidencias"
                    : "Tu biblioteca está vacía"}
                </h2>
                <p>
                  {query || tag || folder !== "all"
                    ? "Prueba otro nombre o filtro."
                    : "Sube tu primer archivo para verlo aquí después de la validación."}
                </p>
                {!query && !tag && filter === "ALL" && (
                  <button type="button" onClick={() => input.current?.click()} disabled={!csrf || uploading}>
                    Subir archivos
                  </button>
                )}
              </div>
            )}
            <div className={`${styles.grid} ${view === "list" ? styles.list : ""}`}>
              {visible.map((file) => (
                <button
                  type="button"
                  className={styles.card}
                  key={file.id}
                  onClick={() => setSelected(file)}
                >
                  <div className={styles.thumb}>
                    {csrf && <MediaPreview file={file} csrf={csrf} />}
                    {file.status !== "AVAILABLE" && (
                      <span className={styles.pending}>
                        {file.status === "REJECTED" || file.status === "FAILED"
                          ? "No disponible"
                          : "Validando"}
                      </span>
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <strong title={file.name}>{file.name}</strong>
                    <span>
                      {readableSize(file.size)} ·{" "}
                      {new Date(file.createdAt).toLocaleDateString("es-CO")}
                    </span>
                    {!!file.tags?.length && (
                      <span className={styles.cardTags}>
                        {file.tags
                          .slice(0, 3)
                          .map((value) => `#${value}`)
                          .join("  ")}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {cursor && (
              <button
                className={styles.more}
                type="button"
                onClick={() => void load(cursor, true)}
                disabled={busy}
              >
                Cargar más archivos
              </button>
            )}
            {dragging && (
              <div className={styles.dropOverlay} aria-hidden="true">
                <span>↑</span>
                <strong>Suelta los archivos para subirlos</strong>
                <small>Imágenes hasta 20 MB · Otros archivos hasta 48 MB</small>
              </div>
            )}
          </section>
        </div>
      </div>
      {selected && (
        <div
          className={styles.overlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            className={styles.detail}
            role="dialog"
            aria-modal="true"
            aria-label={`Archivo ${selected.name}`}
          >
            <header>
              <div>
                <small>DETALLE DEL ARCHIVO</small>
                <h2>{selected.name}</h2>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Cerrar detalle">
                ×
              </button>
            </header>
            <div className={styles.viewer}>
              {selected.status !== "AVAILABLE" ? (
                <p>El archivo aún no está disponible. Estado: {selected.status}.</p>
              ) : !selectedUrl ? (
                <p>Preparando vista previa segura…</p>
              ) : selected.fileClass === "IMAGE" ? (
                <img src={selectedUrl} alt={selected.name} />
              ) : selected.fileClass === "VIDEO" ? (
                <video src={selectedUrl} controls playsInline />
              ) : selected.fileClass === "AUDIO" ? (
                <audio src={selectedUrl} controls />
              ) : selected.mimeType === "application/pdf" ? (
                <iframe src={selectedUrl} title={selected.name} />
              ) : (
                <p>Vista previa no disponible para este formato.</p>
              )}
            </div>
            <form
              className={styles.assetEditor}
              onSubmit={(event) => {
                event.preventDefault();
                void saveAsset();
              }}
            >
              <label>
                Nombre visible
                <input
                  value={assetName}
                  maxLength={255}
                  onChange={(event) => setAssetName(event.target.value)}
                  required
                />
              </label>
              <label>
                Carpeta
                <select
                  value={assetFolder}
                  onChange={(event) => setAssetFolder(event.target.value)}
                >
                  <option value="">Sin carpeta</option>
                  {folders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etiquetas
                <input
                  value={assetTags}
                  onChange={(event) => setAssetTags(event.target.value)}
                  placeholder="cotizaciones, vehículos, marca"
                />
              </label>
              <button type="submit" disabled={!csrf || savingAsset || !assetName.trim()}>
                {savingAsset ? "Guardando…" : "Guardar cambios"}
              </button>
            </form>
            <footer>
              <span>
                {readableSize(selected.size)} · {selected.mimeType}
              </span>
              {selected.status === "AVAILABLE" && selectedUrl && (
                <a href={selectedUrl} target="_blank" rel="noopener noreferrer">
                  Abrir / descargar ↗
                </a>
              )}
            </footer>
          </section>
        </div>
      )}
    </CrmShell>
  );
}
