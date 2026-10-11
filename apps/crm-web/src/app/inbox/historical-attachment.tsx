"use client";

import {
  FileDownloadAuthorizationResponseSchema,
  type HistoricalConversationAttachment,
} from "@quantum-crm/contracts";
import { useEffect, useRef, useState } from "react";

import styles from "./historical-inbox.module.css";

type MediaKind = "image" | "audio" | "video";

function mediaKind(mimeType: string | null): MediaKind | null {
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType ?? "")) return "image";
  if (["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"].includes(mimeType ?? ""))
    return "audio";
  if (["video/mp4", "video/webm"].includes(mimeType ?? "")) return "video";
  return null;
}

class AttachmentAccessError extends Error {}

async function authorizeAttachment(fileId: string, signal: AbortSignal): Promise<string> {
  const sessionResponse = await fetch("/api/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!sessionResponse.ok)
    throw new AttachmentAccessError("Tu sesión expiró. Vuelve a iniciar sesión.");
  const session = (await sessionResponse.json()) as {
    authenticated?: unknown;
    csrfToken?: unknown;
  };
  if (session.authenticated !== true || typeof session.csrfToken !== "string")
    throw new AttachmentAccessError("Tu sesión expiró. Vuelve a iniciar sesión.");
  const response = await fetch(`/api/files/${fileId}/download-authorizations`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "x-csrf-token": session.csrfToken, "idempotency-key": crypto.randomUUID() },
  });
  if (!response.ok)
    throw new AttachmentAccessError(
      response.status === 401
        ? "Tu sesión expiró. Vuelve a iniciar sesión."
        : response.status === 403 || response.status === 404
          ? "No tienes acceso a este adjunto."
          : "El adjunto no está disponible. Inténtalo de nuevo.",
    );
  const authorization = FileDownloadAuthorizationResponseSchema.safeParse(await response.json());
  if (!authorization.success || Date.parse(authorization.data.data.expiresAt) <= Date.now())
    throw new AttachmentAccessError("No fue posible preparar el adjunto. Inténtalo de nuevo.");
  const url = new URL(authorization.data.data.url);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.origin === window.location.origin)
  )
    throw new AttachmentAccessError("No fue posible preparar el adjunto. Inténtalo de nuevo.");
  return url.href;
}

function accessError(failure: unknown): string {
  return failure instanceof AttachmentAccessError
    ? failure.message
    : "No fue posible cargar el adjunto. Inténtalo de nuevo.";
}

export function HistoricalAttachment({
  attachment,
}: {
  readonly attachment: HistoricalConversationAttachment;
}): React.JSX.Element {
  const containerRef = useRef<HTMLLIElement>(null);
  const downloadControllerRef = useRef<AbortController | null>(null);
  const [requested, setRequested] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [source, setSource] = useState<{ readonly fileId: string; readonly url: string } | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const available = attachment.status === "AVAILABLE" && attachment.fileId !== null;
  const kind = mediaKind(attachment.mimeType);
  const name = attachment.name ?? `Adjunto ${attachment.attachmentIndex + 1}`;
  const currentSource = available && source?.fileId === attachment.fileId ? source.url : null;

  useEffect(() => {
    if (!available || kind !== "image" || requested) return;
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRequested(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [available, kind, requested]);

  useEffect(() => {
    if (!available || !attachment.fileId || !kind || !requested) return;
    const fileId = attachment.fileId;
    const controller = new AbortController();
    setSource(null);
    setPreviewBusy(true);
    setPreviewError(null);
    void authorizeAttachment(
      fileId,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    )
      .then((url) => {
        if (!controller.signal.aborted) setSource({ fileId, url });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setPreviewError(accessError(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewBusy(false);
      });
    return () => controller.abort();
  }, [attachment.fileId, available, kind, requested, generation]);

  useEffect(() => () => downloadControllerRef.current?.abort(), []);

  async function download(): Promise<void> {
    if (!available || !attachment.fileId || downloadBusy) return;
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const url = await authorizeAttachment(
        attachment.fileId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) window.location.assign(url);
    } catch (failure) {
      if (!controller.signal.aborted) setDownloadError(accessError(failure));
    } finally {
      if (!controller.signal.aborted) setDownloadBusy(false);
    }
  }

  function requestPreview(): void {
    setRequested(true);
    setGeneration((value) => value + 1);
  }

  function mediaFailed(): void {
    setSource(null);
    setPreviewError("No se pudo mostrar este archivo. Renueva el acceso o descárgalo.");
  }

  const status =
    attachment.status === "REJECTED"
      ? "No disponible: formato o contenido rechazado."
      : attachment.status === "FAILED"
        ? "No se pudo transferir desde el origen."
        : "Pendiente de transferencia y verificación.";

  return (
    <li ref={containerRef} className={styles.mediaAttachment} data-media-kind={kind ?? "document"}>
      <div className={styles.attachmentDescription}>
        <strong>{name}</strong>
        {attachment.size !== null ? (
          <small>
            {new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(
              attachment.size / 1024,
            )}{" "}
            KB
          </small>
        ) : null}
      </div>
      {available && kind ? (
        <div className={styles.mediaPreview} aria-busy={previewBusy}>
          {currentSource && kind === "image" ? (
            <img
              src={currentSource}
              alt={name}
              className={styles.attachmentImage}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={mediaFailed}
            />
          ) : currentSource && kind === "audio" ? (
            <audio
              controls
              preload="metadata"
              src={currentSource}
              aria-label={`Audio: ${name}`}
              onError={mediaFailed}
            />
          ) : currentSource && kind === "video" ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={currentSource}
              aria-label={`Video: ${name}`}
              onError={mediaFailed}
            />
          ) : previewBusy ? (
            <p role="status">Cargando {kind === "image" ? "imagen" : kind}…</p>
          ) : !previewError ? (
            <button type="button" onClick={requestPreview}>
              Cargar {kind === "image" ? "imagen" : kind}
            </button>
          ) : null}
          {previewError ? (
            <div className={styles.mediaError}>
              <p role="alert">{previewError}</p>
              <button type="button" onClick={requestPreview} disabled={previewBusy}>
                Reintentar vista previa
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.attachmentActions}>
        {available ? (
          <button type="button" disabled={downloadBusy} onClick={() => void download()}>
            {downloadBusy ? "Preparando…" : "Descargar"}
          </button>
        ) : (
          <small>{status}</small>
        )}
      </div>
      {downloadError ? (
        <p role="alert" className={styles.mediaError}>
          {downloadError}
        </p>
      ) : null}
    </li>
  );
}
