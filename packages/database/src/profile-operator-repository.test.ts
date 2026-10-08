import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PostgresPool } from "./postgres-database.js";
import { createProfileOperatorRepository } from "./profile-operator-repository.js";

const now = new Date("2026-10-07T23:30:00.000Z");
const command = {
  id: "01999abc-7def-7000-8000-000000000001",
  tenantProfileId: "01999abc-7def-7000-8000-000000000002",
  requestedByOperatorId: "01999abc-7def-7000-8000-000000000003",
  displayName: "David",
  email: "DAVID@example.com",
  correlationId: "operator-retry-20261007",
  idempotencyKey: "operator-retry-20261007",
  now,
};

describe("profile operator repository", () => {
  it("reuses a failed email assignment with the new request identity", async () => {
    const retriedRow = {
      id: command.id,
      tenant_profile_id: command.tenantProfileId,
      requested_by_operator_id: command.requestedByOperatorId,
      operator_id: null,
      crm_member_id: null,
      oidc_subject: null,
      display_name: command.displayName,
      email: command.email.toLowerCase(),
      status: "pending",
      correlation_id: command.correlationId,
      idempotency_key: command.idempotencyKey,
      lease_owner: null,
      lease_expires_at: null,
      version: "3",
      created_at: new Date("2026-10-07T23:08:18.155Z"),
      updated_at: now,
    };
    const clientQuery = vi.fn(async (text: string) => {
      if (text.startsWith("SELECT id::text FROM tenants.tenant_profiles")) {
        return { rows: [{ id: command.tenantProfileId }] };
      }
      if (text.includes("WHERE requested_by_operator_id")) return { rows: [] };
      if (text.startsWith("SELECT count(*)::text")) return { rows: [{ count: "0" }] };
      if (text.startsWith("UPDATE platform_iam.profile_operator_assignments SET id=")) {
        return { rows: [retriedRow] };
      }
      return { rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(createProfileOperatorRepository(pool).request(command)).resolves.toMatchObject({
      assignment: { id: command.id, email: "david@example.com", status: "PENDING" },
      idempotentReplay: false,
    });

    const statements = clientQuery.mock.calls.map(([text]) => text as string);
    expect(statements).toContainEqual(expect.stringContaining("AND email=$5 AND status='failed'"));
    expect(statements).not.toContainEqual(
      expect.stringContaining("INSERT INTO platform_iam.profile_operator_assignments"),
    );
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("completes with the isolated CRM member without granting platform permissions", async () => {
    const memberId = "01999abc-7def-7000-8000-000000000004";
    const subject = "01999abc-7def-7000-8000-000000000005";
    const pendingRow = {
      id: command.id,
      tenant_profile_id: command.tenantProfileId,
      requested_by_operator_id: command.requestedByOperatorId,
      operator_id: null,
      crm_member_id: null,
      oidc_subject: null,
      display_name: command.displayName,
      email: command.email.toLowerCase(),
      status: "pending",
      correlation_id: command.correlationId,
      idempotency_key: command.idempotencyKey,
      lease_owner: "deploy-executor:test",
      lease_expires_at: new Date("2026-10-07T23:31:00.000Z"),
      version: "2",
      created_at: now,
      updated_at: now,
    };
    const clientQuery = vi.fn(async (text: string) => {
      if (text.startsWith("SELECT") && text.includes("status='pending'")) {
        return { rows: [pendingRow] };
      }
      if (
        text.startsWith("UPDATE platform_iam.profile_operator_assignments SET operator_id=NULL")
      ) {
        return {
          rows: [
            {
              ...pendingRow,
              crm_member_id: memberId,
              oidc_subject: subject,
              status: "active",
              lease_owner: null,
              lease_expires_at: null,
              version: "3",
            },
          ],
        };
      }
      return { rows: [] };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    } as unknown as PostgresPool;

    await expect(
      createProfileOperatorRepository(pool).complete({
        assignmentId: command.id,
        workerId: "deploy-executor:test",
        expectedVersion: 2n,
        memberId,
        oidcSubject: subject,
        now,
      }),
    ).resolves.toMatchObject({ crmMemberId: memberId, operatorId: null, status: "ACTIVE" });

    const statements = clientQuery.mock.calls.map(([text]) => text as string);
    expect(statements.join("\n")).not.toContain("operator_memberships");
    expect(statements.join("\n")).not.toContain("operator_permissions");
  });
});
