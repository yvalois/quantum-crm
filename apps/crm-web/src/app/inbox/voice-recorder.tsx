"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./inbox.module.css";

const maxSeconds = 120;
const maxBytes = 16_000_000;

function recordingFormat(): { mime: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
    return { mime: "audio/webm;codecs=opus", extension: "webm" };
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus"))
    return { mime: "audio/ogg;codecs=opus", extension: "ogg" };
  return null;
}

export function VoiceRecorder({
  disabled,
  onFile,
}: {
  readonly disabled: boolean;
  readonly onFile: (file: File) => void;
}): React.JSX.Element {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const activeRef = useRef(true);
  const discardRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "finishing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (seconds >= maxSeconds && recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      setPhase("finishing");
    }
  }, [seconds]);

  useEffect(() => {
    if (disabled && recorderRef.current?.state === "recording") {
      discardRef.current = true;
      recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setPhase("idle");
    }
  }, [disabled]);

  async function start(): Promise<void> {
    if (phase !== "idle" || disabled) return;
    setError(null);
    const format = recordingFormat();
    if (!format || !navigator.mediaDevices?.getUserMedia) {
      setError("Este navegador no puede grabar audio compatible. Adjunta un MP3 u OGG.");
      return;
    }
    try {
      setPhase("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current || disabledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (activeRef.current) setPhase("idle");
        return;
      }
      const recorder = new MediaRecorder(stream, {
        mimeType: format.mime,
        audioBitsPerSecond: 48_000,
      });
      streamRef.current = stream;
      recorderRef.current = recorder;
      discardRef.current = false;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
        if (
          chunksRef.current.reduce((total, chunk) => total + chunk.size, 0) > maxBytes &&
          recorder.state === "recording"
        ) {
          discardRef.current = true;
          recorder.stop();
          setError("El audio supera 16 MB. Graba uno más corto.");
        }
      };
      recorder.onerror = () => {
        discardRef.current = true;
        if (activeRef.current) setError("La grabación falló. Inténtalo de nuevo.");
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: format.extension === "webm" ? "audio/webm" : "audio/ogg",
        });
        chunksRef.current = [];
        if (activeRef.current) {
          setPhase("idle");
          setSeconds(0);
          if (!discardRef.current && blob.size > 0 && blob.size <= maxBytes) {
            onFile(
              new File([blob], `nota-de-voz-${Date.now()}.${format.extension}`, {
                type: blob.type,
              }),
            );
          } else if (!discardRef.current) {
            setError("No se pudo preparar el audio. Inténtalo de nuevo.");
          }
        }
      };
      recorder.start(1_000);
      setSeconds(0);
      setPhase("recording");
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (activeRef.current) {
        setPhase("idle");
        setError("No se pudo acceder al micrófono. Revisa el permiso del navegador.");
      }
    }
  }

  function stop(discard: boolean): void {
    if (recorderRef.current?.state !== "recording") return;
    discardRef.current = discard;
    recorderRef.current.stop();
    setPhase("finishing");
  }

  return (
    <div className={styles.voiceRecorder}>
      {phase === "idle" || phase === "requesting" ? (
        <button
          className={styles.toolButton}
          type="button"
          aria-label={phase === "requesting" ? "Abriendo micrófono" : "Grabar audio"}
          title="Grabar audio"
          disabled={disabled || phase === "requesting"}
          onClick={() => void start()}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
          </svg>
          {phase === "requesting" ? "Abriendo…" : "Audio"}
        </button>
      ) : (
        <div className={styles.voiceRecording} role="status">
          <span className={styles.recordingDot} aria-hidden="true" />
          <span>
            Grabando {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button type="button" disabled={phase !== "recording"} onClick={() => stop(false)}>
            Detener
          </button>
          <button type="button" disabled={phase !== "recording"} onClick={() => stop(true)}>
            Cancelar
          </button>
        </div>
      )}
      {error ? (
        <span className={styles.recordingError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
