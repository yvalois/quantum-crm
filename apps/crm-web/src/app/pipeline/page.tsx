"use client";

import type { Contact, Opportunity, Pipeline } from "@quantum-crm/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}
async function title(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

export default function PipelinePage(): React.JSX.Element {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const key = useRef<string | null>(null);
  async function load(): Promise<void> {
    const [pipeline, opportunity, contact] = await Promise.all([
      fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/opportunities", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
    ]);
    if ([pipeline, opportunity, contact].some((response) => response.status === 401)) {
      window.location.assign("/api/auth/login?returnTo=/pipeline");
      return;
    }
    if (!pipeline.ok) throw new Error(await title(pipeline));
    if (!opportunity.ok) throw new Error(await title(opportunity));
    if (!contact.ok) throw new Error(await title(contact));
    setPipelines(((await pipeline.json()) as List<Pipeline>).data);
    setOpportunities(((await opportunity.json()) as List<Opportunity>).data);
    setContacts(((await contact.json()) as List<Contact>).data);
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/pipeline");
          return;
        }
        const session = (await response.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (active) setCsrf(session.csrfToken);
        await load();
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar el pipeline.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function post(
    url: string,
    body: unknown,
    idempotencyKey: string,
    version?: string,
  ): Promise<void> {
    if (!csrf) return;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": idempotencyKey,
    };
    if (version) headers["if-match"] = `"${version}"`;
    const response = await fetch(url, {
      method: version ? "PATCH" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await title(response));
  }
  async function createPipeline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const idempotencyKey = key.current ?? crypto.randomUUID();
      key.current = idempotencyKey;
      await post(
        "/api/pipeline",
        { name: form.get("name"), description: form.get("description") },
        idempotencyKey,
      );
      key.current = null;
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el pipeline.");
    } finally {
      setSaving(false);
    }
  }
  async function createStage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await post(
        `/api/pipeline/${String(form.get("pipelineId"))}/stages`,
        {
          name: form.get("name"),
          description: form.get("description"),
          position: Number(form.get("position")),
        },
        crypto.randomUUID(),
      );
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la etapa.");
    } finally {
      setSaving(false);
    }
  }
  async function createOpportunity(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await post(
        "/api/opportunities",
        {
          contactId: form.get("contactId"),
          pipelineId: form.get("pipelineId"),
          stageId: form.get("stageId"),
          title: form.get("title"),
          amountMinor: form.get("amountMinor"),
          currency: form.get("currency"),
        },
        crypto.randomUUID(),
      );
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la oportunidad.");
    } finally {
      setSaving(false);
    }
  }
  async function moveOpportunity(
    event: FormEvent<HTMLFormElement>,
    opportunity: Opportunity,
  ): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await post(
        `/api/opportunities/${opportunity.id}/move`,
        { stageId: form.get("stageId") },
        crypto.randomUUID(),
        opportunity.version,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible mover la oportunidad.");
    } finally {
      setSaving(false);
    }
  }
  const stages = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({
      ...stage,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
    })),
  );
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
          <a href="/contacts">Contactos</a>
          <a href="/pipeline" aria-current="page">
            Pipeline
          </a>
          <a href="/tasks">Tareas</a>
        </nav>
      </aside>
      <section className="crm-content" aria-busy={loading}>
        <header className="page-header">
          <div>
            <p className="eyebrow">Ventas</p>
            <h1>Pipeline</h1>
            <p>Configura pipelines y consulta oportunidades persistentes.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            Actualizar
          </button>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="member-layout">
          <section className="member-card">
            <div className="card-heading">
              <h2>Pipeline y oportunidades</h2>
            </div>
            {loading ? <p className="state-message">Cargando pipeline…</p> : null}
            {!loading && pipelines.length === 0 ? (
              <p className="state-message">
                Aún no hay un pipeline. Un administrador debe crear uno antes de registrar
                oportunidades.
              </p>
            ) : null}
            {pipelines.map((pipeline) => (
              <div className="member-row" key={pipeline.id}>
                <div className="member-details">
                  <strong>{pipeline.name}</strong>
                  <span>{pipeline.description}</span>
                  <small>
                    {pipeline.stages.map((stage) => stage.name).join(" · ") || "Sin etapas"}
                  </small>
                </div>
              </div>
            ))}
            {!loading && opportunities.length === 0 && pipelines.length > 0 ? (
              <p className="state-message">Aún no hay oportunidades.</p>
            ) : null}
            {opportunities.map((opportunity) => (
              <div className="member-row" key={opportunity.id}>
                <div className="member-details">
                  <strong>{opportunity.title}</strong>
                  <span>
                    {opportunity.amountMinor} {opportunity.currency}
                  </span>
                  <form onSubmit={(event) => void moveOpportunity(event, opportunity)}>
                    <label>
                      Etapa
                      <select name="stageId" defaultValue={opportunity.stageId}>
                        {stages
                          .filter((stage) => stage.pipelineId === opportunity.pipelineId)
                          .map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="secondary-action" type="submit" disabled={!csrf || saving}>
                      Mover
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </section>
          <aside className="member-card member-form-card">
            <form onSubmit={(event) => void createPipeline(event)}>
              <p className="eyebrow">Administración</p>
              <h2>Nuevo pipeline</h2>
              <label>
                Nombre
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Descripción
                <input name="description" required maxLength={2000} />
              </label>
              <button className="primary-action" type="submit" disabled={!csrf || saving}>
                {saving ? "Guardando…" : "Crear pipeline"}
              </button>
            </form>
            <form onSubmit={(event) => void createStage(event)}>
              <p className="eyebrow">Etapa</p>
              <h2>Nueva etapa</h2>
              <label>
                Pipeline
                <select name="pipelineId" required>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nombre
                <input name="name" required maxLength={160} />
              </label>
              <label>
                Descripción
                <input name="description" required maxLength={2000} />
              </label>
              <label>
                Posición
                <input name="position" type="number" min="0" required />
              </label>
              <button
                className="primary-action"
                type="submit"
                disabled={!csrf || saving || pipelines.length === 0}
              >
                Crear etapa
              </button>
            </form>
            <form onSubmit={(event) => void createOpportunity(event)}>
              <p className="eyebrow">Oportunidad</p>
              <h2>Nueva oportunidad</h2>
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
                Pipeline
                <select name="pipelineId" required>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etapa
                <select name="stageId" required>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.pipelineName}: {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Título
                <input name="title" required maxLength={160} />
              </label>
              <label>
                Importe (unidades menores)
                <input name="amountMinor" inputMode="numeric" pattern="[0-9]+" required />
              </label>
              <label>
                Moneda ISO
                <input name="currency" defaultValue="COP" maxLength={3} required />
              </label>
              <button
                className="primary-action"
                type="submit"
                disabled={!csrf || saving || contacts.length === 0 || stages.length === 0}
              >
                {saving ? "Guardando…" : "Crear oportunidad"}
              </button>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
