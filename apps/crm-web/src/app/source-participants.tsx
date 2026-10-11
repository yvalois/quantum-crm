import type { SourceParticipants } from "@quantum-crm/contracts";
import styles from "./source-participants.module.css";

/** Source attribution is historical context, never a Quantum access grant. */
export function SourceParticipantsCard({
  participants,
  kind,
}: {
  readonly participants: SourceParticipants | null | undefined;
  readonly kind: "contacto" | "oportunidad" | "conversación";
}): React.JSX.Element | null {
  if (!participants) return null;
  return (
    <section className={styles.card} aria-label={`Responsables originales de ${kind}`}>
      <h3>Responsables en GHL · {kind}</h3>
      <dl>
        <div>
          <dt>Propietario original</dt>
          <dd>
            {participants.owner
              ? participants.owner.displayName ?? "Usuario de origen no disponible"
              : "Sin propietario en el registro importado"}
          </dd>
        </div>
        <div>
          <dt>Seguidores originales</dt>
          <dd>
            {participants.followers.length ? (
              <ul>
                {participants.followers.map((person) => (
                  <li key={person.externalId}>
                    {person.displayName ?? "Usuario de origen no disponible"}
                  </li>
                ))}
              </ul>
            ) : (
              "Sin seguidores en el registro importado"
            )}
          </dd>
        </div>
      </dl>
      <p>Datos del origen. No equivalen a cuentas ni permisos de Quantum.</p>
    </section>
  );
}
