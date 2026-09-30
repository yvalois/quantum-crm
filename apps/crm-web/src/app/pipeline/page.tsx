"use client";

import type {
  Contact,
  Member,
  Opportunity,
  OpportunityHistoryEntry,
  OpportunityStatus,
  Pipeline,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}
interface BoardFilters {
  readonly ownerMemberId: string;
  readonly status: "" | OpportunityStatus;
  readonly label: string;
  readonly createdFrom: string;
  readonly createdTo: string;
}

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

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

function formatMoney(amountMinor: string, currency: string): string {
  const amount = Number(amountMinor) / 100;
  if (!Number.isFinite(amount)) return `${amountMinor} ${currency}`;
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

export default function PipelinePage(): React.JSX.Element {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [filters, setFilters] = useState<BoardFilters>(emptyFilters);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Opportunity | null>(null);
  const [history, setHistory] = useState<OpportunityHistoryEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);

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
    async (pipelineId: string, currentFilters: BoardFilters): Promise<void> => {
      if (!pipelineId) {
        setOpportunities([]);
        return;
      }
      const query = new URLSearchParams({ pipelineId });
      if (currentFilters.ownerMemberId) query.set("ownerMemberId", currentFilters.ownerMemberId);
      if (currentFilters.status) query.set("status", currentFilters.status);
      if (currentFilters.label.trim()) query.set("label", currentFilters.label.trim());
      if (currentFilters.createdFrom)
        query.set("createdFrom", `${currentFilters.createdFrom}T00:00:00.000Z`);
      if (currentFilters.createdTo)
        query.set("createdTo", `${currentFilters.createdTo}T23:59:59.999Z`);
      const response = await fetch(`/api/opportunities?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/pipeline");
        return;
      }
      if (!response.ok) throw new Error(await responseTitle(response));
      setOpportunities(((await response.json()) as List<Opportunity>).data);
    },
    [],
  );

  const loadWorkspace = useCallback(async (): Promise<void> => {
    setLoading(true);
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
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const [pipelineResponse, contactResponse, memberResponse] = await Promise.all([
        fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/members?limit=100&status=ACTIVE", {
          cache: "no-store",
          credentials: "same-origin",
        }),
      ]);
      for (const response of [pipelineResponse, contactResponse, memberResponse]) {
        if (!response.ok) throw new Error(await responseTitle(response));
      }
      const pipelineData = ((await pipelineResponse.json()) as List<Pipeline>).data;
      const contactData = ((await contactResponse.json()) as List<Contact>).data;
      const memberData = ((await memberResponse.json()) as List<Member>).data;
      setPipelines(pipelineData);
      setContacts(contactData);
      setMembers(memberData);
      const nextPipelineId = pipelineData.some((item) => item.id === selectedPipelineId)
        ? selectedPipelineId
        : (pipelineData[0]?.id ?? "");
      setSelectedPipelineId(nextPipelineId);
      await loadOpportunities(nextPipelineId, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el pipeline.");
    } finally {
      setLoading(false);
    }
  }, [filters, loadOpportunities, selectedPipelineId]);

  useEffect(() => {
    void loadWorkspace();
    // La carga inicial es deliberadamente unica; los filtros tienen una accion explicita.
  }, []);

  async function mutate(
    url: string,
    body: unknown,
    options: { readonly version?: string } = {},
  ): Promise<Opportunity | null> {
    if (!csrf) return null;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, {
      method: options.version ? "PATCH" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    const payload = (await response.json()) as { readonly data?: Opportunity };
    return payload.data ?? null;
  }

  async function createPipeline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/pipeline", {
        name: form.get("name"),
        description: form.get("description"),
      });
      event.currentTarget.reset();
      setNotice("Pipeline creado.");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el pipeline.");
    } finally {
      setSaving(false);
    }
  }

  async function createStage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/pipeline/${selectedPipeline.id}/stages`, {
        name: form.get("name"),
        description: form.get("description"),
        position: Number(form.get("position")),
      });
      event.currentTarget.reset();
      setNotice("Etapa creada.");
      await loadWorkspace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la etapa.");
    } finally {
      setSaving(false);
    }
  }

  async function createOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const form = new FormData(event.currentTarget);
    const estimatedValue = Number(form.get("amount"));
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/opportunities", {
        contactId: form.get("contactId"),
        pipelineId: selectedPipeline.id,
        stageId: form.get("stageId"),
        ownerMemberId: form.get("ownerMemberId") || undefined,
        title: form.get("title"),
        amountMinor: String(Math.round(estimatedValue * 100)),
        currency: String(form.get("currency")).toUpperCase(),
      });
      event.currentTarget.reset();
      setShowCreate(false);
      setNotice("Oportunidad creada y añadida al tablero.");
      await loadOpportunities(selectedPipeline.id, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la oportunidad.");
    } finally {
      setSaving(false);
    }
  }

  async function moveOpportunity(opportunity: Opportunity, stageId: string): Promise<void> {
    if (stageId === opportunity.stageId) return;
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/opportunities/${opportunity.id}/move`,
        { stageId },
        { version: opportunity.version },
      );
      setNotice("Oportunidad movida.");
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible mover la oportunidad.");
    } finally {
      setSaving(false);
    }
  }

  async function openEditor(opportunity: Opportunity): Promise<void> {
    setEditor(opportunity);
    setHistory([]);
    const response = await fetch(`/api/opportunities/${opportunity.id}/history`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) setHistory(((await response.json()) as List<OpportunityHistoryEntry>).data);
  }

  async function updateOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const status = form.get("status") as OpportunityStatus;
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/opportunities/${editor.id}`,
        {
          title: form.get("title"),
          ownerMemberId: form.get("ownerMemberId"),
          amountMinor: String(Math.round(Number(form.get("amount")) * 100)),
          currency: String(form.get("currency")).toUpperCase(),
          status,
          closeReason: status === "LOST" || status === "ABANDONED" ? form.get("closeReason") : null,
        },
        { version: editor.version },
      );
      setEditor(null);
      setNotice("Oportunidad actualizada.");
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible actualizar la oportunidad.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loadOpportunities(selectedPipelineId, filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar los filtros.");
    } finally {
      setLoading(false);
    }
  }

  const openOpportunities = opportunities.filter((item) => item.status === "OPEN");
  const activeCurrency = opportunities[0]?.currency ?? "COP";
  const openValue = openOpportunities
    .filter((item) => item.currency === activeCurrency)
    .reduce((total, item) => total + BigInt(item.amountMinor), 0n);

  return (
    <main className="crm-shell crm-shell-board">
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span>Quantum</span>
        </a>
        <p className="sidebar-caption">Espacio comercial</p>
        <nav>
          <a href="/">Equipo</a>
          <a href="/contacts">Contactos</a>
          <a href="/pipeline" aria-current="page">
            Pipeline
          </a>
          <a href="/tasks">Tareas</a>
        </nav>
        <div className="sidebar-pulse">
          <span className="pulse-dot" aria-hidden="true" />
          <div>
            <strong>CRM conectado</strong>
            <small>Datos persistentes</small>
          </div>
        </div>
      </aside>

      <section className="crm-content board-content" aria-busy={loading}>
        <header className="board-header">
          <div>
            <p className="eyebrow">Centro de ventas</p>
            <h1>Oportunidades</h1>
            <p>Avanza cada negociación desde el primer interés hasta el cierre.</p>
          </div>
          <div className="board-header-actions">
            <button className="secondary-action" type="button" onClick={() => void loadWorkspace()}>
              Actualizar
            </button>
            <button
              className="primary-action"
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={!selectedPipeline?.stages.length}
            >
              + Nueva oportunidad
            </button>
          </div>
        </header>

        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="feedback feedback-success" role="status">
            {notice}
          </p>
        ) : null}

        <section className="sales-overview" aria-label="Resumen del pipeline">
          <div className="overview-primary">
            <label htmlFor="pipeline-select">Pipeline activo</label>
            <select
              id="pipeline-select"
              value={selectedPipelineId}
              onChange={(event) => {
                const id = event.target.value;
                setSelectedPipelineId(id);
                void loadOpportunities(id, filters);
              }}
            >
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
            <p>{selectedPipeline?.description ?? "Crea tu primer pipeline para comenzar."}</p>
          </div>
          <div className="metric">
            <span>Negociaciones</span>
            <strong>{opportunities.length}</strong>
          </div>
          <div className="metric">
            <span>Abiertas</span>
            <strong>{openOpportunities.length}</strong>
          </div>
          <div className="metric metric-accent">
            <span>Valor abierto</span>
            <strong>{formatMoney(openValue.toString(), activeCurrency)}</strong>
          </div>
        </section>

        <details className="board-filters">
          <summary>Filtros y configuración</summary>
          <form className="board-filter-grid" onSubmit={(event) => void applyFilters(event)}>
            <label>
              Responsable
              <select
                value={filters.ownerMemberId}
                onChange={(event) => setFilters({ ...filters, ownerMemberId: event.target.value })}
              >
                <option value="">Todos</option>
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
                value={filters.status}
                onChange={(event) =>
                  setFilters({ ...filters, status: event.target.value as BoardFilters["status"] })
                }
              >
                <option value="">Todos</option>
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
                value={filters.label}
                onChange={(event) => setFilters({ ...filters, label: event.target.value })}
                placeholder="Ej. Prioritario"
              />
            </label>
            <label>
              Desde
              <input
                type="date"
                value={filters.createdFrom}
                onChange={(event) => setFilters({ ...filters, createdFrom: event.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={filters.createdTo}
                onChange={(event) => setFilters({ ...filters, createdTo: event.target.value })}
              />
            </label>
            <div className="filter-submit">
              <button className="primary-action" type="submit">
                Aplicar
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => {
                  setFilters(emptyFilters);
                  void loadOpportunities(selectedPipelineId, emptyFilters);
                }}
              >
                Limpiar
              </button>
            </div>
          </form>
          <div className="pipeline-admin-grid">
            <form onSubmit={(event) => void createPipeline(event)}>
              <h3>Nuevo pipeline</h3>
              <input name="name" required maxLength={160} placeholder="Nombre" />
              <input
                name="description"
                required
                maxLength={2000}
                placeholder="Descripción y criterio comercial"
              />
              <button type="submit" disabled={saving}>
                Crear
              </button>
            </form>
            <form onSubmit={(event) => void createStage(event)}>
              <h3>Nueva etapa</h3>
              <input name="name" required maxLength={160} placeholder="Nombre" />
              <input
                name="description"
                required
                maxLength={2000}
                placeholder="Criterio para entrar a la etapa"
              />
              <input
                name="position"
                type="number"
                min="0"
                defaultValue={selectedPipeline?.stages.length ?? 0}
                required
              />
              <button type="submit" disabled={saving || !selectedPipeline}>
                Añadir etapa
              </button>
            </form>
          </div>
        </details>

        {loading ? (
          <div className="board-loading" role="status">
            Preparando tu tablero comercial…
          </div>
        ) : null}
        {!loading && pipelines.length === 0 ? (
          <section className="board-empty">
            <span aria-hidden="true">◎</span>
            <h2>Tu proceso de ventas empieza aquí</h2>
            <p>Abre “Filtros y configuración”, crea un pipeline y define sus etapas.</p>
          </section>
        ) : null}
        {!loading && selectedPipeline ? (
          <div className="kanban" aria-label={`Tablero ${selectedPipeline.name}`}>
            {selectedPipeline.stages.map((stage, index) => {
              const stageItems = opportunities.filter((item) => item.stageId === stage.id);
              const stageValue = stageItems
                .filter((item) => item.currency === activeCurrency)
                .reduce((total, item) => total + BigInt(item.amountMinor), 0n);
              return (
                <section
                  className="kanban-column"
                  key={stage.id}
                  aria-labelledby={`stage-${stage.id}`}
                >
                  <header>
                    <div>
                      <span className={`stage-index stage-index-${index % 4}`}>{index + 1}</span>
                      <h2 id={`stage-${stage.id}`}>{stage.name}</h2>
                    </div>
                    <strong>{stageItems.length}</strong>
                  </header>
                  <p className="stage-description">{stage.description}</p>
                  <div className="stage-total">
                    {formatMoney(stageValue.toString(), activeCurrency)}
                  </div>
                  <div className="kanban-cards">
                    {stageItems.map((opportunity) => {
                      const contact = contactById.get(opportunity.contactId);
                      const owner = memberById.get(opportunity.ownerMemberId);
                      return (
                        <article
                          className={`deal-card deal-${opportunity.status.toLowerCase()}`}
                          key={opportunity.id}
                        >
                          <div className="deal-card-top">
                            <span
                              className={`deal-status status-${opportunity.status.toLowerCase()}`}
                            >
                              {statusLabels[opportunity.status]}
                            </span>
                            <button
                              type="button"
                              className="icon-action"
                              aria-label={`Gestionar ${opportunity.title}`}
                              onClick={() => void openEditor(opportunity)}
                            >
                              •••
                            </button>
                          </div>
                          <button
                            className="deal-title"
                            type="button"
                            onClick={() => void openEditor(opportunity)}
                          >
                            {opportunity.title}
                          </button>
                          <a className="deal-contact" href={`/contacts/${opportunity.contactId}`}>
                            {contact?.displayName ?? "Contacto"}
                          </a>
                          <strong className="deal-value">
                            {formatMoney(opportunity.amountMinor, opportunity.currency)}
                          </strong>
                          <div className="deal-footer">
                            <span
                              className="owner-avatar"
                              title={owner?.displayName ?? "Responsable"}
                            >
                              {initials(owner?.displayName ?? "Q")}
                            </span>
                            <select
                              aria-label={`Mover ${opportunity.title}`}
                              value={opportunity.stageId}
                              disabled={saving || opportunity.status !== "OPEN"}
                              onChange={(event) =>
                                void moveOpportunity(opportunity, event.target.value)
                              }
                            >
                              {selectedPipeline.stages.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </article>
                      );
                    })}
                    {stageItems.length === 0 ? (
                      <p className="column-empty">Sin oportunidades en esta etapa</p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </section>

      {showCreate && selectedPipeline ? (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowCreate(false);
          }}
        >
          <aside
            className="deal-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-deal-title"
          >
            <button
              className="drawer-close"
              type="button"
              onClick={() => setShowCreate(false)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <p className="eyebrow">Nueva negociación</p>
            <h2 id="new-deal-title">Crear oportunidad</h2>
            <p>Registra un negocio real dentro de {selectedPipeline.name}.</p>
            <form onSubmit={(event) => void createOpportunity(event)}>
              <label>
                Contacto
                <select name="contactId" required>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Título
                <input
                  name="title"
                  required
                  maxLength={160}
                  placeholder="Ej. Implementación sede norte"
                />
              </label>
              <div className="drawer-form-row">
                <label>
                  Valor estimado
                  <input name="amount" type="number" min="0" step="0.01" required />
                </label>
                <label>
                  Moneda
                  <input name="currency" defaultValue="COP" minLength={3} maxLength={3} required />
                </label>
              </div>
              <label>
                Etapa inicial
                <select name="stageId" required>
                  {selectedPipeline.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select name="ownerMemberId" required>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-action drawer-submit"
                type="submit"
                disabled={saving || contacts.length === 0 || members.length === 0}
              >
                {saving ? "Creando…" : "Crear oportunidad"}
              </button>
            </form>
          </aside>
        </div>
      ) : null}

      {editor ? (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditor(null);
          }}
        >
          <aside
            className="deal-drawer deal-drawer-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-deal-title"
          >
            <button
              className="drawer-close"
              type="button"
              onClick={() => setEditor(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <p className="eyebrow">Gestión de oportunidad</p>
            <h2 id="edit-deal-title">{editor.title}</h2>
            <p>{contactById.get(editor.contactId)?.displayName ?? "Contacto asociado"}</p>
            <form onSubmit={(event) => void updateOpportunity(event)}>
              <label>
                Título
                <input name="title" required maxLength={160} defaultValue={editor.title} />
              </label>
              <div className="drawer-form-row">
                <label>
                  Valor
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={Number(editor.amountMinor) / 100}
                    required
                  />
                </label>
                <label>
                  Moneda
                  <input
                    name="currency"
                    defaultValue={editor.currency}
                    minLength={3}
                    maxLength={3}
                    required
                  />
                </label>
              </div>
              <label>
                Responsable
                <select name="ownerMemberId" defaultValue={editor.ownerMemberId} required>
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
                  placeholder="Obligatorio al marcar perdida o abandonada"
                />
              </label>
              <button className="primary-action drawer-submit" type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </form>
            <section className="deal-history">
              <h3>Actividad reciente</h3>
              {history.length === 0 ? (
                <p>Aún no hay movimientos registrados.</p>
              ) : (
                <ol>
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <span className="history-dot" />
                      <div>
                        <strong>
                          {entry.eventType === "CREATED"
                            ? "Oportunidad creada"
                            : entry.eventType === "STAGE_CHANGED"
                              ? "Cambio de etapa"
                              : entry.eventType === "STATUS_CHANGED"
                                ? "Estado actualizado"
                                : entry.eventType === "OWNER_CHANGED"
                                  ? "Responsable actualizado"
                                  : "Datos actualizados"}
                        </strong>
                        <small>
                          {new Intl.DateTimeFormat("es-CO", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(entry.createdAt))}
                        </small>
                        {entry.note ? <p>{entry.note}</p> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
