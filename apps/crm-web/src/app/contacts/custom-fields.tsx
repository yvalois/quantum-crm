"use client";

import {
  CustomFieldDefinitionListResponseSchema,
  type Contact,
  type ContactCustomFieldValue,
  type CustomFieldDefinition,
  type CustomFieldModel,
} from "@quantum-crm/contracts";
import { useEffect, useId, useState } from "react";
import styles from "./custom-fields.module.css";

export function useCustomFieldDefinitions(model: CustomFieldModel) {
  const [state, setState] = useState<{
    definitions: readonly CustomFieldDefinition[];
    loading: boolean;
    error: string | null;
  }>({ definitions: [], loading: true, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ definitions: [], loading: true, error: null });
    void (async () => {
      const definitions = new Map<string, CustomFieldDefinition>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ model, limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const response = await fetch(`/api/custom-field-definitions?${params}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error("No se pudo cargar el catálogo de campos.");
        const page = CustomFieldDefinitionListResponseSchema.parse(await response.json());
        for (const definition of page.data) {
          if (definition.model !== model) throw new Error("El catálogo de campos no es válido.");
          definitions.set(definition.id, definition);
        }
        cursor = page.page.nextCursor;
        if (cursor) {
          if (seenCursors.has(cursor) || seenCursors.size >= 49)
            throw new Error("No se pudo completar el catálogo de campos.");
          seenCursors.add(cursor);
        }
      } while (cursor);
      if (!controller.signal.aborted)
        setState({ definitions: [...definitions.values()], loading: false, error: null });
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted)
        setState({
          definitions: [],
          loading: false,
          error:
            cause instanceof Error ? cause.message : "No se pudo cargar el catálogo de campos.",
        });
    });
    return () => controller.abort();
  }, [model]);

  return state;
}

function fieldValue(value: ContactCustomFieldValue): string {
  if (value === null || value === "") return "Sin valor";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(fieldValue).join(", ") || "Sin valor";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function FieldEditor({
  definition,
  value,
  displayValue,
  onSave,
}: {
  readonly definition: CustomFieldDefinition;
  readonly value: ContactCustomFieldValue;
  readonly displayValue: string;
  readonly onSave: (fieldId: string, value: ContactCustomFieldValue) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactCustomFieldValue>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = definition.dataType.toUpperCase();
  const options = definition.options;
  const single = type === "SINGLE_OPTIONS" || type === "RADIO";
  async function save(next: ContactCustomFieldValue): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onSave(definition.id, next);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  if (type === "FILE_UPLOAD")
    return (
      <p>
        {displayValue}. Este adjunto requiere la carga segura de archivos; no se puede sustituir
        desde este control.
      </p>
    );
  if (!editing)
    return (
      <button
        type="button"
        className={styles.valueButton}
        aria-label={`${definition.label}: ${displayValue}. Cambiar valor`}
        onClick={() => {
          setDraft(value);
          setError(null);
          setEditing(true);
        }}
      >
        {displayValue}
      </button>
    );
  const multi = type === "MULTIPLE_OPTIONS" || type === "CHECKBOX";
  return (
    <div className={styles.editor}>
      {single ? (
        <div className={styles.optionList} role="group" aria-label={definition.label}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              className={draft === option ? styles.selectedOption : styles.optionButton}
              aria-pressed={draft === option}
              onClick={() => void save(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : multi ? (
        <div className={styles.optionList} role="group" aria-label={definition.label}>
          {options.map((option) => {
            const selected = Array.isArray(draft) && draft.includes(option);
            return (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    setDraft(
                      selected
                        ? Array.isArray(draft)
                          ? draft.filter((item) => item !== option)
                          : []
                        : [...(Array.isArray(draft) ? draft : []), option],
                    )
                  }
                />
                {option}
              </label>
            );
          })}
        </div>
      ) : type === "DATE" ? (
        <input
          aria-label={definition.label}
          type="date"
          value={typeof draft === "string" ? draft.slice(0, 10) : ""}
          onChange={(event) => setDraft(event.target.value || null)}
        />
      ) : type === "NUMERICAL" || type === "MONETORY" ? (
        <input
          aria-label={definition.label}
          type="number"
          step="any"
          value={typeof draft === "number" ? draft : ""}
          onChange={(event) =>
            setDraft(event.target.value === "" ? null : Number(event.target.value))
          }
        />
      ) : type === "LARGE_TEXT" || type === "TEXTBOX_LIST" ? (
        <textarea
          aria-label={definition.label}
          rows={4}
          value={
            type === "TEXTBOX_LIST"
              ? Array.isArray(draft)
                ? draft.join("\n")
                : ""
              : typeof draft === "string"
                ? draft
                : ""
          }
          onChange={(event) =>
            setDraft(
              type === "TEXTBOX_LIST"
                ? event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                : event.target.value,
            )
          }
        />
      ) : (
        <input
          aria-label={definition.label}
          type="text"
          value={typeof draft === "string" ? draft : ""}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.editActions}>
        {!single ? (
          <button type="button" disabled={busy} onClick={() => void save(draft)}>
            Guardar
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={() => setEditing(false)}>
          Cancelar
        </button>
        <button type="button" disabled={busy} onClick={() => void save(null)}>
          Limpiar valor
        </button>
      </div>
    </div>
  );
}

export function CustomFields({
  fields,
  definitions,
  loading = false,
  error = null,
  title = "Campos personalizados",
  initiallyIncludeEmpty = false,
  onSave,
}: {
  readonly fields: Contact["customFields"];
  readonly definitions: readonly CustomFieldDefinition[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly title?: string;
  readonly initiallyIncludeEmpty?: boolean;
  readonly onSave?: (fieldId: string, value: ContactCustomFieldValue) => Promise<void>;
}): React.JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(initiallyIncludeEmpty);
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const savedIds = new Set(fields.map((field) => field.fieldId));
  const rows = [
    ...fields.map((field) => ({
      id: field.fieldId,
      key: field.key,
      label: definitionsById.get(field.fieldId)?.label ?? field.label,
      description: definitionsById.get(field.fieldId)?.description ?? "",
      text:
        field.dataType.toUpperCase() === "FILE_UPLOAD"
          ? "Adjunto pendiente de transferencia y análisis"
          : fieldValue(field.value),
      saved: true,
      definition: definitionsById.get(field.fieldId),
      value: field.value,
    })),
    ...definitions
      .filter((definition) => !savedIds.has(definition.id))
      .map((definition) => ({
        id: definition.id,
        key: definition.key,
        label: definition.label,
        description: definition.description,
        text: "Sin valor guardado",
        saved: false,
        definition,
        value: null,
      })),
  ];
  const search = query.trim().toLocaleLowerCase("es");
  const visible = rows.filter(
    (row) =>
      (includeEmpty || row.saved) &&
      (!search || `${row.label} ${row.key}`.toLocaleLowerCase("es").includes(search)),
  );

  return (
    <details className={styles.panel} open>
      <summary>
        {title}{" "}
        <span>
          {fields.length} con registro · {rows.length} disponibles
        </span>
      </summary>
      <div className={styles.controls}>
        <label htmlFor={searchId}>Buscar campos</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre del campo"
        />
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={includeEmpty}
            onChange={(event) => setIncludeEmpty(event.target.checked)}
          />
          Incluir campos vacíos
        </label>
      </div>
      {loading ? <p role="status">Cargando catálogo de campos…</p> : null}
      {error ? <p role="status">{error} Los valores guardados siguen disponibles.</p> : null}
      {visible.length ? (
        <dl className={styles.fields}>
          {visible.map((field) => (
            <div key={field.id}>
              <dt>{field.label}</dt>
              {field.description ? (
                <dd className={styles.description}>{field.description}</dd>
              ) : null}
              {onSave && field.definition ? (
                <dd>
                  <FieldEditor
                    key={`${field.id}:${JSON.stringify(field.value)}`}
                    definition={field.definition}
                    value={field.value}
                    displayValue={field.text}
                    onSave={onSave}
                  />
                </dd>
              ) : (
                <dd className={field.saved ? undefined : styles.empty}>{field.text}</dd>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <p>
          {search
            ? "No hay campos que coincidan con la búsqueda."
            : includeEmpty
              ? "No hay campos definidos para este modelo."
              : "Sin valores personalizados guardados. Activa los campos vacíos para ver el catálogo."}
        </p>
      )}
    </details>
  );
}

export function ContactCustomFields({
  fields,
  title,
  initiallyIncludeEmpty,
  onSave,
}: {
  readonly fields: Contact["customFields"];
  readonly title?: string;
  readonly initiallyIncludeEmpty?: boolean;
  readonly onSave?: (fieldId: string, value: ContactCustomFieldValue) => Promise<void>;
}): React.JSX.Element {
  const catalog = useCustomFieldDefinitions("contact");
  return (
    <CustomFields
      fields={fields}
      {...(onSave ? { onSave } : {})}
      {...catalog}
      {...(title ? { title } : {})}
      {...(initiallyIncludeEmpty === undefined ? {} : { initiallyIncludeEmpty })}
    />
  );
}
