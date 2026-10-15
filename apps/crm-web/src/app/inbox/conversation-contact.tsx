"use client";

import {
  ContactListResponseSchema,
  ContactResponseSchema,
  type Contact,
  type ContactCustomFieldValue,
  type TaskAssignee,
} from "@quantum-crm/contracts";
import { useEffect, useState } from "react";
import { ContactCustomFields } from "../contacts/custom-fields";
import { SourceParticipantsCard } from "../source-participants";
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
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
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

export function ConversationContactCard({
  contact,
  linked,
  loading,
  error,
  ownerName,
  canAssignOwner,
  assignees,
  csrfToken,
  onSaved,
}: {
  readonly contact: Contact | undefined;
  readonly linked: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly ownerName: string;
  readonly canAssignOwner: boolean;
  readonly assignees: readonly TaskAssignee[];
  readonly csrfToken: string | null;
  readonly onSaved: (contact: Contact) => void;
}): React.JSX.Element {
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const activeOwner = assignees.some((assignee) => assignee.id === contact?.ownerMemberId);

  async function saveOwner(ownerMemberId: string | null): Promise<void> {
    if (!contact || !csrfToken) throw new Error("No hay una sesión activa para guardar.");
    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
        "if-match": `"${contact.version}"`,
      },
      body: JSON.stringify({ ownerMemberId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 409)
        throw new Error("Este contacto cambió. Vuelve a abrir el chat antes de asignarlo.");
      if (response.status === 403)
        throw new Error("No tienes permiso para cambiar el responsable de este contacto.");
      throw new Error("No se pudo cambiar el responsable del contacto.");
    }
    onSaved(ContactResponseSchema.parse(await response.json()).data);
  }

  async function saveField(fieldId: string, value: ContactCustomFieldValue): Promise<void> {
    if (!contact || !csrfToken) throw new Error("No hay una sesión activa para guardar.");
    const response = await fetch(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
        "if-match": `"${contact.version}"`,
      },
      body: JSON.stringify({ customField: { fieldId, value } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 409)
        throw new Error("Este contacto cambió. Vuelve a abrir el chat antes de guardar.");
      if (response.status === 403) throw new Error("No tienes permiso para editar este contacto.");
      throw new Error("No se pudo guardar el campo personalizado.");
    }
    onSaved(ContactResponseSchema.parse(await response.json()).data);
  }
  return (
    <section className={styles.card} aria-label="Ficha del cliente" aria-busy={loading}>
      <div className={styles.heading}>
        <span className={styles.headingText}>
          <span>Ficha del contacto</span>
          <h3>{contact?.displayName ?? "Datos del contacto"}</h3>
        </span>
        {contact ? (
          <span className={styles.contactInitials} aria-hidden="true">
            {contact.displayName.slice(0, 2).toUpperCase()}
          </span>
        ) : null}
      </div>
      <div className={styles.content}>
        {loading ? (
          <p role="status">Cargando contacto…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : contact ? (
          <>
            <dl className={styles.facts}>
              <div>
                <dt>Responsable del contacto</dt>
                <dd>
                  {canAssignOwner ? (
                    <select
                      className={styles.ownerSelect}
                      aria-label="Responsable del contacto"
                      value={contact.ownerMemberId ?? ""}
                      disabled={ownerBusy || !csrfToken}
                      onChange={(event) => {
                        const ownerMemberId = event.target.value || null;
                        setOwnerBusy(true);
                        setOwnerError(null);
                        void saveOwner(ownerMemberId)
                          .catch((cause: unknown) =>
                            setOwnerError(
                              cause instanceof Error
                                ? cause.message
                                : "No se pudo cambiar el responsable del contacto.",
                            ),
                          )
                          .finally(() => setOwnerBusy(false));
                      }}
                    >
                      <option value="">Sin asignar</option>
                      {contact.ownerMemberId && !activeOwner ? (
                        <option value={contact.ownerMemberId} disabled>
                          {ownerName} (cuenta no activa)
                        </option>
                      ) : null}
                      {assignees.map((assignee) => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.displayName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ownerName
                  )}
                  {ownerBusy ? <span className={styles.ownerHint}>Guardando…</span> : null}
                  {ownerError ? (
                    <span className={styles.ownerError} role="alert">
                      {ownerError}
                    </span>
                  ) : null}
                </dd>
              </div>
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
            {contact.labels.length ? (
              <div className={styles.labels}>
                <strong>Etiquetas</strong>
                <ul className={styles.tags}>
                  {contact.labels.map((label) => (
                    <li key={label.id}>{label.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ContactCustomFields
              key={contact.id}
              fields={contact.customFields}
              onSave={saveField}
            />
            {contact.sourceParticipants ? (
              <details className={styles.sourceDetails}>
                <summary>Responsables originales</summary>
                <SourceParticipantsCard participants={contact.sourceParticipants} kind="contacto" />
              </details>
            ) : null}
          </>
        ) : (
          <p>
            {linked
              ? "El contacto no está disponible con tus permisos actuales."
              : "Esta conversación no tiene un contacto vinculado; no hay nombre ni campos confirmados que mostrar."}
          </p>
        )}
      </div>
    </section>
  );
}
