"use client";

import {
  ContactListResponseSchema,
  type Contact,
  type ContactCustomFieldValue,
} from "@quantum-crm/contracts";
import { useEffect, useState } from "react";
import styles from "./conversation-contact.module.css";

/** Resolve only related IDs in bounded batches, with server-side contact authorization. */
export function useConversationContacts(ids: readonly (string | null | undefined)[]) {
  const key = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort().join(",");
  const [result, setResult] = useState<{
    key: string;
    contacts: Map<string, Contact>;
    loading: boolean;
    error: string | null;
  }>({ key: "", contacts: new Map(), loading: false, error: null });
  useEffect(() => {
    const controller = new AbortController();
    if (!key) {
      setResult({ key, contacts: new Map(), loading: false, error: null });
      return () => controller.abort();
    }
    setResult({ key, contacts: new Map(), loading: true, error: null });
    void (async () => {
      const contacts = new Map<string, Contact>();
      const requested = key.split(",");
      for (let offset = 0; offset < requested.length; offset += 100) {
        const params = new URLSearchParams({
          ids: requested.slice(offset, offset + 100).join(","),
          limit: "100",
        });
        const response = await fetch(`/api/contacts?${params}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 403
              ? "No tienes permiso para consultar la ficha del contacto."
              : "No se pudo cargar la información del contacto.",
          );
        for (const contact of ContactListResponseSchema.parse(await response.json()).data)
          contacts.set(contact.id, contact);
      }
      if (!controller.signal.aborted) setResult({ key, contacts, loading: false, error: null });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setResult({
          key,
          contacts: new Map(),
          loading: false,
          error: error instanceof Error ? error.message : "No se pudo cargar el contacto.",
        });
    });
    return () => controller.abort();
  }, [key]);
  return result.key === key
    ? result
    : { contacts: new Map<string, Contact>(), loading: Boolean(key), error: null };
}

function fieldValue(value: ContactCustomFieldValue): string {
  if (value === null || value === "") return "Sin valor";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(fieldValue).join(", ") || "Sin valor";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function ConversationContactCard({
  contact,
  linked,
  loading,
  error,
}: {
  readonly contact: Contact | undefined;
  readonly linked: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}): React.JSX.Element {
  return (
    <section className={styles.card} aria-label="Ficha del cliente" aria-busy={loading}>
      <h3>Ficha del cliente</h3>
      {loading ? (
        <p role="status">Cargando contacto…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : contact ? (
        <>
          <h2>{contact.displayName}</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Correo</dt>
              <dd>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                ) : (
                  "Sin correo"
                )}
              </dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                ) : (
                  "Sin teléfono"
                )}
              </dd>
            </div>
          </dl>
          <a className={styles.open} href={`/contacts?contact=${encodeURIComponent(contact.id)}`}>
            Abrir ficha completa
          </a>
          <details open>
            <summary>
              Etiquetas <span>{contact.labels.length}</span>
            </summary>
            {contact.labels.length ? (
              <ul className={styles.tags}>
                {contact.labels.map((label) => (
                  <li key={label.id}>{label.name}</li>
                ))}
              </ul>
            ) : (
              <p>Sin etiquetas</p>
            )}
          </details>
          <details open>
            <summary>
              Campos personalizados <span>{contact.customFields.length}</span>
            </summary>
            {contact.customFields.length ? (
              <dl className={styles.fields}>
                {contact.customFields.map((field) => (
                  <div key={field.fieldId}>
                    <dt>{field.label}</dt>
                    <dd>{fieldValue(field.value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>Sin campos personalizados guardados</p>
            )}
          </details>
        </>
      ) : (
        <p>
          {linked
            ? "El contacto no está disponible con tus permisos actuales."
            : "Este historial no tiene un contacto vinculado. GHL no incluyó su ficha en los datos importados; no hay nombre ni campos confirmados que mostrar."}
        </p>
      )}
    </section>
  );
}
