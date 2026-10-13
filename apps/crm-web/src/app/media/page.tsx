"use client";

import type { FileClass, FileContract } from "@quantum-crm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import styles from "./media.module.css";

type Filter = "ALL" | FileClass;
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
  const [csrf, setCsrf] = useState<string | null>(null);
  const [items, setItems] = useState<FileContract[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FileContract | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(
    async (nextFilter: Filter, nextCursor: string | null = null, append = false) => {
      setBusy(true);
      setError(null);
      try {
        const search = new URLSearchParams({ collection: "library", limit: "40" });
        if (nextFilter !== "ALL") search.set("fileClass", nextFilter);
        if (nextCursor) search.set("cursor", nextCursor);
        const response = await fetch(`/api/files?${search}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw await responseError(response);
        const page = (await response.json()) as FilePage;
        setItems((current) => (append ? [...current, ...page.data] : page.data));
        setCursor(page.page.nextCursor);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo cargar la biblioteca.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

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
    if (csrf) void load(filter);
  }, [csrf, filter, load]);

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

  async function upload(files: FileList | readonly File[]) {
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
      await load(filter);
      setProgress("Carga finalizada.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  const visible = items.filter((file) =>
    file.name.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")),
  );
  return (
    <CrmShell className={styles.shell ?? ""}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>ARCHIVOS · INTERAMERICAN</p>
            <h1>Biblioteca multimedia</h1>
            <p>Imágenes, videos, audio y documentos en un solo lugar.</p>
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
        <section
          className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void upload(event.dataTransfer.files);
          }}
          aria-label="Arrastra archivos aquí para subirlos"
        >
          <span className={styles.dropIcon} aria-hidden="true">
            ↑
          </span>
          <div>
            <strong>Arrastra tus archivos aquí</strong>
            <p>o usa «Subir archivos». JPG, PNG, WebP, MP4, WebM, MP3, OGG, WAV, PDF, TXT y CSV.</p>
          </div>
          <small>Imágenes hasta 20 MB · Otros hasta 48 MB</small>
        </section>
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
        <div className={styles.toolbar}>
          <div className={styles.filters} role="group" aria-label="Tipo de archivo">
            {filters.map((option) => (
              <button
                type="button"
                key={option.key}
                className={filter === option.key ? styles.active : ""}
                onClick={() => {
                  setFilter(option.key);
                  setQuery("");
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className={styles.search}>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nombre en esta página"
              aria-label="Buscar archivos por nombre"
            />
          </label>
        </div>
        <div className={styles.count}>
          {busy
            ? "Cargando archivos…"
            : `${visible.length} archivo${visible.length === 1 ? "" : "s"} en esta página`}
        </div>
        {!busy && visible.length === 0 && (
          <div className={styles.empty}>
            <span aria-hidden="true">▧</span>
            <h2>{query ? "Sin coincidencias" : "Tu biblioteca está vacía"}</h2>
            <p>
              {query
                ? "Prueba otro nombre o filtro."
                : "Sube tu primer archivo para verlo aquí después de la validación."}
            </p>
          </div>
        )}
        <div className={styles.grid}>
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
                  {readableSize(file.size)} · {new Date(file.createdAt).toLocaleDateString("es-CO")}
                </span>
              </div>
            </button>
          ))}
        </div>
        {cursor && (
          <button
            className={styles.more}
            type="button"
            onClick={() => void load(filter, cursor, true)}
            disabled={busy}
          >
            Cargar más archivos
          </button>
        )}
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
