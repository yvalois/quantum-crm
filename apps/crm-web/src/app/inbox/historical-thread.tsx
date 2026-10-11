"use client";

import {
  HistoricalConversationMessageListResponseSchema,
  HistoricalConversationResponseSchema,
  type HistoricalConversation,
  type HistoricalConversationMessage,
} from "@quantum-crm/contracts";
import { useEffect, useState } from "react";
import styles from "./historical-inbox.module.css";
import { HistoricalAttachment } from "./historical-attachment";
import { HistoricalChannelBadge } from "./historical-channel-badge";

export function historicalThreadTitle(thread: HistoricalConversation, name?: string): string {
  if (name) return name;
  if (
    thread.subject &&
    !["Conversación histórica sin ficha actual en GHL", "Conversación importada de GHL"].includes(
      thread.subject,
    )
  ) return thread.subject;
  return thread.contactId
    ? "Cliente vinculado"
    : `Sin contacto vinculado · ${thread.sourceExternalId.slice(-6)}`;
}

function when(value: string | null): string {
  return value === null
    ? "Fecha no informada"
    : new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      );
}

async function read(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    if (response.status === 403) throw new Error("No tienes permiso para consultar este historial.");
    throw new Error("No fue posible consultar el historial. Inténtalo de nuevo.");
  }
  return response.json() as Promise<unknown>;
}

/** The selected imported thread shares the inbox list and contact panel with native threads. */
export function HistoricalThread({
  conversation,
  contactName,
}: {
  readonly conversation: HistoricalConversation;
  readonly contactName: string | undefined;
}): React.JSX.Element {
  const [selected, setSelected] = useState(conversation);
  const [messages, setMessages] = useState<HistoricalConversationMessage[]>([]);
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const cursor = cursors.at(-1) ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    void Promise.all([
      read(`/api/conversations/historical/${conversation.id}`, signal),
      read(`/api/conversations/historical/${conversation.id}/messages?${params}`, signal),
    ])
      .then(([thread, result]) => {
        if (controller.signal.aborted) return;
        setSelected(HistoricalConversationResponseSchema.parse(thread).data);
        const page = HistoricalConversationMessageListResponseSchema.parse(result);
        setMessages(page.data);
        setNextCursor(page.page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setMessages([]);
          setNextCursor(null);
          setError(cause instanceof Error && cause.name !== "TimeoutError"
            ? cause.message : "La consulta tardó demasiado. Inténtalo de nuevo.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [conversation.id, cursor, retry]);

  return (
    <section className={`${styles.workspace} ${styles.selectedThread}`} aria-label="Mensajes históricos" aria-busy={busy}>
      <header className={styles.header}>
        <div>
          <h2>{historicalThreadTitle(selected, contactName)}</h2>
          <p>{selected.messageCount} mensajes · {selected.rawStatus || "Estado original no informado"}</p>
          <HistoricalChannelBadge rawChannel={selected.rawChannel} />
        </div>
        <div>
          <span>Origen GHL · Solo lectura</span>
          {selected.contactId ? (
            <a className={styles.contactLink} href={`/contacts?contact=${encodeURIComponent(selected.contactId)}`}>Abrir contacto</a>
          ) : null}
        </div>
      </header>
      {!selected.sourceThreadPresent ? (
        <p className={styles.orphan}>
          Este hilo se conserva a partir de referencias de sus mensajes; su ficha ya no aparece
          en la lista actual de GHL.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button>
        </div>
      ) : null}
      {busy ? <p className={styles.loading} role="status">Cargando mensajes…</p> : (
        <ol className={styles.messages} aria-label="Mensajes de la conversación">
          {messages.map((item) => (
            <li key={item.id} className={styles.message} data-direction={item.rawDirection}>
              <header>
                <strong>{item.rawDirection === "inbound" ? "Recibido" : item.rawDirection === "outbound"
                  ? "Enviado desde GHL" : item.rawDirection || "Dirección no informada"}</strong>
                <time>{when(item.sourceCreatedAt)}</time>
              </header>
              <p className={styles.metadata}>
                <HistoricalChannelBadge rawChannel={item.rawChannel} rawType={item.rawType} />
                {item.rawStatus ? <span>{item.rawStatus}</span> : null}
              </p>
              {item.body.length > 0 ? <pre className={styles.body}>{item.body}</pre> : item.attachmentCount === 0
                ? <p className={styles.noBody}>Mensaje original sin texto.</p> : null}
              {item.attachments.length > 0 ? (
                <ul className={styles.attachments} aria-label="Adjuntos del mensaje">
                  {item.attachments.map((attachment) => <HistoricalAttachment key={attachment.id} attachment={attachment} />)}
                </ul>
              ) : null}
              {item.attachmentCount > item.attachments.length ? (
                <p className={styles.attachment}>
                  {item.attachmentCount - item.attachments.length} adjunto(s) pendiente(s) de importación y verificación.
                </p>
              ) : null}
            </li>
          ))}
          {messages.length === 0 && !error ? <li>No hay mensajes en esta página.</li> : null}
        </ol>
      )}
      <nav className={styles.pagination} aria-label="Páginas de mensajes">
        <button type="button" disabled={busy || cursors.length < 2}
          onClick={() => setCursors((values) => values.slice(0, -1))}>Anteriores</button>
        <span>Página {cursors.length}</span>
        <button type="button" disabled={busy || !nextCursor}
          onClick={() => { if (nextCursor) setCursors((values) => [...values, nextCursor]); }}>Siguientes</button>
      </nav>
      <p className={styles.readOnly}>Envío pendiente de conexión del canal. Este historial se conserva en consulta.</p>
    </section>
  );
}
