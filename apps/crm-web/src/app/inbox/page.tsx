"use client";

import type {
  Contact,
  Conversation,
  ConversationMessage,
  QuickReply,
  TaskAssignee,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CrmShell } from "../crm-shell";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}
interface Thread {
  readonly data: {
    readonly conversation: Conversation;
    readonly messages: ConversationMessage[];
  };
}

const channelLabel: Record<Conversation["channel"], string> = {
  EMAIL: "Correo",
  WHATSAPP: "WhatsApp",
  WEBCHAT: "Chat web",
  SMS: "SMS",
};
const statusLabel: Record<Conversation["status"], string> = {
  OPEN: "Abierta",
  PENDING: "Pendiente",
  ESCALATED: "Escalada",
  CLOSED: "Cerrada",
};
const deliveryLabel: Record<ConversationMessage["deliveryStatus"], string> = {
  RECEIVED: "Recibido",
  QUEUED: "En cola",
  SENT: "Enviado",
  DELIVERED: "Entregado",
  READ: "Leído",
  FAILED: "Falló",
  UNKNOWN: "Sin confirmar",
  NOT_APPLICABLE: "Nota interna",
};

async function problem(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === "object" && "title" in value && typeof value.title === "string"
    ? value.title
    : "No fue posible completar la solicitud.";
}
function when(value: string | null): string {
  if (!value) return "Sin actividad";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}
function initials(value: string): string {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
}

export default function InboxPage(): React.JSX.Element {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<"message" | "note">("message");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const loadThread = useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/conversations/${id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await problem(response));
    const thread = (await response.json()) as Thread;
    setSelected(thread.data.conversation);
    setMessages(thread.data.messages);
    setSelectedId(id);
  }, []);

  const loadList = useCallback(
    async (preferredId?: string | null): Promise<void> => {
      const search = new URLSearchParams({ limit: "100" });
      if (query.trim()) search.set("query", query.trim());
      if (channel) search.set("channel", channel);
      if (status) search.set("status", status);
      const response = await fetch(`/api/conversations?${search}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await problem(response));
      const next = ((await response.json()) as List<Conversation>).data;
      setItems(next);
      const target = preferredId ?? selectedId ?? next[0]?.id;
      if (target && next.some((item) => item.id === target)) await loadThread(target);
      else {
        setSelectedId(null);
        setSelected(null);
        setMessages([]);
      }
    },
    [channel, loadThread, query, selectedId, status],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (sessionResponse.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/inbox");
          return;
        }
        const session = (await sessionResponse.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        setCsrf(session.csrfToken);
        const [contactResponse, assigneeResponse, replyResponse] = await Promise.all([
          fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/tasks/assignees", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/conversations/quick-replies", {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ]);
        for (const response of [contactResponse, assigneeResponse, replyResponse])
          if (!response.ok) throw new Error(await problem(response));
        setContacts(((await contactResponse.json()) as List<Contact>).data);
        setAssignees(((await assigneeResponse.json()) as List<TaskAssignee>).data);
        setQuickReplies(((await replyResponse.json()) as List<QuickReply>).data);
        await loadList();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No fue posible cargar la bandeja.");
      } finally {
        setLoading(false);
      }
    })();
    // Carga inicial; los filtros se aplican con el botón de búsqueda.
  }, []);

  async function mutate(
    path: string,
    body: unknown,
    options: { readonly method?: "POST" | "PATCH"; readonly version?: string } = {},
  ): Promise<Response> {
    if (!csrf) throw new Error("La sesión no está lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(path, {
      method: options.method ?? "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await problem(response));
    return response;
  }

  async function createConversation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate("/api/conversations", {
        contactId: String(form.get("contactId")),
        channel: String(form.get("channel")),
        subject: String(form.get("subject")).trim() || undefined,
        initialMessage: String(form.get("initialMessage")),
      });
      const created = (await response.json()) as { data: Conversation };
      setShowCreate(false);
      event.currentTarget.reset();
      await loadList(created.data.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la conversación.");
    } finally {
      setSaving(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/conversations/${selected.id}/${mode === "note" ? "notes" : "messages"}`,
        mode === "note" ? { body: draft } : { body: draft, kind: "TEXT" },
        { version: selected.version },
      );
      setDraft("");
      await loadList(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el mensaje.");
    } finally {
      setSaving(false);
    }
  }

  async function update(patch: Record<string, unknown>): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/conversations/${selected.id}`, patch, {
        method: "PATCH",
        version: selected.version,
      });
      await loadList(selected.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible actualizar la conversación.",
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedContact = selected ? contactById.get(selected.contactId) : undefined;

  return (
    <CrmShell className="crm-shell-board inbox-shell">
      <section className="crm-content inbox-content" aria-busy={loading}>
        <header className="inbox-header">
          <div>
            <p className="eyebrow">Centro omnicanal</p>
            <h1>Conversaciones</h1>
            <p>Correo, WhatsApp, chat y futuros canales en una sola operación.</p>
          </div>
          <button className="primary-action" type="button" onClick={() => setShowCreate(true)}>
            + Nueva conversación
          </button>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="inbox-grid">
          <section className="inbox-list" aria-label="Bandeja">
            <form
              className="inbox-filters"
              onSubmit={(event) => {
                event.preventDefault();
                void loadList(null);
              }}
            >
              <input
                aria-label="Buscar"
                placeholder="Buscar conversación"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                aria-label="Canal"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="">Canales</option>
                <option value="EMAIL">Correo</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="WEBCHAT">Chat web</option>
                <option value="SMS">SMS</option>
              </select>
              <select
                aria-label="Estado"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">Estados</option>
                <option value="OPEN">Abiertas</option>
                <option value="PENDING">Pendientes</option>
                <option value="ESCALATED">Escaladas</option>
                <option value="CLOSED">Cerradas</option>
              </select>
              <button type="submit">Filtrar</button>
            </form>
            <div className="inbox-count">
              <strong>{items.length}</strong>
              <span> conversaciones</span>
            </div>
            <ol>
              {items.map((item) => {
                const contact = contactById.get(item.contactId);
                return (
                  <li key={item.id}>
                    <button
                      className={
                        item.id === selectedId ? "conversation-card active" : "conversation-card"
                      }
                      type="button"
                      onClick={() => void loadThread(item.id)}
                    >
                      <span className="conversation-avatar">
                        {initials(contact?.displayName ?? "Contacto")}
                      </span>
                      <span className="conversation-summary">
                        <span>
                          <strong>{contact?.displayName ?? "Contacto"}</strong>
                          <time>{when(item.lastMessageAt)}</time>
                        </span>
                        <small>
                          {channelLabel[item.channel]} · {statusLabel[item.status]}
                        </small>
                        <p>{item.lastMessagePreview ?? item.subject ?? "Sin mensajes"}</p>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {!loading && items.length === 0 ? (
              <p className="inbox-empty">No hay conversaciones con estos filtros.</p>
            ) : null}
          </section>

          <section className="thread-panel" aria-label="Conversación seleccionada">
            {selected ? (
              <>
                <header className="thread-header">
                  <div className="conversation-avatar large">
                    {initials(selectedContact?.displayName ?? "Contacto")}
                  </div>
                  <div>
                    <h2>{selectedContact?.displayName ?? "Contacto"}</h2>
                    <p>{selected.subject ?? channelLabel[selected.channel]}</p>
                  </div>
                  <span className={`status-pill status-${selected.status.toLowerCase()}`}>
                    {statusLabel[selected.status]}
                  </span>
                </header>
                <div className="message-stream">
                  {messages.map((item) => (
                    <article
                      key={item.id}
                      className={`message-bubble message-${item.direction.toLowerCase()}`}
                    >
                      <p>{item.body}</p>
                      <footer>
                        <span>
                          {item.direction === "INTERNAL"
                            ? "Nota interna"
                            : deliveryLabel[item.deliveryStatus]}
                        </span>
                        <time>{when(item.createdAt)}</time>
                      </footer>
                    </article>
                  ))}
                </div>
                <form
                  className={mode === "note" ? "composer composer-note" : "composer"}
                  onSubmit={(event) => void send(event)}
                >
                  <div className="composer-tabs">
                    <button
                      type="button"
                      className={mode === "message" ? "active" : ""}
                      onClick={() => setMode("message")}
                    >
                      Responder
                    </button>
                    <button
                      type="button"
                      className={mode === "note" ? "active" : ""}
                      onClick={() => setMode("note")}
                    >
                      Nota interna
                    </button>
                  </div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      mode === "note"
                        ? "Escribe una nota solo para el equipo…"
                        : "Escribe una respuesta…"
                    }
                    maxLength={16000}
                  />
                  <footer>
                    <select
                      aria-label="Respuesta rápida"
                      defaultValue=""
                      onChange={(event) => {
                        const reply = quickReplies.find((item) => item.id === event.target.value);
                        if (reply) setDraft(reply.body);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Respuesta rápida</option>
                      {quickReplies.map((reply) => (
                        <option key={reply.id} value={reply.id}>
                          {reply.title}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary-action"
                      disabled={saving || !draft.trim()}
                      type="submit"
                    >
                      {mode === "note" ? "Guardar nota" : "Enviar"}
                    </button>
                  </footer>
                </form>
              </>
            ) : (
              <div className="thread-empty">
                <strong>Selecciona una conversación</strong>
                <p>El hilo, el estado y los controles aparecerán aquí.</p>
              </div>
            )}
          </section>

          <aside className="conversation-details" aria-label="Controles de conversación">
            {selected ? (
              <>
                <p className="eyebrow">Contexto</p>
                <h3>{selectedContact?.displayName ?? "Contacto"}</h3>
                <dl>
                  <div>
                    <dt>Canal</dt>
                    <dd>{channelLabel[selected.channel]}</dd>
                  </div>
                  <div>
                    <dt>Correo</dt>
                    <dd>{selectedContact?.email ?? "No registrado"}</dd>
                  </div>
                  <div>
                    <dt>Teléfono</dt>
                    <dd>{selectedContact?.phone ?? "No registrado"}</dd>
                  </div>
                </dl>
                <label>
                  Responsable
                  <select
                    value={selected.assigneeMemberId ?? ""}
                    disabled={saving}
                    onChange={(event) =>
                      void update({ assigneeMemberId: event.target.value || null })
                    }
                  >
                    <option value="">Sin asignar</option>
                    {assignees.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Estado
                  <select
                    value={selected.status}
                    disabled={saving}
                    onChange={(event) => void update({ status: event.target.value })}
                  >
                    <option value="OPEN">Abierta</option>
                    <option value="PENDING">Pendiente</option>
                    <option value="ESCALATED">Escalada</option>
                    <option value="CLOSED">Cerrada</option>
                  </select>
                </label>
                <div className="attention-control">
                  <span>Atención actual</span>
                  <strong>
                    {selected.attentionMode === "HUMAN" ? "Equipo humano" : "Agente Quantum"}
                  </strong>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={
                      saving ||
                      (selected.attentionMode === "HUMAN" &&
                        (selected.status === "CLOSED" || selected.status === "ESCALATED"))
                    }
                    onClick={() =>
                      void update({
                        attentionMode: selected.attentionMode === "HUMAN" ? "AGENT" : "HUMAN",
                      })
                    }
                  >
                    {selected.attentionMode === "HUMAN"
                      ? "Entregar al agente"
                      : "Tomar conversación"}
                  </button>
                </div>
                <p className="delivery-disclaimer">
                  Los mensajes quedan registrados y en cola. La entrega real se activará al
                  configurar el proveedor del canal.
                </p>
              </>
            ) : null}
          </aside>
        </div>
      </section>

      {showCreate ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-conversation-title"
          >
            <header>
              <div>
                <p className="eyebrow">Nuevo hilo</p>
                <h2 id="new-conversation-title">Iniciar conversación</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowCreate(false)}>
                ×
              </button>
            </header>
            <form onSubmit={(event) => void createConversation(event)}>
              <label>
                Contacto
                <select name="contactId" required defaultValue="">
                  <option value="" disabled>
                    Selecciona un contacto
                  </option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Canal
                <select name="channel" defaultValue="EMAIL">
                  <option value="EMAIL">Correo</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="WEBCHAT">Chat web</option>
                  <option value="SMS">SMS</option>
                </select>
              </label>
              <label>
                Asunto
                <input name="subject" maxLength={240} />
              </label>
              <label className="field-wide">
                Mensaje
                <textarea name="initialMessage" required maxLength={16000} />
              </label>
              <footer>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="primary-action" disabled={saving}>
                  Crear conversación
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </CrmShell>
  );
}
