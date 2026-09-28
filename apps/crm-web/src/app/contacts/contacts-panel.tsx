"use client";

import type { Automation, Contact, ContactImportPreviewRow } from "@quantum-crm/contracts";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface ContactListPayload {
  readonly data: Contact[];
}
interface ContactFilters {
  readonly label: string;
  readonly pipelineId: string;
  readonly ownerMemberId: string;
  readonly channel: "" | "EMAIL" | "PHONE" | "NONE";
  readonly createdFrom: string;
  readonly createdTo: string;
}
interface PipelineOption {
  readonly id: string;
  readonly name: string;
}
interface MemberOption {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
}
const emptyFilters: ContactFilters = {
  label: "",
  pipelineId: "",
  ownerMemberId: "",
  channel: "",
  createdFrom: "",
  createdTo: "",
};
interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface AutomationListPayload {
  readonly data: Automation[];
}
interface AutomationActivationPayload {
  readonly data: {
    readonly succeeded: number;
    readonly failed: number;
  };
}

async function responseMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

export function ContactsPanel(): React.JSX.Element {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [importFile, setImportFile] = useState<{ fileName: string; contentBase64: string } | null>(
    null,
  );
  const [importRows, setImportRows] = useState<ContactImportPreviewRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [filters, setFilters] = useState<ContactFilters>(emptyFilters);
  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [selectedAutomationId, setSelectedAutomationId] = useState("");
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationMessage, setAutomationMessage] = useState<string | null>(null);
  const [automationName, setAutomationName] = useState("Seguimiento inicial");
  const [automationTitle, setAutomationTitle] = useState("Contactar al cliente");
  const [automationDescription, setAutomationDescription] = useState(
    "Realizar seguimiento del contacto seleccionado.",
  );
  const [automationPriority, setAutomationPriority] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const [automationDueHours, setAutomationDueHours] = useState("24");
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async (currentFilters: ContactFilters = emptyFilters) => {
    const query = new URLSearchParams();
    if (currentFilters.label.trim()) query.set("label", currentFilters.label.trim());
    if (currentFilters.pipelineId) query.set("pipelineId", currentFilters.pipelineId);
    if (currentFilters.ownerMemberId) query.set("ownerMemberId", currentFilters.ownerMemberId);
    if (currentFilters.channel) query.set("channel", currentFilters.channel);
    if (currentFilters.createdFrom)
      query.set("createdFrom", `${currentFilters.createdFrom}T00:00:00.000Z`);
    if (currentFilters.createdTo)
      query.set("createdTo", `${currentFilters.createdTo}T23:59:59.999Z`);
    setLoading(true);
    try {
      const response = await fetch(`/api/contacts${query.size ? `?${query}` : ""}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/contacts");
        return;
      }
      if (!response.ok) throw new Error(await responseMessage(response));
      setContacts(((await response.json()) as ContactListPayload).data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/contacts");
          return;
        }
        const session = (await response.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (active) setCsrfToken(session.csrfToken);
        await load();
        const [pipelineResponse, memberResponse] = await Promise.all([
          fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/members?limit=100&status=ACTIVE", {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ]);
        const automationResponse = await fetch("/api/automations", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (pipelineResponse.ok) {
          const payload = (await pipelineResponse.json()) as { data: PipelineOption[] };
          setPipelines(payload.data);
        }
        if (memberResponse.ok) {
          const payload = (await memberResponse.json()) as { data: MemberOption[] };
          setMembers(payload.data);
        }
        if (automationResponse.ok) {
          const payload = (await automationResponse.json()) as AutomationListPayload;
          const active = payload.data.filter((automation) => automation.status === "ACTIVE");
          setAutomations(payload.data);
          setSelectedAutomationId(active[0]?.id ?? "");
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar contactos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function applyFilters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await load(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible filtrar contactos.");
    }
  }

  async function clearFilters(): Promise<void> {
    setFilters(emptyFilters);
    setError(null);
    try {
      await load(emptyFilters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar contactos.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const isUpdate = editing !== null;
      const key = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = key;
      const body = isUpdate
        ? {
            displayName: form.get("displayName"),
            email: form.get("email") || null,
            phone: form.get("phone") || null,
          }
        : {
            displayName: form.get("displayName"),
            ...(form.get("email") ? { email: form.get("email") } : {}),
            ...(form.get("phone") ? { phone: form.get("phone") } : {}),
          };
      const response = await fetch(isUpdate ? `/api/contacts/${editing.id}` : "/api/contacts", {
        method: isUpdate ? "PATCH" : "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          ...(isUpdate ? { "if-match": `\"${editing.version}\"` } : { "idempotency-key": key }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      event.currentTarget.reset();
      setEditing(null);
      idempotencyKey.current = null;
      await load(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el contacto.");
    } finally {
      setSaving(false);
    }
  }

  async function selectImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
      }
      setImportFile({ fileName: file.name, contentBase64: btoa(binary) });
      setImportRows([]);
      setError(null);
    } catch {
      setError("No fue posible leer el archivo.");
    }
  }

  async function previewImport(): Promise<void> {
    if (!csrfToken || !importFile) return;
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import/preview", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportRows(
        ((await response.json()) as { data: { rows: ContactImportPreviewRow[] } }).data.rows,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible previsualizar la importación.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function applyImport(): Promise<void> {
    if (!csrfToken || !importFile || importRows.length === 0) return;
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportRows([]);
      setImportFile(null);
      await load(filters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar la importación.");
    } finally {
      setImportBusy(false);
    }
  }

  async function exportContacts(): Promise<void> {
    const query = new URLSearchParams();
    if (filters.label.trim()) query.set("label", filters.label.trim());
    if (filters.pipelineId) query.set("pipelineId", filters.pipelineId);
    if (filters.ownerMemberId) query.set("ownerMemberId", filters.ownerMemberId);
    if (filters.channel) query.set("channel", filters.channel);
    if (filters.createdFrom) query.set("createdFrom", `${filters.createdFrom}T00:00:00.000Z`);
    if (filters.createdTo) query.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
    const response = await fetch(`/api/contacts/export${query.size ? `?${query}` : ""}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      setError(await responseMessage(response));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "contacts.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function createAutomation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken) return;
    setAutomationBusy(true);
    setAutomationMessage(null);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: automationName,
          status: "ACTIVE",
          action: {
            type: "CREATE_TASK",
            title: automationTitle,
            description: automationDescription,
            priority: automationPriority,
            dueHours: Number(automationDueHours),
          },
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as { data: Automation };
      setAutomations((current) => [...current, payload.data]);
      setSelectedAutomationId(payload.data.id);
      setAutomationMessage("Automatización activa creada.");
    } catch (cause) {
      setAutomationMessage(
        cause instanceof Error ? cause.message : "No fue posible crear la automatización.",
      );
    } finally {
      setAutomationBusy(false);
    }
  }

  async function activateAutomation(): Promise<void> {
    if (!csrfToken || !selectedAutomationId || selectedContactIds.size === 0) return;
    setAutomationBusy(true);
    setAutomationMessage(null);
    try {
      const response = await fetch(`/api/automations/${selectedAutomationId}/activate`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ contactIds: [...selectedContactIds] }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = (await response.json()) as AutomationActivationPayload;
      setAutomationMessage(
        `Ejecución completada: ${payload.data.succeeded} tarea(s) creada(s), ${payload.data.failed} omitida(s).`,
      );
      setSelectedContactIds(new Set());
    } catch (cause) {
      setAutomationMessage(
        cause instanceof Error ? cause.message : "No fue posible ejecutar la automatización.",
      );
    } finally {
      setAutomationBusy(false);
    }
  }

  function toggleContact(contactId: string): void {
    setSelectedContactIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  return (
    <main className="crm-shell">
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span>Quantum</span>
        </a>
        <nav>
          <a href="/">Equipo</a>
          <a href="/contacts" aria-current="page">
            Contactos
          </a>
          <a href="/pipeline">Pipeline</a>
          <a href="/tasks">Tareas</a>
        </nav>
      </aside>
      <section className="crm-content" aria-busy={loading}>
        <header className="page-header">
          <div>
            <p className="eyebrow">CRM</p>
            <h1>Contactos</h1>
            <p>Gestiona los contactos persistentes de tu perfil.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualizar
          </button>
          <button className="secondary-action" type="button" onClick={() => void exportContacts()}>
            Exportar CSV
          </button>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="member-card filters-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Filtros</p>
              <h2>Encuentra contactos</h2>
            </div>
            <span className="state-message">Combina varios criterios</span>
          </div>
          <form className="filter-grid" onSubmit={(event) => void applyFilters(event)}>
            <label>
              Etiqueta
              <input
                value={filters.label}
                maxLength={80}
                placeholder="Ej. VIP"
                onChange={(event) => setFilters({ ...filters, label: event.target.value })}
              />
            </label>
            <label>
              Pipeline
              <select
                value={filters.pipelineId}
                onChange={(event) => setFilters({ ...filters, pipelineId: event.target.value })}
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
              Asesor
              <select
                value={filters.ownerMemberId}
                onChange={(event) => setFilters({ ...filters, ownerMemberId: event.target.value })}
              >
                <option value="">Todos los asesores</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Canal
              <select
                value={filters.channel}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    channel: event.target.value as ContactFilters["channel"],
                  })
                }
              >
                <option value="">Todos los canales</option>
                <option value="EMAIL">Correo</option>
                <option value="PHONE">Teléfono</option>
                <option value="NONE">Sin canal</option>
              </select>
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
            <div className="form-actions filter-actions">
              <button className="primary-action" type="submit" disabled={loading}>
                Aplicar filtros
              </button>
              <button className="text-action" type="button" onClick={() => void clearFilters()}>
                Limpiar
              </button>
            </div>
          </form>
        </section>
        <section className="member-card import-card" aria-busy={importBusy}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">Importación</p>
              <h2>CSV o XLSX</h2>
            </div>
            <label className="secondary-action">
              Seleccionar archivo
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => void selectImport(event)}
                hidden
              />
            </label>
          </div>
          <p className="state-message">
            {importFile ? importFile.fileName : "Revisa las filas antes de aplicar cambios."}
          </p>
          {importFile ? (
            <div className="form-actions">
              <button
                type="button"
                disabled={importBusy || !csrfToken}
                onClick={() => void previewImport()}
              >
                {importBusy ? "Procesando…" : "Previsualizar"}
              </button>
              {importRows.length > 0 ? (
                <button
                  className="primary-action"
                  type="button"
                  disabled={importBusy || importRows.some((row) => row.status === "ERROR")}
                  onClick={() => void applyImport()}
                >
                  Aplicar importación
                </button>
              ) : null}
            </div>
          ) : null}
          {importRows.length > 0 ? (
            <ul className="member-list import-preview-list">
              {importRows.map((row) => (
                <li className="member-row" key={row.rowNumber}>
                  <div className="member-details">
                    <strong>
                      Fila {row.rowNumber}: {row.displayName || "Sin nombre"}
                    </strong>
                    <span>{row.email ?? row.phone ?? "Sin canal"}</span>
                  </div>
                  <span className={row.status === "ERROR" ? "feedback-error" : "feedback-success"}>
                    {row.status === "ERROR"
                      ? row.errors.join(", ")
                      : row.status === "MATCH"
                        ? "Coincide"
                        : "Nueva"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="member-card automation-card" aria-busy={automationBusy}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">Automatizaciones</p>
              <h2>Seguimiento sobre contactos</h2>
            </div>
            <span className="state-message">{selectedContactIds.size} seleccionados</span>
          </div>
          <form className="filter-grid" onSubmit={(event) => void createAutomation(event)}>
            <label>
              Nombre del flujo
              <input value={automationName} maxLength={160} onChange={(event) => setAutomationName(event.target.value)} />
            </label>
            <label>
              Título de tarea
              <input value={automationTitle} maxLength={200} onChange={(event) => setAutomationTitle(event.target.value)} />
            </label>
            <label>
              Descripción
              <input value={automationDescription} maxLength={4_000} onChange={(event) => setAutomationDescription(event.target.value)} />
            </label>
            <label>
              Prioridad
              <select value={automationPriority} onChange={(event) => setAutomationPriority(event.target.value as "LOW" | "MEDIUM" | "HIGH")}>
                <option value="LOW">Baja</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
              </select>
            </label>
            <label>
              Vence en horas
              <input type="number" min={1} max={8_760} value={automationDueHours} onChange={(event) => setAutomationDueHours(event.target.value)} />
            </label>
            <div className="form-actions filter-actions">
              <button className="secondary-action" type="submit" disabled={automationBusy || !csrfToken}>
                Crear flujo activo
              </button>
            </div>
          </form>
          <div className="form-actions">
            <label>
              Flujo a ejecutar
              <select value={selectedAutomationId} onChange={(event) => setSelectedAutomationId(event.target.value)} disabled={automationBusy}>
                <option value="">Selecciona un flujo activo</option>
                {automations.filter((automation) => automation.status === "ACTIVE").map((automation) => (
                  <option key={automation.id} value={automation.id}>{automation.name}</option>
                ))}
              </select>
            </label>
            <button className="primary-action" type="button" disabled={automationBusy || !csrfToken || !selectedAutomationId || selectedContactIds.size === 0} onClick={() => void activateAutomation()}>
              {automationBusy ? "Ejecutando…" : "Ejecutar en seleccionados"}
            </button>
          </div>
          {automationMessage ? <p className="feedback feedback-success" role="status">{automationMessage}</p> : null}
        </section>
        <div className="member-layout">
          <section className="member-card">
            <div className="card-heading">
              <h2>Lista</h2>
            </div>
            {loading ? <p className="state-message">Cargando contactos…</p> : null}
            {!loading && contacts.length === 0 ? (
              <p className="state-message">Aún no hay contactos.</p>
            ) : null}
            {!loading && contacts.length > 0 ? (
              <ul className="member-list">
                {contacts.map((contact) => (
                  <li className="member-row contact-member-row" key={contact.id}>
                    <label className="contact-select">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        aria-label={`Seleccionar ${contact.displayName}`}
                      />
                    </label>
                    <div className="member-avatar" aria-hidden="true">
                      {contact.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="member-details">
                      <strong>{contact.displayName}</strong>
                      <span>{contact.email ?? contact.phone ?? "Sin datos de contacto"}</span>
                    </div>
                    <div className="member-actions">
                      <a className="secondary-action" href={`/contacts/${contact.id}`}>
                        Ver
                      </a>
                      <button type="button" disabled={saving} onClick={() => setEditing(contact)}>
                        Editar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <aside className="member-card member-form-card">
            <form onSubmit={(event) => void submit(event)}>
              <p className="eyebrow">{editing ? "Editar" : "Nuevo"}</p>
              <h2>{editing ? editing.displayName : "Crear contacto"}</h2>
              <label>
                Nombre
                <input
                  name="displayName"
                  key={`name-${editing?.id ?? "new"}`}
                  required
                  maxLength={160}
                  defaultValue={editing?.displayName ?? ""}
                />
              </label>
              <label>
                Correo
                <input
                  name="email"
                  key={`email-${editing?.id ?? "new"}`}
                  type="email"
                  maxLength={320}
                  defaultValue={editing?.email ?? ""}
                />
              </label>
              <label>
                Teléfono
                <input
                  name="phone"
                  key={`phone-${editing?.id ?? "new"}`}
                  maxLength={40}
                  defaultValue={editing?.phone ?? ""}
                />
              </label>
              <div className="form-actions">
                {editing ? (
                  <button className="text-action" type="button" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                ) : null}
                <button className="primary-action" type="submit" disabled={!csrfToken || saving}>
                  {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear contacto"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
