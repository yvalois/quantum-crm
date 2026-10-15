import { createHash, randomUUID } from "node:crypto";

import type { CrmPostgresDatabase } from "@quantum-crm/database";
import { agentRoutingPrincipalId, type CommercialActor, type IamMember } from "@quantum-crm/domain";

const pipelineExternalId = "0JrcG4CvEer6NE969a0P";
const qualifiedStageExternalId = "779de82e-326c-475b-a6be-ac49eff1642c";
const advisorNames = ["Carlos Mejía", "Julio Rafael"] as const;
const actor: CommercialActor = Object.freeze({
  memberId: agentRoutingPrincipalId,
  scope: "PROFILE",
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Invoked only after the profile-bound YCloud signature has been verified. */
export async function routeInterAmericanAdvisor(
  database: CrmPostgresDatabase,
  input: { readonly contactId: string; readonly externalThreadId: string },
): Promise<string | undefined> {
  const members: IamMember[] = [];
  let cursor: string | undefined;
  do {
    const page = await database.members.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    members.push(...page.members);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const pool = advisorNames.map((name) =>
    members.find(
      (member) =>
        member.displayName === name &&
        member.roleCode === "ADVISOR" &&
        member.status !== "DEACTIVATED",
    ),
  );
  if (!pool[0] || !pool[1] || pool[0].id === pool[1].id)
    throw new Error("InterAmerican advisor pool unavailable");
  const advisorIds = [pool[0].id, pool[1].id] as const;
  const thread = await database.commercial.externalConversations.findThreadAssignment(
    input.externalThreadId,
  );
  if (thread && thread.contactId !== input.contactId)
    throw new Error("Conversation/contact mismatch");
  if (thread?.assigneeMemberId && !advisorIds.includes(thread.assigneeMemberId)) return undefined;
  const contact = await database.commercial.contacts.find(actor, input.contactId);
  if (!contact || contact.archivedAt) throw new Error("Contact unavailable for routing");
  const stage = await database.commercial.sales.resolveImportedStage?.({
    pipelineExternalId,
    stageExternalId: qualifiedStageExternalId,
  });
  if (!stage) throw new Error("Imported InterAmerican pipeline unavailable");
  const opportunities = (
    await database.commercial.sales.listOpportunities(actor, {
      contactId: input.contactId,
      pipelineId: stage.pipelineId,
    })
  )
    .slice()
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
  const opportunity = opportunities.find((item) => item.status === "OPEN") ?? null;
  const previousOpportunity = opportunities.find((item) => advisorIds.includes(item.ownerMemberId));
  const previousMemberId =
    thread?.assigneeMemberId ??
    (previousOpportunity
      ? previousOpportunity.ownerMemberId
      : advisorIds.includes(contact.ownerMemberId ?? "")
        ? contact.ownerMemberId
        : null);
  const advisorId = await database.commercial.externalConversations.reserveAdvisor({
    contactId: input.contactId,
    eligibleMemberIds: advisorIds,
    previousMemberId,
  });
  if (contact.ownerMemberId !== advisorId) {
    const updated = await database.commercial.contacts.update({
      actor,
      contact: {
        ...contact,
        ownerMemberId: advisorId,
        version: contact.version + 1n,
        updatedAt: new Date(),
      },
      expectedVersion: contact.version,
    });
    if (!updated) throw new Error("Contact owner changed during routing");
  }
  if (opportunity) {
    if (opportunity.ownerMemberId !== advisorId) {
      const updated = await database.commercial.sales.updateOpportunity({
        actor,
        opportunity: {
          ...opportunity,
          ownerMemberId: advisorId,
          version: opportunity.version + 1n,
          updatedAt: new Date(),
        },
        expectedVersion: opportunity.version,
        idempotencyKey: `agent-route-${opportunity.id}-${opportunity.version}`,
        payloadHash: hash(`${opportunity.id}:${advisorId}`),
      });
      if (!updated) throw new Error("Opportunity owner changed during routing");
    }
  } else {
    const now = new Date();
    await database.commercial.sales.createOpportunity({
      actor,
      opportunity: {
        id: randomUUID(),
        contactId: input.contactId,
        ownerMemberId: advisorId,
        pipelineId: stage.pipelineId,
        stageId: stage.stageId,
        title: `Consulta de ${contact.displayName}`.slice(0, 160),
        amountMinor: 0n,
        currency: "GTQ",
        status: "OPEN",
        closeReason: null,
        closedAt: null,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      },
      idempotencyKey: `agent-route-${input.contactId}`,
      payloadHash: hash(`${input.contactId}:${stage.pipelineId}:${stage.stageId}:${advisorId}`),
    });
  }
  return advisorId;
}
