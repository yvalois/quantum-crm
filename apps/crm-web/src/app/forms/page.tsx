"use client";

import type {
  FormAnswerValue,
  FormContract,
  FormDefinition,
  FormField,
  FormFieldType,
  FormTheme,
  SubmittedFormResponse,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CrmShell } from "../crm-shell";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface List<T> {
  readonly data: T[];
}
type Section = FormDefinition["sections"][number];

const fieldLabels: Record<FormFieldType, string> = {
  SHORT_TEXT: "Texto corto",
  LONG_TEXT: "Texto largo",
  NUMBER: "Numero",
  EMAIL: "Correo",
  PHONE: "Telefono",
  DATE: "Fecha",
  TIME: "Hora",
  SINGLE_CHOICE: "Opcion unica",
  MULTIPLE_CHOICE: "Seleccion multiple",
  DROPDOWN: "Lista",
  CHECKBOX: "Casilla",
  SCALE: "Escala",
};

const defaultTheme: FormTheme = {
  accentColor: "#5de1d4",
  backgroundColor: "#07110f",
  logoFileId: null,
  completionMessage: "Gracias. Recibimos tu respuesta.",
  closedMessage: "Este formulario ya no recibe respuestas.",
};

function newField(type: FormFieldType = "SHORT_TEXT"): FormField {
  const choice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(type);
  return {
    id: crypto.randomUUID(),
    type,
    label: "Nueva pregunta",
    description: "",
    required: false,
    options: choice ? ["Opcion 1", "Opcion 2"] : [],
    condition: null,
    ...(type === "SCALE" ? { minimum: 1, maximum: 5 } : {}),
  };
}

function starterDefinition(): FormDefinition {
  return {
    sections: [
      {
        id: crypto.randomUUID(),
        title: "Seccion principal",
        description: "",
        fields: [newField()],
      },
    ],
  };
}

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

function renderPreviewField(field: FormField): React.JSX.Element {
  if (field.type === "LONG_TEXT") return <textarea rows={3} disabled placeholder="Respuesta" />;
  if (["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(field.type)) {
    return (
      <div className="form-preview-options">
        {field.options.map((option) => (
          <label key={option}>
            <input type={field.type === "SINGLE_CHOICE" ? "radio" : "checkbox"} disabled /> {option}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "DROPDOWN")
    return (
      <select disabled>
        <option>Selecciona una opcion</option>
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  if (field.type === "CHECKBOX")
    return (
      <label>
        <input type="checkbox" disabled /> Confirmar
      </label>
    );
  if (field.type === "SCALE")
    return (
      <div className="form-scale">
        {Array.from(
          { length: (field.maximum ?? 5) - (field.minimum ?? 1) + 1 },
          (_, index) => index + (field.minimum ?? 1),
        ).map((value) => (
          <span key={value}>{value}</span>
        ))}
      </div>
    );
  const htmlType =
    field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : field.type.toLowerCase();
  return <input type={htmlType} disabled placeholder="Respuesta" />;
}

function answerText(value: FormAnswerValue | undefined, empty = ""): string {
  return Array.isArray(value) ? value.join(" | ") : String(value ?? empty);
}

export default function FormsPage(): React.JSX.Element {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [forms, setForms] = useState<FormContract[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormContract | null>(null);
  const [responses, setResponses] = useState<SubmittedFormResponse[]>([]);
  const [tab, setTab] = useState<"build" | "responses">("build");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = forms.find((form) => form.id === selectedId) ?? null;
  const allFields = useMemo(
    () => draft?.definition.sections.flatMap((section) => section.fields) ?? [],
    [draft],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sessionResponse.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/forms");
        return;
      }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesion no es valida.");
      setCsrf(session.csrfToken);
      const response = await fetch("/api/forms", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseTitle(response));
      const list = ((await response.json()) as List<FormContract>).data;
      setForms(list);
      const id = selectedId ?? list[0]?.id ?? null;
      setSelectedId(id);
      setDraft(list.find((entry) => entry.id === id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar Formularios.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (selected) setDraft(selected);
  }, [selectedId]);

  async function mutation(
    url: string,
    body: unknown,
    version?: string,
    method: "POST" | "PATCH" = "POST",
  ) {
    if (!csrf) throw new Error("La sesion no esta lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (version) headers["if-match"] = `"${version}"`;
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    return (await response.json()) as { data: FormContract };
  }

  async function createForm(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const result = await mutation("/api/forms", {
        title: "Formulario sin titulo",
        description: "",
        definition: starterDefinition(),
        theme: defaultTheme,
        closesAt: null,
      });
      setForms((current) => [result.data, ...current]);
      setSelectedId(result.data.id);
      setDraft(result.data);
      setNotice("Formulario creado como borrador.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el formulario.");
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await mutation(
        `/api/forms/${draft.id}`,
        {
          title: draft.title,
          description: draft.description,
          definition: draft.definition,
          theme: draft.theme,
          closesAt: draft.closesAt,
        },
        draft.version,
        "PATCH",
      );
      setForms((current) =>
        current.map((entry) => (entry.id === result.data.id ? result.data : entry)),
      );
      setDraft(result.data);
      setNotice("Cambios guardados.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function transition(action: "publish" | "close"): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const result = await mutation(`/api/forms/${draft.id}/${action}`, {}, draft.version);
      setForms((current) =>
        current.map((entry) => (entry.id === result.data.id ? result.data : entry)),
      );
      setDraft(result.data);
      setNotice(
        action === "publish"
          ? "Formulario publicado. El enlace ya esta activo."
          : "Recepcion cerrada.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible completar la accion.");
    } finally {
      setSaving(false);
    }
  }

  async function loadResponses(): Promise<void> {
    if (!draft) return;
    setTab("responses");
    setError(null);
    try {
      const response = await fetch(`/api/forms/${draft.id}/responses?limit=500`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await responseTitle(response));
      setResponses(((await response.json()) as List<SubmittedFormResponse>).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar las respuestas.");
    }
  }

  function updateSection(sectionId: string, transform: (section: Section) => Section): void {
    if (!draft) return;
    setDraft({
      ...draft,
      definition: {
        sections: draft.definition.sections.map((section) =>
          section.id === sectionId ? transform(section) : section,
        ),
      },
    });
  }
  function updateField(sectionId: string, fieldId: string, patch: Partial<FormField>): void {
    updateSection(sectionId, (section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === fieldId ? ({ ...field, ...patch } as FormField) : field,
      ),
    }));
  }
  function moveField(sectionId: string, index: number, direction: -1 | 1): void {
    updateSection(sectionId, (section) => {
      const fields = [...section.fields];
      const target = index + direction;
      if (target < 0 || target >= fields.length) return section;
      [fields[index], fields[target]] = [fields[target]!, fields[index]!];
      return { ...section, fields };
    });
  }
  function exportCsv(): void {
    if (!draft) return;
    const fields = draft.definition.sections.flatMap((section) => section.fields);
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Fecha", ...fields.map((field) => field.label)],
      ...responses.map((entry) => [
        entry.submittedAt,
        ...fields.map((field) => answerText(entry.answers[field.id])),
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.map(quote).join(",")).join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${draft.slug}-respuestas.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <CrmShell>
      <section className="crm-content forms-page">
        <header className="forms-topbar">
          <div>
            <p className="eyebrow">CAPTURA Y CALIFICACION</p>
            <h1>Formularios</h1>
            <p>Crea experiencias publicas, publica versiones estables y revisa cada respuesta.</p>
          </div>
          <button className="primary-action" onClick={() => void createForm()} disabled={saving}>
            + Nuevo formulario
          </button>
        </header>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="form-notice">{notice}</p> : null}
        <div className="forms-workspace">
          <aside className="forms-list">
            <h2>Tus formularios</h2>
            {loading ? <p>Cargando...</p> : null}
            {forms.map((form) => (
              <button
                key={form.id}
                className={form.id === selectedId ? "active" : ""}
                onClick={() => {
                  setSelectedId(form.id);
                  setTab("build");
                }}
              >
                <strong>{form.title}</strong>
                <span className={`forms-status forms-status-${form.status.toLowerCase()}`}>
                  {form.status === "DRAFT"
                    ? "Borrador"
                    : form.status === "PUBLISHED"
                      ? "Publicado"
                      : "Cerrado"}
                </span>
                <small>
                  {form.publishedRevision
                    ? `Version publicada ${form.publishedRevision}`
                    : "Sin publicar"}
                </small>
              </button>
            ))}
            {!loading && forms.length === 0 ? (
              <p>Aun no hay formularios. Crea el primero.</p>
            ) : null}
          </aside>
          {draft ? (
            <main className="forms-editor">
              <nav className="forms-tabs">
                <button className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}>
                  Constructor
                </button>
                <button
                  className={tab === "responses" ? "active" : ""}
                  onClick={() => void loadResponses()}
                >
                  Respuestas ({responses.length})
                </button>
              </nav>
              {tab === "build" ? (
                <>
                  <section className="forms-editor-toolbar">
                    <div>
                      <input
                        className="forms-title-input"
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                      />
                      <textarea
                        value={draft.description}
                        placeholder="Describe el objetivo del formulario"
                        onChange={(event) =>
                          setDraft({ ...draft, description: event.target.value })
                        }
                      />
                    </div>
                    <div>
                      <button onClick={() => void save()} disabled={saving}>
                        Guardar
                      </button>
                      {draft.status !== "CLOSED" ? (
                        <button
                          className="primary-action"
                          onClick={() => void transition("publish")}
                          disabled={saving}
                        >
                          Publicar
                        </button>
                      ) : null}
                      {draft.status === "PUBLISHED" ? (
                        <button onClick={() => void transition("close")} disabled={saving}>
                          Cerrar
                        </button>
                      ) : null}
                    </div>
                  </section>
                  {draft.status === "PUBLISHED" ? (
                    <section className="forms-share">
                      <span>Enlace publico</span>
                      <a href={`/f/${draft.slug}`} target="_blank" rel="noreferrer">
                        {window.location.origin}/f/{draft.slug}
                      </a>
                      <button
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            `${window.location.origin}/f/${draft.slug}`,
                          )
                        }
                      >
                        Copiar
                      </button>
                    </section>
                  ) : null}
                  <div className="forms-builder-grid">
                    <section className="forms-builder">
                      {draft.definition.sections.map((section, sectionIndex) => (
                        <article className="form-section-editor" key={section.id}>
                          <header>
                            <span>SECCION {sectionIndex + 1}</span>
                            <input
                              value={section.title}
                              onChange={(event) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  title: event.target.value,
                                }))
                              }
                            />
                            <textarea
                              value={section.description}
                              placeholder="Descripcion opcional"
                              onChange={(event) =>
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  description: event.target.value,
                                }))
                              }
                            />
                          </header>
                          {section.fields.map((field, index) => (
                            <div className="form-field-editor" key={field.id}>
                              <div className="form-field-head">
                                <span className="drag-handle">⋮⋮</span>
                                <input
                                  value={field.label}
                                  onChange={(event) =>
                                    updateField(section.id, field.id, { label: event.target.value })
                                  }
                                />
                                <select
                                  value={field.type}
                                  onChange={(event) => {
                                    const type = event.target.value as FormFieldType;
                                    updateField(section.id, field.id, {
                                      type,
                                      options: [
                                        "SINGLE_CHOICE",
                                        "MULTIPLE_CHOICE",
                                        "DROPDOWN",
                                      ].includes(type)
                                        ? field.options.length
                                          ? field.options
                                          : ["Opcion 1"]
                                        : [],
                                      ...(type === "SCALE" ? { minimum: 1, maximum: 5 } : {}),
                                    });
                                  }}
                                >
                                  {Object.entries(fieldLabels).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <input
                                className="form-field-description"
                                value={field.description}
                                placeholder="Ayuda o descripcion"
                                onChange={(event) =>
                                  updateField(section.id, field.id, {
                                    description: event.target.value,
                                  })
                                }
                              />
                              {["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"].includes(
                                field.type,
                              ) ? (
                                <label>
                                  Opciones separadas por coma
                                  <input
                                    value={field.options.join(", ")}
                                    onChange={(event) =>
                                      updateField(section.id, field.id, {
                                        options: event.target.value
                                          .split(",")
                                          .map((value) => value.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                  />
                                </label>
                              ) : null}
                              {field.type === "SCALE" ? (
                                <div className="form-field-limits">
                                  <label>
                                    Minimo
                                    <input
                                      type="number"
                                      value={field.minimum ?? 1}
                                      onChange={(event) =>
                                        updateField(section.id, field.id, {
                                          minimum: Number(event.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Maximo
                                    <input
                                      type="number"
                                      value={field.maximum ?? 5}
                                      onChange={(event) =>
                                        updateField(section.id, field.id, {
                                          maximum: Number(event.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              ) : null}
                              <details>
                                <summary>Logica condicional</summary>
                                <select
                                  value={field.condition?.sourceFieldId ?? ""}
                                  onChange={(event) =>
                                    updateField(section.id, field.id, {
                                      condition: event.target.value
                                        ? {
                                            sourceFieldId: event.target.value,
                                            operator: "EQUALS",
                                            value: "",
                                          }
                                        : null,
                                    })
                                  }
                                >
                                  <option value="">Siempre visible</option>
                                  {allFields
                                    .slice(
                                      0,
                                      allFields.findIndex((candidate) => candidate.id === field.id),
                                    )
                                    .map((candidate) => (
                                      <option value={candidate.id} key={candidate.id}>
                                        {candidate.label}
                                      </option>
                                    ))}
                                </select>
                                {field.condition ? (
                                  <>
                                    <select
                                      value={field.condition.operator}
                                      onChange={(event) =>
                                        updateField(section.id, field.id, {
                                          condition: {
                                            ...field.condition!,
                                            operator: event.target.value as
                                              "EQUALS" | "NOT_EQUALS" | "CONTAINS" | "NOT_EMPTY",
                                          },
                                        })
                                      }
                                    >
                                      <option value="EQUALS">Es igual a</option>
                                      <option value="NOT_EQUALS">No es igual a</option>
                                      <option value="CONTAINS">Contiene</option>
                                      <option value="NOT_EMPTY">Tiene respuesta</option>
                                    </select>
                                    {field.condition.operator !== "NOT_EMPTY" ? (
                                      <input
                                        value={String(field.condition.value ?? "")}
                                        placeholder="Valor"
                                        onChange={(event) =>
                                          updateField(section.id, field.id, {
                                            condition: {
                                              ...field.condition!,
                                              value: event.target.value,
                                            },
                                          })
                                        }
                                      />
                                    ) : null}
                                  </>
                                ) : null}
                              </details>
                              <footer>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={field.required}
                                    onChange={(event) =>
                                      updateField(section.id, field.id, {
                                        required: event.target.checked,
                                      })
                                    }
                                  />{" "}
                                  Obligatoria
                                </label>
                                <div>
                                  <button
                                    onClick={() => moveField(section.id, index, -1)}
                                    disabled={index === 0}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    onClick={() => moveField(section.id, index, 1)}
                                    disabled={index === section.fields.length - 1}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    className="danger-link"
                                    onClick={() =>
                                      updateSection(section.id, (current) => ({
                                        ...current,
                                        fields: current.fields.filter(
                                          (item) => item.id !== field.id,
                                        ),
                                      }))
                                    }
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              </footer>
                            </div>
                          ))}
                          <button
                            className="form-add-question"
                            onClick={() =>
                              updateSection(section.id, (current) => ({
                                ...current,
                                fields: [...current.fields, newField()],
                              }))
                            }
                          >
                            + Agregar pregunta
                          </button>
                        </article>
                      ))}
                      <button
                        className="form-add-section"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            definition: {
                              sections: [
                                ...draft.definition.sections,
                                {
                                  id: crypto.randomUUID(),
                                  title: `Seccion ${draft.definition.sections.length + 1}`,
                                  description: "",
                                  fields: [newField()],
                                },
                              ],
                            },
                          })
                        }
                      >
                        + Agregar seccion
                      </button>
                    </section>
                    <aside
                      className="forms-preview"
                      style={{ background: draft.theme.backgroundColor }}
                    >
                      <span>VISTA PREVIA</span>
                      <div style={{ borderTopColor: draft.theme.accentColor }}>
                        <h2>{draft.title}</h2>
                        <p>{draft.description}</p>
                        {draft.definition.sections.map((section) => (
                          <section key={section.id}>
                            <h3>{section.title}</h3>
                            <p>{section.description}</p>
                            {section.fields.map((field) => (
                              <label className="form-preview-field" key={field.id}>
                                <strong>
                                  {field.label}
                                  {field.required ? " *" : ""}
                                </strong>
                                <small>{field.description}</small>
                                {renderPreviewField(field)}
                              </label>
                            ))}
                          </section>
                        ))}
                        <button style={{ background: draft.theme.accentColor }}>
                          Enviar respuesta
                        </button>
                      </div>
                      <label>
                        Color principal
                        <input
                          type="color"
                          value={draft.theme.accentColor}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              theme: { ...draft.theme, accentColor: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        Fondo
                        <input
                          type="color"
                          value={draft.theme.backgroundColor}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              theme: { ...draft.theme, backgroundColor: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        Mensaje final
                        <textarea
                          value={draft.theme.completionMessage}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              theme: { ...draft.theme, completionMessage: event.target.value },
                            })
                          }
                        />
                      </label>
                    </aside>
                  </div>
                </>
              ) : (
                <section className="forms-responses">
                  <header>
                    <div>
                      <h2>Respuestas recibidas</h2>
                      <p>Cada envio conserva la version exacta del formulario.</p>
                    </div>
                    <button onClick={exportCsv} disabled={responses.length === 0}>
                      Exportar CSV
                    </button>
                  </header>
                  {responses.map((entry, index) => (
                    <article key={entry.id}>
                      <header>
                        <strong>Respuesta #{responses.length - index}</strong>
                        <time>
                          {new Intl.DateTimeFormat("es-CO", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(entry.submittedAt))}
                        </time>
                        <span>Version {entry.formRevision}</span>
                      </header>
                      <dl>
                        {allFields.map((field) => (
                          <div key={field.id}>
                            <dt>{field.label}</dt>
                            <dd>
                              {answerText(entry.answers[field.id], "Sin respuesta").replaceAll(
                                " | ",
                                ", ",
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                  {responses.length === 0 ? (
                    <div className="dashboard-empty">
                      <strong>Aun no hay respuestas</strong>
                      <p>Comparte el enlace publicado para empezar a recibirlas.</p>
                    </div>
                  ) : null}
                </section>
              )}
            </main>
          ) : (
            <main className="forms-empty">
              <span>Q</span>
              <h2>Crea tu primer formulario</h2>
              <p>Configura preguntas, publicalo y recibe respuestas sin salir de Quantum.</p>
              <button className="primary-action" onClick={() => void createForm()}>
                Crear formulario
              </button>
            </main>
          )}
        </div>
      </section>
    </CrmShell>
  );
}
