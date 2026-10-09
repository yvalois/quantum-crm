"use client";

import type {
  Contact,
  Member,
  Opportunity,
  OpportunityHistoryEntry,
  OpportunityStatus,
  Pipeline,
  PipelineStage,
} from "@quantum-crm/contracts";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CrmShell } from "../crm-shell";
import styles from "./pipeline.module.css";

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
  readonly ownerMemberId: string;
  readonly status: "" | OpportunityStatus;
  readonly label: string;
  readonly createdFrom: string;
  readonly createdTo: string;
}

type BoardView = "kanban" | "table";
type SortMode = "recent" | "amount" | "name";
type Panel = "filters" | "manage" | null;

const emptyFilters: BoardFilters = {
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

function Icon({ name, size = 18 }: { readonly name: string; readonly size?: number }): React.JSX.Element {
  const paths: Record<string, React.JSX.Element> = {
    add: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    columns: <path d="M4 5h5v14H4zM10 5h5v14h-5zM16 5h4v14h-4z" />,
    filter: <path d="M4 6h16M7 12h10M10 18h4" />,
    history: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 5v4h4M12 8v4l3 2" />,
    move: <path d="M5 8h14M15 5l4 3-4 3M19 16H5M9 13l-4 3 4 3" />,
    more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
    refresh: <path d="M20 11a8 8 0 0 0-14.8-4.2L4 9M4 5v4h4M4 13a8 8 0 0 0 14.8 4.2L20 15M20 19v-4h-4" />,
    search: <path d="m20 20-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />,
    settings: <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.3 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.3 2.6h4.4l.3-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />,
    table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M9 5v14" />,
  };
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size}>
      {paths[name] ?? <path d="M6 12h.01M12 12h.01M18 12h.01" />}
    </svg>
  );
}

function responseTitle(response: Response): Promise<string> {
  return response.json().catch(() => null).then((body: unknown) =>
    body && typeof body === "object" && "title" in body && typeof body.title === "string"
      ? body.title
      : "No fue posible completar la solicitud.",
  );
}

function formatMoney(amountMinor: string, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${amountMinor} ${currency}`;
  return new Intl.NumberFormat("es-CO", { currency, maximumFractionDigits: 0, style: "currency" }).format(amount);
}

function initials(value: string): string {
  return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(new Date(value));
}

function fullDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatTotalsByCurrency(items: readonly Opportunity[]): string {
  const totals = new Map<string, bigint>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0n) + BigInt(item.amountMinor));
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => formatMoney(amount.toString(), currency))
    .join(" · ") || "—";
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
  return [filters.ownerMemberId, filters.status !== "OPEN" ? filters.status : "", filters.label, filters.createdFrom, filters.createdTo].filter(Boolean).length;
}

export default function PipelinePage(): React.JSX.Element {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
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
  const [editor, setEditor] = useState<Opportunity | null>(null);
  const [history, setHistory] = useState<OpportunityHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [closeReasonError, setCloseReasonError] = useState<string | null>(null);
  const [draggedOpportunityId, setDraggedOpportunityId] = useState<string | null>(null);
  const [moveMenuOpportunityId, setMoveMenuOpportunityId] = useState<string | null>(null);
  const opportunityRequest = useRef(0);
  const historyRequest = useRef(0);
  const didLoad = useRef(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastDrawerFocusRef = useRef<HTMLElement | null>(null);

  const selectedPipeline = useMemo(() => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null, [pipelines, selectedPipelineId]);
  const contactById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const loadOpportunities = useCallback(async (pipelineId: string, nextFilters: BoardFilters): Promise<void> => {
    if (!pipelineId) { setOpportunities([]); return; }
    const requestId = opportunityRequest.current + 1;
    opportunityRequest.current = requestId;
    setBoardLoading(true);
    const query = new URLSearchParams({ pipelineId });
    if (nextFilters.ownerMemberId) query.set("ownerMemberId", nextFilters.ownerMemberId);
    if (nextFilters.status) query.set("status", nextFilters.status);
    if (nextFilters.label.trim()) query.set("label", nextFilters.label.trim());
    if (nextFilters.createdFrom) query.set("createdFrom", `${nextFilters.createdFrom}T00:00:00.000Z`);
    if (nextFilters.createdTo) query.set("createdTo", `${nextFilters.createdTo}T23:59:59.999Z`);
    try {
      const response = await fetch(`/api/opportunities?${query}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { window.location.assign("/api/auth/login?returnTo=/pipeline"); return; }
      if (!response.ok) throw new Error(await responseTitle(response));
      if (opportunityRequest.current === requestId) setOpportunities(((await response.json()) as List<Opportunity>).data);
    } finally {
      if (opportunityRequest.current === requestId) setBoardLoading(false);
    }
  }, []);

  const loadWorkspace = useCallback(async (preferredPipelineId?: string): Promise<void> => {
    setWorkspaceLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (sessionResponse.status === 401) { window.location.assign("/api/auth/login?returnTo=/pipeline"); return; }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const [pipelineResponse, contactResponse, memberResponse] = await Promise.all([
        fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/members?limit=100&status=ACTIVE", { cache: "no-store", credentials: "same-origin" }),
      ]);
      for (const response of [pipelineResponse, contactResponse, memberResponse]) if (!response.ok) throw new Error(await responseTitle(response));
      const pipelineData = ((await pipelineResponse.json()) as List<Pipeline>).data;
      setPipelines(pipelineData);
      setContacts(((await contactResponse.json()) as List<Contact>).data);
      setMembers(((await memberResponse.json()) as List<Member>).data);
      const requestedId = preferredPipelineId ?? selectedPipelineId;
      const nextPipelineId = pipelineData.some((item) => item.id === requestedId) ? requestedId : (pipelineData[0]?.id ?? "");
      setSelectedPipelineId(nextPipelineId);
      await loadOpportunities(nextPipelineId, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el pipeline.");
    } finally {
      setWorkspaceLoading(false);
    }
  }, [filters, loadOpportunities, selectedPipelineId]);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!showCreate && !editor) return;
    lastDrawerFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        )
        ?.focus();
    });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      lastDrawerFocusRef.current?.focus();
    };
  }, [editor, saving, showCreate]);

  async function mutate<T>(url: string, body: unknown, options: { readonly method?: "POST" | "PATCH"; readonly version?: string } = {}): Promise<T | null> {
    if (!csrf) throw new Error("La sesión todavía no está lista. Intenta de nuevo.");
    const headers: Record<string, string> = { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-csrf-token": csrf };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, { body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", headers, method: options.method ?? "POST" });
    if (!response.ok) throw new Error(await responseTitle(response));
    const payload = (await response.json().catch(() => ({}))) as MutationResponse<T>;
    return payload.data ?? null;
  }

  async function refreshBoard(): Promise<void> {
    setError(null);
    try { await loadOpportunities(selectedPipelineId, filters); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar el tablero."); }
  }

  async function selectPipeline(pipelineId: string): Promise<void> {
    setSelectedPipelineId(pipelineId);
    setSearch("");
    setError(null);
    try { await loadOpportunities(pipelineId, filters); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible cargar ese pipeline."); }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try { await loadOpportunities(selectedPipelineId, filters); setOpenPanel(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible aplicar los filtros."); }
  }

  async function applyQuickStatus(status: BoardFilters["status"]): Promise<void> {
    const nextFilters = { ...filters, status };
    setFilters(nextFilters);
    setError(null);
    try { await loadOpportunities(selectedPipelineId, nextFilters); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible filtrar las oportunidades."); }
  }

  async function createPipeline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(null);
    try {
      const created = await mutate<Pipeline>("/api/pipeline", { description: form.get("description"), name: form.get("name") });
      event.currentTarget.reset();
      setNotice("Pipeline creado. Ahora puedes definir sus etapas.");
      await loadWorkspace(created?.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear el pipeline."); }
    finally { setSaving(false); }
  }

  async function createStage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError(null);
    try {
      await mutate<PipelineStage>(`/api/pipeline/${selectedPipeline.id}/stages`, { description: form.get("description"), name: form.get("name"), position: Number(form.get("position")) });
      event.currentTarget.reset();
      setNotice("Etapa añadida al pipeline.");
      await loadWorkspace(selectedPipeline.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear la etapa."); }
    finally { setSaving(false); }
  }

  async function createOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const form = new FormData(event.currentTarget);
    const ownerMemberId = String(form.get("ownerMemberId") ?? "").trim();
    setSaving(true); setError(null);
    try {
      await mutate<Opportunity>("/api/opportunities", {
        amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
        contactId: form.get("contactId"),
        currency: String(form.get("currency")).toUpperCase(),
        ownerMemberId: ownerMemberId || undefined,
        pipelineId: selectedPipeline.id,
        stageId: form.get("stageId"),
        title: form.get("title"),
      });
      event.currentTarget.reset();
      setShowCreate(false);
      setNotice("Oportunidad creada y añadida al tablero.");
      await loadOpportunities(selectedPipeline.id, filters);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible crear la oportunidad."); }
    finally { setSaving(false); }
  }

  async function moveOpportunity(opportunity: Opportunity, stageId: string): Promise<void> {
    if (stageId === opportunity.stageId || opportunity.status !== "OPEN") return;
    setSaving(true); setError(null);
    try {
      const moved = await mutate<Opportunity>(`/api/opportunities/${opportunity.id}/move`, { stageId }, { method: "PATCH", version: opportunity.version });
      if (moved) setEditor((current) => current?.id === moved.id ? moved : current);
      setNotice("Oportunidad movida de etapa.");
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible mover la oportunidad."); }
    finally { setDraggedOpportunityId(null); setMoveMenuOpportunityId(null); setSaving(false); }
  }

  async function openEditor(opportunity: Opportunity): Promise<void> {
    const requestId = historyRequest.current + 1;
    historyRequest.current = requestId;
    setEditor(opportunity); setHistory([]); setHistoryError(null); setCloseReasonError(null); setHistoryLoading(true);
    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}/history`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { window.location.assign("/api/auth/login?returnTo=/pipeline"); return; }
      if (!response.ok) throw new Error(await responseTitle(response));
      if (historyRequest.current === requestId) setHistory(((await response.json()) as List<OpportunityHistoryEntry>).data);
    } catch (cause) {
      if (historyRequest.current === requestId) setHistoryError(cause instanceof Error ? cause.message : "No fue posible cargar la actividad.");
    } finally { if (historyRequest.current === requestId) setHistoryLoading(false); }
  }

  async function updateOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status") as OpportunityStatus;
    const ownerMemberId = String(form.get("ownerMemberId") ?? "").trim();
    const reason = String(form.get("closeReason") ?? "").trim();
    if ((status === "LOST" || status === "ABANDONED") && !reason) {
      setCloseReasonError("Indica el motivo antes de cerrar esta oportunidad.");
      return;
    }
    setCloseReasonError(null);
    setSaving(true); setError(null);
    try {
      await mutate<Opportunity>(`/api/opportunities/${editor.id}`, {
        amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
        closeReason: status === "LOST" || status === "ABANDONED" ? reason || null : null,
        currency: String(form.get("currency")).toUpperCase(),
        ownerMemberId: ownerMemberId || undefined,
        status,
        title: form.get("title"),
      }, { method: "PATCH", version: editor.version });
      setEditor(null);
      setNotice(status === "WON" ? "Oportunidad marcada como ganada." : "Oportunidad actualizada.");
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible actualizar la oportunidad."); }
    finally { setSaving(false); }
  }

  function handleDrop(stageId: string): void {
    const opportunity = opportunities.find((item) => item.id === draggedOpportunityId);
    if (opportunity) void moveOpportunity(opportunity, stageId);
  }

  const visibleOpportunities = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");
    const visible = opportunities.filter((opportunity) => {
      if (!normalizedSearch) return true;
      const contact = contactById.get(opportunity.contactId);
      const owner = memberById.get(opportunity.ownerMemberId);
      return [opportunity.title, contact?.displayName, contact?.email, owner?.displayName].some(
        (value) => typeof value === "string" && value.toLocaleLowerCase("es-CO").includes(normalizedSearch),
      );
    });
    return [...visible].sort((first, second) => {
      if (sortMode === "name") return first.title.localeCompare(second.title, "es");
      if (sortMode === "amount") {
        const firstAmount = BigInt(first.amountMinor); const secondAmount = BigInt(second.amountMinor);
        return firstAmount === secondAmount ? 0 : firstAmount > secondAmount ? -1 : 1;
      }
      return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    });
  }, [contactById, memberById, opportunities, search, sortMode]);

  const openOpportunities = visibleOpportunities.filter((item) => item.status === "OPEN");
  const openValue = formatTotalsByCurrency(openOpportunities);
  const totalValue = formatTotalsByCurrency(visibleOpportunities);
  const wonOpportunities = visibleOpportunities.filter((item) => item.status === "WON");
  const filterCount = activeFilterCount(filters);

  return (
    <CrmShell className={styles.pipelineShell}>
      <section className={styles.workspace} aria-busy={workspaceLoading || boardLoading}>
        <header className={styles.topbar}>
          <div className={styles.headingGroup}>
            <div className={styles.eyebrowRow}><span className={styles.liveDot} aria-hidden="true" />Ventas · tablero en vivo</div>
            <div className={styles.titleRow}><h1>Oportunidades</h1>{selectedPipeline ? <span className={styles.pipelinePill}>{selectedPipeline.stages.length} etapas</span> : null}</div>
            <p>Un espacio para priorizar, avanzar y cerrar cada negociación sin salir del contexto.</p>
          </div>
          <div className={styles.topActions}>
            <button className={styles.iconButton} type="button" onClick={() => void refreshBoard()} disabled={workspaceLoading || boardLoading} title="Actualizar tablero" aria-label="Actualizar tablero"><Icon name="refresh" /></button>
            <button className={styles.ghostButton} type="button" onClick={() => setOpenPanel((current) => current === "manage" ? null : "manage")} aria-expanded={openPanel === "manage"}><Icon name="settings" size={16} />Gestionar</button>
            <button className={styles.primaryButton} type="button" onClick={() => setShowCreate(true)} disabled={!selectedPipeline?.stages.length || contacts.length === 0}><Icon name="add" size={17} />Nueva oportunidad</button>
          </div>
        </header>

        {error ? <div className={styles.feedbackError} role="alert"><strong>No se pudo completar la acción.</strong><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso de error"><Icon name="close" size={15} /></button></div> : null}
        {notice ? <div className={styles.feedbackSuccess} role="status"><Icon name="check" size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar confirmación"><Icon name="close" size={15} /></button></div> : null}

        <section className={styles.controlDeck} aria-label="Controles del pipeline">
          <div className={styles.pipelineSelectWrap}>
            <span className={styles.controlLabel}>Pipeline</span>
            <select value={selectedPipelineId} onChange={(event) => void selectPipeline(event.target.value)} aria-label="Seleccionar pipeline" disabled={workspaceLoading || pipelines.length === 0}>
              {pipelines.length === 0 ? <option value="">Sin pipelines</option> : null}
              {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
            </select>
            <Icon name="chevron" size={15} />
          </div>
          <label className={styles.searchBox}>
            <Icon name="search" size={17} /><span className={styles.visuallyHidden}>Buscar oportunidad</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por oportunidad, contacto o responsable" type="search" />
            {search ? <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda"><Icon name="close" size={14} /></button> : null}
          </label>
          <div className={styles.quickFilters} role="group" aria-label="Filtro rápido por estado">
            {([ ["OPEN", "Abiertas"], ["", "Todas"], ["WON", "Ganadas"] ] as const).map(([status, label]) => (
              <button className={filters.status === status ? styles.quickFilterActive : undefined} key={label} type="button" onClick={() => void applyQuickStatus(status)} aria-pressed={filters.status === status}>{label}</button>
            ))}
          </div>
          <button className={`${styles.filterButton} ${filterCount > 0 ? styles.filterButtonActive : ""}`} type="button" onClick={() => setOpenPanel((current) => current === "filters" ? null : "filters")} aria-expanded={openPanel === "filters"}><Icon name="filter" size={16} />Filtros{filterCount > 0 ? <span>{filterCount}</span> : null}</button>
          <label className={styles.sortSelect}><span className={styles.visuallyHidden}>Ordenar oportunidades</span><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="recent">Más recientes</option><option value="amount">Mayor valor</option><option value="name">Nombre A–Z</option></select><Icon name="chevron" size={14} /></label>
          <div className={styles.viewToggle} role="group" aria-label="Vista de oportunidades">
            <button type="button" aria-label="Vista Kanban" aria-pressed={boardView === "kanban"} onClick={() => setBoardView("kanban")} title="Vista Kanban"><Icon name="columns" size={17} /></button>
            <button type="button" aria-label="Vista de tabla" aria-pressed={boardView === "table"} onClick={() => setBoardView("table")} title="Vista de tabla"><Icon name="table" size={17} /></button>
          </div>
        </section>

        {openPanel === "filters" ? (
          <section className={styles.utilityPanel} aria-label="Filtros avanzados">
            <div className={styles.utilityPanelHeader}><div><span>Vista del tablero</span><h2>Filtrar oportunidades</h2></div><button type="button" onClick={() => setOpenPanel(null)} aria-label="Cerrar filtros"><Icon name="close" size={16} /></button></div>
            <form className={styles.filterForm} onSubmit={(event) => void applyFilters(event)}>
              <label>Responsable<select value={filters.ownerMemberId} onChange={(event) => setFilters({ ...filters, ownerMemberId: event.target.value })}><option value="">Todos los responsables</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
              <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as BoardFilters["status"] })}><option value="">Todos los estados</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Etiqueta<input value={filters.label} onChange={(event) => setFilters({ ...filters, label: event.target.value })} maxLength={120} placeholder="Ej. renovación" /></label>
              <label>Creada desde<input type="date" value={filters.createdFrom} onChange={(event) => setFilters({ ...filters, createdFrom: event.target.value })} /></label>
              <label>Creada hasta<input type="date" value={filters.createdTo} onChange={(event) => setFilters({ ...filters, createdTo: event.target.value })} /></label>
              <div className={styles.filterActions}><button className={styles.primaryButton} type="submit" disabled={boardLoading}>Aplicar filtros</button><button className={styles.textButton} type="button" onClick={() => { setFilters(emptyFilters); void loadOpportunities(selectedPipelineId, emptyFilters); }}>Restablecer</button></div>
            </form>
          </section>
        ) : null}

        {openPanel === "manage" ? (
          <section className={styles.utilityPanel} aria-label="Gestionar pipeline">
            <div className={styles.utilityPanelHeader}><div><span>Configuración comercial</span><h2>Pipeline y etapas</h2></div><button type="button" onClick={() => setOpenPanel(null)} aria-label="Cerrar gestión"><Icon name="close" size={16} /></button></div>
            <div className={styles.manageGrid}>
              <form className={styles.smallForm} onSubmit={(event) => void createPipeline(event)}><h3>Crear pipeline</h3><p>Úsalo cuando el proceso comercial tenga etapas distintas.</p><label>Nombre<input name="name" maxLength={160} required placeholder="Ej. Renovaciones" /></label><label>Descripción<textarea name="description" maxLength={2000} required placeholder="Qué representa este proceso" /></label><button className={styles.secondaryButton} disabled={saving} type="submit">Crear pipeline</button></form>
              <form className={styles.smallForm} onSubmit={(event) => void createStage(event)}><h3>Añadir etapa</h3><p>Las etapas se muestran de izquierda a derecha en el tablero activo.</p><label>Nombre<input name="name" maxLength={160} required disabled={!selectedPipeline} placeholder="Ej. Propuesta enviada" /></label><label>Criterio de entrada<textarea name="description" maxLength={2000} required disabled={!selectedPipeline} placeholder="Cuándo debe estar una oportunidad aquí" /></label><label>Posición<input name="position" type="number" min="0" defaultValue={selectedPipeline?.stages.length ?? 0} required disabled={!selectedPipeline} /></label><button className={styles.secondaryButton} disabled={saving || !selectedPipeline} type="submit">Añadir etapa</button></form>
            </div>
          </section>
        ) : null}

        <section className={styles.summaryStrip} aria-label="Resumen del pipeline mostrado">
          <div className={styles.summaryContext}><span>{selectedPipeline?.name ?? "Sin pipeline activo"}</span><small>{selectedPipeline?.description ?? "Crea un proceso comercial para empezar."}</small></div>
          <div className={styles.summaryMetric}><span>En tablero</span><strong>{visibleOpportunities.length}</strong></div>
          <div className={styles.summaryMetric}><span>Valor mostrado</span><strong>{totalValue}</strong></div>
          <div className={`${styles.summaryMetric} ${styles.summaryMetricAccent}`}><span>Abiertas</span><strong>{openOpportunities.length}</strong><small>{openValue}</small></div>
          <div className={styles.summaryMetric}><span>Ganadas</span><strong>{wonOpportunities.length}</strong></div>
        </section>

        {workspaceLoading ? <section className={styles.loadingState} role="status"><span className={styles.loader} aria-hidden="true" /><div><strong>Preparando el tablero comercial</strong><p>Estamos conectando oportunidades, contactos y responsables.</p></div></section> : null}
        {!workspaceLoading && pipelines.length === 0 ? <section className={styles.emptyState}><span className={styles.emptyGlyph} aria-hidden="true">◇</span><p className={styles.emptyEyebrow}>Proceso comercial</p><h2>Crea el primer pipeline de este perfil</h2><p>Define el proceso y sus etapas para comenzar a registrar oportunidades reales.</p><button className={styles.primaryButton} type="button" onClick={() => setOpenPanel("manage")}><Icon name="add" size={17} /> Crear pipeline</button></section> : null}
        {!workspaceLoading && selectedPipeline && selectedPipeline.stages.length === 0 ? <section className={styles.emptyState}><span className={styles.emptyGlyph} aria-hidden="true">→</span><p className={styles.emptyEyebrow}>{selectedPipeline.name}</p><h2>Este pipeline aún no tiene etapas</h2><p>Añade la primera etapa para poder crear y mover oportunidades.</p><button className={styles.primaryButton} type="button" onClick={() => setOpenPanel("manage")}><Icon name="add" size={17} /> Añadir etapa</button></section> : null}

        {!workspaceLoading && selectedPipeline && selectedPipeline.stages.length > 0 && boardView === "kanban" ? (
          <section className={styles.boardViewport} aria-label={`Tablero ${selectedPipeline.name}`}>
            <div className={styles.kanbanBoard}>
              {selectedPipeline.stages.map((stage, index) => {
                const stageItems = visibleOpportunities.filter((item) => item.stageId === stage.id);
                const stageValue = formatTotalsByCurrency(stageItems);
                const isDropTarget = draggedOpportunityId !== null;
                return (
                  <section className={`${styles.stageColumn} ${isDropTarget ? styles.stageColumnDroppable : ""}`} key={stage.id} aria-labelledby={`stage-${stage.id}`} onDragOver={(event) => { if (draggedOpportunityId) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); handleDrop(stage.id); }}>
                    <header className={styles.stageHeader}><div className={styles.stageIdentity}><span className={styles.stageNumber}>{String(index + 1).padStart(2, "0")}</span><div><h2 id={`stage-${stage.id}`}>{stage.name}</h2><p>{stageItems.length} {stageItems.length === 1 ? "oportunidad" : "oportunidades"}</p></div></div><strong>{stageValue}</strong></header>
                    <p className={styles.stageDescription}>{stage.description}</p><div className={styles.stageDivider} />
                    <div className={styles.cardStack}>
                      {stageItems.map((opportunity) => {
                        const contact = contactById.get(opportunity.contactId);
                        const owner = memberById.get(opportunity.ownerMemberId);
                        const isDragging = opportunity.id === draggedOpportunityId;
                        return (
                          <article className={`${styles.dealCard} ${isDragging ? styles.dealCardDragging : ""}`} draggable={opportunity.status === "OPEN" && !saving} key={opportunity.id} onDragEnd={() => setDraggedOpportunityId(null)} onDragStart={(event) => { if (opportunity.status !== "OPEN") return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", opportunity.id); setDraggedOpportunityId(opportunity.id); }}>
                            <div className={styles.cardTopline}><span className={`${styles.statusBadge} ${styles[`status${statusTone[opportunity.status]}`]}`}>{statusLabels[opportunity.status]}</span><button className={styles.cardMenu} type="button" onClick={(event) => { event.stopPropagation(); void openEditor(opportunity); }} aria-label={`Gestionar ${opportunity.title}`}><Icon name="more" size={18} /></button></div>
                            <button className={styles.dealTitle} type="button" onClick={() => void openEditor(opportunity)}>{opportunity.title}</button>
                            <a className={styles.contactLink} href={`/contacts/${opportunity.contactId}`} onClick={(event) => event.stopPropagation()}><span className={styles.contactAvatar}>{initials(contact?.displayName ?? "C")}</span><span>{contact?.displayName ?? "Contacto sin nombre"}</span></a>
                            <strong className={styles.dealValue}>{formatMoney(opportunity.amountMinor, opportunity.currency)}</strong>
                            <footer className={styles.cardFooter}><span className={styles.ownerIdentity} title={owner?.displayName ?? "Sin responsable"}><span className={styles.ownerAvatar}>{initials(owner?.displayName ?? "Q")}</span><span>{owner?.displayName ?? "Sin responsable"}</span></span><time dateTime={opportunity.updatedAt} title={`Actualizada ${fullDate(opportunity.updatedAt)}`}>{shortDate(opportunity.updatedAt)}</time></footer>
                            {opportunity.status === "OPEN" ? <div className={styles.cardActionRow}><button className={styles.moveMenuButton} type="button" onClick={() => setMoveMenuOpportunityId((current) => current === opportunity.id ? null : opportunity.id)} aria-expanded={moveMenuOpportunityId === opportunity.id} aria-controls={`move-${opportunity.id}`}><Icon name="move" size={14} />Mover</button>{moveMenuOpportunityId === opportunity.id ? <div className={styles.movePopover} id={`move-${opportunity.id}`} role="group" aria-label={`Mover ${opportunity.title} a otra etapa`}><span>Mover a…</span><div>{selectedPipeline.stages.filter((stage) => stage.id !== opportunity.stageId).map((stage) => <button key={stage.id} type="button" disabled={saving} onClick={() => void moveOpportunity(opportunity, stage.id)}>{stage.name}</button>)}</div></div> : null}</div> : null}
                          </article>
                        );
                      })}
                      {stageItems.length === 0 ? <div className={styles.columnEmpty}><span aria-hidden="true">+</span><p>{draggedOpportunityId ? "Suelta aquí para mover" : "Sin oportunidades"}</p></div> : null}
                    </div>
                  </section>
                );
              })}
            </div>
            {boardLoading ? <div className={styles.boardProgress} role="status">Actualizando tablero…</div> : null}
            {!boardLoading && visibleOpportunities.length === 0 ? <div className={styles.boardEmptyOverlay}><span aria-hidden="true">⌁</span><strong>No hay oportunidades para esta vista</strong><p>Prueba restableciendo los filtros o crea una nueva oportunidad.</p>{(search || filterCount > 0) ? <button className={styles.textButton} type="button" onClick={() => { setSearch(""); setFilters(emptyFilters); void loadOpportunities(selectedPipelineId, emptyFilters); }}>Limpiar vista</button> : null}</div> : null}
          </section>
        ) : null}

        {!workspaceLoading && selectedPipeline && selectedPipeline.stages.length > 0 && boardView === "table" ? (
          <section className={styles.tableViewport} aria-label="Tabla de oportunidades">
            <table className={styles.dealTable}><caption className={styles.visuallyHidden}>Oportunidades de {selectedPipeline.name}</caption><thead><tr><th scope="col">Oportunidad</th><th scope="col">Etapa</th><th scope="col">Responsable</th><th scope="col">Estado</th><th scope="col">Valor</th><th scope="col">Actualizada</th><th scope="col"><span className={styles.visuallyHidden}>Acciones</span></th></tr></thead><tbody>
              {visibleOpportunities.map((opportunity) => {
                const contact = contactById.get(opportunity.contactId); const owner = memberById.get(opportunity.ownerMemberId); const stage = selectedPipeline.stages.find((item) => item.id === opportunity.stageId);
                return <tr key={opportunity.id}><td><button className={styles.tableTitle} type="button" onClick={() => void openEditor(opportunity)}>{opportunity.title}</button><a href={`/contacts/${opportunity.contactId}`}>{contact?.displayName ?? "Contacto"}</a></td><td>{opportunity.status === "OPEN" ? <select className={styles.tableMove} value={opportunity.stageId} disabled={saving} onChange={(event) => void moveOpportunity(opportunity, event.target.value)} aria-label={`Mover ${opportunity.title}`}>{selectedPipeline.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : stage?.name ?? "Etapa eliminada"}</td><td><span className={styles.tableOwner}><span>{initials(owner?.displayName ?? "Q")}</span>{owner?.displayName ?? "Sin responsable"}</span></td><td><span className={`${styles.statusBadge} ${styles[`status${statusTone[opportunity.status]}`]}`}>{statusLabels[opportunity.status]}</span></td><td className={styles.tableAmount}>{formatMoney(opportunity.amountMinor, opportunity.currency)}</td><td><time dateTime={opportunity.updatedAt} title={fullDate(opportunity.updatedAt)}>{shortDate(opportunity.updatedAt)}</time></td><td><button className={styles.rowAction} type="button" onClick={() => void openEditor(opportunity)} aria-label={`Abrir ${opportunity.title}`}><Icon name="more" size={18} /></button></td></tr>;
              })}
            </tbody></table>
            {!boardLoading && visibleOpportunities.length === 0 ? <p className={styles.tableEmpty}>No hay oportunidades que coincidan con esta vista.</p> : null}
            {boardLoading ? <div className={styles.boardProgress} role="status">Actualizando tablero…</div> : null}
          </section>
        ) : null}
      </section>

      {showCreate && selectedPipeline ? <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setShowCreate(false); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="new-deal-title"><header className={styles.drawerHeader}><div><span>Nueva oportunidad</span><h2 id="new-deal-title">Registrar negocio</h2></div><button type="button" onClick={() => setShowCreate(false)} disabled={saving} aria-label="Cerrar"><Icon name="close" size={18} /></button></header><p className={styles.drawerIntro}>Se creará dentro de <strong>{selectedPipeline.name}</strong> y quedará disponible de inmediato en el tablero.</p><form className={styles.drawerForm} onSubmit={(event) => void createOpportunity(event)}><label>Contacto <em>*</em><select name="contactId" required defaultValue=""><option value="" disabled>Selecciona un contacto</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label><label>Nombre de la oportunidad <em>*</em><input name="title" required maxLength={160} placeholder="Ej. Renovación anual — Sede Norte" /></label><div className={styles.drawerPair}><label>Valor estimado <em>*</em><input name="amount" type="number" min="0" step="0.01" inputMode="decimal" required placeholder="0" /></label><label>Moneda <em>*</em><input name="currency" defaultValue="COP" minLength={3} maxLength={3} required /></label></div><label>Etapa inicial <em>*</em><select name="stageId" required>{selectedPipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>Responsable<select name="ownerMemberId" defaultValue=""><option value="">Asignar según la política del equipo</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><div className={styles.drawerActions}><button className={styles.textButton} type="button" disabled={saving} onClick={() => setShowCreate(false)}>Cancelar</button><button className={styles.primaryButton} type="submit" disabled={saving || contacts.length === 0}>{saving ? "Creando…" : "Crear oportunidad"}</button></div></form></aside></div> : null}

      {editor && selectedPipeline ? <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setEditor(null); }}><aside className={`${styles.drawer} ${styles.detailDrawer}`} role="dialog" aria-modal="true" aria-labelledby="deal-detail-title"><header className={styles.drawerHeader}><div><span>Oportunidad</span><h2 id="deal-detail-title">{editor.title}</h2></div><button type="button" onClick={() => setEditor(null)} disabled={saving} aria-label="Cerrar"><Icon name="close" size={18} /></button></header><div className={styles.detailIdentity}><a href={`/contacts/${editor.contactId}`}><span>{initials(contactById.get(editor.contactId)?.displayName ?? "C")}</span><div><strong>{contactById.get(editor.contactId)?.displayName ?? "Contacto asociado"}</strong><small>{contactById.get(editor.contactId)?.email ?? contactById.get(editor.contactId)?.phone ?? "Sin canal de contacto"}</small></div></a><span className={`${styles.statusBadge} ${styles[`status${statusTone[editor.status]}`]}`}>{statusLabels[editor.status]}</span></div><div className={styles.detailMoveBar}><span><Icon name="move" size={15} /> Mover a etapa</span><select value={editor.stageId} disabled={saving || editor.status !== "OPEN"} onChange={(event) => void moveOpportunity(editor, event.target.value)} aria-label="Mover oportunidad a etapa">{selectedPipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><div className={styles.drawerBodyGrid}><form className={styles.drawerForm} key={editor.id} onSubmit={(event) => void updateOpportunity(event)}><div className={styles.sectionKicker}><Icon name="settings" size={15} /> Detalles comerciales</div><label>Nombre <em>*</em><input name="title" required maxLength={160} defaultValue={editor.title} /></label><div className={styles.drawerPair}><label>Valor <em>*</em><input name="amount" type="number" min="0" step="0.01" required defaultValue={Number(editor.amountMinor) / 100} /></label><label>Moneda <em>*</em><input name="currency" minLength={3} maxLength={3} required defaultValue={editor.currency} /></label></div><label>Responsable<select name="ownerMemberId" defaultValue={editor.ownerMemberId}>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label>Estado comercial<select name="status" defaultValue={editor.status}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Motivo de pérdida o abandono<textarea name="closeReason" maxLength={2000} defaultValue={editor.closeReason ?? ""} aria-describedby={closeReasonError ? "close-reason-error" : undefined} onChange={() => setCloseReasonError(null)} placeholder="Añade contexto cuando la oportunidad no continúe." />{closeReasonError ? <small className={styles.fieldError} id="close-reason-error" role="alert">{closeReasonError}</small> : null}</label><div className={styles.drawerActions}><button className={styles.textButton} type="button" disabled={saving} onClick={() => setEditor(null)}>Cancelar</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></div></form><section className={styles.historyPanel} aria-labelledby="history-heading"><div className={styles.historyHeader}><div><span><Icon name="history" size={15} /> Actividad</span><h3 id="history-heading">Historial de la oportunidad</h3></div><time dateTime={editor.createdAt}>Creada {shortDate(editor.createdAt)}</time></div>{historyLoading ? <p className={styles.historyLoading}>Cargando actividad…</p> : null}{historyError ? <p className={styles.historyError}>{historyError}</p> : null}{!historyLoading && !historyError && history.length === 0 ? <p className={styles.historyEmpty}>Aún no hay movimientos registrados para esta oportunidad.</p> : null}{!historyLoading && history.length > 0 ? <ol className={styles.timeline}>{history.map((entry) => <li key={entry.id}><span aria-hidden="true" /><div><strong>{historyLabel(entry)}</strong><time dateTime={entry.createdAt}>{fullDate(entry.createdAt)}</time>{entry.note ? <p>{entry.note}</p> : null}</div></li>)}</ol> : null}</section></div></aside></div> : null}
    </CrmShell>
  );
}
