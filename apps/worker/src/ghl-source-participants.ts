import { ghlApiOrigin, type SecretValue } from "@quantum-crm/config";
import {
  authorizeHistoricalImport,
  sourceParticipantReferencesFromRow,
  type ExternalParticipantDirectory,
  type GhlImportOperationIdentity,
  type HistoricalImportContext,
} from "@quantum-crm/domain";
import { type GhlImportArtifact } from "./ghl-migration-import-artifact.js";

const identifier = /^[A-Za-z0-9_-]{1,200}$/u;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid directory response");
  return value as Record<string, unknown>;
}

/** Fixed, documented read-only users endpoint. No endpoint, method or version comes from data. */
export async function readGhlParticipantDirectory(
  locationId: string,
  token: SecretValue,
  fetcher: typeof fetch = fetch,
): Promise<readonly { readonly externalId: string; readonly displayName: string }[]> {
  if (!identifier.test(locationId)) throw new Error("Invalid source location");
  const response = await fetcher(`${ghlApiOrigin}/users/?locationId=${encodeURIComponent(locationId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token.expose()}`, Version: "2021-07-28", Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("GHL participant directory unavailable");
  }
  if (!response.body) throw new Error("Missing directory response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 2_097_152) throw new Error("Directory response exceeds limit");
    chunks.push(chunk);
  }
  const payload = object(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
  if (!Array.isArray(payload.users) || payload.users.length > 5000) throw new Error("Invalid directory response");
  const ids = new Set<string>();
  return payload.users.map((value: unknown) => {
    const user = object(value);
    const roles = object(user.roles);
    const displayName = typeof user.name === "string" && user.name.trim()
      ? user.name.trim()
      : [user.firstName, user.lastName].filter((part) => typeof part === "string").join(" ").trim();
    if (typeof user.id !== "string" || !identifier.test(user.id) || ids.has(user.id) ||
      !Array.isArray(roles.locationIds) || !roles.locationIds.includes(locationId) ||
      !displayName || displayName.length > 300 || /[\u0000-\u001f\u007f]/u.test(displayName))
      throw new Error("Invalid directory participant or location");
    ids.add(user.id);
    // Deliberately discard email, phone, roles, scope and every other provider attribute.
    return { externalId: user.id, displayName };
  });
}

export async function enrichGhlSourceParticipants(
  artifact: GhlImportArtifact,
  identity: GhlImportOperationIdentity,
  context: HistoricalImportContext,
  directory: ExternalParticipantDirectory,
  token: SecretValue,
  fetcher: typeof fetch = fetch,
) {
  authorizeHistoricalImport(context, "iam:members:update");
  if (identity.locationId !== artifact.locationId || identity.exportId !== artifact.exportId ||
    identity.operatorMemberId !== context.actor.memberId) throw new Error("Directory import identity mismatch");
  const references = ["CONTACTS", "OPPORTUNITIES", "CONVERSATIONS"].flatMap((stream) =>
    (artifact.records.get(stream as "CONTACTS" | "OPPORTUNITIES" | "CONVERSATIONS") ?? []).map((record) => {
      if (record.locationId !== identity.locationId) throw new Error("Directory reference location mismatch");
      const parsed = sourceParticipantReferencesFromRow({
        locationId: identity.locationId,
        ownerExternalId: record.assignedTo || null,
        followerExternalIds: record.followers ?? [],
      }).sourceParticipantReferences;
      if (!parsed) throw new Error("Directory reference missing");
      return parsed;
    }),
  );
  // Complete provider validation before the single destination transaction.
  const participants = await readGhlParticipantDirectory(identity.locationId, token, fetcher);
  const result = await directory.importDirectory(context, {
    operationId: identity.operationId,
    locationId: identity.locationId,
    participants,
  });
  const persisted = await directory.resolve(references);
  const ids = new Set(persisted.filter((entry) => entry.locationId === identity.locationId).map((entry) => entry.externalId));
  const sourceIds = references.flatMap((reference) => [reference.ownerExternalId, ...reference.followerExternalIds].filter((id): id is string => id !== null));
  const resolvedReferences = sourceIds.filter((id) => ids.has(id)).length;
  return {
    ...result,
    status: sourceIds.length === resolvedReferences ? "COMPLETE" as const : "PARTIAL" as const,
    sourceReferences: sourceIds.length,
    resolvedReferences,
  };
}
