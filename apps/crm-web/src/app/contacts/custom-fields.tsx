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

export function CustomFields({
  fields,
  definitions,
  loading = false,
  error = null,
  title = "Campos personalizados",
}: {
  readonly fields: Contact["customFields"];
  readonly definitions: readonly CustomFieldDefinition[];
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly title?: string;
}): React.JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
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
              <dd className={field.saved ? undefined : styles.empty}>{field.text}</dd>
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
}: {
  readonly fields: Contact["customFields"];
  readonly title?: string;
}): React.JSX.Element {
  const catalog = useCustomFieldDefinitions("contact");
  return <CustomFields fields={fields} {...catalog} {...(title ? { title } : {})} />;
}
