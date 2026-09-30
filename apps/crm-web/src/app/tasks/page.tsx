"use client";

import type {
  Contact,
  Opportunity,
  Task,
  TaskAssignee,
  TaskComment,
  TaskHistoryEntry,
  TaskType,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface List<T> {
  readonly data: T[];
}

interface TaskFilters {
  readonly assigneeMemberId: string;
  readonly status: string;
  readonly priority: string;
  readonly type: string;
  readonly dueFrom: string;
  readonly dueTo: string;
}

const emptyFilters: TaskFilters = {
  assigneeMemberId: "",
  status: "",
  priority: "",
  type: "",
  dueFrom: "",
  dueTo: "",
};

const typeLabels: Record<TaskType, string> = {
  CALL: "Llamada",
  MESSAGE: "Mensaje",
  MEETING: "Reunión",
  QUOTE: "Cotización",
  COLLECTION: "Cobro",
  OTHER: "Otra acción",
};

const statusLabels: Record<Task["status"], string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
};

const priorityLabels: Record<Task["priority"], string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
};

const originLabels: Record<Task["origin"], string> = {
  MANUAL: "Manual",
  AUTOMATION: "Automatización",
  AGENT: "Agente",
};

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

function formatDate(value: string | null): string {
  if (!value) return "Sin vencimiento";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function TasksPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [filters, setFilters] = useState<TaskFilters>(emptyFilters);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [relation, setRelation] = useState<"contact" | "opportunity">("contact");
  const [showCreate, setShowCreate] = useState(false);
  const [editor, setEditor] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const createKey = useRef<string | null>(null);

  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const opportunityById = useMemo(
    () => new Map(opportunities.map((opportunity) => [opportunity.id, opportunity])),
    [opportunities],
  );
  const assigneeById = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.id, assignee])),
    [assignees],
  );

  const loadTasks = useCallback(async (currentFilters: TaskFilters): Promise<Task[]> => {
    const query = new URLSearchParams();
    if (currentFilters.assigneeMemberId)
      query.set("assigneeMemberId", currentFilters.assigneeMemberId);
    if (currentFilters.status) query.set("status", currentFilters.status);
    if (currentFilters.priority) query.set("priority", currentFilters.priority);
    if (currentFilters.type) query.set("type", currentFilters.type);
    if (currentFilters.dueFrom) query.set("dueFrom", `${currentFilters.dueFrom}T00:00:00.000Z`);
    if (currentFilters.dueTo) query.set("dueTo", `${currentFilters.dueTo}T23:59:59.999Z`);
    const response = await fetch(`/api/tasks${query.size > 0 ? `?${query}` : ""}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) {
      window.location.assign("/api/auth/login?returnTo=/tasks");
      return [];
    }
    if (!response.ok) throw new Error(await responseTitle(response));
    const nextTasks = ((await response.json()) as List<Task>).data;
    setTasks(nextTasks);
    return nextTasks;
  }, []);

  const loadWorkspace = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sessionResponse.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/tasks");
        return;
      }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const [contactResponse, opportunityResponse, assigneeResponse] = await Promise.all([
        fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/opportunities", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/tasks/assignees", { cache: "no-store", credentials: "same-origin" }),
      ]);
      for (const response of [contactResponse, opportunityResponse, assigneeResponse]) {
        if (!response.ok) throw new Error(await responseTitle(response));
      }
      setContacts(((await contactResponse.json()) as List<Contact>).data);
      setOpportunities(((await opportunityResponse.json()) as List<Opportunity>).data);
      setAssignees(((await assigneeResponse.json()) as List<TaskAssignee>).data);
      await loadTasks(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar las tareas.");
    } finally {
      setLoading(false);
    }
  }, [filters, loadTasks]);

  useEffect(() => {
    void loadWorkspace();
    // La carga inicial es única; los filtros se aplican de forma explícita.
  }, []);

  async function mutate(
    url: string,
    body: unknown,
    options: { readonly version?: string; readonly idempotencyKey?: string } = {},
  ): Promise<Response> {
    if (!csrf) throw new Error("La sesión no está lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, {
      method: options.version ? "PATCH" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    return response;
  }

  async function createTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const relationId = String(form.get("relationId"));
    setSaving(true);
    setError(null);
    try {
      const idempotencyKey = createKey.current ?? crypto.randomUUID();
      createKey.current = idempotencyKey;
      await mutate(
        "/api/tasks",
        {
          ...(relation === "contact" ? { contactId: relationId } : { opportunityId: relationId }),
          assigneeMemberId: form.get("assigneeMemberId"),
          title: form.get("title"),
          description: form.get("description"),
          priority: form.get("priority"),
          type: form.get("type"),
          dueAt: new Date(String(form.get("dueAt"))).toISOString(),
        },
        { idempotencyKey },
      );
      createKey.current = null;
      event.currentTarget.reset();
      setShowCreate(false);
      setNotice("Tarea creada y asignada.");
      await loadTasks(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la tarea.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate(
        `/api/tasks/${editor.id}`,
        {
          assigneeMemberId: form.get("assigneeMemberId"),
          title: form.get("title"),
          description: form.get("description"),
          priority: form.get("priority"),
          type: form.get("type"),
          dueAt: new Date(String(form.get("dueAt"))).toISOString(),
        },
        { version: editor.version },
      );
      const updated = ((await response.json()) as { readonly data: Task }).data;
      setEditor(updated);
      setNotice("Tarea actualizada.");
      await Promise.all([loadTasks(filters), loadTaskActivity(updated)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible actualizar la tarea.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(task: Task, status: string): Promise<void> {
    if (!status) return;
    setSaving(true);
    setError(null);
    try {
      const response = await mutate(
        `/api/tasks/${task.id}/status`,
        { status },
        { version: task.version },
      );
      const updated = ((await response.json()) as { readonly data: Task }).data;
      if (editor?.id === updated.id) {
        setEditor(updated);
        await loadTaskActivity(updated);
      }
      setNotice(`Tarea ${statusLabels[updated.status].toLowerCase()}.`);
      await loadTasks(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cambiar el estado.");
    } finally {
      setSaving(false);
    }
  }

  async function loadTaskActivity(task: Task): Promise<void> {
    const [commentResponse, historyResponse] = await Promise.all([
      fetch(`/api/tasks/${task.id}/comments`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
      fetch(`/api/tasks/${task.id}/history`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    ]);
    if (!commentResponse.ok) throw new Error(await responseTitle(commentResponse));
    if (!historyResponse.ok) throw new Error(await responseTitle(historyResponse));
    setComments(((await commentResponse.json()) as List<TaskComment>).data);
    setHistory(((await historyResponse.json()) as List<TaskHistoryEntry>).data);
  }

  async function openTask(task: Task): Promise<void> {
    setEditor(task);
    setComments([]);
    setHistory([]);
    setError(null);
    try {
      await loadTaskActivity(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar la actividad.");
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await mutate(`/api/tasks/${editor.id}/comments`, { body: form.get("body") });
      event.currentTarget.reset();
      setNotice("Comentario interno agregado.");
      await loadTaskActivity(editor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible agregar el comentario.");
    } finally {
      setSaving(false);
    }
  }

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loadTasks(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar los filtros.");
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = tasks.filter((task) => task.status === "PENDING").length;
  const inProgressCount = tasks.filter((task) => task.status === "IN_PROGRESS").length;
  const expiredCount = tasks.filter((task) => task.status === "EXPIRED").length;
  const completedCount = tasks.filter((task) => task.status === "COMPLETED").length;

  function relationFor(task: Task): { readonly href: string; readonly label: string } | null {
    if (task.contactId) {
      return {
        href: `/contacts/${task.contactId}`,
        label: contactById.get(task.contactId)?.displayName ?? "Contacto",
      };
    }
    if (task.opportunityId) {
      return {
        href: "/pipeline",
        label: opportunityById.get(task.opportunityId)?.title ?? "Oportunidad",
      };
    }
    return null;
  }

  return (
    <main className="crm-shell crm-shell-board task-shell">
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
          <a href="/pipeline">Pipeline</a>
          <a href="/tasks" aria-current="page">
            Tareas
          </a>
        </nav>
        <div className="sidebar-pulse">
          <span className="pulse-dot" aria-hidden="true" />
          <div>
            <strong>Seguimiento activo</strong>
            <small>Datos persistentes</small>
          </div>
        </div>
      </aside>

      <section className="crm-content board-content" aria-busy={loading}>
        <header className="board-header task-header">
          <div>
            <p className="eyebrow">Centro de seguimiento</p>
            <h1>Tareas</h1>
            <p>Prioriza, asigna y completa el trabajo comercial sin perder su contexto.</p>
          </div>
          <div className="board-header-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => void loadTasks(filters)}
              disabled={loading}
            >
              Actualizar
            </button>
            <button className="primary-action" type="button" onClick={() => setShowCreate(true)}>
              + Nueva tarea
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

        <section className="task-overview" aria-label="Resumen de tareas">
          <div className="task-overview-lead">
            <span>Vista actual</span>
            <strong>{tasks.length}</strong>
            <p>tareas coinciden con los filtros</p>
          </div>
          <div>
            <span>Pendientes</span>
            <strong>{pendingCount}</strong>
          </div>
          <div>
            <span>En curso</span>
            <strong>{inProgressCount}</strong>
          </div>
          <div className="task-metric-alert">
            <span>Vencidas</span>
            <strong>{expiredCount}</strong>
          </div>
          <div className="task-metric-done">
            <span>Completadas</span>
            <strong>{completedCount}</strong>
          </div>
        </section>

        <details className="board-filters task-filters" open>
          <summary>Filtros de seguimiento</summary>
          <form className="task-filter-grid" onSubmit={(event) => void applyFilters(event)}>
            <label>
              Responsable
              <select
                value={filters.assigneeMemberId}
                onChange={(event) =>
                  setFilters({ ...filters, assigneeMemberId: event.target.value })
                }
              >
                <option value="">Todos</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select
                value={filters.status}
                onChange={(event) => setFilters({ ...filters, status: event.target.value })}
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
              Prioridad
              <select
                value={filters.priority}
                onChange={(event) => setFilters({ ...filters, priority: event.target.value })}
              >
                <option value="">Todas</option>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select
                value={filters.type}
                onChange={(event) => setFilters({ ...filters, type: event.target.value })}
              >
                <option value="">Todos</option>
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Desde
              <input
                type="date"
                value={filters.dueFrom}
                onChange={(event) => setFilters({ ...filters, dueFrom: event.target.value })}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={filters.dueTo}
                onChange={(event) => setFilters({ ...filters, dueTo: event.target.value })}
              />
            </label>
            <div className="filter-submit">
              <button className="primary-action" type="submit" disabled={loading}>
                Aplicar
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setFilters(emptyFilters);
                  void loadTasks(emptyFilters);
                }}
              >
                Limpiar
              </button>
            </div>
          </form>
        </details>

        {loading ? <div className="board-loading">Cargando tareas…</div> : null}
        {!loading && tasks.length === 0 ? (
          <div className="board-empty task-empty">
            <span aria-hidden="true">✓</span>
            <h2>Todo está despejado</h2>
            <p>No hay tareas para los filtros actuales.</p>
          </div>
        ) : null}
        {!loading && tasks.length > 0 ? (
          <section className="task-list" aria-label="Listado de tareas">
            {tasks.map((task) => {
              const assignee = assigneeById.get(task.assigneeMemberId);
              const linked = relationFor(task);
              const immutable = task.status === "COMPLETED" || task.status === "CANCELLED";
              return (
                <article
                  className={`task-card task-card-${task.status.toLowerCase()}`}
                  key={task.id}
                >
                  <div
                    className={`task-type task-type-${task.type.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {task.type === "CALL"
                      ? "☎"
                      : task.type === "MESSAGE"
                        ? "✉"
                        : task.type === "MEETING"
                          ? "◫"
                          : task.type === "QUOTE"
                            ? "▤"
                            : task.type === "COLLECTION"
                              ? "$"
                              : "✓"}
                  </div>
                  <div className="task-main">
                    <div className="task-card-heading">
                      <div>
                        <span className={`task-priority priority-${task.priority.toLowerCase()}`}>
                          {priorityLabels[task.priority]}
                        </span>
                        <span className={`task-state task-state-${task.status.toLowerCase()}`}>
                          {statusLabels[task.status]}
                        </span>
                      </div>
                      <small>
                        {typeLabels[task.type]} · {originLabels[task.origin]}
                      </small>
                    </div>
                    <button
                      className="task-title"
                      type="button"
                      onClick={() => void openTask(task)}
                    >
                      {task.title}
                    </button>
                    <p>{task.description}</p>
                    <div className="task-meta">
                      <span className="table-owner">
                        <span className="owner-avatar" aria-hidden="true">
                          {initials(assignee?.displayName ?? "Q")}
                        </span>
                        {assignee?.displayName ?? "Responsable"}
                      </span>
                      <span className={task.status === "EXPIRED" ? "due-expired" : ""}>
                        Vence {formatDate(task.dueAt)}
                      </span>
                      {linked ? <a href={linked.href}>{linked.label}</a> : null}
                    </div>
                  </div>
                  <div className="task-card-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() => void openTask(task)}
                    >
                      Abrir
                    </button>
                    {!immutable ? (
                      <select
                        aria-label={`Cambiar estado de ${task.title}`}
                        defaultValue={task.status === "EXPIRED" ? "" : task.status}
                        disabled={saving}
                        onChange={(event) => void updateStatus(task, event.target.value)}
                      >
                        {task.status === "EXPIRED" ? <option value="">Resolver…</option> : null}
                        <option value="PENDING">Pendiente</option>
                        <option value="IN_PROGRESS">En curso</option>
                        <option value="COMPLETED">Completada</option>
                        <option value="CANCELLED">Cancelada</option>
                      </select>
                    ) : (
                      <span className="task-closed">Cerrada {formatDate(task.completedAt)}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </section>

      {showCreate ? (
        <div
          className="drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowCreate(false);
          }}
        >
          <aside
            className="deal-drawer task-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-task-title"
          >
            <button
              className="drawer-close"
              type="button"
              onClick={() => setShowCreate(false)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <p className="eyebrow">Nuevo seguimiento</p>
            <h2 id="new-task-title">Crear tarea</h2>
            <p>Asigna una acción con contexto comercial y fecha clara.</p>
            <form onSubmit={(event) => void createTask(event)}>
              <div className="drawer-form-row">
                <label>
                  Vinculada a
                  <select
                    value={relation}
                    onChange={(event) =>
                      setRelation(event.target.value as "contact" | "opportunity")
                    }
                  >
                    <option value="contact">Contacto</option>
                    <option value="opportunity">Oportunidad</option>
                  </select>
                </label>
                <label>
                  {relation === "contact" ? "Contacto" : "Oportunidad"}
                  <select name="relationId" required>
                    {(relation === "contact" ? contacts : opportunities).map((item) => (
                      <option key={item.id} value={item.id}>
                        {relation === "contact"
                          ? (item as Contact).displayName
                          : (item as Opportunity).title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Título
                <input name="title" required maxLength={200} />
              </label>
              <label>
                Descripción
                <textarea name="description" required maxLength={4000} />
              </label>
              <div className="drawer-form-row">
                <label>
                  Tipo
                  <select name="type" defaultValue="CALL">
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioridad
                  <select name="priority" defaultValue="MEDIUM">
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Responsable
                <select name="assigneeMemberId" required>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vencimiento
                <input name="dueAt" type="datetime-local" required />
              </label>
              <button
                className="primary-action drawer-submit"
                type="submit"
                disabled={
                  !csrf ||
                  saving ||
                  assignees.length === 0 ||
                  (relation === "contact" ? contacts.length === 0 : opportunities.length === 0)
                }
              >
                {saving ? "Creando…" : "Crear tarea"}
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
            className="deal-drawer deal-drawer-wide task-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-task-title"
          >
            <button
              className="drawer-close"
              type="button"
              onClick={() => setEditor(null)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <p className="eyebrow">Detalle de seguimiento</p>
            <h2 id="edit-task-title">{editor.title}</h2>
            <p>
              {statusLabels[editor.status]} · {typeLabels[editor.type]}
            </p>
            <form onSubmit={(event) => void updateTask(event)}>
              <label>
                Título
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={editor.title}
                  disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                />
              </label>
              <label>
                Descripción
                <textarea
                  name="description"
                  required
                  maxLength={4000}
                  defaultValue={editor.description}
                  disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                />
              </label>
              <div className="drawer-form-row">
                <label>
                  Tipo
                  <select
                    name="type"
                    defaultValue={editor.type}
                    disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                  >
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Prioridad
                  <select
                    name="priority"
                    defaultValue={editor.priority}
                    disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Responsable
                <select
                  name="assigneeMemberId"
                  defaultValue={editor.assigneeMemberId}
                  required
                  disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                >
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vencimiento
                <input
                  name="dueAt"
                  type="datetime-local"
                  required
                  defaultValue={localDateTime(editor.dueAt)}
                  disabled={editor.status === "COMPLETED" || editor.status === "CANCELLED"}
                />
              </label>
              {editor.status === "COMPLETED" || editor.status === "CANCELLED" ? (
                <p className="task-locked">La tarea está cerrada y conserva su evidencia.</p>
              ) : (
                <button className="primary-action drawer-submit" type="submit" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar cambios"}
                </button>
              )}
            </form>
            <section className="task-comments">
              <div>
                <h3>Comentarios internos</h3>
                <span>{comments.length}</span>
              </div>
              <form onSubmit={(event) => void addComment(event)}>
                <label className="sr-only" htmlFor="task-comment">
                  Comentario interno
                </label>
                <textarea
                  id="task-comment"
                  name="body"
                  required
                  maxLength={4000}
                  placeholder="Agregar contexto para el equipo…"
                />
                <button className="secondary-action" type="submit" disabled={saving}>
                  Comentar
                </button>
              </form>
              {comments.length === 0 ? (
                <p className="task-activity-empty">Sin comentarios todavía.</p>
              ) : (
                <ol>
                  {comments.map((comment) => (
                    <li key={comment.id}>
                      <span className="owner-avatar" aria-hidden="true">
                        {initials(assigneeById.get(comment.authorMemberId)?.displayName ?? "Q")}
                      </span>
                      <div>
                        <strong>
                          {assigneeById.get(comment.authorMemberId)?.displayName ??
                            "Miembro del equipo"}
                        </strong>
                        <small>{formatDate(comment.createdAt)}</small>
                        <p>{comment.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="deal-history task-history">
              <h3>Historial</h3>
              {history.length === 0 ? (
                <p className="task-activity-empty">Sin movimientos registrados.</p>
              ) : (
                <ol>
                  {history.map((entry) => (
                    <li key={entry.id}>
                      <span className="history-dot" />
                      <div>
                        <strong>
                          {entry.eventType === "CREATED"
                            ? "Tarea creada"
                            : entry.eventType === "UPDATED"
                              ? "Datos actualizados"
                              : entry.eventType === "ASSIGNEE_CHANGED"
                                ? "Responsable actualizado"
                                : entry.eventType === "STATUS_CHANGED"
                                  ? "Estado actualizado"
                                  : "Comentario agregado"}
                        </strong>
                        <small>
                          {formatDate(entry.createdAt)} ·{" "}
                          {assigneeById.get(entry.actorMemberId)?.displayName ??
                            "Miembro del equipo"}
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
