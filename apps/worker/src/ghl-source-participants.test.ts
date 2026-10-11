import { SecretValue } from "@quantum-crm/config";
import {
  IamAuthorizationError,
  type ExternalParticipantDirectory,
  type GhlImportOperationIdentity,
  type HistoricalImportContext,
} from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";
import {
  enrichGhlSourceParticipants,
  readGhlParticipantDirectory,
} from "./ghl-source-participants.js";
import type { GhlImportArtifact } from "./ghl-migration-import-artifact.js";

const token = new SecretValue("synthetic-ghl-participant-secret");
const user = {
  id: "advisor",
  name: "Original advisor",
  email: "private@example.test",
  roles: { locationIds: ["fixture_location"] },
  scopes: ["contacts.write"],
};
const identity: GhlImportOperationIdentity = {
  tenantId: "019b0000-0000-7000-8000-000000000001",
  operationId: "019b0000-0000-7000-8000-000000000002",
  exportId: "019b0000-0000-7000-8000-000000000003",
  locationId: "fixture_location",
  artifactSha256: "a".repeat(64),
  currency: "GTQ",
  operatorMemberId: "019b0000-0000-7000-8000-000000000004",
};
const context: HistoricalImportContext = {
  actor: { memberId: identity.operatorMemberId, scope: "PROFILE" },
  permissions: ["iam:members:update"],
};
const artifact: GhlImportArtifact = {
  locationId: identity.locationId,
  exportId: identity.exportId,
  generatedAt: new Date(),
  recordCount: 1,
  records: new Map([
    [
      "CONTACTS",
      [
        {
          id: "contact",
          locationId: identity.locationId,
          assignedTo: "advisor",
          followers: ["missing"],
        },
      ],
    ],
  ]),
};
const respond = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

describe("GHL original participant enrichment", () => {
  it("reads only the fixed approved location, strips provider privileges and private attributes", async () => {
    const fetcher = respond({ users: [user] });
    expect(await readGhlParticipantDirectory(identity.locationId, token, fetcher)).toEqual([
      { externalId: "advisor", displayName: "Original advisor" },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://services.leadconnectorhq.com/users/?locationId=fixture_location",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ Version: "2021-07-28" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects foreign location membership, duplicate users, missing names and unsuccessful responses", async () => {
    for (const users of [
      [{ ...user, roles: { locationIds: ["other"] } }],
      [user, user],
      [{ ...user, name: "" }],
    ])
      await expect(
        readGhlParticipantDirectory(identity.locationId, token, respond({ users })),
      ).rejects.toThrow();
    await expect(
      readGhlParticipantDirectory(
        identity.locationId,
        token,
        respond({ private: "do not report" }, 403),
      ),
    ).rejects.toThrow("GHL participant directory unavailable");
    await expect(
      readGhlParticipantDirectory(
        identity.locationId,
        token,
        respond({ users: [], extra: "a".repeat(2_097_152) }),
      ),
    ).rejects.toThrow("exceeds limit");
  });

  it("requires permission and verified source identity before network or writes and reports unresolved IDs", async () => {
    const importDirectory = vi.fn(async () => ({ total: 1, created: 1, replayed: 0 }));
    const directory: ExternalParticipantDirectory = {
      importDirectory,
      resolve: async () => [
        { locationId: identity.locationId, externalId: "advisor", displayName: "Original advisor" },
      ],
    };
    const fetcher = respond({ users: [user] });
    await expect(
      enrichGhlSourceParticipants(
        artifact,
        identity,
        { ...context, permissions: [] },
        directory,
        token,
        fetcher,
      ),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      enrichGhlSourceParticipants(
        artifact,
        { ...identity, locationId: "other" },
        context,
        directory,
        token,
        fetcher,
      ),
    ).rejects.toThrow("identity mismatch");
    expect(fetcher).not.toHaveBeenCalled();
    expect(importDirectory).not.toHaveBeenCalled();
    await expect(
      enrichGhlSourceParticipants(
        artifact,
        identity,
        context,
        directory,
        token,
        respond({ users: [{ ...user, roles: { locationIds: ["other"] } }] }),
      ),
    ).rejects.toThrow();
    expect(importDirectory).not.toHaveBeenCalled();
    expect(
      await enrichGhlSourceParticipants(artifact, identity, context, directory, token, fetcher),
    ).toEqual({
      status: "PARTIAL",
      total: 1,
      created: 1,
      replayed: 0,
      sourceReferences: 2,
      resolvedReferences: 1,
    });
    expect(importDirectory).toHaveBeenCalledWith(context, {
      operationId: identity.operationId,
      locationId: identity.locationId,
      participants: [{ externalId: "advisor", displayName: "Original advisor" }],
    });
  });
});
