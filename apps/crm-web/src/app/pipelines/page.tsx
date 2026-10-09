"use client";

import type { Pipeline, PipelineStage } from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import styles from "../pipeline/pipeline.module.css";

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

interface PipelineStageDraft {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface IdempotentAttempt {
  readonly key: string;
  readonly payload: string;
}

const initialStages: readonly PipelineStageDraft[] = [
  {
    id: "new-lead",
    name: "Nuevo lead",
    description: "El contacto llegó y espera la primera revisión comercial.",
  },
  {
    id: "qualified",
    name: "Calificación",
    description: "Se confirmó necesidad, presupuesto y siguiente paso.",
  },
  {
    id: "proposal",
    name: "Propuesta enviada",
    description: "La propuesta está en manos del cliente para revisión.",
  },
  {
    id: "negotiation",
    name: "Negociación",
    description: "Se están resolviendo condiciones antes de cerrar.",
  },
];

function freshInitialStages(): PipelineStageDraft[] {
  return initialStages.map((stage) => ({ ...stage }));
}

function Icon({ name, size = 18 }: { readonly name: string; readonly size?: number }): React.JSX.Element {
  const paths: Record<string, React.JSX.Element> = {
    add: <path d="M12 5v14M5 12h14" />,
    arrowDown: <path d="M12 5v14m0 0-5-5m5 5 5-5" />,
    arrowUp: <path d="M12 19V5m0 0-5 5m5-5 5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    pipeline: <path d="M5 6h14M5 12h10M5 18h6m5-2 2 2 3-4" />,
    refresh: (
      <path d="M20 11a8 8 0 0 0-14.8-4.2L4 9M4 5v4h4M4 13a8 8 0 0 0 14.8 4.2L20 15M20 19v-4h-4" />
    ),
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
      {paths[name] ?? paths.pipeline}
    </svg>
  );
}

async function responseTitle(response: Response): Promise<string> {
  return response
    .json()
    .catch(() => null)
    .then((body: unknown) =>
      body && typeof body === "object" && "title" in body && typeof body.title === "string"
        ? body.title
        : "No fue posible completar la solicitud.",
    );
}

export default function PipelinesPage(): React.JSX.Element {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [stageDrafts, setStageDrafts] = useState<PipelineStageDraft[]>(freshInitialStages);
  const creationAttempt = useRef<IdempotentAttempt | null>(null);
  const stageCreationAttempt = useRef<IdempotentAttempt | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId],
  );

  const load = useCallback(async (preferredPipelineId?: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sessionResponse.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/pipelines");
        return;
      }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const response = await fetch("/api/pipeline", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseTitle(response));
      const nextPipelines = ((await response.json()) as List<Pipeline>).data;
      setPipelines(nextPipelines);
      setSelectedPipelineId((current) => {
        const requested = preferredPipelineId ?? current;
        return nextPipelines.some((pipeline) => pipeline.id === requested)
          ? requested
          : (nextPipelines[0]?.id ?? "");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar los pipelines.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showCreator) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !saving) setShowCreator(false);
    };
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [saving, showCreator]);

  async function mutate<T>(url: string, body: unknown, idempotencyKey: string): Promise<T> {
    if (!csrf) throw new Error("La sesión todavía no está lista. Intenta de nuevo.");
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-csrf-token": csrf,
      },
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    const payload = (await response.json()) as MutationResponse<T>;
    if (!payload.data) throw new Error("El servidor no confirmó el cambio.");
    return payload.data;
  }

  function openCreator(): void {
    creationAttempt.current = null;
    setError(null);
    setStageDrafts(freshInitialStages());
    setShowCreator(true);
  }

  function updateDraft(id: string, field: "description" | "name", value: string): void {
    setStageDrafts((current) =>
      current.map((stage) => (stage.id === id ? { ...stage, [field]: value } : stage)),
    );
  }

  function addDraft(): void {
    setStageDrafts((current) =>
      current.length >= 25
        ? current
        : [...current, { id: crypto.randomUUID(), name: "", description: "" }],
    );
  }

  function removeDraft(id: string): void {
    setStageDrafts((current) =>
      current.length === 1 ? current : current.filter((stage) => stage.id !== id),
    );
  }

  function moveDraft(id: string, direction: -1 | 1): void {
    setStageDrafts((current) => {
      const index = current.findIndex((stage) => stage.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const currentStage = next[index];
      const targetStage = next[targetIndex];
      if (!currentStage || !targetStage) return current;
      next[index] = targetStage;
      next[targetIndex] = currentStage;
      return next;
    });
  }

  async function createPipeline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stages = stageDrafts.map((stage) => ({
      name: stage.name.trim(),
      description: stage.description.trim(),
    }));
    const duplicate = stages.some(
      (stage, index) =>
        stages.findIndex(
          (candidate) =>
            candidate.name.normalize("NFKC").toLocaleLowerCase() ===
            stage.name.normalize("NFKC").toLocaleLowerCase(),
        ) !== index,
    );
    if (stages.some((stage) => !stage.name || !stage.description) || duplicate) {
      setError(
        duplicate
          ? "Cada etapa debe tener un nombre diferente."
          : "Define al menos una etapa con nombre y criterio de entrada.",
      );
      return;
    }
    const payload = {
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      stages,
    };
    const serializedPayload = JSON.stringify(payload);
    const idempotencyKey =
      creationAttempt.current?.payload === serializedPayload
        ? creationAttempt.current.key
        : crypto.randomUUID();
    creationAttempt.current = { key: idempotencyKey, payload: serializedPayload };
    setSaving(true);
    setError(null);
    try {
      const created = await mutate<Pipeline>("/api/pipeline", payload, idempotencyKey);
      creationAttempt.current = null;
      setPipelines((current) => [created, ...current.filter((pipeline) => pipeline.id !== created.id)]);
      setSelectedPipelineId(created.id);
      setShowCreator(false);
      setNotice(
        `Pipeline creado con ${created.stages.length} ${created.stages.length === 1 ? "etapa" : "etapas"}.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el pipeline.");
    } finally {
      setSaving(false);
    }
  }

  async function createStage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedPipeline) return;
    const position = Math.max(-1, ...selectedPipeline.stages.map((stage) => stage.position)) + 1;
    if (position > 1000) {
      setError("Este pipeline ya alcanzó el máximo de etapas configurables.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      description: String(form.get("description") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      position,
    };
    const serializedPayload = JSON.stringify({ pipelineId: selectedPipeline.id, ...payload });
    const idempotencyKey =
      stageCreationAttempt.current?.payload === serializedPayload
        ? stageCreationAttempt.current.key
        : crypto.randomUUID();
    stageCreationAttempt.current = { key: idempotencyKey, payload: serializedPayload };
    setSaving(true);
    setError(null);
    try {
      const created = await mutate<PipelineStage>(
        `/api/pipeline/${selectedPipeline.id}/stages`,
        payload,
        idempotencyKey,
      );
      stageCreationAttempt.current = null;
      setPipelines((current) =>
        current.map((pipeline) =>
          pipeline.id === selectedPipeline.id
            ? {
                ...pipeline,
                stages: [...pipeline.stages.filter((stage) => stage.id !== created.id), created].sort(
                  (left, right) => left.position - right.position,
                ),
              }
            : pipeline,
        ),
      );
      formElement.reset();
      setNotice("Etapa añadida al pipeline.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la etapa.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <CrmShell className={styles.pipelineShell ?? ""}>
      <section className={styles.workspace} aria-busy={loading || saving}>
        <header className={styles.topbar}>
          <div className={styles.headingGroup}>
            <div className={styles.eyebrowRow}>
              <span className={styles.liveDot} aria-hidden="true" />
              Administración comercial
            </div>
            <div className={styles.titleRow}>
              <h1>Pipelines</h1>
              <span className={styles.pipelinePill}>{pipelines.length} activos</span>
            </div>
            <p>Configura los recorridos que usa el equipo antes de llevar oportunidades al tablero.</p>
          </div>
          <div className={styles.topActions}>
            <button
              className={styles.iconButton}
              type="button"
              onClick={() => void load(selectedPipelineId)}
              disabled={loading || saving}
              aria-label="Actualizar pipelines"
              title="Actualizar pipelines"
            >
              <Icon name="refresh" />
            </button>
            <button className={styles.primaryButton} type="button" onClick={openCreator} disabled={loading}>
              <Icon name="add" size={17} /> Crear pipeline
            </button>
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

        {loading ? (
          <section className={styles.loadingState} role="status">
            <span className={styles.loader} aria-hidden="true" />
            <div>
              <strong>Preparando tus procesos comerciales</strong>
              <p>Estamos cargando los pipelines y sus etapas.</p>
            </div>
          </section>
        ) : null}

        {!loading && pipelines.length === 0 ? (
          <section className={styles.emptyState}>
            <span className={styles.emptyGlyph} aria-hidden="true">
              ◇
            </span>
            <p className={styles.emptyEyebrow}>Configuración comercial</p>
            <h2>Crea el primer pipeline de este perfil</h2>
            <p>Define las etapas aquí. Después, el equipo podrá crear oportunidades en el tablero.</p>
            <button className={styles.primaryButton} type="button" onClick={openCreator}>
              <Icon name="add" size={17} /> Crear mi primer pipeline
            </button>
          </section>
        ) : null}

        {!loading && pipelines.length > 0 ? (
          <section className={styles.pipelineSettingsGrid} aria-label="Administrar pipelines">
            <aside className={styles.pipelineDirectory} aria-label="Pipelines disponibles">
              <div className={styles.pipelineDirectoryHeader}>
                <span>Procesos</span>
                <strong>{pipelines.length}</strong>
              </div>
              <div className={styles.pipelineDirectoryList}>
                {pipelines.map((pipeline) => (
                  <button
                    className={
                      selectedPipeline?.id === pipeline.id ? styles.pipelineDirectoryActive : undefined
                    }
                    key={pipeline.id}
                    type="button"
                    onClick={() => setSelectedPipelineId(pipeline.id)}
                    aria-pressed={selectedPipeline?.id === pipeline.id}
                  >
                    <span>
                      <strong>{pipeline.name}</strong>
                      <small>{pipeline.description}</small>
                    </span>
                    <em>{pipeline.stages.length}</em>
                  </button>
                ))}
              </div>
            </aside>

            {selectedPipeline ? (
              <section className={styles.pipelineSettingsDetail} aria-labelledby="pipeline-settings-title">
                <header className={styles.pipelineSettingsDetailHeader}>
                  <div>
                    <span>Proceso seleccionado</span>
                    <h2 id="pipeline-settings-title">{selectedPipeline.name}</h2>
                    <p>{selectedPipeline.description}</p>
                  </div>
                  <a
                    className={styles.secondaryButton}
                    href={`/pipeline?pipeline=${encodeURIComponent(selectedPipeline.id)}`}
                  >
                    Ver oportunidades
                  </a>
                </header>
                <div className={styles.manageGrid}>
                  <section className={styles.stageInventory} aria-label="Etapas actuales">
                    <div>
                      <span className={styles.sectionKicker}>Etapas actuales</span>
                      <h3>{selectedPipeline.stages.length} configuradas</h3>
                    </div>
                    {selectedPipeline.stages.length > 0 ? (
                      <ol className={styles.stageInventoryList}>
                        {selectedPipeline.stages.map((stage, index) => (
                          <li key={stage.id}>
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <div>
                              <strong>{stage.name}</strong>
                              <p>{stage.description}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className={styles.stageInventoryEmpty}>
                        Aún no hay etapas. Agrega la primera para habilitar oportunidades en este proceso.
                      </p>
                    )}
                  </section>
                  <form className={styles.smallForm} onSubmit={(event) => void createStage(event)}>
                    <h3>Añadir una etapa</h3>
                    <p>Se agrega al final del recorrido; no necesitas calcular su posición.</p>
                    <label>
                      Nombre
                      <input name="name" maxLength={160} required placeholder="Ej. Propuesta enviada" />
                    </label>
                    <label>
                      Criterio de entrada
                      <textarea
                        name="description"
                        maxLength={2000}
                        required
                        placeholder="Cuándo debe estar una oportunidad aquí"
                      />
                    </label>
                    <button className={styles.secondaryButton} disabled={saving} type="submit">
                      Añadir etapa
                    </button>
                  </form>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}
      </section>

      {showCreator ? (
        <div
          className={styles.drawerBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setShowCreator(false);
          }}
        >
          <aside
            ref={drawerRef}
            className={`${styles.drawer} ${styles.pipelineCreatorDrawer}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pipeline-create-title"
          >
            <header className={styles.drawerHeader}>
              <div>
                <span>Nuevo proceso comercial</span>
                <h2 id="pipeline-create-title">Crear pipeline</h2>
              </div>
              <button type="button" disabled={saving} onClick={() => setShowCreator(false)} aria-label="Cerrar">
                <Icon name="close" size={18} />
              </button>
            </header>
            <p className={styles.drawerIntro}>
              Define el proceso completo una sola vez. Al guardarlo, el tablero quedará listo para
              recibir oportunidades.
            </p>
            <form className={styles.pipelineCreatorForm} onSubmit={(event) => void createPipeline(event)}>
              {error ? (
                <div className={styles.drawerError} role="alert">
                  <strong>No se pudo crear el pipeline.</strong>
                  <span>{error}</span>
                </div>
              ) : null}
              <section className={styles.pipelineIdentityFields} aria-labelledby="pipeline-identity-title">
                <div className={styles.setupSectionHeading}>
                  <span>01</span>
                  <div>
                    <h3 id="pipeline-identity-title">Identifica el proceso</h3>
                    <p>Usa un nombre que el equipo reconozca sin explicación adicional.</p>
                  </div>
                </div>
                <label>
                  Nombre del pipeline <em>*</em>
                  <input name="name" required maxLength={160} autoComplete="off" placeholder="Ej. Ventas corporativas" />
                </label>
                <label>
                  Descripción <em>*</em>
                  <textarea
                    name="description"
                    required
                    maxLength={2000}
                    placeholder="Qué proceso representa y cuándo se usa"
                  />
                </label>
              </section>
              <section className={styles.pipelineStageBuilder} aria-labelledby="pipeline-stages-title">
                <div className={styles.setupSectionHeading}>
                  <span>02</span>
                  <div>
                    <h3 id="pipeline-stages-title">Define las etapas iniciales</h3>
                    <p>El orden de esta lista será el orden de las columnas en Oportunidades.</p>
                  </div>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={saving || stageDrafts.length >= 25}
                    onClick={addDraft}
                  >
                    <Icon name="add" size={15} /> Añadir etapa
                  </button>
                </div>
                <ol className={styles.pipelineDraftList}>
                  {stageDrafts.map((stage, index) => (
                    <li key={stage.id}>
                      <span className={styles.pipelineDraftNumber}>{String(index + 1).padStart(2, "0")}</span>
                      <div className={styles.pipelineDraftFields}>
                        <label>
                          <span>Nombre de la etapa</span>
                          <input
                            value={stage.name}
                            required
                            maxLength={160}
                            onChange={(event) => updateDraft(stage.id, "name", event.target.value)}
                            placeholder="Ej. Calificación"
                          />
                        </label>
                        <label>
                          <span>Criterio de entrada</span>
                          <input
                            value={stage.description}
                            required
                            maxLength={2000}
                            onChange={(event) => updateDraft(stage.id, "description", event.target.value)}
                            placeholder="Qué debe ocurrir para mover una oportunidad aquí"
                          />
                        </label>
                      </div>
                      <div className={styles.pipelineDraftActions} aria-label={`Acciones para ${stage.name || `etapa ${index + 1}`}`}>
                        <button
                          type="button"
                          disabled={saving || index === 0}
                          onClick={() => moveDraft(stage.id, -1)}
                          aria-label={`Subir ${stage.name || `etapa ${index + 1}`}`}
                          title="Subir etapa"
                        >
                          <Icon name="arrowUp" size={15} />
                        </button>
                        <button
                          type="button"
                          disabled={saving || index === stageDrafts.length - 1}
                          onClick={() => moveDraft(stage.id, 1)}
                          aria-label={`Bajar ${stage.name || `etapa ${index + 1}`}`}
                          title="Bajar etapa"
                        >
                          <Icon name="arrowDown" size={15} />
                        </button>
                        <button
                          type="button"
                          disabled={saving || stageDrafts.length === 1}
                          onClick={() => removeDraft(stage.id)}
                          aria-label={`Quitar ${stage.name || `etapa ${index + 1}`}`}
                          title="Quitar etapa"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className={styles.pipelineSetupHint}>
                  Ganada, perdida o abandonada son estados de la oportunidad; no necesitas crear
                  columnas separadas para esos cierres.
                </p>
              </section>
              <div className={styles.drawerActions}>
                <button className={styles.textButton} type="button" disabled={saving} onClick={() => setShowCreator(false)}>
                  Cancelar
                </button>
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  {saving ? "Creando proceso…" : "Crear pipeline y etapas"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </CrmShell>
  );
}
