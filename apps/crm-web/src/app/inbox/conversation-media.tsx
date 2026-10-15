"use client";

import type { ConversationMessage } from "@quantum-crm/contracts";
import { useCallback, useEffect, useState } from "react";

import styles from "./inbox.module.css";

export function ConversationMedia({
  message,
  csrf,
}: {
  readonly message: ConversationMessage;
  readonly csrf: string | null;
}): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const fileId = message.fileId;
  const authorize = useCallback(async () => {
    if (!fileId || !csrf) return;
    const response = await fetch(`/api/files/${fileId}/download-authorizations`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID(), "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Archivo no disponible");
    const payload = (await response.json()) as { readonly data: { readonly url: string } };
    setUrl(payload.data.url);
    setError(false);
  }, [fileId, csrf]);

  useEffect(() => {
    if (!fileId || !csrf) return;
    void authorize().catch(() => setError(true));
    if (message.kind === "AUDIO" && playing) return;
    const refresh = window.setInterval(() => void authorize().catch(() => setError(true)), 45_000);
    return () => window.clearInterval(refresh);
  }, [authorize, fileId, csrf, message.kind, playing]);

  if (!fileId) return null;
  if (error) return <p className={styles.mediaUnavailable}>No se puede abrir este archivo.</p>;
  if (!url) return <p className={styles.mediaUnavailable}>Preparando archivo…</p>;
  if (message.kind === "IMAGE") {
    return <img className={styles.messageImage} src={url} alt={message.body} onError={() => void authorize().catch(() => setError(true))} />;
  }
  if (message.kind === "AUDIO") {
    return <audio className={styles.messageAudio} controls src={url} preload="none"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onError={() => void authorize().catch(() => setError(true))} />;
  }
  return <a className={styles.messageFile} href={url} target="_blank" rel="noreferrer"
    onClick={() => void authorize().catch(() => setError(true))}>Abrir documento ↗</a>;
}
