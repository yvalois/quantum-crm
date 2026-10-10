"use client";

import type { Automation, Contact, ContactImportPreviewRow } from "@quantum-crm/contracts";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CrmShell } from "../crm-shell";

type WorkspaceView = "all" | "unassigned" | "archived";
type ContactTab =
  "activity" | "conversations" | "opportunities" | "tasks" | "appointments" | "documents";
type BulkAction = "" | "ASSIGN" | "ADD_LABEL" | "REMOVE_LABEL" | "ARCHIVE" | "RESTORE";
type IconName =
  | "archive"
  | "arrow"
  | "bolt"
  | "calendar"
  | "check"
  | "chevron"
  | "close"
  | "download"
  | "filter"
  | "mail"
  | "phone"
  | "plus"
  | "refresh"
  | "search"
  | "tag"
  | "upload"
  | "user";

interface ContactLabel {
  readonly id: string;
  readonly name: string;
  readonly color?: string | null;
}

interface ContactOwner {
  readonly id: string;
  readonly displayName: string;
}

interface WorkspaceContact extends Contact {
  readonly owner?: ContactOwner | null;
}

interface MemberOption {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
}

interface PipelineOption {
  readonly id: string;
  readonly name: string;
}

interface PageInfo {
  readonly nextCursor?: string | null;
  readonly previousCursor?: string | null;
  readonly total?: number | null;
}

interface ContactListPayload {
  readonly data: WorkspaceContact[];
  readonly page?: PageInfo;
}

interface ContactFilters {
  readonly q: string;
  readonly label: string;
  readonly pipelineId: string;
  readonly ownerMemberId: string;
  readonly assignment: "" | "UNASSIGNED";
  readonly channel: "" | "EMAIL" | "PHONE" | "NONE";
  readonly source: string;
  readonly createdFrom: string;
  readonly createdTo: string;
  readonly archived: "" | "true" | "false";
  readonly sort: "UPDATED_DESC" | "CREATED_DESC" | "NAME_ASC";
}

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface RelationItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly occurredAt?: string | null;
  readonly status?: string | null;
  readonly href: string;
}

interface ContactRelations {
  readonly activity: readonly RelationItem[];
  readonly conversations: readonly RelationItem[];
  readonly opportunities: readonly RelationItem[];
  readonly tasks: readonly RelationItem[];
  readonly appointments: readonly RelationItem[];
  readonly documents: readonly RelationItem[];
}

interface ComposerState {
  readonly mode: "create" | "edit";
  readonly contact?: WorkspaceContact;
}

interface ImportFile {
  readonly fileName: string;
  readonly contentBase64: string;
}

interface AutomationRun {
  readonly fingerprint: string;
  readonly batchKeys: Map<number, string>;
}

interface AutomationCreateRun {
  readonly fingerprint: string;
  readonly operationKey: string;
}

interface FilterSelection {
  readonly filters: ContactFilters;
  readonly total: number;
}

interface BulkActionRun {
  readonly fingerprint: string;
  readonly operationKey: string;
}

const emptyFilters: ContactFilters = {
  q: "",
  label: "",
  pipelineId: "",
  ownerMemberId: "",
  assignment: "",
  channel: "",
  source: "",
  createdFrom: "",
  createdTo: "",
  archived: "false",
  sort: "UPDATED_DESC",
};

function contactQuery(
  filters: ContactFilters,
  cursor: string | null = null,
  limit = 50,
): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.q.trim()) query.set("q", filters.q.trim());
  if (filters.label) query.set("label", filters.label);
  if (filters.pipelineId) query.set("pipelineId", filters.pipelineId);
  if (filters.ownerMemberId) query.set("ownerMemberId", filters.ownerMemberId);
  if (filters.assignment) query.set("assignment", filters.assignment);
  if (filters.channel) query.set("channel", filters.channel);
  if (filters.source) query.set("source", filters.source);
  if (filters.createdFrom) query.set("createdFrom", `${filters.createdFrom}T00:00:00.000Z`);
  if (filters.createdTo) query.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  if (filters.archived) query.set("archived", filters.archived);
  query.set("sort", filters.sort);
  query.set("limit", String(limit));
  if (cursor) query.set("cursor", cursor);
  return query;
}

function bulkFilterPayload(filters: ContactFilters): Readonly<Record<string, string>> {
  const filter: Record<string, string> = {};
  if (filters.q.trim()) filter.q = filters.q.trim();
  if (filters.label) filter.label = filters.label;
  if (filters.pipelineId) filter.pipelineId = filters.pipelineId;
  if (filters.ownerMemberId) filter.ownerMemberId = filters.ownerMemberId;
  if (filters.assignment) filter.assignment = filters.assignment;
  if (filters.channel) filter.channel = filters.channel;
  if (filters.source) filter.source = filters.source;
  if (filters.createdFrom) filter.createdFrom = `${filters.createdFrom}T00:00:00.000Z`;
  if (filters.createdTo) filter.createdTo = `${filters.createdTo}T23:59:59.999Z`;
  if (filters.archived) filter.archived = filters.archived;
  return Object.freeze(filter);
}

const tabs: readonly {
  readonly id: ContactTab;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { id: "activity", label: "Actividad", icon: "bolt" },
  { id: "conversations", label: "Conversaciones", icon: "mail" },
  { id: "opportunities", label: "Oportunidades", icon: "arrow" },
  { id: "tasks", label: "Tareas", icon: "check" },
  { id: "appointments", label: "Citas", icon: "calendar" },
  { id: "documents", label: "Documentos", icon: "archive" },
];

const iconPaths: Readonly<Record<IconName, readonly string[]>> = {
  archive: ["M4 7h16v13H4z", "M3 4h18v3H3z", "M9 11h6"],
  arrow: ["M5 12h13", "m14 7 5 5-5 5"],
  bolt: ["m13 2-8 12h6l-1 8 9-13h-6l0-7Z"],
  calendar: ["M5 5h14v14H5z", "M8 3v4", "M16 3v4", "M5 9h14", "M8 13h2", "M14 13h2"],
  check: ["M5 12.5 9.2 17 19 7"],
  chevron: ["m9 6 6 6-6 6"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 20h14"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  mail: ["M4 5h16v14H4z", "m4 7 8 6 8-6"],
  phone: [
    "M8 4 5.4 5.2c-.7.3-1.1 1.1-.9 1.8 1.4 5.5 5.8 9.9 11.3 11.3.7.2 1.5-.2 1.8-.9L19 15l-3.1-2-1.5 1.7c-2.1-1.1-3.9-2.9-5-5L11.1 8 8 4Z",
  ],
  plus: ["M12 5v14", "M5 12h14"],
  refresh: ["M19 8V4l-2 2a7 7 0 1 0 1.8 8", "M5 16v4l2-2"],
  search: ["m20 20-4.4-4.4", "M10.8 17a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4Z"],
  tag: ["M4 4h8l8 8-8 8-8-8V4Z", "M8 8h.01"],
  upload: ["M12 21V9", "m7 14 5-5 5 5", "M5 4h14"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4.5 21a7.5 7.5 0 0 1 15 0"],
};

function Icon({
  name,
  size = 18,
}: {
  readonly name: IconName;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function responseMessage(
  response: Response,
  fallback = "No fue posible completar la solicitud.",
): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return isRecord(payload) && typeof payload.title === "string" ? payload.title : fallback;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "--"
  );
}

function dateText(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("es-CO", options).format(new Date(value));
}

function relativeDate(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Sin actividad";
  const hours = Math.round((Date.now() - Date.parse(value)) / 3_600_000);
  if (hours <= 0) return "Ahora";
  if (hours === 1) return "Hace 1 hora";
  if (hours < 24) return `Hace ${hours} horas`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Ayer" : `Hace ${days} días`;
}

function sourceLabel(source: string | null | undefined): string {
  const names: Readonly<Record<string, string>> = {
    API: "API",
    CONVERSATION: "Conversación",
    FORM: "Formulario",
    IMPORT: "Importación",
    MANUAL: "Manual",
  };
  return source ? (names[source.toUpperCase()] ?? source) : "Manual";
}

function importErrorLabel(code: string): string {
  const labels: Readonly<Record<string, string>> = {
    contact_channel_required: "Agrega correo o teléfono",
    display_name_invalid: "El nombre no es válido",
    email_invalid: "El correo no es válido",
    phone_invalid: "El teléfono no es válido",
    row_number_invalid: "La fila no es válida",
  };
  return labels[code] ?? code;
}

function toRelations(payload: unknown, href: string): readonly RelationItem[] {
  const values = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return values.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    return [
      {
        id: text(value.id) ?? `${href}-${index}`,
        title:
          text(value.title) ??
          text(value.subject) ??
          text(value.name) ??
          text(value.lastMessagePreview) ??
          "Sin título",
        subtitle:
          text(value.lastMessagePreview) ??
          text(value.description) ??
          text(value.preview) ??
          text(value.email) ??
          text(value.phone),
        occurredAt:
          text(value.lastMessageAt) ??
          text(value.updatedAt) ??
          text(value.createdAt) ??
          text(value.startsAt) ??
          text(value.dueAt),
        status: text(value.status),
        href,
      },
    ];
  });
}

function RelationList({
  items,
  empty,
  icon,
}: {
  readonly items: readonly RelationItem[];
  readonly empty: string;
  readonly icon: IconName;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="contact-workspace-empty-relation">
        <span>
          <Icon name={icon} size={19} />
        </span>
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <ul className="contact-workspace-relation-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="contact-workspace-relation-mark">
            <Icon name={icon} size={15} />
          </span>
          <div>
            <strong>{item.title}</strong>
            {item.subtitle ? <span>{item.subtitle}</span> : null}
            {item.occurredAt ? (
              <small>
                {dateText(item.occurredAt, { dateStyle: "medium", timeStyle: "short" })}
              </small>
            ) : null}
          </div>
          {item.status ? <em>{item.status}</em> : null}
          <a href={item.href}>Abrir</a>
        </li>
      ))}
    </ul>
  );
}

export function ContactsWorkspacePanel(): React.JSX.Element {
  const [contacts, setContacts] = useState<WorkspaceContact[]>([]);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [labels, setLabels] = useState<ContactLabel[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [draftFilters, setDraftFilters] = useState<ContactFilters>(emptyFilters);
  const [activeFilters, setActiveFilters] = useState<ContactFilters>(emptyFilters);
  const [activeView, setActiveView] = useState<WorkspaceView>("all");
  const [page, setPage] = useState<PageInfo>({});
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterSelection, setFilterSelection] = useState<FilterSelection | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>("");
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selectedContact, setSelectedContact] = useState<WorkspaceContact | null>(null);
  const [relations, setRelations] = useState<ContactRelations | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [unavailableRelationTabs, setUnavailableRelationTabs] = useState<ReadonlySet<ContactTab>>(
    new Set<ContactTab>(),
  );
  const [activeTab, setActiveTab] = useState<ContactTab>("activity");
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [importFile, setImportFile] = useState<ImportFile | null>(null);
  const [importRows, setImportRows] = useState<ContactImportPreviewRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [selectedAutomationId, setSelectedAutomationId] = useState("");
  const [automationCreateOpen, setAutomationCreateOpen] = useState(false);
  const [automationCreateBusy, setAutomationCreateBusy] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const requestNumber = useRef(0);
  const relationRequestNumber = useRef(0);
  const selectedFilterKey = useRef<string | null>(null);
  const automationRun = useRef<AutomationRun | null>(null);
  const automationCreateRun = useRef<AutomationCreateRun | null>(null);
  const bulkActionRun = useRef<BulkActionRun | null>(null);

  const selectedCount = filterSelection?.total ?? selectedIds.size;
  const importErrors = importRows.filter((row) => row.status === "ERROR");
  const visibleIds = useMemo(() => contacts.map((contact) => contact.id), [contacts]);
  const activeAutomations = useMemo(
    () => automations.filter((item) => item.status === "ACTIVE"),
    [automations],
  );
  const unavailableComposerOwner = useMemo(() => {
    const contact = composer?.mode === "edit" ? composer.contact : undefined;
    if (!contact?.ownerMemberId || members.some((member) => member.id === contact.ownerMemberId))
      return null;
    return {
      id: contact.ownerMemberId,
      displayName: contact.owner?.displayName ?? "Responsable actual",
    };
  }, [composer, members]);
  const ownerFor = useCallback(
    (contact: WorkspaceContact): ContactOwner | null =>
      contact.owner ??
      members.find((member) => member.id === contact.ownerMemberId) ??
      (contact.ownerMemberId
        ? { id: contact.ownerMemberId, displayName: "Responsable asignado" }
        : null),
    [members],
  );

  const loadContacts = useCallback(
    async (filters: ContactFilters, cursor: string | null = null, silent = false) => {
      const requestId = requestNumber.current + 1;
      requestNumber.current = requestId;
      if (!silent) setLoading(true);
      const query = contactQuery(filters, cursor);
      const filterKey = contactQuery(filters).toString();
      try {
        const response = await fetch(`/api/contacts?${query.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/contacts");
          return;
        }
        if (!response.ok)
          throw new Error(await responseMessage(response, "No fue posible cargar los contactos."));
        const payload = (await response.json()) as ContactListPayload;
        if (requestNumber.current !== requestId) return;
        const data = Array.isArray(payload.data) ? payload.data : [];
        setContacts(data);
        setPage(payload.page ?? {});
        setCurrentCursor(cursor);
        setActiveFilters(filters);
        if (selectedFilterKey.current !== filterKey) {
          setSelectedIds(new Set());
          setFilterSelection(null);
          bulkActionRun.current = null;
        }
        selectedFilterKey.current = filterKey;
      } catch (cause) {
        if (requestNumber.current === requestId)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar los contactos.");
      } finally {
        if (requestNumber.current === requestId && !silent) setLoading(false);
      }
    },
    [],
  );

  const loadRelations = useCallback(async (contact: WorkspaceContact) => {
    const requestId = relationRequestNumber.current + 1;
    relationRequestNumber.current = requestId;
    setRelationsLoading(true);
    setRelationsError(null);
    setRelations(null);
    setUnavailableRelationTabs(new Set<ContactTab>());
    const id = encodeURIComponent(contact.id);
    try {
      const [
        conversationResponse,
        documentResponse,
        opportunityResponse,
        taskResponse,
        appointmentResponse,
      ] = await Promise.all([
        fetch(`/api/conversations?contactId=${id}&limit=50`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch(`/api/documents?contactId=${id}`, { cache: "no-store", credentials: "same-origin" }),
        fetch(`/api/opportunities?contactId=${id}`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
        fetch(`/api/tasks?contactId=${id}`, { cache: "no-store", credentials: "same-origin" }),
        fetch(`/api/calendar/events?contactId=${id}`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);
      if (relationRequestNumber.current !== requestId) return;
      const responses = [
        { tab: "conversations" as const, response: conversationResponse },
        { tab: "documents" as const, response: documentResponse },
        { tab: "opportunities" as const, response: opportunityResponse },
        { tab: "tasks" as const, response: taskResponse },
        { tab: "appointments" as const, response: appointmentResponse },
      ];
      if (responses.some(({ response }) => response.status === 401)) {
        window.location.assign("/api/auth/login?returnTo=/contacts");
        return;
      }
      const unavailable = new Set<ContactTab>();
      const payloads = await Promise.all(
        responses.map(async ({ tab, response }) => {
          if (!response.ok) {
            unavailable.add(tab);
            return null;
          }
          try {
            return await response.json();
          } catch {
            unavailable.add(tab);
            return null;
          }
        }),
      );
      if (relationRequestNumber.current !== requestId) return;
      const [conversations, documents, opportunities, tasks, appointments] = payloads;
      const collections = {
        conversations: toRelations(conversations, "/inbox"),
        documents: toRelations(documents, "/documents"),
        opportunities: toRelations(opportunities, "/pipeline"),
        tasks: toRelations(tasks, "/tasks"),
        appointments: toRelations(appointments, "/calendar"),
      };
      const activity = Object.values(collections)
        .flat()
        .sort(
          (left, right) => Date.parse(right.occurredAt ?? "") - Date.parse(left.occurredAt ?? ""),
        );
      setRelations({ ...collections, activity });
      setUnavailableRelationTabs(unavailable);
    } catch (cause) {
      if (relationRequestNumber.current === requestId) {
        setRelationsError(
          cause instanceof Error
            ? cause.message
            : "No fue posible cargar las relaciones del contacto.",
        );
      }
    } finally {
      if (relationRequestNumber.current === requestId) setRelationsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (sessionResponse.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/contacts");
          return;
        }
        const session = (await sessionResponse.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (!mounted) return;
        setCsrfToken(session.csrfToken);
        const [memberResponse, pipelineResponse, labelResponse, automationResponse] =
          await Promise.all([
            fetch("/api/members?limit=100&status=ACTIVE", {
              cache: "no-store",
              credentials: "same-origin",
            }),
            fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
            fetch("/api/contacts/labels", { cache: "no-store", credentials: "same-origin" }),
            fetch("/api/automations", { cache: "no-store", credentials: "same-origin" }),
          ]);
        if (!mounted) return;
        if (memberResponse.ok)
          setMembers(
            ((await memberResponse.json()) as { readonly data?: MemberOption[] }).data ?? [],
          );
        if (pipelineResponse.ok)
          setPipelines(
            ((await pipelineResponse.json()) as { readonly data?: PipelineOption[] }).data ?? [],
          );
        if (labelResponse.ok)
          setLabels(
            ((await labelResponse.json()) as { readonly data?: ContactLabel[] }).data ?? [],
          );
        if (automationResponse.ok) {
          const data =
            ((await automationResponse.json()) as { readonly data?: Automation[] }).data ?? [];
          setAutomations(data);
          setSelectedAutomationId(data.find((item) => item.status === "ACTIVE")?.id ?? "");
        }
        await loadContacts(emptyFilters);
        const openedId = new URLSearchParams(window.location.search).get("contact");
        if (openedId) {
          const response = await fetch(`/api/contacts/${openedId}`, {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (response.ok && mounted) {
            const contact = ((await response.json()) as { readonly data?: WorkspaceContact }).data;
            if (contact) {
              setSelectedContact(contact);
              void loadRelations(contact);
            }
          }
        }
      } catch (cause) {
        if (mounted)
          setError(cause instanceof Error ? cause.message : "No fue posible iniciar Contactos.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadContacts, loadRelations]);

  function updateFilter<Key extends keyof ContactFilters>(
    key: Key,
    value: ContactFilters[Key],
  ): void {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function openContact(contact: WorkspaceContact): void {
    setSelectedContact(contact);
    setActiveTab("activity");
    const url = new URL(window.location.href);
    url.searchParams.set("contact", contact.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    void loadRelations(contact);
  }

  function closeContact(): void {
    relationRequestNumber.current += 1;
    setSelectedContact(null);
    setRelations(null);
    setRelationsError(null);
    setUnavailableRelationTabs(new Set<ContactTab>());
    const url = new URL(window.location.href);
    url.searchParams.delete("contact");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function chooseView(view: WorkspaceView): void {
    const next =
      view === "unassigned"
        ? { ...emptyFilters, assignment: "UNASSIGNED" as const }
        : view === "archived"
          ? { ...emptyFilters, archived: "true" as const }
          : emptyFilters;
    setActiveView(view);
    setDraftFilters(next);
    setError(null);
    void loadContacts(next);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setActiveView("all");
    setError(null);
    void loadContacts(draftFilters);
  }

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setActiveView("all");
    setError(null);
    void loadContacts(draftFilters);
  }

  function resetFilters(): void {
    setDraftFilters(emptyFilters);
    setActiveView("all");
    setError(null);
    void loadContacts(emptyFilters);
  }

  function toggleContact(id: string): void {
    if (filterSelection) {
      setFilterSelection(null);
      bulkActionRun.current = null;
      setSelectedIds(new Set([id]));
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (filterSelection) {
      setFilterSelection(null);
      bulkActionRun.current = null;
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      const allVisibleAreSelected =
        visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      for (const id of visibleIds) {
        if (allVisibleAreSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function submitContact(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken || !composer) return;
    const form = new FormData(event.currentTarget);
    const labelIds = form
      .getAll("labelIds")
      .filter((value): value is string => typeof value === "string");
    const rawOwner = String(form.get("ownerMemberId") ?? "");
    const details = {
      displayName: String(form.get("displayName") ?? "").trim(),
      email: String(form.get("email") ?? "").trim() || null,
      phone: String(form.get("phone") ?? "").trim() || null,
      ownerMemberId: rawOwner === "__UNASSIGNED__" ? null : rawOwner || undefined,
      source: String(form.get("source") ?? "MANUAL"),
      labelIds,
    };
    if (!details.displayName) {
      setError("Escribe el nombre del contacto.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const editing = composer.mode === "edit" && composer.contact;
      const response = await fetch(
        editing ? `/api/contacts/${composer.contact?.id}` : "/api/contacts",
        {
          method: editing ? "PATCH" : "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            ...(editing
              ? { "if-match": `\"${String(composer.contact?.version ?? "1")}\"` }
              : { "idempotency-key": crypto.randomUUID() }),
          },
          body: JSON.stringify(
            editing
              ? {
                  displayName: details.displayName,
                  email: details.email,
                  phone: details.phone,
                  ...(details.ownerMemberId === undefined
                    ? {}
                    : { ownerMemberId: details.ownerMemberId }),
                  labelIds: details.labelIds,
                }
              : {
                  displayName: details.displayName,
                  ...(details.email ? { email: details.email } : {}),
                  ...(details.phone ? { phone: details.phone } : {}),
                  ...(details.ownerMemberId === undefined
                    ? {}
                    : { ownerMemberId: details.ownerMemberId }),
                  source: details.source,
                  ...(details.labelIds.length > 0 ? { labelIds: details.labelIds } : {}),
                },
          ),
        },
      );
      if (!response.ok)
        throw new Error(await responseMessage(response, "No fue posible guardar el contacto."));
      const saved = (
        (await response
          .clone()
          .json()
          .catch(() => null)) as { readonly data?: WorkspaceContact } | null
      )?.data;
      setComposer(null);
      setNotice(editing ? "Contacto actualizado." : "Contacto creado.");
      await loadContacts(activeFilters, currentCursor, true);
      const savedId = saved?.id ?? composer.contact?.id;
      if (saved && savedId && selectedContact?.id === savedId) {
        setSelectedContact(saved);
        void loadRelations(saved);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el contacto.");
    } finally {
      setSaving(false);
    }
  }

  function selectAllMatching(): void {
    const total = page.total ?? contacts.length;
    if (total === 0) return;
    setFilterSelection(Object.freeze({ filters: Object.freeze({ ...activeFilters }), total }));
    setSelectedIds(new Set());
    bulkActionRun.current = null;
    setNotice(
      total === 1
        ? "1 contacto seleccionado en todos los resultados del filtro."
        : `${total} contactos seleccionados en todos los resultados del filtro.`,
    );
  }

  async function applyBulkAction(
    action: BulkAction = bulkAction,
    target = bulkTarget,
    contactIds: readonly string[] = [...selectedIds],
  ): Promise<void> {
    const selectedFilter = filterSelection;
    if (!csrfToken || !action || (!selectedFilter && contactIds.length === 0)) return;
    if ((action === "ASSIGN" || action === "ADD_LABEL" || action === "REMOVE_LABEL") && !target) {
      setError("Selecciona el valor que se aplicará a los contactos.");
      return;
    }
    setBulkBusy(true);
    setError(null);
    let completed = 0;
    let updated = 0;
    let unchanged = 0;
    let notVisible = 0;
    try {
      const batches = selectedFilter
        ? [null]
        : Array.from({ length: Math.ceil(contactIds.length / 100) }, (_, index) =>
            contactIds.slice(index * 100, index * 100 + 100),
          );
      const filter = selectedFilter ? bulkFilterPayload(selectedFilter.filters) : null;
      const fingerprint = JSON.stringify({
        action,
        target,
        contactIds: selectedFilter ? undefined : contactIds,
        filter,
      });
      const stableOperation =
        selectedFilter && bulkActionRun.current?.fingerprint === fingerprint
          ? bulkActionRun.current
          : selectedFilter
            ? { fingerprint, operationKey: crypto.randomUUID() }
            : null;
      if (stableOperation) bulkActionRun.current = stableOperation;
      for (const batch of batches) {
        const response = await fetch("/api/contacts/actions", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            "idempotency-key": stableOperation?.operationKey ?? crypto.randomUUID(),
          },
          body: JSON.stringify({
            action,
            ...(filter ? { filter } : { contactIds: batch }),
            ...(action === "ASSIGN"
              ? { ownerMemberId: target === "__UNASSIGNED__" ? null : target }
              : {}),
            ...(action === "ADD_LABEL" || action === "REMOVE_LABEL" ? { labelId: target } : {}),
          }),
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        const data = (await response.json()) as {
          readonly data?: {
            readonly updated?: number;
            readonly unchanged?: number;
            readonly notVisible?: number;
          };
        };
        updated += data.data?.updated ?? 0;
        unchanged += data.data?.unchanged ?? 0;
        notVisible += data.data?.notVisible ?? 0;
        completed += batch?.length ?? selectedFilter?.total ?? 0;
      }
      const messages: Readonly<Record<Exclude<BulkAction, "">, string>> = {
        ASSIGN: "Asignación actualizada",
        ADD_LABEL: "Etiqueta aplicada",
        REMOVE_LABEL: "Etiqueta retirada",
        ARCHIVE: "Contactos archivados",
        RESTORE: "Contactos restaurados",
      };
      const details = [
        `${updated} modificados`,
        unchanged > 0 ? `${unchanged} sin cambios` : null,
        notVisible > 0 ? `${notVisible} sin acceso` : null,
      ]
        .filter((value): value is string => value !== null)
        .join(" · ");
      setNotice(`${messages[action]}: ${details}.`);
      setSelectedIds(new Set());
      setFilterSelection(null);
      bulkActionRun.current = null;
      setBulkAction("");
      setBulkTarget("");
      await loadContacts(activeFilters, currentCursor, true);
      if (selectedContact && (selectedFilter !== null || contactIds.includes(selectedContact.id))) {
        const refreshedResponse = await fetch(`/api/contacts/${selectedContact.id}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (refreshedResponse.ok) {
          const refreshed = (
            (await refreshedResponse.json()) as { readonly data?: WorkspaceContact }
          ).data;
          if (refreshed) setSelectedContact(refreshed);
        } else {
          setError("La acción se aplicó, pero no fue posible refrescar la ficha abierta.");
        }
      }
    } catch (cause) {
      const partial =
        completed > 0 ? ` Se completaron ${completed} contactos antes del error.` : "";
      setError(
        `${cause instanceof Error ? cause.message : "No fue posible aplicar la acción masiva."}${partial}${selectedFilter ? " Puedes reintentar; se conservará la misma operación." : ""}`,
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function createLabel(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) {
      setError("Escribe el nombre de la etiqueta.");
      return;
    }
    setLabelBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/labels", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ name }),
      });
      if (!response.ok)
        throw new Error(await responseMessage(response, "No fue posible crear la etiqueta."));
      const label = ((await response.json()) as { readonly data?: ContactLabel }).data;
      if (label)
        setLabels((current) =>
          [...current, label].sort((left, right) => left.name.localeCompare(right.name, "es-CO")),
        );
      setLabelOpen(false);
      setNotice("Etiqueta creada. Ya puedes aplicarla a contactos.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la etiqueta.");
    } finally {
      setLabelBusy(false);
    }
  }

  async function selectImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setImportFile(null);
      setImportRows([]);
      setError("El archivo supera el límite de 5 MB.");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      setImportFile({ fileName: file.name, contentBase64: btoa(binary) });
      setImportRows([]);
    } catch {
      setError("No fue posible leer el archivo seleccionado.");
    }
  }

  async function previewImport(): Promise<void> {
    if (!csrfToken || !importFile) return;
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import/preview", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const rows =
        (
          (await response.json()) as {
            readonly data?: { readonly rows?: ContactImportPreviewRow[] };
          }
        ).data?.rows ?? [];
      setImportRows(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible revisar la importación.");
    } finally {
      setImportBusy(false);
    }
  }

  async function applyImport(): Promise<void> {
    if (!csrfToken || !importFile || importRows.length === 0) return;
    if (importErrors.length > 0) {
      setError("Corrige las filas marcadas antes de confirmar la importación.");
      return;
    }
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportFile(null);
      setImportRows([]);
      setImportOpen(false);
      setNotice("Importación aplicada. Revisa los contactos creados o actualizados.");
      await loadContacts(activeFilters, currentCursor, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible importar los contactos.");
    } finally {
      setImportBusy(false);
    }
  }

  async function exportContacts(): Promise<void> {
    const query = new URLSearchParams();
    if (activeFilters.q.trim()) query.set("q", activeFilters.q.trim());
    if (activeFilters.label) query.set("label", activeFilters.label);
    if (activeFilters.pipelineId) query.set("pipelineId", activeFilters.pipelineId);
    if (activeFilters.ownerMemberId) query.set("ownerMemberId", activeFilters.ownerMemberId);
    if (activeFilters.assignment) query.set("assignment", activeFilters.assignment);
    if (activeFilters.channel) query.set("channel", activeFilters.channel);
    if (activeFilters.source) query.set("source", activeFilters.source);
    if (activeFilters.createdFrom)
      query.set("createdFrom", `${activeFilters.createdFrom}T00:00:00.000Z`);
    if (activeFilters.createdTo) query.set("createdTo", `${activeFilters.createdTo}T23:59:59.999Z`);
    if (activeFilters.archived) query.set("archived", activeFilters.archived);
    const response = await fetch(`/api/contacts/export?${query.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      setError(await responseMessage(response));
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "contactos.csv";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function runAutomation(): Promise<void> {
    if (!csrfToken || !selectedAutomationId || selectedIds.size === 0) return;
    setBulkBusy(true);
    setError(null);
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    const ids = [...selectedIds].sort((left, right) => left.localeCompare(right));
    const fingerprint = `${selectedAutomationId}:${ids.join(",")}`;
    const activeRun =
      automationRun.current?.fingerprint === fingerprint
        ? automationRun.current
        : { fingerprint, batchKeys: new Map<number, string>() };
    automationRun.current = activeRun;
    const failedContactIds = new Set<string>();
    try {
      for (let start = 0; start < ids.length; start += 500) {
        const contactIds = ids.slice(start, start + 500);
        const operationKey = activeRun.batchKeys.get(start) ?? crypto.randomUUID();
        activeRun.batchKeys.set(start, operationKey);
        const response = await fetch(`/api/automations/${selectedAutomationId}/activate`, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
            "idempotency-key": operationKey,
          },
          body: JSON.stringify({ contactIds }),
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        const data = (
          (await response.json()) as {
            readonly data?: {
              readonly succeeded?: number;
              readonly failed?: number;
              readonly results?: readonly {
                readonly contactId?: string;
                readonly status?: "SUCCEEDED" | "FAILED";
              }[];
            };
          }
        ).data;
        succeeded += data?.succeeded ?? 0;
        failed += data?.failed ?? 0;
        for (const result of data?.results ?? []) {
          if (result.status === "FAILED" && result.contactId)
            failedContactIds.add(result.contactId);
        }
        completed += contactIds.length;
      }
      setNotice(
        `Automatización ejecutada: ${succeeded} completadas${failed ? ` · ${failed} con error` : ""}.`,
      );
      setAutomationOpen(false);
      if (failedContactIds.size > 0) {
        setSelectedIds(failedContactIds);
        setNotice(
          `Automatización ejecutada: ${succeeded} completadas · ${failedContactIds.size} con error. Quedaron seleccionados para revisarlos o reintentarlos.`,
        );
      } else {
        setSelectedIds(new Set());
      }
      automationRun.current = null;
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "No fue posible ejecutar la automatización."}${completed ? ` Se procesaron ${completed} contactos antes del error.` : ""} Puedes reintentar; esta selección conservará sus claves de operación.`,
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function createAutomation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken) return;
    const form = new FormData(event.currentTarget);
    const dueHours = Number(form.get("dueHours"));
    if (!Number.isInteger(dueHours) || dueHours < 1 || dueHours > 8_760) {
      setError("Indica un plazo entre 1 y 8.760 horas.");
      return;
    }
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      status: String(form.get("status") ?? "ACTIVE"),
      action: {
        type: "CREATE_TASK" as const,
        title: String(form.get("taskTitle") ?? "").trim(),
        description: String(form.get("taskDescription") ?? "").trim(),
        priority: String(form.get("priority") ?? "MEDIUM"),
        dueHours,
      },
    };
    if (!payload.name || !payload.action.title || !payload.action.description) {
      setError("Completa el nombre y los datos de la tarea automática.");
      return;
    }
    setAutomationCreateBusy(true);
    setError(null);
    const fingerprint = JSON.stringify(payload);
    const activeRun =
      automationCreateRun.current?.fingerprint === fingerprint
        ? automationCreateRun.current
        : { fingerprint, operationKey: crypto.randomUUID() };
    automationCreateRun.current = activeRun;
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": activeRun.operationKey,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(await responseMessage(response, "No fue posible crear la automatización."));
      const created = ((await response.json()) as { readonly data?: Automation }).data;
      if (!created) throw new Error("La automatización se creó sin una respuesta válida.");
      automationCreateRun.current = null;
      setAutomations((current) => [...current, created]);
      setAutomationCreateOpen(false);
      if (created.status === "ACTIVE") {
        setSelectedAutomationId(created.id);
        setAutomationOpen(true);
        setNotice(
          "Automatización activa creada. Ya puedes aplicarla a los contactos seleccionados.",
        );
      } else {
        setSelectedAutomationId("");
        setAutomationOpen(false);
        setNotice("Automatización creada como borrador. Actívala antes de aplicarla a contactos.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la automatización.");
    } finally {
      setAutomationCreateBusy(false);
    }
  }

  function rowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, contact: WorkspaceContact): void {
    if ((event.target as HTMLElement).closest("button, input, a, select")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openContact(contact);
    }
  }

  const currentRelations = relations ? relations[activeTab] : [];
  const drawerOwner = selectedContact ? ownerFor(selectedContact) : null;

  return (
    <CrmShell className="contact-workspace-shell">
      <section className="crm-content contact-workspace" aria-busy={loading || saving || bulkBusy}>
        <header className="contact-workspace-header">
          <div className="contact-workspace-heading">
            <span className="contact-workspace-kicker">Centro de contactos</span>
            <div>
              <h1>Contactos</h1>
              <span className="contact-workspace-count">
                {page.total ?? contacts.length}{" "}
                {(page.total ?? contacts.length) === 1 ? "contacto" : "contactos"}
              </span>
            </div>
          </div>
          <div className="contact-workspace-header-actions">
            <button
              className="contact-workspace-icon-button"
              type="button"
              onClick={() => void loadContacts(activeFilters, currentCursor, true)}
              title="Actualizar lista"
              disabled={loading}
            >
              <Icon name="refresh" />
              <span className="sr-only">Actualizar</span>
            </button>
            <button
              className="contact-workspace-quiet-button"
              type="button"
              onClick={() => setImportOpen(true)}
            >
              <Icon name="upload" size={16} /> Importar
            </button>
            <button
              className="contact-workspace-quiet-button"
              type="button"
              onClick={() => void exportContacts()}
            >
              <Icon name="download" size={16} /> Exportar
            </button>
            <button
              className="contact-workspace-primary-button"
              type="button"
              onClick={() => setComposer({ mode: "create" })}
            >
              <Icon name="plus" size={17} /> Nuevo contacto
            </button>
          </div>
        </header>

        {error ? (
          <p className="contact-workspace-feedback is-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="contact-workspace-feedback is-success" role="status">
            {notice}
            <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
              <Icon name="close" size={14} />
            </button>
          </p>
        ) : null}

        <div className="contact-workspace-grid">
          <aside className="contact-workspace-views" aria-label="Vistas de contactos">
            <div className="contact-workspace-views-heading">
              <span>Vistas</span>
              <button type="button" title="Restablecer vista" onClick={resetFilters}>
                <Icon name="refresh" size={14} />
              </button>
            </div>
            <nav>
              <button
                type="button"
                className={activeView === "all" ? "is-active" : ""}
                onClick={() => chooseView("all")}
              >
                <span>
                  <Icon name="user" size={16} /> Todos los contactos
                </span>
                <em>{activeView === "all" ? (page.total ?? contacts.length) : ""}</em>
              </button>
              <button
                type="button"
                className={activeView === "unassigned" ? "is-active" : ""}
                onClick={() => chooseView("unassigned")}
              >
                <span>
                  <Icon name="user" size={16} /> Sin asignar
                </span>
              </button>
              <button
                type="button"
                className={activeView === "archived" ? "is-active" : ""}
                onClick={() => chooseView("archived")}
              >
                <span>
                  <Icon name="archive" size={16} /> Archivados
                </span>
              </button>
            </nav>
            <div className="contact-workspace-view-note">
              <span aria-hidden="true" />
              <p>Las vistas consultan solamente el perfil activo.</p>
            </div>
          </aside>

          <main className="contact-workspace-table-pane">
            <div className="contact-workspace-toolbar">
              <form className="contact-workspace-search" onSubmit={submitSearch} role="search">
                <Icon name="search" size={18} />
                <input
                  value={draftFilters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Buscar por nombre, correo o teléfono"
                  aria-label="Buscar contactos"
                />
                {draftFilters.q ? (
                  <button
                    type="button"
                    onClick={() => updateFilter("q", "")}
                    aria-label="Limpiar búsqueda"
                  >
                    <Icon name="close" size={15} />
                  </button>
                ) : null}
              </form>
              <details className="contact-workspace-filter-menu">
                <summary>
                  <Icon name="filter" size={16} /> Filtros
                </summary>
                <form onSubmit={submitFilters}>
                  <div className="contact-workspace-filter-title">
                    <strong>Filtrar contactos</strong>
                    <button type="button" onClick={resetFilters}>
                      Limpiar todo
                    </button>
                  </div>
                  <label>
                    Etiqueta
                    <select
                      value={draftFilters.label}
                      onChange={(event) => updateFilter("label", event.target.value)}
                    >
                      <option value="">Todas las etiquetas</option>
                      {labels.map((label) => (
                        <option key={label.id} value={label.name}>
                          {label.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Responsable
                    <select
                      value={draftFilters.ownerMemberId}
                      onChange={(event) => updateFilter("ownerMemberId", event.target.value)}
                    >
                      <option value="">Todos los responsables</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pipeline
                    <select
                      value={draftFilters.pipelineId}
                      onChange={(event) => updateFilter("pipelineId", event.target.value)}
                    >
                      <option value="">Todos los pipelines</option>
                      {pipelines.map((pipeline) => (
                        <option key={pipeline.id} value={pipeline.id}>
                          {pipeline.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Canal
                    <select
                      value={draftFilters.channel}
                      onChange={(event) =>
                        updateFilter("channel", event.target.value as ContactFilters["channel"])
                      }
                    >
                      <option value="">Todos los canales</option>
                      <option value="EMAIL">Correo</option>
                      <option value="PHONE">Teléfono</option>
                      <option value="NONE">Sin canal</option>
                    </select>
                  </label>
                  <label>
                    Origen
                    <select
                      value={draftFilters.source}
                      onChange={(event) => updateFilter("source", event.target.value)}
                    >
                      <option value="">Todos los orígenes</option>
                      <option value="MANUAL">Manual</option>
                      <option value="IMPORT">Importación</option>
                      <option value="FORM">Formulario</option>
                      <option value="CONVERSATION">Conversación</option>
                      <option value="API">API</option>
                    </select>
                  </label>
                  <label>
                    Ordenar por
                    <select
                      value={draftFilters.sort}
                      onChange={(event) =>
                        updateFilter("sort", event.target.value as ContactFilters["sort"])
                      }
                    >
                      <option value="UPDATED_DESC">Actividad reciente</option>
                      <option value="CREATED_DESC">Fecha de creación</option>
                      <option value="NAME_ASC">Nombre, A–Z</option>
                    </select>
                  </label>
                  <div className="contact-workspace-date-row">
                    <label>
                      Desde
                      <input
                        type="date"
                        value={draftFilters.createdFrom}
                        onChange={(event) => updateFilter("createdFrom", event.target.value)}
                      />
                    </label>
                    <label>
                      Hasta
                      <input
                        type="date"
                        value={draftFilters.createdTo}
                        onChange={(event) => updateFilter("createdTo", event.target.value)}
                      />
                    </label>
                  </div>
                  <button type="submit" className="contact-workspace-apply-filter">
                    Aplicar filtros
                  </button>
                </form>
              </details>
              <span className="contact-workspace-toolbar-count">
                {loading ? "Actualizando…" : `${contacts.length} visibles`}
              </span>
            </div>

            {selectedCount > 0 ? (
              <div
                className="contact-workspace-bulk-bar"
                aria-label="Acciones para contactos seleccionados"
              >
                <strong>
                  <span>{selectedCount}</span>{" "}
                  {filterSelection
                    ? "del filtro seleccionados"
                    : `seleccionado${selectedCount === 1 ? "" : "s"}`}
                </strong>
                {!filterSelection &&
                typeof page.total === "number" &&
                page.total > selectedCount ? (
                  <button
                    type="button"
                    className="contact-workspace-select-all-filtered"
                    disabled={bulkBusy}
                    onClick={() => void selectAllMatching()}
                  >
                    Seleccionar los {page.total} del filtro
                  </button>
                ) : null}
                {filterSelection ? (
                  <span className="contact-workspace-filter-selection-note">
                    La acción se aplicará a quienes cumplan este filtro al confirmar. Las
                    automatizaciones requieren una selección explícita de hasta 500 contactos.
                  </span>
                ) : null}
                <select
                  value={bulkAction}
                  onChange={(event) => {
                    setBulkAction(event.target.value as BulkAction);
                    setBulkTarget("");
                  }}
                  aria-label="Acción masiva"
                >
                  <option value="">Elige una acción</option>
                  <option value="ASSIGN">Asignar responsable</option>
                  <option value="ADD_LABEL">Añadir etiqueta</option>
                  <option value="REMOVE_LABEL">Quitar etiqueta</option>
                  {activeFilters.archived === "true" ? (
                    <option value="RESTORE">Restaurar</option>
                  ) : (
                    <option value="ARCHIVE">Archivar</option>
                  )}
                </select>
                {bulkAction === "ASSIGN" ? (
                  <select
                    value={bulkTarget}
                    onChange={(event) => setBulkTarget(event.target.value)}
                    aria-label="Responsable"
                  >
                    <option value="">Seleccionar responsable</option>
                    <option value="__UNASSIGNED__">Sin asignar</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                ) : null}
                {bulkAction === "ADD_LABEL" || bulkAction === "REMOVE_LABEL" ? (
                  <select
                    value={bulkTarget}
                    onChange={(event) => setBulkTarget(event.target.value)}
                    aria-label="Etiqueta"
                  >
                    <option value="">Seleccionar etiqueta</option>
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button
                  type="button"
                  className="contact-workspace-bulk-apply"
                  disabled={!bulkAction || bulkBusy}
                  onClick={() => void applyBulkAction()}
                >
                  {bulkBusy ? "Aplicando…" : "Aplicar"}
                </button>
                <button
                  type="button"
                  className="contact-workspace-bulk-automation"
                  onClick={() => setAutomationOpen(true)}
                  disabled={filterSelection !== null || selectedIds.size > 500 || bulkBusy}
                  title={
                    filterSelection
                      ? "La automatización requiere una selección explícita de hasta 500 contactos."
                      : selectedIds.size > 500
                        ? "La automatización admite hasta 500 contactos por ejecución."
                        : undefined
                  }
                >
                  <Icon name="bolt" size={15} /> Automatizar
                </button>
                <button
                  type="button"
                  className="contact-workspace-clear-selection"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setFilterSelection(null);
                    bulkActionRun.current = null;
                  }}
                >
                  Limpiar
                </button>
              </div>
            ) : null}

            <div className="contact-workspace-table-wrap">
              <table className="contact-workspace-table">
                <thead>
                  <tr>
                    <th className="contact-workspace-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={
                          filterSelection !== null ||
                          (visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)))
                        }
                        onChange={toggleAll}
                        aria-label={
                          filterSelection
                            ? "Limpiar la selección de todos los resultados del filtro"
                            : "Seleccionar todos los contactos visibles"
                        }
                      />
                    </th>
                    <th>Contacto</th>
                    <th>Responsable</th>
                    <th>Etiquetas</th>
                    <th>Origen</th>
                    <th>Actualizado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {loading && contacts.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="contact-workspace-loading">
                          <span />
                          <p>Cargando contactos…</p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {!loading && contacts.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="contact-workspace-empty">
                          <span>
                            <Icon name="user" size={24} />
                          </span>
                          <h2>No hay contactos en esta vista</h2>
                          <p>Prueba con otros filtros o crea el primer contacto del perfil.</p>
                          <button type="button" onClick={() => setComposer({ mode: "create" })}>
                            <Icon name="plus" size={16} /> Crear contacto
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {contacts.map((contact) => {
                    const owner = ownerFor(contact);
                    return (
                      <tr
                        key={contact.id}
                        className={selectedContact?.id === contact.id ? "is-focused" : ""}
                        tabIndex={0}
                        onKeyDown={(event) => rowKeyDown(event, contact)}
                      >
                        <td className="contact-workspace-checkbox-cell">
                          <input
                            type="checkbox"
                            checked={filterSelection !== null || selectedIds.has(contact.id)}
                            onChange={() => toggleContact(contact.id)}
                            disabled={filterSelection !== null}
                            aria-label={
                              filterSelection
                                ? `${contact.displayName} está incluido en todos los resultados seleccionados`
                                : `Seleccionar a ${contact.displayName}`
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="contact-workspace-contact-cell"
                            onClick={() => openContact(contact)}
                          >
                            <span className="contact-workspace-avatar">
                              {initials(contact.displayName)}
                            </span>
                            <span>
                              <strong>{contact.displayName}</strong>
                              <small>
                                {contact.email ?? contact.phone ?? "Sin datos de contacto"}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          {owner ? (
                            <span className="contact-workspace-owner">
                              <i>{initials(owner.displayName)}</i>
                              {owner.displayName}
                            </span>
                          ) : (
                            <span className="contact-workspace-unassigned">Sin asignar</span>
                          )}
                        </td>
                        <td>
                          <span className="contact-workspace-tags">
                            {contact.labels.length ? (
                              contact.labels.slice(0, 2).map((label) => (
                                <span className="contact-workspace-tag" key={label.id}>
                                  {label.name}
                                </span>
                              ))
                            ) : (
                              <span className="contact-workspace-muted">—</span>
                            )}
                            {contact.labels.length > 2 ? (
                              <span className="contact-workspace-more-tags">
                                +{contact.labels.length - 2}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          <span className="contact-workspace-source">
                            {sourceLabel(contact.source)}
                          </span>
                        </td>
                        <td>
                          <span className="contact-workspace-activity-time">
                            {relativeDate(contact.updatedAt)}
                            <small>{dateText(contact.updatedAt)}</small>
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="contact-workspace-open-button"
                            onClick={() => openContact(contact)}
                            aria-label={`Abrir a ${contact.displayName}`}
                          >
                            <Icon name="chevron" size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="contact-workspace-pagination">
              <span>
                {page.total !== undefined && page.total !== null ? `${page.total} en total` : ""}
              </span>
              <div>
                <button
                  type="button"
                  disabled={!page.previousCursor || loading}
                  onClick={() => void loadContacts(activeFilters, page.previousCursor ?? null)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={!page.nextCursor || loading}
                  onClick={() => void loadContacts(activeFilters, page.nextCursor ?? null)}
                >
                  Siguiente
                </button>
              </div>
            </footer>
          </main>
        </div>

        {selectedContact ? (
          <aside
            className="contact-workspace-drawer"
            aria-label={`Ficha de ${selectedContact.displayName}`}
          >
            <header>
              <button
                type="button"
                className="contact-workspace-close-drawer"
                onClick={closeContact}
                aria-label="Cerrar ficha"
              >
                <Icon name="close" size={19} />
              </button>
              <span className="contact-workspace-profile-avatar">
                {initials(selectedContact.displayName)}
              </span>
              <div className="contact-workspace-profile-summary">
                <h2>{selectedContact.displayName}</h2>
                <span>{drawerOwner?.displayName ?? "Sin responsable"}</span>
              </div>
              <button
                type="button"
                className="contact-workspace-drawer-edit"
                onClick={() => setComposer({ mode: "edit", contact: selectedContact })}
              >
                Editar
              </button>
            </header>
            <section className="contact-workspace-contact-methods">
              <a
                href={selectedContact.email ? `mailto:${selectedContact.email}` : undefined}
                aria-disabled={!selectedContact.email}
              >
                <Icon name="mail" size={16} />
                <span>{selectedContact.email ?? "Sin correo"}</span>
              </a>
              <a
                href={selectedContact.phone ? `tel:${selectedContact.phone}` : undefined}
                aria-disabled={!selectedContact.phone}
              >
                <Icon name="phone" size={16} />
                <span>{selectedContact.phone ?? "Sin teléfono"}</span>
              </a>
            </section>
            <div className="contact-workspace-drawer-meta">
              <span>
                Origen: <strong>{sourceLabel(selectedContact.source)}</strong>
              </span>
              <span>
                Creado: <strong>{dateText(selectedContact.createdAt)}</strong>
              </span>
            </div>
            <nav className="contact-workspace-tabs" aria-label="Información relacionada">
              {tabs.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  className={activeTab === tab.id ? "is-active" : ""}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon name={tab.icon} size={15} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
            <section className="contact-workspace-drawer-body">
              {relationsLoading ? (
                <div className="contact-workspace-drawer-loading">
                  <span />
                  <p>Cargando relación del contacto…</p>
                </div>
              ) : null}
              {relationsError ? (
                <div className="contact-workspace-detail-error">
                  <p>{relationsError}</p>
                  <button type="button" onClick={() => void loadRelations(selectedContact)}>
                    Reintentar
                  </button>
                </div>
              ) : null}
              {!relationsLoading &&
              !relationsError &&
              activeTab !== "activity" &&
              unavailableRelationTabs.has(activeTab) ? (
                <div className="contact-workspace-empty-relation">
                  <span>
                    <Icon
                      name={tabs.find((tab) => tab.id === activeTab)?.icon ?? "bolt"}
                      size={19}
                    />
                  </span>
                  <p>No tienes acceso a esta relación para el contacto.</p>
                </div>
              ) : null}
              {!relationsLoading &&
              !relationsError &&
              (activeTab === "activity" || !unavailableRelationTabs.has(activeTab)) ? (
                <RelationList
                  items={currentRelations}
                  icon={tabs.find((tab) => tab.id === activeTab)?.icon ?? "bolt"}
                  empty={
                    activeTab === "activity"
                      ? "Todavía no hay actividad registrada para este contacto."
                      : `No hay ${tabs.find((tab) => tab.id === activeTab)?.label.toLocaleLowerCase("es-CO") ?? "registros"} vinculados a este contacto.`
                  }
                />
              ) : null}
            </section>
            <footer>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() =>
                  void applyBulkAction(selectedContact.archivedAt ? "RESTORE" : "ARCHIVE", "", [
                    selectedContact.id,
                  ])
                }
              >
                {selectedContact.archivedAt ? "Restaurar contacto" : "Archivar contacto"}
              </button>
              <a href={`/contacts/${selectedContact.id}`}>
                Abrir ficha completa <Icon name="arrow" size={15} />
              </a>
            </footer>
          </aside>
        ) : null}

        {composer ? (
          <div
            className="contact-workspace-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) setComposer(null);
            }}
          >
            <form
              className="contact-workspace-modal"
              onSubmit={(event) => void submitContact(event)}
              aria-modal="true"
              role="dialog"
              aria-labelledby="contact-composer-title"
            >
              <header>
                <div>
                  <span className="contact-workspace-kicker">
                    {composer.mode === "create" ? "Nuevo registro" : "Editar registro"}
                  </span>
                  <h2 id="contact-composer-title">
                    {composer.mode === "create" ? "Crear contacto" : "Actualizar contacto"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setComposer(null)}
                  disabled={saving}
                  aria-label="Cerrar"
                >
                  <Icon name="close" size={20} />
                </button>
              </header>
              <p>
                {composer.mode === "create"
                  ? "Añade los datos con los que el equipo podrá identificar y atender a esta persona."
                  : "Los cambios se guardarán en el contacto del perfil activo."}
              </p>
              <div className="contact-workspace-form-grid">
                <label className="is-wide">
                  Nombre completo
                  <input
                    name="displayName"
                    maxLength={160}
                    defaultValue={composer.contact?.displayName ?? ""}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Correo electrónico
                  <input
                    name="email"
                    type="email"
                    maxLength={320}
                    defaultValue={composer.contact?.email ?? ""}
                    placeholder="persona@empresa.com"
                  />
                </label>
                <label>
                  Teléfono
                  <input
                    name="phone"
                    maxLength={40}
                    defaultValue={composer.contact?.phone ?? ""}
                    placeholder="+57 300 000 0000"
                  />
                </label>
                <label>
                  Responsable
                  <select
                    name="ownerMemberId"
                    defaultValue={
                      composer.mode === "create"
                        ? ""
                        : (composer.contact?.ownerMemberId ?? "__UNASSIGNED__")
                    }
                  >
                    {composer.mode === "create" ? (
                      <option value="">Asignarme automáticamente</option>
                    ) : null}
                    <option value="__UNASSIGNED__">Sin asignar</option>
                    {unavailableComposerOwner ? (
                      <option value={unavailableComposerOwner.id}>
                        {unavailableComposerOwner.displayName} (responsable actual no disponible)
                      </option>
                    ) : null}
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                {composer.mode === "create" ? (
                  <label>
                    Origen
                    <select name="source" defaultValue="MANUAL">
                      <option value="MANUAL">Registro manual</option>
                      <option value="FORM">Formulario</option>
                      <option value="CONVERSATION">Conversación</option>
                      <option value="IMPORT">Importación</option>
                      <option value="API">API</option>
                    </select>
                  </label>
                ) : (
                  <div className="contact-workspace-readonly-field">
                    <span>Origen</span>
                    <strong>{sourceLabel(composer.contact?.source)}</strong>
                    <small>El origen se conserva.</small>
                  </div>
                )}
                <label className="is-wide">
                  Etiquetas
                  <select
                    name="labelIds"
                    multiple
                    defaultValue={composer.contact?.labels.map((label) => label.id) ?? []}
                    size={Math.min(Math.max(labels.length, 3), 5)}
                  >
                    {labels.length === 0 ? (
                      <option disabled>No hay etiquetas disponibles</option>
                    ) : (
                      labels.map((label) => (
                        <option key={label.id} value={label.id}>
                          {label.name}
                        </option>
                      ))
                    )}
                  </select>
                  <span className="contact-workspace-label-help">
                    <small>Usa Ctrl o ⌘ para seleccionar varias.</small>
                    <button type="button" onClick={() => setLabelOpen(true)}>
                      <Icon name="plus" size={13} /> Crear etiqueta
                    </button>
                  </span>
                </label>
              </div>
              <footer>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => setComposer(null)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="contact-workspace-primary-button"
                  disabled={saving}
                >
                  {saving
                    ? "Guardando…"
                    : composer.mode === "create"
                      ? "Crear contacto"
                      : "Guardar cambios"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}

        {labelOpen ? (
          <div
            className="contact-workspace-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !labelBusy) setLabelOpen(false);
            }}
          >
            <form
              className="contact-workspace-modal contact-workspace-label-modal"
              onSubmit={(event) => void createLabel(event)}
              aria-modal="true"
              role="dialog"
              aria-labelledby="contact-label-title"
            >
              <header>
                <div>
                  <span className="contact-workspace-kicker">Organización</span>
                  <h2 id="contact-label-title">Crear etiqueta</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setLabelOpen(false)}
                  disabled={labelBusy}
                  aria-label="Cerrar"
                >
                  <Icon name="close" size={20} />
                </button>
              </header>
              <p>Las etiquetas se pueden aplicar a uno o varios contactos del perfil activo.</p>
              <label>
                Nombre de la etiqueta
                <input
                  name="name"
                  maxLength={80}
                  placeholder="Ej. Cliente prioritario"
                  autoFocus
                  required
                />
              </label>
              <footer>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => setLabelOpen(false)}
                  disabled={labelBusy}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="contact-workspace-primary-button"
                  disabled={labelBusy}
                >
                  {labelBusy ? "Creando…" : "Crear etiqueta"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}

        {importOpen ? (
          <div
            className="contact-workspace-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !importBusy) setImportOpen(false);
            }}
          >
            <section
              className="contact-workspace-modal contact-workspace-import-modal"
              aria-modal="true"
              role="dialog"
              aria-labelledby="contact-import-title"
            >
              <header>
                <div>
                  <span className="contact-workspace-kicker">Importación</span>
                  <h2 id="contact-import-title">Traer contactos al perfil</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  disabled={importBusy}
                  aria-label="Cerrar"
                >
                  <Icon name="close" size={20} />
                </button>
              </header>
              <p>
                Sube un CSV o XLSX. Primero se revisan las filas; solo después confirmas la
                importación.
              </p>
              <label className="contact-workspace-upload-zone">
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => void selectImport(event)}
                />
                <Icon name="upload" size={23} />
                <strong>{importFile ? importFile.fileName : "Seleccionar archivo"}</strong>
                <span>CSV o XLSX · máximo 5 MB</span>
              </label>
              {importRows.length > 0 ? (
                <>
                  <div className="contact-workspace-import-summary">
                    <strong>{importRows.length} filas revisadas</strong>
                    <span>
                      {importRows.filter((row) => row.status === "VALID").length} listas para crear
                      · {importRows.filter((row) => row.status === "MATCH").length} coincidencias ·{" "}
                      {importErrors.length} con errores
                    </span>
                  </div>
                  <div
                    className="contact-workspace-import-rows"
                    role="region"
                    aria-label="Resultado de la revisión"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Fila</th>
                          <th>Contacto</th>
                          <th>Resultado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((row) => (
                          <tr
                            key={row.rowNumber}
                            className={`is-${row.status.toLocaleLowerCase("en-US")}`}
                          >
                            <td>{row.rowNumber}</td>
                            <td>
                              <strong>{row.displayName || "Sin nombre"}</strong>
                              <span>{row.email ?? row.phone ?? "Sin canal"}</span>
                            </td>
                            <td>
                              {row.status === "MATCH" ? "Actualizar coincidencia" : row.status}
                            </td>
                            <td>
                              {row.errors.length
                                ? row.errors.map(importErrorLabel).join(", ")
                                : (row.contactId ?? "Lista")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importErrors.length > 0 ? (
                    <p className="contact-workspace-import-error-note">
                      Hay filas inválidas. Corrígelas en el archivo y vuelve a revisarlo antes de
                      importar.
                    </p>
                  ) : null}
                </>
              ) : null}
              <footer>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => setImportOpen(false)}
                  disabled={importBusy}
                >
                  Cancelar
                </button>
                {importRows.length > 0 ? (
                  <button
                    type="button"
                    className="contact-workspace-primary-button"
                    onClick={() => void applyImport()}
                    disabled={importBusy || importErrors.length > 0}
                  >
                    {importBusy ? "Importando…" : "Confirmar importación"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="contact-workspace-primary-button"
                    onClick={() => void previewImport()}
                    disabled={!importFile || importBusy}
                  >
                    {importBusy ? "Revisando…" : "Revisar archivo"}
                  </button>
                )}
              </footer>
            </section>
          </div>
        ) : null}

        {automationOpen ? (
          <div
            className="contact-workspace-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !bulkBusy) setAutomationOpen(false);
            }}
          >
            <section
              className="contact-workspace-modal contact-workspace-automation-modal"
              aria-modal="true"
              role="dialog"
              aria-labelledby="contact-automation-title"
            >
              <header>
                <div>
                  <span className="contact-workspace-kicker">Automatización</span>
                  <h2 id="contact-automation-title">
                    Aplicar a {selectedCount} contacto{selectedCount === 1 ? "" : "s"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAutomationOpen(false)}
                  disabled={bulkBusy}
                  aria-label="Cerrar"
                >
                  <Icon name="close" size={20} />
                </button>
              </header>
              <p>Se ejecutará una vez por cada contacto marcado.</p>
              <label>
                Automatización activa
                <select
                  value={selectedAutomationId}
                  onChange={(event) => setSelectedAutomationId(event.target.value)}
                >
                  {activeAutomations.length === 0 ? (
                    <option value="">No hay automatizaciones activas</option>
                  ) : (
                    activeAutomations.map((automation) => (
                      <option key={automation.id} value={automation.id}>
                        {automation.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <footer>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => {
                    setAutomationOpen(false);
                    setAutomationCreateOpen(true);
                  }}
                  disabled={bulkBusy}
                >
                  Crear automatización
                </button>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => setAutomationOpen(false)}
                  disabled={bulkBusy}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="contact-workspace-primary-button"
                  disabled={!selectedAutomationId || bulkBusy}
                  onClick={() => void runAutomation()}
                >
                  {bulkBusy ? "Ejecutando…" : "Ejecutar automatización"}
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        {automationCreateOpen ? (
          <div
            className="contact-workspace-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !automationCreateBusy)
                setAutomationCreateOpen(false);
            }}
          >
            <form
              className="contact-workspace-modal contact-workspace-automation-create-modal"
              onSubmit={(event) => void createAutomation(event)}
              aria-modal="true"
              role="dialog"
              aria-labelledby="contact-automation-create-title"
            >
              <header>
                <div>
                  <span className="contact-workspace-kicker">Automatización</span>
                  <h2 id="contact-automation-create-title">Crear seguimiento automático</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setAutomationCreateOpen(false)}
                  disabled={automationCreateBusy}
                  aria-label="Cerrar"
                >
                  <Icon name="close" size={20} />
                </button>
              </header>
              <p>
                Esta automatización creará una tarea cuando la ejecutes sobre los contactos
                seleccionados.
              </p>
              <div className="contact-workspace-form-grid">
                <label className="is-wide">
                  Nombre de la automatización
                  <input
                    name="name"
                    maxLength={160}
                    required
                    autoFocus
                    placeholder="Seguimiento comercial"
                  />
                </label>
                <label>
                  Estado inicial
                  <select name="status" defaultValue="ACTIVE">
                    <option value="ACTIVE">Activa y lista para usar</option>
                    <option value="DRAFT">Borrador</option>
                  </select>
                </label>
                <label>
                  Plazo de la tarea (horas)
                  <input
                    name="dueHours"
                    type="number"
                    min={1}
                    max={8760}
                    defaultValue={24}
                    required
                  />
                </label>
                <label className="is-wide">
                  Título de la tarea
                  <input
                    name="taskTitle"
                    maxLength={200}
                    required
                    placeholder="Contactar y dar seguimiento"
                  />
                </label>
                <label className="is-wide">
                  Instrucción para el equipo
                  <textarea
                    name="taskDescription"
                    maxLength={4000}
                    required
                    placeholder="Revisa el contexto del contacto y registra el siguiente paso."
                  />
                </label>
                <label>
                  Prioridad
                  <select name="priority" defaultValue="MEDIUM">
                    <option value="LOW">Baja</option>
                    <option value="MEDIUM">Media</option>
                    <option value="HIGH">Alta</option>
                  </select>
                </label>
              </div>
              <footer>
                <button
                  type="button"
                  className="contact-workspace-cancel"
                  onClick={() => setAutomationCreateOpen(false)}
                  disabled={automationCreateBusy}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="contact-workspace-primary-button"
                  disabled={automationCreateBusy}
                >
                  {automationCreateBusy ? "Creando…" : "Crear automatización"}
                </button>
              </footer>
            </form>
          </div>
        ) : null}
      </section>
    </CrmShell>
  );
}
