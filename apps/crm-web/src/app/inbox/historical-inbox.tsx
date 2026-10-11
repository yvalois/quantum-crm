"use client";

import {
  HistoricalConversationListResponseSchema,
  HistoricalConversationMessageListResponseSchema,
  HistoricalConversationResponseSchema,
  type HistoricalConversation,
  type HistoricalConversationMessage,
} from "@quantum-crm/contracts";
import { type FormEvent, useEffect, useState } from "react";
import styles from "./historical-inbox.module.css";
import { ConversationContactCard, useConversationContacts } from "./conversation-contact";
import { HistoricalAttachment } from "./historical-attachment";
import { HistoricalChannelBadge } from "./historical-channel-badge";
import { SourceParticipantsCard } from "../source-participants";

function threadTitle(thread: HistoricalConversation, name?: string): string {
  if (name) return name;
  if (
    thread.subject &&
    !["Conversación histórica sin ficha actual en GHL", "Conversación importada de GHL"].includes(
      thread.subject,
    )
  )
    return thread.subject;
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
    if (response.status === 403)
      throw new Error("No tienes permiso para consultar este historial.");
    throw new Error("No fue posible consultar el historial. Inténtalo de nuevo.");
  }
  return response.json() as Promise<unknown>;
}

export function HistoricalInbox(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [threads, setThreads] = useState<HistoricalConversation[]>([]);
  const [contactState, setContactState] = useState<"ALL" | "LINKED" | "UNLINKED">("LINKED");
  const [listCursors, setListCursors] = useState<readonly (string | null)[]>([null]);
  const [nextListCursor, setNextListCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<HistoricalConversation | null>(null);
  const [messages, setMessages] = useState<HistoricalConversationMessage[]>([]);
  const [messageCursors, setMessageCursors] = useState<readonly (string | null)[]>([null]);
  const [nextMessageCursor, setNextMessageCursor] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [threadBusy, setThreadBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const listCursor = listCursors.at(-1) ?? null;
  const messageCursor = messageCursors.at(-1) ?? null;
  const related = useConversationContacts([
    ...threads.map((thread) => thread.contactId),
    selected?.contactId,
  ]);
  const selectedContact = selected?.contactId
    ? related.contacts.get(selected.contactId)
    : undefined;

  useEffect(() => {
    const contact = new URLSearchParams(window.location.search).get("contactId");
    if (contact && /^[0-9a-f-]{36}$/u.test(contact)) setContactId(contact);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setListBusy(true);
    setListError(null);
    const params = new URLSearchParams({ limit: "50" });
    params.set("contactState", contactState);
    if (listCursor) params.set("cursor", listCursor);
    if (search) params.set("query", search);
    if (contactId) params.set("contactId", contactId);
    void read(`/api/conversations/historical?${params}`, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const page = HistoricalConversationListResponseSchema.parse(result);
        setThreads(page.data);
        setNextListCursor(page.page.nextCursor);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setListError(
            error instanceof Error ? error.message : "No fue posible cargar el historial.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setListBusy(false);
      });
    return () => controller.abort();
  }, [listCursor, search, contactId, contactState]);

  useEffect(() => {
    if (selectedId === null) return;
    const controller = new AbortController();
    setThreadBusy(true);
    setThreadError(null);
    const params = new URLSearchParams({ limit: "50" });
    if (messageCursor) params.set("cursor", messageCursor);
    void Promise.all([
      read(`/api/conversations/historical/${selectedId}`, controller.signal),
      read(`/api/conversations/historical/${selectedId}/messages?${params}`, controller.signal),
    ])
      .then(([thread, result]) => {
        if (controller.signal.aborted) return;
        setSelected(HistoricalConversationResponseSchema.parse(thread).data);
        const page = HistoricalConversationMessageListResponseSchema.parse(result);
        setMessages(page.data);
        setNextMessageCursor(page.page.nextCursor);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setThreadError(
            error instanceof Error ? error.message : "No fue posible cargar los mensajes.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setThreadBusy(false);
      });
    return () => controller.abort();
  }, [selectedId, messageCursor]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setListCursors([null]);
    setSearch(query.trim());
  }
  function choose(item: HistoricalConversation): void {
    setSelectedId(item.id);
    setSelected(item);
    setMessages([]);
    setMessageCursors([null]);
    setNextMessageCursor(null);
  }

  return (
    <section className={styles.workspace} aria-label="Historial de conversaciones GHL">
      <div className={styles.notice}>
        <strong>Historial importado de GHL · Solo lectura</strong>
        <span>
          Mensajes y fechas originales. Los adjuntos pendientes se indican en cada mensaje.
        </span>
      </div>
      <div className={styles.columns}>
        <aside className={styles.list} aria-label="Conversaciones históricas" aria-busy={listBusy}>
          <label className={styles.contactFilter}>
            Mostrar conversaciones
            <select
              aria-label="Vínculo del contacto"
              value={contactState}
              onChange={(event) => {
                setContactState(event.target.value as "ALL" | "LINKED" | "UNLINKED");
                setListCursors([null]);
                setSelectedId(null);
                setSelected(null);
                setMessages([]);
              }}
            >
              <option value="LINKED">Con contacto</option>
              <option value="UNLINKED">Sin contacto vinculado</option>
              <option value="ALL">Todas las conversaciones</option>
            </select>
          </label>
          <form className={styles.search} onSubmit={submit}>
            <label htmlFor="historical-search">Buscar en el historial</label>
            <div>
              <input
                id="historical-search"
                maxLength={160}
                value={query}
                placeholder="Contacto, asunto o mensaje"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="submit" disabled={listBusy}>
                Buscar
              </button>
            </div>
          </form>
          {contactId ? (
            <button
              className={styles.clearFilter}
              onClick={() => {
                setContactId(null);
                setListCursors([null]);
              }}
              type="button"
            >
              Quitar filtro de contacto
            </button>
          ) : null}
          {listError ? (
            <p role="alert" className={styles.error}>
              {listError}
            </p>
          ) : null}
          {listBusy ? (
            <p role="status">Cargando conversaciones…</p>
          ) : threads.length === 0 ? (
            <p>No hay historial importado visible con estos filtros.</p>
          ) : null}
          <ul className={styles.threadList}>
            {threads.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === item.id}
                  className={styles.threadButton}
                  onClick={() => choose(item)}
                >
                  <strong>
                    {threadTitle(
                      item,
                      item.contactId
                        ? related.contacts.get(item.contactId)?.displayName
                        : undefined,
                    )}
                  </strong>
                  {item.contactId && related.contacts.get(item.contactId)?.phone ? (
                    <span>{related.contacts.get(item.contactId)?.phone}</span>
                  ) : null}
                  <span className={styles.threadSummary}>
                    <span>{item.messageCount} mensajes</span>
                    <HistoricalChannelBadge rawChannel={item.rawChannel} />
                  </span>
                  <time>{when(item.lastMessageAt ?? item.sourceCreatedAt)}</time>
                  {!item.contactId ? (
                    <small>Datos del cliente no incluidos en la importación</small>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <nav className={styles.pagination} aria-label="Páginas de conversaciones históricas">
            <button
              type="button"
              disabled={listBusy || listCursors.length < 2}
              onClick={() => setListCursors((values) => values.slice(0, -1))}
            >
              Anterior
            </button>
            <span>Página {listCursors.length}</span>
            <button
              type="button"
              disabled={listBusy || !nextListCursor}
              onClick={() => {
                if (nextListCursor) setListCursors((values) => [...values, nextListCursor]);
              }}
            >
              Siguiente
            </button>
          </nav>
        </aside>
        <section className={styles.thread} aria-label="Mensajes históricos" aria-busy={threadBusy}>
          {selected ? (
            <>
              <header className={styles.header}>
                <div>
                  <h2>{threadTitle(selected, selectedContact?.displayName)}</h2>
                  <p>
                    {selected.messageCount} mensajes ·{" "}
                    {selected.rawStatus || "Estado original no informado"}
                  </p>
                  <HistoricalChannelBadge rawChannel={selected.rawChannel} />
                </div>
                {selected.contactId ? (
                  <a href={`/contacts?contact=${encodeURIComponent(selected.contactId)}`}>
                    Abrir contacto
                  </a>
                ) : (
                  <span>Contacto sin correspondencia confirmada</span>
                )}
              </header>
              {!selected.sourceThreadPresent ? (
                <p className={styles.orphan}>
                  Este hilo se conserva a partir de referencias de sus mensajes; su ficha ya no
                  aparece en la lista actual de GHL.
                </p>
              ) : null}
              {threadError ? (
                <p role="alert" className={styles.error}>
                  {threadError}
                </p>
              ) : null}
              {threadBusy ? (
                <p role="status">Cargando mensajes…</p>
              ) : (
                <>
                  <ol className={styles.messages}>
                    {messages.map((item) => (
                      <li
                        key={item.id}
                        className={styles.message}
                        data-direction={item.rawDirection}
                      >
                        <header>
                          <strong>
                            {item.rawDirection === "inbound"
                              ? "Recibido"
                              : item.rawDirection === "outbound"
                                ? "Enviado desde GHL"
                                : item.rawDirection || "Dirección no informada"}
                          </strong>
                          <time>{when(item.sourceCreatedAt)}</time>
                        </header>
                        <p className={styles.metadata}>
                          <HistoricalChannelBadge rawChannel={item.rawChannel} rawType={item.rawType} />
                          {item.rawStatus ? <span>{item.rawStatus}</span> : null}
                        </p>
                        {item.body.length > 0 ? (
                          <pre className={styles.body}>{item.body}</pre>
                        ) : item.attachmentCount === 0 ? (
                          <p className={styles.noBody}>Mensaje original sin texto.</p>
                        ) : null}
                        {item.attachments.length > 0 ? (
                          <ul className={styles.attachments} aria-label="Adjuntos del mensaje">
                            {item.attachments.map((attachment) => (
                              <HistoricalAttachment key={attachment.id} attachment={attachment} />
                            ))}
                          </ul>
                        ) : null}
                        {item.attachmentCount > item.attachments.length ? (
                          <p className={styles.attachment}>
                            {item.attachmentCount - item.attachments.length} adjunto(s) pendiente(s)
                            de importación y verificación.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {messages.length === 0 && !threadError ? (
                    <p>No hay mensajes en esta página.</p>
                  ) : null}
                </>
              )}
              <nav className={styles.pagination} aria-label="Páginas de mensajes históricos">
                <button
                  type="button"
                  disabled={threadBusy || messageCursors.length < 2}
                  onClick={() => setMessageCursors((values) => values.slice(0, -1))}
                >
                  Anteriores
                </button>
                <span>Página {messageCursors.length}</span>
                <button
                  type="button"
                  disabled={threadBusy || !nextMessageCursor}
                  onClick={() => {
                    if (nextMessageCursor)
                      setMessageCursors((values) => [...values, nextMessageCursor]);
                  }}
                >
                  Siguientes
                </button>
              </nav>
              <p className={styles.readOnly}>
                Historial de consulta. No se envían mensajes desde esta vista.
              </p>
            </>
          ) : (
            <div className={styles.empty}>
              <h2>Selecciona una conversación</h2>
              <p>
                Aquí puedes consultar el historial importado y abrir el contacto cuando exista una
                correspondencia confirmada.
              </p>
            </div>
          )}
        </section>
        <aside className={styles.contactPanel} aria-label="Información del cliente">
          {selected ? (
            <>
              <SourceParticipantsCard participants={selected.sourceParticipants} kind="conversación" />
              <ConversationContactCard
                contact={selectedContact}
                linked={Boolean(selected.contactId)}
                loading={Boolean(selected.contactId) && related.loading}
                error={selected.contactId ? related.error : null}
              />
            </>
          ) : (
            <p>
              Selecciona una conversación para ver el cliente, sus etiquetas y campos
              personalizados.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
