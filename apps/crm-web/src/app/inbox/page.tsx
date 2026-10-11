"use client";

import type {
  CommercialDocument,
  Contact,
  Conversation,
  ConversationHistoryEntry,
  ConversationMessage,
  DocumentBlock,
  DocumentTemplate,
  QuickReply,
  TaskAssignee,
  HistoricalConversation,
  UnifiedInboxItem,
} from "@quantum-crm/contracts";
import { ConversationThreadResponseSchema, UnifiedInboxListResponseSchema } from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import { HistoricalThread, historicalThreadTitle } from "./historical-thread";
import { HistoricalChannelBadge } from "./historical-channel-badge";
import { SourceParticipantsCard } from "../source-participants";
import { ConversationContactCard, useConversationContacts } from "./conversation-contact";
import styles from "./inbox.module.css";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface List<T> {
  readonly data: T[];
}

type InboxView = "ALL" | "OPEN" | "PENDING" | "ESCALATED" | "CLOSED" | "UNASSIGNED";
type ComposerMode = "message" | "note";
type IconName =
  | "add"
  | "agent"
  | "arrow"
  | "chevron"
  | "close"
  | "document"
  | "filter"
  | "inbox"
  | "message"
  | "note"
  | "search"
  | "send"
  | "spark"
  | "user";

const channelLabel: Record<Conversation["channel"], string> = {
  EMAIL: "Correo",
  WHATSAPP: "WhatsApp",
  WEBCHAT: "Chat web",
  SMS: "SMS",
};
const channelShortLabel: Record<Conversation["channel"], string> = {
  EMAIL: "EM",
  WHATSAPP: "WA",
  WEBCHAT: "WEB",
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
const viewLabel: Record<InboxView, string> = {
  ALL: "Todas",
  OPEN: "Abiertas",
  PENDING: "Pendientes",
  ESCALATED: "Escaladas",
  CLOSED: "Cerradas",
  UNASSIGNED: "Sin asignar",
};
const historyLabel: Record<ConversationHistoryEntry["eventType"], string> = {
  CREATED: "Conversación creada",
  ASSIGNED: "Responsable asignado",
  TRANSFERRED: "Responsable transferido",
  STATUS_CHANGED: "Estado actualizado",
  ATTENTION_CHANGED: "Modo de atención actualizado",
  MESSAGE_ADDED: "Mensaje registrado",
  NOTE_ADDED: "Nota interna registrada",
};
const statusClass: Record<Conversation["status"], string> = {
  OPEN: styles.statusOPEN ?? "",
  PENDING: styles.statusPENDING ?? "",
  ESCALATED: styles.statusESCALATED ?? "",
  CLOSED: styles.statusCLOSED ?? "",
};

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function Icon({
  name,
  size = 18,
}: {
  readonly name: IconName;
  readonly size?: number;
}): React.JSX.Element {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  const paths: Record<IconName, React.JSX.Element> = {
    add: <path {...common} d="M12 5v14M5 12h14" />,
    agent: (
      <>
        <rect {...common} x="4" y="6" width="16" height="13" rx="3" />
        <path {...common} d="M12 3v3M8.5 12h.01M15.5 12h.01M8.5 15h7" />
      </>
    ),
    arrow: <path {...common} d="m5 12 5 5L20 7" />,
    chevron: <path {...common} d="m8 10 4 4 4-4" />,
    close: <path {...common} d="m7 7 10 10M17 7 7 17" />,
    document: (
      <>
        <path {...common} d="M7 3h7l4 4v14H7z" />
        <path {...common} d="M14 3v5h5M10 13h5M10 17h5" />
      </>
    ),
    filter: <path {...common} d="M4 6h16M7 12h10M10 18h4" />,
    inbox: (
      <>
        <path {...common} d="M4 5h16v14H4z" />
        <path {...common} d="M4 13h4l2 3h4l2-3h4" />
      </>
    ),
    message: <path {...common} d="M4 5h16v11H9l-5 4z" />,
    note: (
      <>
        <path {...common} d="M5 4h14v16H5z" />
        <path {...common} d="M8 9h8M8 13h5" />
      </>
    ),
    search: (
      <>
        <circle {...common} cx="10.7" cy="10.7" r="5.7" />
        <path {...common} d="m15 15 4 4" />
      </>
    ),
    send: <path {...common} d="m4 4 16 8-16 8 3-8zM7 12h13" />,
    spark: (
      <path {...common} d="m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55z" />
    ),
    user: (
      <>
        <circle {...common} cx="12" cy="8" r="3.25" />
        <path {...common} d="M5 20c.7-3.35 3.15-5 7-5s6.3 1.65 7 5" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" focusable="false">
      {paths[name]}
    </svg>
  );
}

function problem(response: Response): Promise<string> {
  return response
    .json()
    .catch(() => null)
    .then((value: unknown) =>
      value && typeof value === "object" && "title" in value && typeof value.title === "string"
        ? value.title
        : "No fue posible completar la solicitud.",
    );
}

function when(value: string | null): string {
  if (!value) return "Sin actividad";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function day(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoy";
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long" }).format(date);
}

function time(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" }).format(
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

function authorLabel(item: ConversationMessage): string {
  if (item.direction === "INBOUND") return "Cliente";
  if (item.direction === "INTERNAL") return "Nota interna";
  return "Equipo";
}

function sameDay(left: ConversationMessage, right: ConversationMessage | undefined): boolean {
  if (!right) return false;
  return new Date(left.createdAt).toDateString() === new Date(right.createdAt).toDateString();
}

function availabilityMessage(selected: Conversation | null): string | null {
  if (!selected) return null;
  if (selected.status === "CLOSED") return "Esta conversación está cerrada. Ábrela para responder.";
  if (selected.attentionMode === "AGENT")
    return "El agente está atendiendo esta conversación. Tómala para escribir como equipo.";
  return null;
}

export default function InboxPage(): React.JSX.Element {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [historicalSelected, setHistoricalSelected] = useState<HistoricalConversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [history, setHistory] = useState<ConversationHistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [attention, setAttention] = useState("");
  const [contactState, setContactState] = useState("ALL");
  const [contactId, setContactId] = useState<string | null>(null);
  const [appliedFilters, setAppliedFilters] = useState("");
  const [listCursors, setListCursors] = useState<readonly (string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listRefresh, setListRefresh] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [view, setView] = useState<InboxView>("ALL");
  const [mode, setMode] = useState<ComposerMode>("message");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickReply, setShowQuickReply] = useState(false);
  const [showDocumentComposer, setShowDocumentComposer] = useState(false);
  const [documentTemplates, setDocumentTemplates] = useState<DocumentTemplate[]>([]);
  const [preparedDocument, setPreparedDocument] = useState<CommercialDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const lastModalFocusRef = useRef<HTMLElement | null>(null);
  const selectionRef = useRef<string | null>(null);
  const threadRequestRef = useRef<AbortController | null>(null);
  const listCursor = listCursors.at(-1) ?? null;

  const relatedContacts = useConversationContacts([
    ...items.map((item) => item.conversation.contactId),
    selected?.contactId,
    historicalSelected?.contactId,
  ]);
  const contactById = relatedContacts.contacts;
  const assigneeById = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.id, assignee])),
    [assignees],
  );
  const activeContactId = selected?.contactId ?? historicalSelected?.contactId;
  const selectedContact = activeContactId ? contactById.get(activeContactId) : undefined;
  const selectedAssignee = selected?.assigneeMemberId
    ? assigneeById.get(selected.assigneeMemberId)
    : undefined;
  const messageBlocked = availabilityMessage(selected);
  const composerBlocked = mode === "message" ? messageBlocked : null;

  const loadThread = useCallback(async (id: string): Promise<void> => {
    const key = `QUANTUM:${id}`;
    if (selectionRef.current !== key) return;
    threadRequestRef.current?.abort();
    const controller = new AbortController();
    threadRequestRef.current = controller;
    setThreadBusy(true);
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error(await problem(response));
      const thread = ConversationThreadResponseSchema.parse(await response.json());
      if (controller.signal.aborted || selectionRef.current !== key) return;
      setSelected(thread.data.conversation);
      setMessages(thread.data.messages);
      setHistory(thread.data.history);
    } catch (cause) {
      if (!controller.signal.aborted && selectionRef.current === key) {
        setError(cause instanceof Error ? cause.message : "No fue posible abrir la conversación.");
      }
    } finally {
      if (!controller.signal.aborted && selectionRef.current === key) setThreadBusy(false);
    }
  }, []);

  function chooseConversation(item: UnifiedInboxItem): void {
    threadRequestRef.current?.abort();
    const key = `${item.source}:${item.conversation.id}`;
    selectionRef.current = key;
    setSelectedKey(key);
    setSelected(null);
    setMessages([]);
    setHistory([]);
    setDraft("");
    setError(null);
    setHistoricalSelected(item.source === "GHL" ? item.conversation : null);
    setThreadBusy(false);
    if (item.source === "QUANTUM") void loadThread(item.conversation.id);
  }

  async function refreshConversation(id: string): Promise<void> {
    setListRefresh((value) => value + 1);
    await loadThread(id);
  }

  useEffect(() => {
    if (!csrf) return;
    const controller = new AbortController();
    setLoading(true);
    setListError(null);
    const search = new URLSearchParams(appliedFilters);
    search.set("limit", "30");
    if (!search.has("contactState")) search.set("contactState", "ALL");
    if (contactId) search.set("contactId", contactId);
    if (listCursor) search.set("cursor", listCursor);
    void fetch(`/api/conversations/inbox?${search}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await problem(response));
      const result = UnifiedInboxListResponseSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setItems(result.data);
      setNextCursor(result.page.nextCursor);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setItems([]);
        setNextCursor(null);
        setListError(cause instanceof Error ? cause.message : "No fue posible cargar la bandeja.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [csrf, appliedFilters, contactId, listCursor, listRefresh]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    // Legacy ?history=1 links open this same inbox; only contactId narrows its list.
    const contact = new URLSearchParams(window.location.search).get("contactId");
    if (contact && /^[0-9a-f-]{36}$/iu.test(contact)) setContactId(contact);
    void (async () => {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        });
        if (sessionResponse.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/inbox");
          return;
        }
        const session = (await sessionResponse.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (controller.signal.aborted) return;
        setCsrf(session.csrfToken);
        const [contactResponse, assigneeResponse, replyResponse] = await Promise.all([
          fetch("/api/contacts", { cache: "no-store", credentials: "same-origin", signal }),
          fetch("/api/tasks/assignees", { cache: "no-store", credentials: "same-origin", signal }),
          fetch("/api/conversations/quick-replies", {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          }),
        ]);
        for (const response of [contactResponse, assigneeResponse, replyResponse])
          if (!response.ok) throw new Error(await problem(response));
        if (controller.signal.aborted) return;
        setContacts(((await contactResponse.json()) as List<Contact>).data);
        setAssignees(((await assigneeResponse.json()) as List<TaskAssignee>).data);
        setQuickReplies(((await replyResponse.json()) as List<QuickReply>).data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "No fue posible cargar la bandeja.");
          setLoading(false);
        }
      }
    })();
    return () => { controller.abort(); threadRequestRef.current?.abort(); };
    // La sesión y referencias se cargan una sola vez; los filtros se aplican explícitamente.
  }, []);

  useEffect(() => {
    if (!showCreate && !showQuickReply && !showDocumentComposer) return;

    lastModalFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusModal = (): void => {
      const focusable = modalRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    };
    const closeModal = (): void => {
      setShowCreate(false);
      setShowQuickReply(false);
      setShowDocumentComposer(false);
      setPreparedDocument(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [
        ...modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const frame = window.requestAnimationFrame(focusModal);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      lastModalFocusRef.current?.focus();
    };
  }, [saving, showCreate, showDocumentComposer, showQuickReply]);

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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
      formElement.reset();
      setView("ALL");
      setAppliedFilters("");
      setListCursors([null]);
      chooseConversation({ source: "QUANTUM", conversation: created.data });
      setListRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la conversación.");
    } finally {
      setSaving(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !draft.trim() || (mode === "message" && messageBlocked)) return;
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/conversations/${selected.id}/${mode === "note" ? "notes" : "messages"}`,
        mode === "note" ? { body: draft } : { body: draft, kind: "TEXT" },
        { version: selected.version },
      );
      setDraft("");
      await refreshConversation(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el mensaje.");
    } finally {
      setSaving(false);
    }
  }

  async function createQuickReply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate("/api/conversations/quick-replies", {
        title: String(form.get("title")),
        body: String(form.get("body")),
      });
      const created = (await response.json()) as { data: QuickReply };
      setQuickReplies((current) =>
        [...current, created.data].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setShowQuickReply(false);
      setDraft(created.data.body);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible guardar la respuesta rápida.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openDocumentComposer(): Promise<void> {
    setError(null);
    try {
      const response = await fetch("/api/documents/templates", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await problem(response));
      setDocumentTemplates(((await response.json()) as List<DocumentTemplate>).data);
      setPreparedDocument(null);
      setShowDocumentComposer(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar las plantillas.");
    }
  }

  async function createDocumentForConversation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !csrf) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          kind: form.get("kind"),
          title: form.get("title"),
          contactId: selected.contactId,
          templateId: form.get("templateId"),
        }),
      });
      if (!response.ok) throw new Error(await problem(response));
      setPreparedDocument(((await response.json()) as { data: CommercialDocument }).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible preparar el documento.");
    } finally {
      setSaving(false);
    }
  }

  async function updatePreparedBlocks(blocks: readonly DocumentBlock[]): Promise<boolean> {
    if (!preparedDocument || !csrf) return false;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${preparedDocument.id}`, {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf,
          "idempotency-key": crypto.randomUUID(),
          "if-match": `"${preparedDocument.version}"`,
        },
        body: JSON.stringify({ blocks }),
      });
      if (!response.ok) throw new Error(await problem(response));
      setPreparedDocument(((await response.json()) as { data: CommercialDocument }).data);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar los ajustes.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function queuePreparedDocument(): Promise<void> {
    if (!selected || !preparedDocument) return;
    setSaving(true);
    setError(null);
    try {
      if (!(await updatePreparedBlocks(preparedDocument.blocks))) return;
      await mutate(
        `/api/conversations/${selected.id}/messages`,
        {
          body: `Documento preparado: ${preparedDocument.title}`,
          kind: "DOCUMENT",
          documentId: preparedDocument.id,
        },
        { version: selected.version },
      );
      setShowDocumentComposer(false);
      setPreparedDocument(null);
      await refreshConversation(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible encolar el documento.");
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
      await refreshConversation(selected.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible actualizar la conversación.",
      );
    } finally {
      setSaving(false);
    }
  }

  function chooseView(nextView: InboxView): void {
    setView(nextView);
    setStatus("");
    setError(null);
    const filters = new URLSearchParams(appliedFilters);
    filters.delete("status");
    filters.delete("unassigned");
    if (nextView === "UNASSIGNED") filters.set("unassigned", "true");
    else if (nextView !== "ALL") filters.set("status", nextView);
    setAppliedFilters(filters.toString());
    setListCursors([null]);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setView("ALL");
    setError(null);
    const filters = new URLSearchParams({ contactState });
    if (query.trim()) filters.set("query", query.trim());
    if (channel) filters.set("channel", channel);
    if (status) filters.set("status", status);
    if (attention) filters.set("attentionMode", attention);
    setAppliedFilters(filters.toString());
    setListCursors([null]);
  }

  return (
    <CrmShell className={styles.shell ?? ""}>
      <section className={styles.workspace} aria-busy={loading}>
        <header className={styles.topbar}>
          <div className={styles.titleGroup}>
            <div>
              <h1>Conversaciones</h1>
            </div>
          </div>
          <div className={styles.topbarActions}>
            <span className={styles.liveSignal}>
              <span aria-hidden="true" /> Actualizado al abrir
            </span>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setShowCreate(true);
              }}
            >
              <Icon name="add" size={17} />
              Nueva conversación
            </button>
          </div>
        </header>

        {error ? (
          <div className={styles.alert} role="alert">
            <strong>No se pudo completar la acción.</strong>
            <span>{error}</span>
            <button type="button" aria-label="Cerrar aviso" onClick={() => setError(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : null}

          <section className={styles.inboxFrame} aria-label="Bandeja de conversaciones">
            <aside className={styles.viewsPanel} aria-label="Vistas de bandeja">
              <div className={styles.viewsBrand}>
                <span className={styles.viewsBrandIcon}>
                  <Icon name="inbox" size={18} />
                </span>
                <div>
                  <strong>Bandeja</strong>
                  <small>Atención central</small>
                </div>
              </div>

              <nav className={styles.viewNavigation} aria-label="Vistas rápidas">
                <p>Vistas rápidas</p>
                {(Object.keys(viewLabel) as InboxView[]).map((item) => {
                  return (
                    <button
                      key={item}
                      className={cx(styles.viewButton, view === item && styles.viewButtonActive)}
                      type="button"
                      aria-pressed={view === item}
                      onClick={() => chooseView(item)}
                    >
                      <span>{viewLabel[item]}</span>
                    </button>
                  );
                })}
              </nav>

              <div className={styles.viewsFooter}>
                <span className={styles.queueDot} aria-hidden="true" />
                <p>
                  Los canales externos se activan por proveedor. Los mensajes en cola permanecen
                  visibles aquí.
                </p>
              </div>
            </aside>

            <section className={styles.listPanel} aria-label="Lista de conversaciones">
              <div className={styles.listHeader}>
                <div>
                  <span className={styles.panelKicker}>{viewLabel[view]}</span>
                  <h2>Conversaciones</h2>
                </div>
                <button
                  className={cx(styles.iconButton, showFilters && styles.iconButtonActive)}
                  type="button"
                  aria-label={showFilters ? "Ocultar filtros" : "Mostrar filtros"}
                  aria-expanded={showFilters}
                  onClick={() => setShowFilters((current) => !current)}
                >
                  <Icon name="filter" size={17} />
                </button>
              </div>

              <form className={styles.searchForm} onSubmit={applyFilters}>
                <label className={styles.searchField}>
                  <Icon name="search" size={17} />
                  <span className="sr-only">Buscar conversaciones</span>
                  <input
                    type="search"
                    aria-label="Buscar conversaciones"
                    placeholder="Buscar por asunto o mensaje"
                    maxLength={160}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <button className={styles.searchSubmit} type="submit">
                  Buscar
                </button>
              </form>

              <label className={styles.contactFilter}>
                Vínculo del contacto
                <select
                  aria-label="Vínculo del contacto"
                  value={contactState}
                  onChange={(event) => {
                    setContactState(event.target.value);
                    const filters = new URLSearchParams(appliedFilters);
                    filters.set("contactState", event.target.value);
                    setAppliedFilters(filters.toString());
                    setListCursors([null]);
                  }}
                >
                  <option value="ALL">Todas las conversaciones</option>
                  <option value="LINKED">Con contacto</option>
                  <option value="UNLINKED">Sin contacto vinculado</option>
                </select>
              </label>
              {contactId ? (
                <button className={styles.clearContactFilter} type="button" onClick={() => {
                  setContactId(null);
                  setListCursors([null]);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("contactId");
                  window.history.replaceState(null, "", url);
                }}>Quitar filtro de contacto</button>
              ) : null}

              {showFilters ? (
                <form className={styles.filterDrawer} onSubmit={applyFilters}>
                  <label>
                    Canal
                    <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                      <option value="">Todos los canales</option>
                      <option value="EMAIL">Correo</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="WEBCHAT">Chat web</option>
                      <option value="SMS">SMS</option>
                    </select>
                  </label>
                  <label>
                    Estado
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="">Todos los estados</option>
                      <option value="OPEN">Abierta</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="ESCALATED">Escalada</option>
                      <option value="CLOSED">Cerrada</option>
                    </select>
                  </label>
                  <label>
                    Atención
                    <select
                      value={attention}
                      onChange={(event) => setAttention(event.target.value)}
                    >
                      <option value="">Humana y agente</option>
                      <option value="HUMAN">Equipo humano</option>
                      <option value="AGENT">Agente Quantum</option>
                    </select>
                  </label>
                  <button type="submit">Aplicar filtros</button>
                </form>
              ) : null}

              <div className={styles.conversationList} aria-live="polite">
                {listError ? (
                  <div className={styles.listState} role="alert">
                    <p>{listError}</p>
                    <button className={styles.outlineButton} type="button" onClick={() => setListRefresh((value) => value + 1)}>Reintentar</button>
                  </div>
                ) : null}
                {loading ? (
                  <div className={styles.listState}>
                    <span className={styles.spinner} aria-hidden="true" />
                    <strong>Cargando conversaciones</strong>
                    <p>Consultando la bandeja real.</p>
                  </div>
                ) : null}
                {!loading && !listError && items.length === 0 ? (
                  <div className={styles.listState}>
                    <span className={styles.emptyIcon}>
                      <Icon name="inbox" size={22} />
                    </span>
                    <strong>Esta vista está vacía</strong>
                    <p>Ajusta los filtros o inicia una conversación desde un contacto.</p>
                  </div>
                ) : null}
                {!loading
                  ? items.map((entry) => {
                      const item = entry.conversation;
                      const native = entry.source === "QUANTUM" ? entry.conversation : null;
                      const imported = entry.source === "GHL" ? entry.conversation : null;
                      const key = `${entry.source}:${item.id}`;
                      const contact = item.contactId ? contactById.get(item.contactId) : undefined;
                      const title = imported ? historicalThreadTitle(imported, contact?.displayName) : contact?.displayName ?? item.subject ?? "Contacto vinculado";
                      const assignee = native?.assigneeMemberId
                        ? assigneeById.get(native.assigneeMemberId)
                        : undefined;
                      return (
                        <button
                          key={key}
                          data-source={entry.source}
                          data-conversation-id={item.id}
                          disabled={saving}
                          className={cx(
                            styles.conversationCard,
                            key === selectedKey && styles.conversationCardActive,
                          )}
                          type="button"
                          aria-current={key === selectedKey ? "true" : undefined}
                          onClick={() => chooseConversation(entry)}
                        >
                          <span className={styles.avatar}>
                            {initials(contact?.displayName ?? (item.contactId ? "Contacto" : "Sin vínculo"))}
                          </span>
                          <span className={styles.cardBody}>
                            <span className={styles.cardLine}>
                              <strong>{title}</strong>
                              <time>{when(item.lastMessageAt ?? imported?.sourceCreatedAt ?? null)}</time>
                            </span>
                            <span className={styles.cardPreview}>
                              {native?.lastMessagePreview ?? item.subject ?? (imported ? `${imported.messageCount} mensajes` : "Sin mensajes")}
                            </span>
                            <span className={styles.cardMeta}>
                              {native ? (
                                <>
                                  <span className={styles.channelTag}>{channelShortLabel[native.channel]}</span>
                                  <span className={cx(styles.statusTag, statusClass[native.status])}>{statusLabel[native.status]}</span>
                                </>
                              ) : imported ? (
                                <>
                                  <HistoricalChannelBadge rawChannel={imported.rawChannel} />
                                  <span className={styles.sourceTag}>GHL</span>
                                  {!imported.contactId ? <span className={styles.sourceTag}>Sin contacto vinculado</span> : null}
                                </>
                              ) : null}
                              {assignee ? (
                                <span className={styles.assigneeTag}>{assignee.displayName}</span>
                              ) : null}
                              {native && native.unreadCount > 0 ? (
                                <span className={styles.unreadBadge}>{native.unreadCount}</span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  : null}
              </div>
              <nav className={styles.pagination} aria-label="Páginas de conversaciones">
                <button className={styles.outlineButton} type="button" disabled={loading || listCursors.length < 2}
                  onClick={() => setListCursors((values) => values.slice(0, -1))}>Anterior</button>
                <span>Página {listCursors.length}</span>
                <button className={styles.outlineButton} type="button" disabled={loading || !nextCursor}
                  onClick={() => { if (nextCursor) setListCursors((values) => [...values, nextCursor]); }}>Siguiente</button>
              </nav>
            </section>

            <section className={styles.threadPanel} aria-label="Conversación seleccionada">
              {historicalSelected ? (
                <HistoricalThread key={`GHL:${historicalSelected.id}`} conversation={historicalSelected} contactName={selectedContact?.displayName} />
              ) : threadBusy ? (
                <div className={styles.threadEmpty} role="status">Cargando conversación…</div>
              ) : selected ? (
                <>
                  <header className={styles.threadHeader}>
                    <div className={styles.threadIdentity}>
                      <span className={cx(styles.avatar, styles.avatarLarge)}>
                        {initials(selectedContact?.displayName ?? "Contacto")}
                      </span>
                      <div>
                        <span className={styles.threadKicker}>
                          <span className={styles.channelTag}>
                            {channelLabel[selected.channel]}
                          </span>
                          {selected.attentionMode === "AGENT" ? (
                            <span className={styles.agentInline}>
                              <Icon name="spark" size={12} /> Agente
                            </span>
                          ) : null}
                        </span>
                        <h2>{selectedContact?.displayName ?? "Contacto"}</h2>
                        <p>{selected.subject ?? "Conversación sin asunto"}</p>
                      </div>
                    </div>
                    <div className={styles.threadActions}>
                      <span className={cx(styles.statusTag, statusClass[selected.status])}>
                        {statusLabel[selected.status]}
                      </span>
                      <button
                        className={styles.outlineButton}
                        type="button"
                        disabled={saving || selected.status === "CLOSED"}
                        onClick={() => void update({ status: "CLOSED" })}
                      >
                        Cerrar
                      </button>
                    </div>
                  </header>

                  <div className={styles.messageScroll} aria-live="polite">
                    {messages.length === 0 ? (
                      <div className={styles.messageEmpty}>
                        <span className={styles.emptyIcon}>
                          <Icon name="message" size={22} />
                        </span>
                        <strong>Sin mensajes todavía</strong>
                        <p>Escribe la primera respuesta para dejar una trazabilidad real.</p>
                      </div>
                    ) : (
                      messages.map((item, index) => (
                        <div key={item.id}>
                          {!sameDay(item, messages[index - 1]) ? (
                            <div className={styles.dayDivider}>
                              <span>{day(item.createdAt)}</span>
                            </div>
                          ) : null}
                          <article
                            className={cx(
                              styles.messageRow,
                              item.direction === "OUTBOUND" && styles.messageRowOutbound,
                              item.direction === "INTERNAL" && styles.messageRowInternal,
                            )}
                          >
                            <div className={styles.messageMeta}>
                              <span>{authorLabel(item)}</span>
                              <time>{time(item.createdAt)}</time>
                            </div>
                            <div className={styles.messageBubble}>
                              {item.kind === "DOCUMENT" && item.documentSnapshot ? (
                                <div className={styles.documentMessage}>
                                  <span>
                                    <Icon name="document" size={16} />
                                  </span>
                                  <div>
                                    <strong>{item.documentSnapshot.title}</strong>
                                    <small>
                                      Documento preparado · revisión{" "}
                                      {item.documentSnapshot.revision}
                                    </small>
                                  </div>
                                </div>
                              ) : null}
                              <p>{item.body}</p>
                              <footer>
                                <span>{deliveryLabel[item.deliveryStatus]}</span>
                                {item.failureCode ? <span>{item.failureCode}</span> : null}
                              </footer>
                            </div>
                          </article>
                        </div>
                      ))
                    )}
                  </div>

                  <form className={styles.composer} onSubmit={(event) => void send(event)}>
                    <div className={styles.composerMode}>
                      <div role="tablist" aria-label="Tipo de respuesta">
                        <button
                          className={mode === "message" ? styles.modeActive : undefined}
                          type="button"
                          role="tab"
                          aria-selected={mode === "message"}
                          onClick={() => setMode("message")}
                        >
                          <Icon name="message" size={15} /> Responder
                        </button>
                        <button
                          className={mode === "note" ? styles.modeNoteActive : undefined}
                          type="button"
                          role="tab"
                          aria-selected={mode === "note"}
                          onClick={() => setMode("note")}
                        >
                          <Icon name="note" size={15} /> Nota interna
                        </button>
                      </div>
                      {mode === "note" ? (
                        <span className={styles.noteHint}>Solo la ve el equipo</span>
                      ) : null}
                    </div>

                    {composerBlocked ? (
                      <div className={styles.composerBlocked}>
                        <Icon
                          name={selected.attentionMode === "AGENT" ? "agent" : "inbox"}
                          size={18}
                        />
                        <span>{composerBlocked}</span>
                        {selected.attentionMode === "AGENT" ? (
                          <button
                            type="button"
                            onClick={() => void update({ attentionMode: "HUMAN" })}
                            disabled={saving}
                          >
                            Tomar conversación
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void update({ status: "OPEN" })}
                            disabled={saving}
                          >
                            Reabrir
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <textarea
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder={
                            mode === "note"
                              ? "Escribe una nota para el equipo…"
                              : `Responder por ${channelLabel[selected.channel]}…`
                          }
                          maxLength={16000}
                        />
                        <footer className={styles.composerFooter}>
                          <div className={styles.composerTools}>
                            <button
                              className={styles.toolButton}
                              type="button"
                              disabled={saving || !csrf || Boolean(messageBlocked)}
                              onClick={() => void openDocumentComposer()}
                            >
                              <Icon name="document" size={16} /> Documento
                            </button>
                            <label className={styles.quickReplySelect}>
                              <span className="sr-only">Insertar respuesta rápida</span>
                              <select
                                aria-label="Insertar respuesta rápida"
                                defaultValue=""
                                onChange={(event) => {
                                  const reply = quickReplies.find(
                                    (item) => item.id === event.target.value,
                                  );
                                  if (reply) setDraft(reply.body);
                                  event.target.value = "";
                                }}
                              >
                                <option value="">Respuestas rápidas</option>
                                {quickReplies.map((reply) => (
                                  <option key={reply.id} value={reply.id}>
                                    {reply.title}
                                  </option>
                                ))}
                              </select>
                              <Icon name="chevron" size={15} />
                            </label>
                            <button
                              className={styles.toolButton}
                              type="button"
                              onClick={() => setShowQuickReply(true)}
                              disabled={saving || !csrf}
                            >
                              <Icon name="add" size={15} /> Guardar rápida
                            </button>
                          </div>
                          <button
                            className={styles.sendButton}
                            disabled={saving || !draft.trim()}
                            type="submit"
                          >
                            {mode === "note" ? "Guardar nota" : "Enviar"}
                            <Icon name={mode === "note" ? "arrow" : "send"} size={16} />
                          </button>
                        </footer>
                        {mode === "message" ? <p className={styles.composerNotice}>El envío externo está pendiente de conexión del canal. Los mensajes preparados quedan en cola.</p> : null}
                      </>
                    )}
                  </form>
                </>
              ) : (
                <div className={styles.threadEmpty}>
                  <span className={styles.emptyIcon}>
                    <Icon name="message" size={25} />
                  </span>
                  <h2>Elige una conversación</h2>
                  <p>El hilo, su estado y los controles de atención aparecerán aquí.</p>
                </div>
              )}
            </section>

            <aside className={styles.contextPanel} aria-label="Contexto de conversación">
              {historicalSelected ? (
                <>
                  <header className={styles.contextHeader}><span className={styles.panelKicker}>Contexto</span></header>
                  <SourceParticipantsCard participants={historicalSelected.sourceParticipants} kind="conversación" />
                  <ConversationContactCard
                    contact={selectedContact}
                    linked={Boolean(historicalSelected.contactId)}
                    loading={Boolean(historicalSelected.contactId) && relatedContacts.loading}
                    error={historicalSelected.contactId ? relatedContacts.error : null}
                  />
                  <section className={styles.contextFacts}>
                    <div><span>Origen</span><strong>GHL · Solo lectura</strong></div>
                    <div><span>Estado original</span><strong>{historicalSelected.rawStatus || "No informado"}</strong></div>
                    <div><span>Última actividad</span><strong>{when(historicalSelected.lastMessageAt)}</strong></div>
                  </section>
                </>
              ) : selected ? (
                <>
                  <header className={styles.contextHeader}>
                    <span className={styles.panelKicker}>Contexto</span>
                  </header>

                  <ConversationContactCard
                    contact={selectedContact}
                    linked={true}
                    loading={relatedContacts.loading}
                    error={relatedContacts.error}
                  />

                  <section className={styles.controlSection}>
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
                      Estado de conversación
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
                  </section>

                  <section className={styles.attentionCard}>
                    <div>
                      <span className={styles.attentionIcon}>
                        <Icon
                          name={selected.attentionMode === "HUMAN" ? "user" : "agent"}
                          size={17}
                        />
                      </span>
                      <div>
                        <span>Atención actual</span>
                        <strong>
                          {selected.attentionMode === "HUMAN" ? "Equipo humano" : "Agente Quantum"}
                        </strong>
                      </div>
                    </div>
                    <button
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
                      <Icon name="arrow" size={15} />
                    </button>
                  </section>

                  <section className={styles.contextFacts}>
                    <div>
                      <span>Canal</span>
                      <strong>{channelLabel[selected.channel]}</strong>
                    </div>
                    <div>
                      <span>Responsable</span>
                      <strong>{selectedAssignee?.displayName ?? "Sin asignar"}</strong>
                    </div>
                    <div>
                      <span>Última actividad</span>
                      <strong>{when(selected.lastMessageAt)}</strong>
                    </div>
                  </section>

                  <section className={styles.activitySection}>
                    <div className={styles.sectionHeading}>
                      <h3>Actividad</h3>
                      <span>{history.length}</span>
                    </div>
                    {history.length ? (
                      <ol className={styles.activityList}>
                        {history
                          .slice(-6)
                          .reverse()
                          .map((entry) => (
                            <li key={entry.id}>
                              <span />
                              <div>
                                <strong>{historyLabel[entry.eventType]}</strong>
                                <p>
                                  {entry.previousValue && entry.nextValue
                                    ? `${entry.previousValue} → ${entry.nextValue}`
                                    : (entry.nextValue ?? entry.previousValue ?? "Registrado")}
                                </p>
                                <time>{when(entry.createdAt)}</time>
                              </div>
                            </li>
                          ))}
                      </ol>
                    ) : (
                      <p className={styles.activityEmpty}>Aún no hay actividad adicional.</p>
                    )}
                  </section>

                  <p className={styles.queueNotice}>
                    <Icon name="inbox" size={15} />
                    Los mensajes quedan registrados. La entrega externa se confirmará cuando el
                    proveedor del canal esté configurado.
                  </p>
                </>
              ) : (
                <div className={styles.contextEmpty}>
                  <Icon name="user" size={22} />
                  <p>Selecciona un hilo para ver el contacto, la asignación y la actividad.</p>
                </div>
              )}
            </aside>
          </section>
      </section>

      {showCreate ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) setShowCreate(false);
          }}
        >
          <section
            ref={modalRef}
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-conversation-title"
          >
            <header>
              <div>
                <span className={styles.productEyebrow}>Nuevo hilo</span>
                <h2 id="new-conversation-title">Iniciar conversación</h2>
                <p>
                  El mensaje se registra inmediatamente. Los canales externos se entregan al
                  configurar su proveedor.
                </p>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Cerrar"
                onClick={() => setShowCreate(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            <form className={styles.modalForm} onSubmit={(event) => void createConversation(event)}>
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
              <label className={styles.modalWide}>
                Asunto
                <input
                  name="subject"
                  maxLength={240}
                  placeholder="Ej. Consulta sobre disponibilidad"
                />
              </label>
              <label className={styles.modalWide}>
                Mensaje
                <textarea
                  name="initialMessage"
                  required
                  maxLength={16000}
                  placeholder="Escribe el primer mensaje…"
                />
              </label>
              <footer>
                <button
                  className={styles.outlineButton}
                  type="button"
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </button>
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  Crear conversación <Icon name="arrow" size={16} />
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {showQuickReply ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) setShowQuickReply(false);
          }}
        >
          <section
            ref={modalRef}
            className={cx(styles.modal, styles.quickReplyModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-reply-title"
          >
            <header>
              <div>
                <span className={styles.productEyebrow}>Respuesta rápida</span>
                <h2 id="quick-reply-title">Guardar para el equipo</h2>
                <p>Quedará disponible al redactar respuestas en esta bandeja.</p>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Cerrar"
                onClick={() => setShowQuickReply(false)}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            <form className={styles.modalForm} onSubmit={(event) => void createQuickReply(event)}>
              <label>
                Nombre de la respuesta
                <input
                  name="title"
                  required
                  maxLength={120}
                  placeholder="Ej. Solicitar documentos"
                />
              </label>
              <label className={styles.modalWide}>
                Contenido
                <textarea
                  name="body"
                  required
                  maxLength={16000}
                  defaultValue={draft}
                  placeholder="Texto que insertará el equipo…"
                />
              </label>
              <footer>
                <button
                  className={styles.outlineButton}
                  type="button"
                  onClick={() => setShowQuickReply(false)}
                >
                  Cancelar
                </button>
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  Guardar rápida <Icon name="arrow" size={16} />
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {showDocumentComposer && selected ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) {
              setShowDocumentComposer(false);
              setPreparedDocument(null);
            }
          }}
        >
          <section
            ref={modalRef}
            className={cx(styles.modal, styles.documentModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-composer-title"
          >
            <header>
              <div>
                <span className={styles.productEyebrow}>
                  Documento para {selectedContact?.displayName ?? "el contacto"}
                </span>
                <h2 id="document-composer-title">
                  {preparedDocument ? "Revisa lo que se enviará" : "Elegir una plantilla"}
                </h2>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Cerrar"
                disabled={saving}
                onClick={() => {
                  setShowDocumentComposer(false);
                  setPreparedDocument(null);
                }}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            {preparedDocument ? (
              <>
                <p className={styles.documentIntro}>
                  Los valores e imágenes autorizados por la plantilla pueden ajustarse antes de
                  dejar el documento en cola.
                </p>
                <div className={styles.documentFields}>
                  {preparedDocument.blocks.map((block) => {
                    if (block.type === "VARIABLE" && block.editable)
                      return (
                        <label key={block.id}>
                          {block.label}
                          <input
                            value={block.value ?? ""}
                            disabled={saving}
                            onChange={(event) =>
                              setPreparedDocument((current) =>
                                current
                                  ? {
                                      ...current,
                                      blocks: current.blocks.map((candidate) =>
                                        candidate.id === block.id && candidate.type === "VARIABLE"
                                          ? { ...candidate, value: event.target.value }
                                          : candidate,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                      );
                    if (block.type === "IMAGE" && block.replaceable)
                      return (
                        <label key={block.id} className={styles.toggleField}>
                          <input
                            type="checkbox"
                            checked={block.visible}
                            disabled={saving}
                            onChange={(event) =>
                              setPreparedDocument((current) =>
                                current
                                  ? {
                                      ...current,
                                      blocks: current.blocks.map((candidate) =>
                                        candidate.id === block.id && candidate.type === "IMAGE"
                                          ? { ...candidate, visible: event.target.checked }
                                          : candidate,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          Incluir imagen: {block.label}
                        </label>
                      );
                    return null;
                  })}
                </div>
                <footer className={styles.documentFooter}>
                  <button
                    className={styles.outlineButton}
                    type="button"
                    disabled={saving}
                    onClick={() => void updatePreparedBlocks(preparedDocument.blocks)}
                  >
                    Guardar ajustes
                  </button>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    disabled={saving}
                    onClick={() => void queuePreparedDocument()}
                  >
                    Encolar documento <Icon name="arrow" size={16} />
                  </button>
                </footer>
              </>
            ) : documentTemplates.length ? (
              <form
                className={styles.modalForm}
                onSubmit={(event) => void createDocumentForConversation(event)}
              >
                <label className={styles.modalWide}>
                  Plantilla
                  <select name="templateId" required defaultValue="">
                    <option value="" disabled>
                      Selecciona una plantilla
                    </option>
                    {documentTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.modalWide}>
                  Título del documento
                  <input name="title" required maxLength={240} defaultValue="Propuesta comercial" />
                </label>
                <input name="kind" type="hidden" value="QUOTE" />
                <footer>
                  <button
                    className={styles.outlineButton}
                    type="button"
                    onClick={() => setShowDocumentComposer(false)}
                  >
                    Cancelar
                  </button>
                  <button className={styles.primaryButton} type="submit" disabled={saving}>
                    Preparar para revisar <Icon name="arrow" size={16} />
                  </button>
                </footer>
              </form>
            ) : (
              <div className={styles.noTemplates}>
                <Icon name="document" size={23} />
                <strong>No hay plantillas disponibles</strong>
                <p>Crea una desde Documentos para prepararla desde una conversación.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </CrmShell>
  );
}
