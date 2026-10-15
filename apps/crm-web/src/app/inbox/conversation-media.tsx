"use client";

import {
  FileDownloadAuthorizationResponseSchema,
  type ConversationMessage,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./inbox.module.css";

function clockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function ConversationAudio({
  url,
  onError,
}: {
  readonly url: string;
  readonly onError: () => void;
}): React.JSX.Element {
  const player = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = async () => {
    const audio = player.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      onError();
    }
  };

  return (
    <div className={styles.messageAudioPlayer}>
      <audio
        ref={player}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onError={onError}
      />
      <button
        type="button"
        className={styles.messageAudioToggle}
        onClick={() => void toggle()}
        aria-label={playing ? "Pausar audio" : "Reproducir audio"}
      >
        {playing ? "Ⅱ" : "▶"}
      </button>
      <div className={styles.messageAudioTrack}>
        <span>Mensaje de voz</span>
        <input
          type="range"
          min="0"
          max={Number.isFinite(duration) && duration > 0 ? duration : 1}
          step="0.1"
          value={Math.min(elapsed, Number.isFinite(duration) && duration > 0 ? duration : 1)}
          aria-label="Posición del audio"
          onChange={(event) => {
            if (!player.current) return;
            player.current.currentTime = Number(event.target.value);
            setElapsed(player.current.currentTime);
          }}
        />
      </div>
      <span className={styles.messageAudioTime}>
        {clockTime(elapsed)} / {clockTime(duration)}
      </span>
    </div>
  );
}

export function ConversationMedia({
  message,
  csrf,
}: {
  readonly message: ConversationMessage;
  readonly csrf: string | null;
}): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mediaRetry = useRef(0);
  const imageDialog = useRef<HTMLDialogElement>(null);
  const fileId = message.fileId;
  const authorize = useCallback(async () => {
    if (!fileId || !csrf) return;
    const response = await fetch(`/api/files/${fileId}/download-authorizations`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "x-csrf-token": csrf,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error("Archivo no disponible");
    const payload = FileDownloadAuthorizationResponseSchema.parse(await response.json());
    if (Date.parse(payload.data.expiresAt) <= Date.now()) throw new Error("Acceso vencido");
    const source = new URL(payload.data.url);
    if (
      source.protocol !== "https:" &&
      !(source.protocol === "http:" && source.origin === window.location.origin)
    )
      throw new Error("Origen de archivo no permitido");
    setUrl(source.href);
    setError(false);
  }, [fileId, csrf]);

  useEffect(() => {
    if (!fileId || !csrf) return;
    mediaRetry.current = 0;
    void authorize().catch(() => setError(true));
  }, [authorize, fileId, csrf]);

  const retryMedia = () => {
    if (mediaRetry.current >= 1) {
      setError(true);
      return;
    }
    mediaRetry.current += 1;
    void authorize().catch(() => setError(true));
  };

  if (!fileId) return null;
  if (error)
    return (
      <div className={styles.mediaUnavailable} role="alert">
        <span>No se puede abrir este archivo.</span>{" "}
        <button type="button" onClick={() => void authorize().catch(() => setError(true))}>
          Reintentar
        </button>
      </div>
    );
  if (!url) return <p className={styles.mediaUnavailable}>Preparando archivo…</p>;
  if (message.kind === "IMAGE") {
    return (
      <>
        <button
          className={styles.messageImageButton}
          type="button"
          onClick={() => imageDialog.current?.showModal()}
          aria-label="Ampliar imagen"
        >
          <img
            className={styles.messageImage}
            src={url}
            alt={message.body || "Imagen de la conversación"}
            referrerPolicy="no-referrer"
            onError={retryMedia}
          />
        </button>
        <dialog className={styles.messageImageDialog} ref={imageDialog}>
          <button type="button" onClick={() => imageDialog.current?.close()}>
            Cerrar imagen
          </button>
          <img src={url} alt={message.body || "Imagen de la conversación"} onError={retryMedia} />
        </dialog>
      </>
    );
  }
  if (message.kind === "AUDIO") {
    return <ConversationAudio url={url} onError={retryMedia} />;
  }
  return (
    <a
      className={styles.messageFile}
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={() => void authorize().catch(() => setError(true))}
    >
      Abrir documento ↗
    </a>
  );
}
