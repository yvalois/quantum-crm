"use client";

import { ContactListResponseSchema } from "@quantum-crm/contracts";
import type {
  Contact,
  Member,
  Opportunity,
  OpportunityHistoryEntry,
  OpportunityStatus,
  Pipeline,
} from "@quantum-crm/contracts";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import { ContactCustomFields } from "../contacts/custom-fields";
import { SourceParticipantsCard } from "../source-participants";
import styles from "./pipeline.module.css";
import { useBoardDrag } from "./use-board-drag";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface List<T> {
  readonly data: T[];
}

interface MutationResponse<T> {
  readonly data?: T;
}

interface BoardFilters {
  readonly stageId: string;
  readonly ownerMemberId: string;
  readonly status: "" | OpportunityStatus;
  readonly label: string;
  readonly createdFrom: string;
  readonly createdTo: string;
}

type BoardView = "kanban" | "table";
type SortMode = "recent" | "amount" | "name";
type Panel = "filters" | null;
type OpportunityContactMode = "existing" | "new";

interface OpportunityCreationAttempt {
  readonly contactKey: string;
  readonly contactPayload: string;
  readonly contactId?: string;
  readonly opportunityKey: string;
  readonly opportunityPayload: string;
}

const emptyFilters: BoardFilters = {
  stageId: "",
  ownerMemberId: "",
  status: "OPEN",
  label: "",
  createdFrom: "",
  createdTo: "",
};

const statusLabels: Record<OpportunityStatus, string> = {
  OPEN: "Abierta",
  WON: "Ganada",
  LOST: "Perdida",
  ABANDONED: "Abandonada",
};

const statusTone: Record<OpportunityStatus, "open" | "won" | "lost" | "abandoned"> = {
  OPEN: "open",
  WON: "won",
  LOST: "lost",
  ABANDONED: "abandoned",
};

function Icon({
  name,
  size = 18,
}: {
  readonly name: string;
  readonly size?: number;
}): React.JSX.Element {
  const paths: Record<string, React.JSX.Element> = {
    add: <path d="M12 5v14M5 12h14" />,
    arrowDown: <path d="M12 5v14m0 0-5-5m5 5 5-5" />,
    arrowUp: <path d="M12 19V5m0 0-5 5m5-5 5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    columns: <path d="M4 5h5v14H4zM10 5h5v14h-5zM16 5h4v14h-4z" />,
    filter: <path d="M4 6h16M7 12h10M10 18h4" />,
    history: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 5v4h4M12 8v4l3 2" />,
    move: <path d="M5 8h14M15 5l4 3-4 3M19 16H5M9 13l-4 3 4 3" />,
    grip: <path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" />,
    more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
    refresh: (
      <path d="M20 11a8 8 0 0 0-14.8-4.2L4 9M4 5v4h4M4 13a8 8 0 0 0 14.8 4.2L20 15M20 19v-4h-4" />
    ),
    search: <path d="m20 20-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
    settings: (
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.3 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.3 2.6h4.4l.3-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    ),
    table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M9 5v14" />,
    trash: <path d="M5 7h14M10 11v5M14 11v5M9 7l1-2h4l1 2m-8 0 1 13h8l1-13" />,
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name] ?? <path d="M6 12h.01M12 12h.01M18 12h.01" />}
    </svg>
  );
}

function responseTitle(response: Response): Promise<string> {
  return response
    .json()
    .catch(() => null)
    .then((body: unknown) =>
      body && typeof body === "object" && "title" in body && typeof body.title === "string"
        ? body.title
        : "No fue posible completar la solicitud.",
    );
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function formatMoney(amountMinor: string, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${amountMinor} ${currency}`;
  return new Intl.NumberFormat("es-CO", {
    currency,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(
    new Date(value),
  );
}

function fullDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatTotalsByCurrency(items: readonly Opportunity[]): string {
  const totals = new Map<string, bigint>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0n) + BigInt(item.amountMinor));
  }
  return (
    [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => `${formatMoney(amount.toString(), currency)} ${currency}`)
      .join(" · ") || "—"
  );
}

function historyLabel(entry: OpportunityHistoryEntry): string {
  const labels: Record<OpportunityHistoryEntry["eventType"], string> = {
    CREATED: "Oportunidad creada",
    STAGE_CHANGED: "Cambio de etapa",
    STATUS_CHANGED: "Estado comercial actualizado",
    OWNER_CHANGED: "Responsable actualizado",
    UPDATED: "Datos de la oportunidad actualizados",
  };
  return labels[entry.eventType];
}

function activeFilterCount(filters: BoardFilters): number {
  return [
    filters.stageId,
    filters.ownerMemberId,
    filters.status !== "OPEN" ? "status" : "",
    filters.label,
    filters.createdFrom,
    filters.createdTo,
  ].filter(Boolean).length;
}

export default function PipelinePage(): React.JSX.Element {
  const searchParams = useSearchParams();
  const requestedPipelineId = searchParams.get("pipeline") ?? "";
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<BoardFilters>(emptyFilters);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [boardView, setBoardView] = useState<BoardView>("kanban");
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [opportunityContactMode, setOpportunityContactMode] =
    useState<OpportunityContactMode>("existing");
  const [editor, setEditor] = useState<Opportunity | null>(null);
  const [history, setHistory] = useState<OpportunityHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactMatches, setContactMatches] = useState<Contact[]>([]);
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  const [contactSearchError, setContactSearchError] = useState<string | null>(null);
  const [creationContactId, setCreationContactId] = useState("");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [closeReasonError, setCloseReasonError] = useState<string | null>(null);
  const [moveMenuOpportunityId, setMoveMenuOpportunityId] = useState<string | null>(null);
  const [movingOpportunityId, setMovingOpportunityId] = useState<string | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<ReadonlySet<string>>(new Set());
  const [columnWidth, setColumnWidth] = useState(288);
  const [creationStageId, setCreationStageId] = useState("");
  const opportunityRequest = useRef(0);
  const historyRequest = useRef(0);
  const detailRequest = useRef(0);
  const didLoad = useRef(false);
  const opportunityCreationAttempt = useRef<OpportunityCreationAttempt | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastDrawerFocusRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const movingRef = useRef(false);
  const activePipelineRef = useRef("");
  const moveAttempt = useRef<{ readonly fingerprint: string; readonly key: string } | null>(null);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId],
  );
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const loadOpportunities = useCallback(
    async (pipelineId: string, nextFilters: BoardFilters): Promise<void> => {
      if (!pipelineId) {
        setOpportunities([]);
        return;
      }
      const requestId = opportunityRequest.current + 1;
      opportunityRequest.current = requestId;
      setBoardLoading(true);
      const query = new URLSearchParams({ pipelineId });
      if (nextFilters.stageId) query.set("stageId", nextFilters.stageId);
      if (nextFilters.ownerMemberId) query.set("ownerMemberId", nextFilters.ownerMemberId);
      if (nextFilters.status) query.set("status", nextFilters.status);
      if (nextFilters.label.trim()) query.set("label", nextFilters.label.trim());
      if (nextFilters.createdFrom)
        query.set("createdFrom", `${nextFilters.createdFrom}T00:00:00.000Z`);
      if (nextFilters.createdTo) query.set("createdTo", `${nextFilters.createdTo}T23:59:59.999Z`);
      try {
        const response = await fetch(`/api/opportunities?${query}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/pipeline");
          return;
        }
        if (!response.ok) throw new Error(await responseTitle(response));
        if (opportunityRequest.current === requestId)
          setOpportunities(((await response.json()) as List<Opportunity>).data);
      } finally {
        if (opportunityRequest.current === requestId) setBoardLoading(false);
      }
    },
    [],
  );

  const loadWorkspace = useCallback(
    async (preferredPipelineId?: string): Promise<void> => {
      setWorkspaceLoading(true);
      setError(null);
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (sessionResponse.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/pipeline");
          return;
        }
        const session = (await sessionResponse.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        setCsrf(session.csrfToken);
        const [pipelineResponse, memberResponse] = await Promise.all([
          fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/members?limit=100&status=ACTIVE", {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ]);
        for (const response of [pipelineResponse])
          if (!response.ok) throw new Error(await responseTitle(response));
        const pipelineData = ((await pipelineResponse.json()) as List<Pipeline>).data;
        setPipelines(pipelineData);
        if (memberResponse.ok) setMembers(((await memberResponse.json()) as List<Member>).data);
        const requestedId = preferredPipelineId ?? selectedPipelineId;
        const nextPipelineId = pipelineData.some((item) => item.id === requestedId)
          ? requestedId
          : (pipelineData[0]?.id ?? "");
        setSelectedPipelineId(nextPipelineId);
        activePipelineRef.current = nextPipelineId;
        await loadOpportunities(nextPipelineId, filters);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No fue posible cargar el pipeline.");
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [filters, loadOpportunities, selectedPipelineId],
  );

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadWorkspace(requestedPipelineId);
  }, [loadWorkspace, requestedPipelineId]);

  useEffect(() => {
    if (!selectedPipelineId) return;
    const controller = new AbortController();
    setContactsLoading(true);
    setContactsError(null);
    async function loadPipelineContacts(): Promise<void> {
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ pipelineId: selectedPipelineId, limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/contacts?${query}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await responseTitle(response));
        const result = ContactListResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setContacts((current) => [
          ...new Map([...current, ...result.data].map((contact) => [contact.id, contact])).values(),
        ]);
        cursor = result.page.nextCursor;
      } while (cursor && !controller.signal.aborted);
    }
    void loadPipelineContacts()
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setContactsError(
            cause instanceof Error ? cause.message : "No se pudieron cargar los contactos.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setContactsLoading(false);
      });
    return () => controller.abort();
  }, [selectedPipelineId]);

  useEffect(() => {
    if (!showCreate || opportunityContactMode !== "existing") return;
    const controller = new AbortController();
    setContactSearchLoading(true);
    setContactSearchError(null);
    const timer = window.setTimeout(
      () => {
        async function searchContacts(): Promise<void> {
          const query = new URLSearchParams({ limit: "100" });
          if (contactSearch.trim()) query.set("q", contactSearch.trim());
          const response = await fetch(`/api/contacts?${query}`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(await responseTitle(response));
          const result = ContactListResponseSchema.parse(await response.json());
          if (!controller.signal.aborted) setContactMatches(result.data);
        }
        void searchContacts()
          .catch((cause: unknown) => {
            if (!controller.signal.aborted)
              setContactSearchError(
                cause instanceof Error ? cause.message : "No se pudieron buscar contactos.",
              );
          })
          .finally(() => {
            if (!controller.signal.aborted) setContactSearchLoading(false);
          });
      },
      contactSearch ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [contactSearch, opportunityContactMode, showCreate]);

  useEffect(() => {
    if (!showCreate && !editor) return;
    lastDrawerFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeDrawer = (): void => {
      setShowCreate(false);
      setEditor(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
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
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current
        ?.querySelector<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        )
        ?.focus();
    });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      lastDrawerFocusRef.current?.focus();
    };
  }, [editor?.id, saving, showCreate]);

  async function mutate<T>(
    url: string,
    body: unknown,
    options: {
      readonly idempotencyKey?: string;
      readonly method?: "POST" | "PATCH";
      readonly version?: string;
    } = {},
  ): Promise<T | null> {
    if (!csrf) throw new Error("La sesión todavía no está lista. Intenta de nuevo.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
      "x-csrf-token": csrf,
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers,
      method: options.method ?? "POST",
    });
    if (response.status === 401) window.location.assign("/api/auth/login?returnTo=/pipeline");
    if (!response.ok) throw new RequestError(await responseTitle(response), response.status);
    const payload = (await response.json().catch(() => ({}))) as MutationResponse<T>;
    return payload.data ?? null;
  }

  async function refreshBoard(): Promise<void> {
    setError(null);
    try {
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar el tablero.");
    }
  }

  async function selectPipeline(pipelineId: string): Promise<void> {
    if (saving) return;
    setSelectedPipelineId(pipelineId);
    activePipelineRef.current = pipelineId;
    setOpportunities([]);
    setCollapsedStages(new Set());
    const nextFilters = { ...filters, stageId: "" };
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setSearch("");
    setError(null);
    try {
      await loadOpportunities(pipelineId, nextFilters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar ese pipeline.");
    }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await loadOpportunities(selectedPipelineId, draftFilters);
      setFilters(draftFilters);
      setOpenPanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar los filtros.");
    }
  }

  async function applyQuickStatus(status: BoardFilters["status"]): Promise<void> {
    const nextFilters = { ...filters, status };
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setError(null);
    try {
      await loadOpportunities(selectedPipelineId, nextFilters);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible filtrar las oportunidades.",
      );
    }
  }

  function openOpportunityCreator(stageId?: string): void {
    opportunityCreationAttempt.current = null;
    setError(null);
    setCreationStageId(stageId ?? selectedPipeline?.stages[0]?.id ?? "");
    setOpportunityContactMode("existing");
    setContactSearch("");
    setContactMatches([]);
    setCreationContactId("");
    setShowCreate(true);
  }

  async function createOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ownerMemberId = String(form.get("ownerMemberId") ?? "").trim();
    const existingContactId = String(form.get("contactId") ?? "").trim();
    const displayName = String(form.get("contactDisplayName") ?? "").trim();
    const email = String(form.get("contactEmail") ?? "").trim();
    const phone = String(form.get("contactPhone") ?? "").trim();
    if (opportunityContactMode === "existing" && !existingContactId) {
      setError("Selecciona un contacto o crea uno nuevo antes de guardar la oportunidad.");
      return;
    }
    if (opportunityContactMode === "new" && !displayName) {
      setError("Indica el nombre del contacto nuevo.");
      return;
    }
    const opportunityPayload = {
      amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
      currency: String(form.get("currency") ?? "").toUpperCase(),
      ownerMemberId: ownerMemberId || undefined,
      pipelineId: selectedPipeline.id,
      stageId: String(form.get("stageId") ?? ""),
      title: String(form.get("title") ?? "").trim(),
    };
    const contactPayload = JSON.stringify(
      opportunityContactMode === "existing"
        ? { id: existingContactId, mode: "existing" }
        : { displayName, email, mode: "new", phone },
    );
    const serializedOpportunityPayload = JSON.stringify(opportunityPayload);
    const matchingContactAttempt =
      opportunityCreationAttempt.current?.contactPayload === contactPayload
        ? opportunityCreationAttempt.current
        : null;
    const matchingOpportunityAttempt =
      matchingContactAttempt?.opportunityPayload === serializedOpportunityPayload
        ? matchingContactAttempt
        : null;
    let attempt: OpportunityCreationAttempt = {
      contactKey: matchingContactAttempt?.contactKey ?? crypto.randomUUID(),
      contactPayload,
      ...(matchingContactAttempt?.contactId
        ? { contactId: matchingContactAttempt.contactId }
        : opportunityContactMode === "existing"
          ? { contactId: existingContactId }
          : {}),
      opportunityKey: matchingOpportunityAttempt?.opportunityKey ?? crypto.randomUUID(),
      opportunityPayload: serializedOpportunityPayload,
    };
    opportunityCreationAttempt.current = attempt;
    setSaving(true);
    setError(null);
    try {
      let contactId = attempt.contactId;
      let createdContact: Contact | null = null;
      if (!contactId && opportunityContactMode === "new") {
        createdContact = await mutate<Contact>(
          "/api/contacts",
          {
            displayName,
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
          },
          { idempotencyKey: attempt.contactKey },
        );
        contactId = createdContact?.id;
      }
      if (!contactId) throw new Error("El servidor no confirmó el contacto creado.");
      if (attempt.contactId !== contactId) {
        attempt = { ...attempt, contactId };
        opportunityCreationAttempt.current = attempt;
      }
      const created = await mutate<Opportunity>(
        "/api/opportunities",
        { ...opportunityPayload, contactId },
        { idempotencyKey: attempt.opportunityKey },
      );
      if (!created) throw new Error("El servidor no confirmó la oportunidad creada.");
      if (createdContact) {
        const contact = createdContact;
        setContacts((current) =>
          current.some((item) => item.id === contact.id) ? current : [contact, ...current],
        );
      }
      setOpportunities((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      opportunityCreationAttempt.current = null;
      formElement.reset();
      setShowCreate(false);
      setNotice("Oportunidad creada y añadida al tablero.");
      void loadOpportunities(selectedPipeline.id, filters).catch(() => {
        setNotice("La oportunidad se creó. Actualiza el tablero para sincronizar los filtros.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la oportunidad.");
    } finally {
      setSaving(false);
    }
  }

  async function moveOpportunity(opportunity: Opportunity, stageId: string): Promise<void> {
    if (
      movingRef.current ||
      saving ||
      stageId === opportunity.stageId ||
      opportunity.status !== "OPEN"
    )
      return;
    if (!selectedPipeline?.stages.some((stage) => stage.id === stageId)) return;
    movingRef.current = true;
    setMovingOpportunityId(opportunity.id);
    setSaving(true);
    setError(null);
    setNotice(null);
    const pipelineId = selectedPipelineId;
    const fingerprint = `${opportunity.id}:${opportunity.version}:${stageId}`;
    const idempotencyKey =
      moveAttempt.current?.fingerprint === fingerprint
        ? moveAttempt.current.key
        : crypto.randomUUID();
    moveAttempt.current = { fingerprint, key: idempotencyKey };
    setOpportunities((current) =>
      current.map((item) => (item.id === opportunity.id ? { ...item, stageId } : item)),
    );
    try {
      const moved = await mutate<Opportunity>(
        `/api/opportunities/${opportunity.id}/move`,
        { stageId },
        { method: "PATCH", version: opportunity.version, idempotencyKey },
      );
      if (!moved)
        throw new Error(
          "El servidor no confirmó el movimiento. Actualiza antes de volver a intentarlo.",
        );
      moveAttempt.current = null;
      if (activePipelineRef.current === pipelineId) {
        setOpportunities((current) =>
          current
            .map((item) => (item.id === moved.id ? moved : item))
            .filter((item) => !filters.stageId || item.stageId === filters.stageId),
        );
        setEditor((current) => (current?.id === moved.id ? moved : current));
        setNotice(
          `Oportunidad movida a ${selectedPipeline.stages.find((stage) => stage.id === stageId)?.name ?? "la etapa seleccionada"}.`,
        );
        if (editor?.id === moved.id) void loadHistory(moved.id);
      }
    } catch (cause) {
      if (activePipelineRef.current === pipelineId) {
        setOpportunities((current) =>
          current.map((item) => (item.id === opportunity.id ? opportunity : item)),
        );
        setError(
          cause instanceof RequestError && cause.status === 412
            ? "Otra persona actualizó esta oportunidad. Cargamos la versión actual; revisa la etapa antes de volver a moverla."
            : cause instanceof Error
              ? cause.message
              : "No fue posible mover la oportunidad.",
        );
        try {
          const current = await fetchOpportunity(opportunity.id);
          setOpportunities((items) =>
            items
              .map((item) => (item.id === current.id ? current : item))
              .filter(
                (item) =>
                  (!filters.status || item.status === filters.status) &&
                  (!filters.stageId || item.stageId === filters.stageId),
              ),
          );
          setEditor((item) => (item?.id === current.id ? current : item));
        } catch {
          setError(
            "No pudimos confirmar el estado actual. El tablero conserva la última versión conocida; actualiza antes de volver a mover.",
          );
        }
      }
    } finally {
      setMoveMenuOpportunityId(null);
      setMovingOpportunityId(null);
      movingRef.current = false;
      setSaving(false);
    }
  }

  async function fetchOpportunity(id: string): Promise<Opportunity> {
    const response = await fetch(`/api/opportunities/${id}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new RequestError(await responseTitle(response), response.status);
    return ((await response.json()) as { readonly data: Opportunity }).data;
  }

  async function loadHistory(opportunityId: string): Promise<void> {
    const requestId = historyRequest.current + 1;
    historyRequest.current = requestId;
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/history`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/pipeline");
        return;
      }
      if (!response.ok) throw new Error(await responseTitle(response));
      if (historyRequest.current === requestId)
        setHistory(((await response.json()) as List<OpportunityHistoryEntry>).data);
    } catch (cause) {
      if (historyRequest.current === requestId)
        setHistoryError(
          cause instanceof Error ? cause.message : "No fue posible cargar la actividad.",
        );
    } finally {
      if (historyRequest.current === requestId) setHistoryLoading(false);
    }
  }

  async function openEditor(opportunity: Opportunity, fromPointer = false): Promise<void> {
    if (saving || (fromPointer && drag.suppressClick())) return;
    const requestId = ++detailRequest.current;
    setEditor(opportunity);
    setDetailLoading(true);
    setDetailError(null);
    setError(null);
    setCloseReasonError(null);
    void loadHistory(opportunity.id);
    try {
      const [detail, contactResponse] = await Promise.all([
        fetchOpportunity(opportunity.id),
        fetch(`/api/contacts/${opportunity.contactId}`, {
          cache: "no-store",
          credentials: "same-origin",
        }).catch(() => null),
      ]);
      if (detailRequest.current !== requestId) return;
      setEditor((current) => (current?.id === detail.id ? detail : current));
      setOpportunities((current) => current.map((item) => (item.id === detail.id ? detail : item)));
      if (contactResponse?.ok) {
        const contact = ((await contactResponse.json()) as { readonly data: Contact }).data;
        setContacts((current) => [...current.filter((item) => item.id !== contact.id), contact]);
      }
    } catch (cause) {
      if (detailRequest.current === requestId)
        setDetailError(
          cause instanceof Error ? cause.message : "No pudimos actualizar esta oportunidad.",
        );
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }

  async function updateOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor || saving || detailLoading || detailError) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status") as OpportunityStatus;
    const ownerMemberId = String(form.get("ownerMemberId") ?? "").trim();
    const reason = String(form.get("closeReason") ?? "").trim();
    if ((status === "LOST" || status === "ABANDONED") && !reason) {
      setCloseReasonError("Indica el motivo antes de cerrar esta oportunidad.");
      return;
    }
    setCloseReasonError(null);
    setSaving(true);
    setError(null);
    try {
      const updated = await mutate<Opportunity>(
        `/api/opportunities/${editor.id}`,
        {
          amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
          closeReason: status === "LOST" || status === "ABANDONED" ? reason || null : null,
          currency: String(form.get("currency")).toUpperCase(),
          ownerMemberId: ownerMemberId || undefined,
          status,
          title: form.get("title"),
        },
        { method: "PATCH", version: editor.version },
      );
      if (!updated)
        throw new Error(
          "El servidor no confirmó los cambios. Vuelve a abrir la oportunidad para comprobar su estado.",
        );
      setOpportunities((current) =>
        current
          .map((item) => (item.id === updated.id ? updated : item))
          .filter(
            (item) =>
              (!filters.status || item.status === filters.status) &&
              (!filters.ownerMemberId || item.ownerMemberId === filters.ownerMemberId),
          ),
      );
      setEditor(null);
      setNotice(status === "WON" ? "Oportunidad marcada como ganada." : "Oportunidad actualizada.");
    } catch (cause) {
      setError(
        cause instanceof RequestError && cause.status === 412
          ? "La oportunidad cambió mientras la editabas. Tus cambios siguen en el formulario. Cierra y vuelve a abrir para revisar la versión actual."
          : cause instanceof Error
            ? cause.message
            : "No fue posible actualizar la oportunidad.",
      );
    } finally {
      setSaving(false);
    }
  }

  const drag = useBoardDrag({
    boardRef,
    disabled: saving || boardLoading || workspaceLoading,
    onMove: moveOpportunity,
    stages: selectedPipeline?.stages ?? [],
  });

  const visibleOpportunities = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
    const visible = opportunities.filter((opportunity) => {
      if (!normalizedSearch) return true;
      const contact = contactById.get(opportunity.contactId);
      const owner = memberById.get(opportunity.ownerMemberId);
      return [
        opportunity.title,
        contact?.displayName,
        contact?.email,
        contact?.phone,
        owner?.displayName,
      ].some(
        (value) =>
          typeof value === "string" && value.toLocaleLowerCase("es-CO").includes(normalizedSearch),
      );
    });
    return [...visible].sort((first, second) => {
      if (sortMode === "name") return first.title.localeCompare(second.title, "es");
      if (sortMode === "amount") {
        if (first.currency !== second.currency)
          return first.currency.localeCompare(second.currency);
        const firstAmount = BigInt(first.amountMinor);
        const secondAmount = BigInt(second.amountMinor);
        return firstAmount === secondAmount ? 0 : firstAmount > secondAmount ? -1 : 1;
      }
      return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    });
  }, [contactById, memberById, opportunities, search, sortMode]);

  const totalValue = formatTotalsByCurrency(visibleOpportunities);
  const filterCount = activeFilterCount(filters);

  return (
    <CrmShell className={styles.pipelineShell ?? ""}>
      <section
        className={`${styles.workspace} ${styles.boardWorkspace}`}
        aria-busy={workspaceLoading || boardLoading}
      >
        <header className={styles.topbar}>
          <div className={styles.headingGroup}>
            <div className={styles.titleRow}>
              <h1>Oportunidades</h1>
              {selectedPipeline ? (
                <span className={styles.pipelinePill}>{selectedPipeline.stages.length} etapas</span>
              ) : null}
            </div>
          </div>
          <div className={styles.topActions}>
            <button
              className={styles.iconButton}
              type="button"
              onClick={() => void refreshBoard()}
              disabled={workspaceLoading || boardLoading || saving}
              title="Actualizar tablero"
              aria-label="Actualizar tablero"
            >
              <Icon name="refresh" />
            </button>
            {selectedPipeline?.stages.length ? (
              <button
                className={styles.primaryButton}
                type="button"
                onClick={() => openOpportunityCreator()}
                disabled={workspaceLoading || saving}
              >
                <Icon name="add" size={17} />
                Nueva oportunidad
              </button>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className={styles.feedbackError} role="alert">
            <strong>No se pudo completar la acción.</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso de error">
              <Icon name="close" size={15} />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className={styles.feedbackSuccess} role="status">
            <Icon name="check" size={16} />
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar confirmación">
              <Icon name="close" size={15} />
            </button>
          </div>
        ) : null}

        {pipelines.length > 0 ? (
          <section className={styles.controlDeck} aria-label="Controles del pipeline">
            <div className={styles.pipelineSelectWrap}>
              <span className={styles.controlLabel}>Pipeline</span>
              <select
                value={selectedPipelineId}
                onChange={(event) => void selectPipeline(event.target.value)}
                aria-label="Seleccionar pipeline"
                disabled={workspaceLoading || saving || pipelines.length === 0}
              >
                {pipelines.length === 0 ? <option value="">Sin pipelines</option> : null}
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={15} />
            </div>
            <label className={styles.searchBox}>
              <Icon name="search" size={17} />
              <span className={styles.visuallyHidden}>Buscar oportunidad</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar oportunidades o contactos"
                type="search"
              />
              {search ? (
                <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
                  <Icon name="close" size={14} />
                </button>
              ) : null}
            </label>
            <div className={styles.quickFilters} role="group" aria-label="Filtro rápido por estado">
              {(
                [
                  ["OPEN", "Abiertas"],
                  ["", "Todas"],
                  ["WON", "Ganadas"],
                ] as const
              ).map(([status, label]) => (
                <button
                  className={filters.status === status ? styles.quickFilterActive : undefined}
                  key={label}
                  type="button"
                  onClick={() => void applyQuickStatus(status)}
                  aria-pressed={filters.status === status}
                  disabled={saving || boardLoading}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className={`${styles.filterButton} ${filterCount > 0 ? styles.filterButtonActive : ""}`}
              type="button"
              onClick={() => {
                setDraftFilters(filters);
                setOpenPanel((current) => (current === "filters" ? null : "filters"));
              }}
              aria-expanded={openPanel === "filters"}
            >
              <Icon name="filter" size={16} />
              Filtros{filterCount > 0 ? <span>{filterCount}</span> : null}
            </button>
            <label className={styles.sortSelect}>
              <span className={styles.visuallyHidden}>Ordenar oportunidades</span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
              >
                <option value="recent">Más recientes</option>
                <option value="amount">Valor por moneda</option>
                <option value="name">Nombre A–Z</option>
              </select>
              <Icon name="chevron" size={14} />
            </label>
            <div className={styles.viewToggle} role="group" aria-label="Vista de oportunidades">
              <button
                type="button"
                aria-label="Vista Kanban"
                aria-pressed={boardView === "kanban"}
                onClick={() => setBoardView("kanban")}
                title="Vista Kanban"
              >
                <Icon name="columns" size={17} />
              </button>
              <button
                type="button"
                aria-label="Vista de tabla"
                aria-pressed={boardView === "table"}
                onClick={() => setBoardView("table")}
                title="Vista de tabla"
              >
                <Icon name="table" size={17} />
              </button>
            </div>
          </section>
        ) : null}

        {openPanel === "filters" ? (
          <section className={styles.utilityPanel} aria-label="Filtros avanzados">
            <div className={styles.utilityPanelHeader}>
              <div>
                <span>Vista del tablero</span>
                <h2>Filtrar oportunidades</h2>
              </div>
              <button type="button" onClick={() => setOpenPanel(null)} aria-label="Cerrar filtros">
                <Icon name="close" size={16} />
              </button>
            </div>
            <form className={styles.filterForm} onSubmit={(event) => void applyFilters(event)}>
              <label>
                Etapa
                <select
                  value={draftFilters.stageId}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, stageId: event.target.value })
                  }
                >
                  <option value="">Todas las etapas</option>
                  {selectedPipeline?.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select
                  value={draftFilters.ownerMemberId}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, ownerMemberId: event.target.value })
                  }
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
                Estado
                <select
                  value={draftFilters.status}
                  onChange={(event) =>
                    setDraftFilters({
                      ...draftFilters,
                      status: event.target.value as BoardFilters["status"],
                    })
                  }
                >
                  <option value="">Todos los estados</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etiqueta
                <input
                  value={draftFilters.label}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, label: event.target.value })
                  }
                  maxLength={120}
                  placeholder="Ej. renovación"
                />
              </label>
              <label>
                Creada desde
                <input
                  type="date"
                  value={draftFilters.createdFrom}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, createdFrom: event.target.value })
                  }
                />
              </label>
              <label>
                Creada hasta
                <input
                  type="date"
                  value={draftFilters.createdTo}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, createdTo: event.target.value })
                  }
                />
              </label>
              <div className={styles.filterActions}>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={boardLoading || saving}
                >
                  Aplicar filtros
                </button>
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => {
                    setFilters(emptyFilters);
                    setDraftFilters(emptyFilters);
                    void loadOpportunities(selectedPipelineId, emptyFilters).catch(() =>
                      setError("No se pudo restablecer el tablero."),
                    );
                  }}
                >
                  Restablecer
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {pipelines.length > 0 ? (
          <section className={styles.boardSummary} aria-label="Resumen del pipeline mostrado">
            <span>
              <strong>{visibleOpportunities.length}</strong> oportunidades
              {search ? ` de ${opportunities.length} cargadas` : ""}
            </span>
            <span>
              Valor de esta vista <strong>{totalValue}</strong>
            </span>
            {contactsLoading ? <small role="status">Cargando contactos…</small> : null}
            {contactsError ? (
              <small title={contactsError}>Algunos contactos no están disponibles.</small>
            ) : null}
            {boardView === "kanban" ? (
              <label className={styles.columnWidthControl}>
                Ancho de columnas
                <input
                  aria-label="Ancho de columnas"
                  type="range"
                  min="250"
                  max="390"
                  step="10"
                  value={columnWidth}
                  onChange={(event) => setColumnWidth(Number(event.target.value))}
                />
                <button
                  type="button"
                  onClick={() => {
                    setColumnWidth(288);
                    setCollapsedStages(new Set());
                  }}
                >
                  Restablecer
                </button>
              </label>
            ) : null}
          </section>
        ) : null}

        {workspaceLoading ? (
          <section className={styles.loadingState} role="status">
            <span className={styles.loader} aria-hidden="true" />
            <div>
              <strong>Preparando el tablero comercial</strong>
              <p>Estamos conectando oportunidades, contactos y responsables.</p>
            </div>
          </section>
        ) : null}
        {!workspaceLoading && pipelines.length === 0 ? (
          <section className={styles.emptyState}>
            <span className={styles.emptyGlyph} aria-hidden="true">
              ◇
            </span>
            <p className={styles.emptyEyebrow}>Proceso comercial</p>
            <h2>No hay un pipeline operativo</h2>
            <p>
              La configuración comercial vive en <strong>Pipelines</strong>, dentro de
              Administración en el menú lateral. Cuando haya etapas, este tablero quedará listo para
              registrar oportunidades.
            </p>
          </section>
        ) : null}
        {!workspaceLoading && selectedPipeline && selectedPipeline.stages.length === 0 ? (
          <section className={styles.emptyState}>
            <span className={styles.emptyGlyph} aria-hidden="true">
              →
            </span>
            <p className={styles.emptyEyebrow}>{selectedPipeline.name}</p>
            <h2>Este pipeline aún no tiene etapas</h2>
            <p>
              Añade las etapas desde <strong>Pipelines</strong>, dentro de Administración en el menú
              lateral. Aquí solo trabajas las oportunidades del proceso.
            </p>
          </section>
        ) : null}

        {!workspaceLoading &&
        selectedPipeline &&
        selectedPipeline.stages.length > 0 &&
        boardView === "kanban" ? (
          <section
            ref={boardRef}
            className={styles.boardViewport}
            aria-label={`Tablero ${selectedPipeline.name}`}
          >
            <div className={styles.kanbanBoard}>
              {selectedPipeline.stages.map((stage) => {
                const stageItems = visibleOpportunities.filter((item) => item.stageId === stage.id);
                const stageValue = formatTotalsByCurrency(stageItems);
                const isDropTarget = drag.targetStageId === stage.id;
                const collapsed = collapsedStages.has(stage.id);
                return (
                  <section
                    className={`${styles.stageColumn} ${isDropTarget ? styles.stageColumnDroppable : ""} ${collapsed ? styles.stageCollapsed : ""}`}
                    key={stage.id}
                    data-stage-id={stage.id}
                    style={{ width: collapsed ? 54 : columnWidth }}
                    aria-label={stage.name}
                  >
                    <header className={styles.stageHeader}>
                      <div className={styles.stageIdentity}>
                        <div>
                          <h2 id={`stage-${stage.id}`} title={stage.description}>
                            {stage.name}{" "}
                            <span className={styles.stageCount}>{stageItems.length}</span>
                          </h2>
                          {!collapsed ? <p>{stageValue}</p> : null}
                        </div>
                      </div>
                      <button
                        className={styles.collapseStage}
                        type="button"
                        aria-label={`${collapsed ? "Expandir" : "Contraer"} etapa ${stage.name}`}
                        aria-expanded={!collapsed}
                        onClick={() =>
                          setCollapsedStages((current) => {
                            const next = new Set(current);
                            if (next.has(stage.id)) next.delete(stage.id);
                            else next.add(stage.id);
                            return next;
                          })
                        }
                      >
                        <Icon name="chevron" size={14} />
                      </button>
                    </header>
                    {!collapsed ? (
                      <div className={styles.cardStack} data-card-stack="true">
                        {stageItems.map((opportunity) => {
                          const contact = contactById.get(opportunity.contactId);
                          const owner = memberById.get(opportunity.ownerMemberId);
                          const isDragging = opportunity.id === drag.opportunityId;
                          return (
                            <article
                              className={`${styles.dealCard} ${isDragging ? styles.dealCardDragging : ""} ${movingOpportunityId === opportunity.id ? styles.dealCardSaving : ""}`}
                              key={opportunity.id}
                              aria-label={`Oportunidad ${opportunity.title}`}
                              onPointerDown={(event) => drag.onPointerDown(event, opportunity)}
                              onPointerMove={drag.onPointerMove}
                              onPointerUp={drag.onPointerUp}
                              onPointerCancel={drag.cancel}
                              onClick={(event) => {
                                if (
                                  !(event.target instanceof Element) ||
                                  !event.target.closest("button, a, select")
                                )
                                  void openEditor(opportunity, event.detail > 0);
                              }}
                            >
                              <div className={styles.cardTopline}>
                                <span
                                  className={`${styles.statusBadge} ${styles[`status${statusTone[opportunity.status]}`]}`}
                                >
                                  {statusLabels[opportunity.status]}
                                </span>
                                {opportunity.status === "OPEN" ? (
                                  <button
                                    className={styles.dragHandle}
                                    data-drag-handle="true"
                                    type="button"
                                    aria-label={`Arrastrar ${opportunity.title}`}
                                    aria-describedby="board-move-help"
                                    disabled={saving || boardLoading}
                                    onKeyDown={(event) => drag.onHandleKeyDown(event, opportunity)}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <Icon name="grip" size={17} />
                                  </button>
                                ) : null}
                              </div>
                              <button
                                className={styles.dealTitle}
                                data-card-open="true"
                                type="button"
                                aria-label={`Abrir oportunidad ${opportunity.title}`}
                                onClick={(event) => void openEditor(opportunity, event.detail > 0)}
                              >
                                {opportunity.title}
                              </button>
                              <span className={styles.contactLink}>
                                <span className={styles.contactAvatar}>
                                  {initials(contact?.displayName ?? "C")}
                                </span>
                                <span>
                                  {contact?.displayName ??
                                    (contactsLoading
                                      ? "Cargando contacto…"
                                      : "Ver contacto en el detalle")}
                                </span>
                              </span>
                              <strong className={styles.dealValue}>
                                {formatMoney(opportunity.amountMinor, opportunity.currency)}{" "}
                                <small>{opportunity.currency}</small>
                              </strong>
                              <footer className={styles.cardFooter}>
                                <span
                                  className={styles.ownerIdentity}
                                  title={owner?.displayName ?? "Responsable no disponible"}
                                >
                                  <span className={styles.ownerAvatar}>
                                    {initials(owner?.displayName ?? "Q")}
                                  </span>
                                  <span>{owner?.displayName ?? "Responsable no disponible"}</span>
                                </span>
                                <time
                                  dateTime={opportunity.updatedAt}
                                  title={`Actualizada ${fullDate(opportunity.updatedAt)}`}
                                >
                                  {shortDate(opportunity.updatedAt)}
                                </time>
                              </footer>
                              {opportunity.status === "OPEN" ? (
                                <div className={styles.cardActionRow}>
                                  <button
                                    className={styles.moveMenuButton}
                                    type="button"
                                    disabled={saving || boardLoading}
                                    onClick={() =>
                                      setMoveMenuOpportunityId((current) =>
                                        current === opportunity.id ? null : opportunity.id,
                                      )
                                    }
                                    aria-expanded={moveMenuOpportunityId === opportunity.id}
                                    aria-controls={`move-${opportunity.id}`}
                                  >
                                    <Icon name="move" size={14} />
                                    Mover
                                  </button>
                                  {moveMenuOpportunityId === opportunity.id ? (
                                    <div
                                      className={styles.movePopover}
                                      id={`move-${opportunity.id}`}
                                      role="group"
                                      aria-label={`Mover ${opportunity.title} a otra etapa`}
                                    >
                                      <span>Mover a…</span>
                                      <div>
                                        {selectedPipeline.stages
                                          .filter((stage) => stage.id !== opportunity.stageId)
                                          .map((stage) => (
                                            <button
                                              key={stage.id}
                                              type="button"
                                              disabled={saving}
                                              onClick={() =>
                                                void moveOpportunity(opportunity, stage.id)
                                              }
                                            >
                                              {stage.name}
                                            </button>
                                          ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                        {stageItems.length === 0 ? (
                          <div className={styles.columnEmpty}>
                            <span aria-hidden="true">+</span>
                            <p>
                              {drag.opportunityId ? "Suelta aquí para mover" : "Sin oportunidades"}
                            </p>
                          </div>
                        ) : null}
                        <button
                          className={styles.addInStage}
                          type="button"
                          disabled={saving || boardLoading}
                          onClick={() => openOpportunityCreator(stage.id)}
                        >
                          <Icon name="add" size={15} /> Añadir oportunidad
                        </button>
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
            {boardLoading ? (
              <div className={styles.boardProgress} role="status">
                Actualizando tablero…
              </div>
            ) : null}
            {!boardLoading && visibleOpportunities.length === 0 ? (
              <div className={styles.boardEmptyOverlay}>
                <span aria-hidden="true">⌁</span>
                <strong>No hay oportunidades para esta vista</strong>
                <p>Prueba restableciendo los filtros o crea una nueva oportunidad.</p>
                {search || filterCount > 0 ? (
                  <button
                    className={styles.textButton}
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setFilters(emptyFilters);
                      setDraftFilters(emptyFilters);
                      void loadOpportunities(selectedPipelineId, emptyFilters).catch(() =>
                        setError("No se pudo restablecer el tablero."),
                      );
                    }}
                  >
                    Limpiar vista
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
        <span className={styles.visuallyHidden} id="board-move-help">
          Arrastra a otra etapa. Con teclado, pulsa espacio, usa las flechas y confirma con Enter.
          Escape cancela.
        </span>
        <span className={styles.visuallyHidden} role="status" aria-live="polite">
          {drag.announcement}
        </span>

        {!workspaceLoading &&
        selectedPipeline &&
        selectedPipeline.stages.length > 0 &&
        boardView === "table" ? (
          <section className={styles.tableViewport} aria-label="Tabla de oportunidades">
            <table className={styles.dealTable}>
              <caption className={styles.visuallyHidden}>
                Oportunidades de {selectedPipeline.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Oportunidad</th>
                  <th scope="col">Etapa</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Actualizada</th>
                  <th scope="col">
                    <span className={styles.visuallyHidden}>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleOpportunities.map((opportunity) => {
                  const contact = contactById.get(opportunity.contactId);
                  const owner = memberById.get(opportunity.ownerMemberId);
                  const stage = selectedPipeline.stages.find(
                    (item) => item.id === opportunity.stageId,
                  );
                  return (
                    <tr key={opportunity.id}>
                      <td>
                        <button
                          className={styles.tableTitle}
                          type="button"
                          onClick={() => void openEditor(opportunity)}
                        >
                          {opportunity.title}
                        </button>
                        <a href={`/contacts/${opportunity.contactId}`}>
                          {contact?.displayName ?? "Contacto"}
                        </a>
                      </td>
                      <td>
                        {opportunity.status === "OPEN" ? (
                          <select
                            className={styles.tableMove}
                            value={opportunity.stageId}
                            disabled={saving}
                            onChange={(event) =>
                              void moveOpportunity(opportunity, event.target.value)
                            }
                            aria-label={`Mover ${opportunity.title}`}
                          >
                            {selectedPipeline.stages.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          (stage?.name ?? "Etapa eliminada")
                        )}
                      </td>
                      <td>
                        <span className={styles.tableOwner}>
                          <span>{initials(owner?.displayName ?? "Q")}</span>
                          {owner?.displayName ?? "Sin responsable"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${styles[`status${statusTone[opportunity.status]}`]}`}
                        >
                          {statusLabels[opportunity.status]}
                        </span>
                      </td>
                      <td className={styles.tableAmount}>
                        {formatMoney(opportunity.amountMinor, opportunity.currency)}
                      </td>
                      <td>
                        <time
                          dateTime={opportunity.updatedAt}
                          title={fullDate(opportunity.updatedAt)}
                        >
                          {shortDate(opportunity.updatedAt)}
                        </time>
                      </td>
                      <td>
                        <button
                          className={styles.rowAction}
                          type="button"
                          onClick={() => void openEditor(opportunity)}
                          aria-label={`Abrir ${opportunity.title}`}
                        >
                          <Icon name="more" size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!boardLoading && visibleOpportunities.length === 0 ? (
              <p className={styles.tableEmpty}>
                No hay oportunidades que coincidan con esta vista.
              </p>
            ) : null}
            {boardLoading ? (
              <div className={styles.boardProgress} role="status">
                Actualizando tablero…
              </div>
            ) : null}
          </section>
        ) : null}
      </section>

      {showCreate && selectedPipeline ? (
        <div
          className={styles.drawerBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) setShowCreate(false);
          }}
        >
          <aside
            ref={drawerRef}
            className={styles.drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-deal-title"
          >
            <header className={styles.drawerHeader}>
              <div>
                <span>Nueva oportunidad</span>
                <h2 id="new-deal-title">Registrar negocio</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={saving}
                aria-label="Cerrar"
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            <p className={styles.drawerIntro}>
              Se creará dentro de <strong>{selectedPipeline.name}</strong> y quedará disponible de
              inmediato en el tablero.
            </p>
            <form className={styles.drawerForm} onSubmit={(event) => void createOpportunity(event)}>
              {error ? (
                <div className={styles.drawerError} role="alert">
                  <strong>No se pudo crear la oportunidad.</strong>
                  <span>{error}</span>
                </div>
              ) : null}
              <fieldset className={styles.contactSource}>
                <legend>
                  Contacto <em>*</em>
                </legend>
                <p>Elige uno existente o crea un contacto real sin salir de esta oportunidad.</p>
                <div
                  className={styles.contactSourceOptions}
                  role="radiogroup"
                  aria-label="Origen del contacto"
                >
                  <label>
                    <input
                      checked={opportunityContactMode === "existing"}
                      name="contactMode"
                      onChange={() => setOpportunityContactMode("existing")}
                      type="radio"
                      value="existing"
                    />
                    <span>Elegir contacto existente</span>
                  </label>
                  <label>
                    <input
                      checked={opportunityContactMode === "new"}
                      name="contactMode"
                      onChange={() => setOpportunityContactMode("new")}
                      type="radio"
                      value="new"
                    />
                    <span>Crear contacto nuevo</span>
                  </label>
                </div>
                {opportunityContactMode === "existing" ? (
                  <div className={styles.existingContactPicker}>
                    <label>
                      Buscar contacto
                      <input
                        type="search"
                        value={contactSearch}
                        maxLength={160}
                        onChange={(event) => {
                          setContactSearch(event.target.value);
                          setCreationContactId("");
                        }}
                        placeholder="Nombre, correo o teléfono"
                      />
                    </label>
                    <label>
                      Contacto existente
                      <select
                        name="contactId"
                        required
                        value={creationContactId}
                        onChange={(event) => setCreationContactId(event.target.value)}
                        disabled={contactSearchLoading}
                      >
                        <option value="" disabled>
                          Selecciona un contacto
                        </option>
                        {contactMatches.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.displayName}
                            {contact.email
                              ? ` · ${contact.email}`
                              : contact.phone
                                ? ` · ${contact.phone}`
                                : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {contactSearchLoading ? (
                      <small role="status">Buscando contactos…</small>
                    ) : contactSearchError ? (
                      <small role="alert">{contactSearchError}</small>
                    ) : (
                      <small>
                        {contactMatches.length} resultados. Escribe para precisar la búsqueda.
                      </small>
                    )}
                  </div>
                ) : (
                  <div className={styles.quickContactFields}>
                    <label>
                      Nombre del contacto <em>*</em>
                      <input
                        name="contactDisplayName"
                        required
                        maxLength={160}
                        placeholder="Ej. Ana Pérez"
                      />
                    </label>
                    <label>
                      Correo
                      <input
                        name="contactEmail"
                        type="email"
                        maxLength={320}
                        placeholder="ana@empresa.com"
                      />
                    </label>
                    <label>
                      Teléfono
                      <input
                        name="contactPhone"
                        maxLength={40}
                        minLength={3}
                        placeholder="+57 300 000 0000"
                      />
                    </label>
                  </div>
                )}
              </fieldset>
              <label>
                Nombre de la oportunidad <em>*</em>
                <input
                  name="title"
                  required
                  maxLength={160}
                  placeholder="Ej. Renovación anual — Sede Norte"
                />
              </label>
              <div className={styles.drawerPair}>
                <label>
                  Valor estimado <em>*</em>
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    required
                    placeholder="0"
                  />
                </label>
                <label>
                  Moneda <em>*</em>
                  <input name="currency" defaultValue="COP" minLength={3} maxLength={3} required />
                </label>
              </div>
              <label>
                Etapa inicial <em>*</em>
                <select name="stageId" required defaultValue={creationStageId}>
                  {selectedPipeline.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select name="ownerMemberId" defaultValue="">
                  <option value="">Asignar según la política del equipo</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.drawerActions}>
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={saving}
                  onClick={() => setShowCreate(false)}
                >
                  Cancelar
                </button>
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  {saving ? "Creando…" : "Crear oportunidad"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {editor && selectedPipeline ? (
        <div
          className={styles.drawerBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) setEditor(null);
          }}
        >
          <aside
            ref={drawerRef}
            className={`${styles.drawer} ${styles.detailDrawer}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deal-detail-title"
          >
            <header className={styles.drawerHeader}>
              <div>
                <span>Oportunidad</span>
                <h2 id="deal-detail-title">{editor.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                disabled={saving}
                aria-label="Cerrar"
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            {detailLoading ? (
              <p className={styles.detailLoadNotice} role="status">
                Actualizando información de la oportunidad…
              </p>
            ) : null}
            {detailError ? (
              <div className={styles.drawerError} role="alert">
                <span>{detailError}</span>
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={() => void openEditor(editor)}
                >
                  Volver a cargar
                </button>
              </div>
            ) : null}
            {error ? (
              <div className={styles.drawerError} role="alert">
                <span>{error}</span>
              </div>
            ) : null}
            <div className={styles.detailIdentity}>
              <a href={`/contacts/${editor.contactId}`}>
                <span>{initials(contactById.get(editor.contactId)?.displayName ?? "C")}</span>
                <div>
                  <strong>
                    {contactById.get(editor.contactId)?.displayName ?? "Contacto asociado"}
                  </strong>
                  <small>
                    {contactById.get(editor.contactId)?.email ?? "Sin correo registrado"}
                  </small>
                  <small>
                    {contactById.get(editor.contactId)?.phone ?? "Sin teléfono registrado"}
                  </small>
                </div>
              </a>
              <span
                className={`${styles.statusBadge} ${styles[`status${statusTone[editor.status]}`]}`}
              >
                {statusLabels[editor.status]}
              </span>
            </div>
            {contactById.get(editor.contactId)?.labels.length ? (
              <div className={styles.contactLabels}>
                {contactById.get(editor.contactId)?.labels.map((label) => (
                  <span key={label.id}>{label.name}</span>
                ))}
              </div>
            ) : null}
            <div className={styles.detailMoveBar}>
              <span>
                <Icon name="move" size={15} /> {selectedPipeline.name}
              </span>
              <select
                value={editor.stageId}
                disabled={
                  saving || detailLoading || Boolean(detailError) || editor.status !== "OPEN"
                }
                onChange={(event) => void moveOpportunity(editor, event.target.value)}
                aria-label="Mover oportunidad a etapa"
              >
                {selectedPipeline.stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            </div>
            {contactById.get(editor.contactId) ? (
              <ContactCustomFields
                key={editor.contactId}
                fields={contactById.get(editor.contactId)?.customFields ?? []}
                title="Campos personalizados del contacto"
              />
            ) : null}
            <SourceParticipantsCard participants={editor.sourceParticipants} kind="oportunidad" />
            <div className={styles.drawerBodyGrid}>
              <form
                className={styles.drawerForm}
                key={`${editor.id}:${detailLoading ? "loading" : "ready"}`}
                onSubmit={(event) => void updateOpportunity(event)}
              >
                <fieldset
                  className={styles.detailFields}
                  disabled={saving || detailLoading || Boolean(detailError)}
                >
                  <div className={styles.sectionKicker}>
                    <Icon name="settings" size={15} /> Detalles comerciales
                  </div>
                  <label>
                    Nombre <em>*</em>
                    <input name="title" required maxLength={160} defaultValue={editor.title} />
                  </label>
                  <div className={styles.drawerPair}>
                    <label>
                      Valor <em>*</em>
                      <input
                        name="amount"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        defaultValue={Number(editor.amountMinor) / 100}
                      />
                    </label>
                    <label>
                      Moneda <em>*</em>
                      <input
                        name="currency"
                        minLength={3}
                        maxLength={3}
                        required
                        defaultValue={editor.currency}
                      />
                    </label>
                  </div>
                  <label>
                    Responsable
                    <select name="ownerMemberId" defaultValue={editor.ownerMemberId}>
                      {!memberById.has(editor.ownerMemberId) ? (
                        <option value={editor.ownerMemberId}>
                          Responsable actual (no disponible en el directorio)
                        </option>
                      ) : null}
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Estado comercial
                    <select name="status" defaultValue={editor.status}>
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Motivo de pérdida o abandono
                    <textarea
                      name="closeReason"
                      maxLength={2000}
                      defaultValue={editor.closeReason ?? ""}
                      aria-describedby={closeReasonError ? "close-reason-error" : undefined}
                      onChange={() => setCloseReasonError(null)}
                      placeholder="Añade contexto cuando la oportunidad no continúe."
                    />
                    {closeReasonError ? (
                      <small className={styles.historyError} id="close-reason-error" role="alert">
                        {closeReasonError}
                      </small>
                    ) : null}
                  </label>
                </fieldset>
                <div className={styles.drawerActions}>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={saving}
                    onClick={() => setEditor(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className={styles.primaryButton}
                    type="submit"
                    disabled={saving || detailLoading || Boolean(detailError)}
                  >
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>
              </form>
              <section className={styles.historyPanel} aria-labelledby="history-heading">
                <div className={styles.historyHeader}>
                  <div>
                    <span>
                      <Icon name="history" size={15} /> Actividad
                    </span>
                    <h3 id="history-heading">Historial de la oportunidad</h3>
                  </div>
                  <time dateTime={editor.createdAt}>Creada {shortDate(editor.createdAt)}</time>
                </div>
                {historyLoading ? (
                  <p className={styles.historyLoading}>Cargando actividad…</p>
                ) : null}
                {historyError ? <p className={styles.historyError}>{historyError}</p> : null}
                {!historyLoading && !historyError && history.length === 0 ? (
                  <p className={styles.historyEmpty}>
                    Aún no hay movimientos registrados para esta oportunidad.
                  </p>
                ) : null}
                {!historyLoading && history.length > 0 ? (
                  <ol className={styles.timeline}>
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{historyLabel(entry)}</strong>
                          <span className={styles.historyActor}>
                            {memberById.get(entry.actorMemberId)?.displayName ??
                              "Miembro del equipo"}
                          </span>
                          <time dateTime={entry.createdAt}>{fullDate(entry.createdAt)}</time>
                          {entry.previousStageId && entry.nextStageId ? (
                            <p>
                              {selectedPipeline.stages.find(
                                (stage) => stage.id === entry.previousStageId,
                              )?.name ?? "Etapa anterior"}{" "}
                              →{" "}
                              {selectedPipeline.stages.find(
                                (stage) => stage.id === entry.nextStageId,
                              )?.name ?? "Etapa actual"}
                            </p>
                          ) : null}
                          {entry.previousStatus && entry.nextStatus ? (
                            <p>
                              {statusLabels[entry.previousStatus]} →{" "}
                              {statusLabels[entry.nextStatus]}
                            </p>
                          ) : null}
                          {entry.previousOwnerMemberId && entry.nextOwnerMemberId ? (
                            <p>
                              {memberById.get(entry.previousOwnerMemberId)?.displayName ??
                                "Responsable anterior"}{" "}
                              →{" "}
                              {memberById.get(entry.nextOwnerMemberId)?.displayName ??
                                "Responsable actual"}
                            </p>
                          ) : null}
                          {entry.previousAmountMinor !== null && entry.nextAmountMinor !== null ? (
                            <p>
                              Valor:{" "}
                              {(Number(entry.previousAmountMinor) / 100).toLocaleString("es-CO")} →{" "}
                              {(Number(entry.nextAmountMinor) / 100).toLocaleString("es-CO")}
                            </p>
                          ) : null}
                          {entry.note ? <p>{entry.note}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </CrmShell>
  );
}
