import { createHash, randomUUID } from "node:crypto";

import { parseDatabaseConfig } from "@quantum-crm/config";
import {
  CommercialIdempotencyConflictError,
  createCrmPostgresDatabase,
  type CrmPostgresDatabase,
} from "@quantum-crm/database";
import {
  ContactService,
  IamAuthorizationError,
  SalesNotFoundError,
  SalesService,
  SalesValidationError,
  SalesVersionConflictError,
  type CommercialActor,
} from "@quantum-crm/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Reuse the dedicated, migrated PostgreSQL profiles from the integration bootstrap.
// Identity is checked before any write; these fixtures must never target a business profile.
const profiles = ["a", "b"].map((suffix) => {
  const tenantId = `00000000-0000-4000-8000-00000000000${suffix}`;
  const config = parseDatabaseConfig(
    "pipeline-board-integration",
    { target: "crm", requiresTenant: true },
    "test",
    {
      QCRM_TENANT_ID: tenantId,
      QCRM_DATABASE_URL_FILE: `/run/secrets/ghl_import_test_${suffix}_database_url`,
    },
  );
  return {
    tenantId,
    database: createCrmPostgresDatabase(config, `pipeline-board-${suffix}`),
    pool: new Pool({
      connectionString: config.connectionUrl.expose(),
      max: 5,
      connectionTimeoutMillis: 5000,
    }),
  };
});
const profileA = profiles[0]!;
const profileB = profiles[1]!;
const actor: CommercialActor = { memberId: randomUUID(), scope: "PROFILE" };
const permissions = [
  "crm:contacts:create",
  "crm:sales:configure",
  "crm:sales:create",
  "crm:sales:read",
  "crm:sales:move",
  "crm:sales:update",
] as const;
const clock = () => new Date("2026-10-11T15:00:00.000Z");

function command(value: string) {
  return {
    idempotencyKey: `pipeline-test-${randomUUID()}`,
    payloadHash: createHash("sha256").update(value).digest("hex"),
  };
}

function service(database: CrmPostgresDatabase) {
  return new SalesService(
    database.commercial.sales,
    {
      existsFor: async (viewer, id) =>
        (await database.commercial.contacts.find(viewer, id)) !== null,
    },
    { isActive: async (id) => (await database.members.findById(id))?.status === "ACTIVE" },
    clock,
  );
}

const salesA = service(profileA.database);
const salesB = service(profileB.database);

async function fixture() {
  const contact = await new ContactService(profileA.database.commercial.contacts, clock).create({
    actor,
    permissions,
    displayName: "Synthetic pipeline contact",
    email: `pipeline-${randomUUID()}@example.test`,
    ...command("contact"),
  });
  const pipeline = await salesA.createPipeline({
    actor,
    permissions,
    name: `Synthetic pipeline ${randomUUID()}`,
    description: "Disposable pipeline verification",
    stages: [
      { name: "Discovery", description: "Initial contact" },
      { name: "Proposal", description: "Proposal delivered" },
    ],
    ...command("pipeline"),
  });
  const firstStage = pipeline.stages[0]!;
  const nextStage = pipeline.stages[1]!;
  const opportunity = await salesA.createOpportunity({
    actor,
    permissions,
    contactId: contact.id,
    pipelineId: pipeline.id,
    stageId: firstStage.id,
    title: "Synthetic deal",
    amountMinor: 1234500n,
    currency: "COP",
    ...command("opportunity"),
  });
  return { contact, pipeline, firstStage, nextStage, opportunity };
}

beforeAll(async () => {
  for (const profile of profiles) {
    const suffix = profile.tenantId.replaceAll("-", "");
    const identity = await profile.pool.query<{ database_name: string; runtime_role: string }>(
      "SELECT current_database() AS database_name, current_user AS runtime_role",
    );
    expect(identity.rows[0]).toEqual({
      database_name: `qcrm_t_${suffix}`,
      runtime_role: `qcrm_r_${suffix}`,
    });
  }
  for (const profile of profiles) {
    await profile.pool.query(
      `INSERT INTO iam.members(id, oidc_subject, display_name, email, status, commercial_scope)
       VALUES ($1::uuid, $2, 'Synthetic pipeline operator', $3, 'active', 'profile')`,
      [
        actor.memberId,
        `pipeline-fixture-${actor.memberId}`,
        `pipeline-${actor.memberId}@example.test`,
      ],
    );
    await profile.database.connect();
  }
});

afterAll(async () => {
  // The isolated host setup owns disposal, including append-only history.
  await Promise.all(profiles.flatMap(({ database, pool }) => [database.close(), pool.end()]));
});

describe("PIPE-07 practical board against isolated PostgreSQL", () => {
  it("returns all 1127 opportunities and applies stage filters without truncation", async () => {
    const { contact, pipeline, firstStage, nextStage } = await fixture();
    await profileA.pool.query(
      `INSERT INTO sales.opportunities
       (owner_member_id, contact_id, pipeline_id, stage_id, title, amount_minor, currency)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid,
              'Synthetic volume deal ' || number::text, 10000, 'COP'
       FROM generate_series(1, 1126) AS number`,
      [actor.memberId, contact.id, pipeline.id, firstStage.id],
    );
    const all = await salesA.listOpportunities(actor, permissions, { pipelineId: pipeline.id });
    expect(all).toHaveLength(1127);
    expect(new Set(all.map((item) => item.id)).size).toBe(1127);
    expect(all.every((item) => item.pipelineId === pipeline.id)).toBe(true);
    expect(
      await salesA.listOpportunities(actor, permissions, {
        pipelineId: pipeline.id,
        stageId: nextStage.id,
      }),
    ).toEqual([]);
  });

  it("persists one move and one history event across concurrent and later replays", async () => {
    const { opportunity, firstStage, nextStage } = await fixture();
    const request = {
      actor,
      permissions,
      opportunityId: opportunity.id,
      stageId: nextStage.id,
      expectedVersion: opportunity.version,
      ...command("same move"),
    };
    const [first, concurrent] = await Promise.all([
      salesA.moveOpportunity(request),
      salesA.moveOpportunity(request),
    ]);
    expect(concurrent).toEqual(first);
    expect(await salesA.moveOpportunity(request)).toEqual(first);
    expect(
      await salesA.getOpportunity({ actor, permissions, opportunityId: opportunity.id }),
    ).toMatchObject({
      stageId: nextStage.id,
      version: 2n,
    });
    const history = await salesA.listOpportunityHistory({
      actor,
      permissions,
      opportunityId: opportunity.id,
    });
    expect(history.filter((entry) => entry.eventType === "STAGE_CHANGED")).toEqual([
      expect.objectContaining({
        actorMemberId: actor.memberId,
        previousStageId: firstStage.id,
        nextStageId: nextStage.id,
      }),
    ]);
    await expect(
      salesA.moveOpportunity({
        ...request,
        ...command("stale distinct move"),
        stageId: firstStage.id,
      }),
    ).rejects.toBeInstanceOf(SalesVersionConflictError);
    await expect(
      salesA.moveOpportunity({ ...request, payloadHash: "b".repeat(64), stageId: firstStage.id }),
    ).rejects.toBeInstanceOf(CommercialIdempotencyConflictError);
    expect(
      (await salesA.listOpportunityHistory({ actor, permissions, opportunityId: opportunity.id }))
        .length,
    ).toBe(2);
    await profileA.pool.query(
      "UPDATE sales.opportunities SET owner_member_id = $2::uuid WHERE id = $1::uuid",
      [opportunity.id, randomUUID()],
    );
    await expect(
      salesA.moveOpportunity({ ...request, actor: { ...actor, scope: "OWN" } }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
  });

  it("replays a saved amount change while rejecting stale independent changes", async () => {
    const { opportunity } = await fixture();
    const request = {
      actor,
      permissions,
      opportunityId: opportunity.id,
      expectedVersion: opportunity.version,
      amountMinor: 7654300n,
      ...command("amount update"),
    };
    const [result, concurrent] = await Promise.all([
      salesA.updateOpportunity(request),
      salesA.updateOpportunity(request),
    ]);
    expect(concurrent).toEqual(result);
    expect(result).toMatchObject({ amountMinor: 7654300n, version: 2n });
    expect(await salesA.updateOpportunity(request)).toEqual(result);
    await expect(
      salesA.updateOpportunity({ ...request, ...command("stale update") }),
    ).rejects.toBeInstanceOf(SalesVersionConflictError);
    const history = await salesA.listOpportunityHistory({
      actor,
      permissions,
      opportunityId: opportunity.id,
    });
    expect(history.filter((entry) => entry.eventType === "UPDATED")).toEqual([
      expect.objectContaining({ previousAmountMinor: 1234500n, nextAmountMinor: 7654300n }),
    ]);
  });

  it("rejects missing permission, another pipeline stage and resources outside the current scope", async () => {
    const { opportunity, nextStage } = await fixture();
    const other = await fixture();
    const request = {
      actor,
      permissions,
      opportunityId: opportunity.id,
      stageId: nextStage.id,
      expectedVersion: opportunity.version,
      ...command("denied move"),
    };
    await expect(salesA.moveOpportunity({ ...request, permissions: [] })).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );
    await expect(
      salesA.moveOpportunity({ ...request, stageId: other.nextStage.id }),
    ).rejects.toBeInstanceOf(SalesValidationError);
    const otherActor: CommercialActor = { memberId: randomUUID(), scope: "OWN" };
    await expect(salesA.moveOpportunity({ ...request, actor: otherActor })).rejects.toBeInstanceOf(
      SalesNotFoundError,
    );
    await expect(
      salesA.getOpportunity({ actor: otherActor, permissions, opportunityId: opportunity.id }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
    expect(
      await salesA.listOpportunities(otherActor, permissions, {
        pipelineId: opportunity.pipelineId,
      }),
    ).toEqual([]);
    expect(
      await salesA.listOpportunityHistory({
        actor: otherActor,
        permissions,
        opportunityId: opportunity.id,
      }),
    ).toEqual([]);
    expect(
      await salesA.getOpportunity({ actor, permissions, opportunityId: opportunity.id }),
    ).toMatchObject({ stageId: opportunity.stageId, version: 1n });
  });

  it("keeps a known opportunity ID unreadable and unmovable from the other profile", async () => {
    const { opportunity, nextStage } = await fixture();
    await expect(
      salesB.getOpportunity({ actor, permissions, opportunityId: opportunity.id }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
    await expect(
      salesB.moveOpportunity({
        actor,
        permissions,
        opportunityId: opportunity.id,
        stageId: nextStage.id,
        expectedVersion: opportunity.version,
        ...command("cross-profile move"),
      }),
    ).rejects.toBeInstanceOf(SalesNotFoundError);
    expect(
      await salesB.listOpportunities(actor, permissions, { pipelineId: opportunity.pipelineId }),
    ).toEqual([]);
    expect(
      await salesB.listOpportunityHistory({ actor, permissions, opportunityId: opportunity.id }),
    ).toEqual([]);
    expect(
      await salesA.getOpportunity({ actor, permissions, opportunityId: opportunity.id }),
    ).toMatchObject({ stageId: opportunity.stageId, version: 1n });
  });
});
