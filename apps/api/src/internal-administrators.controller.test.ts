import { describe, expect, it, vi } from "vitest";

import { ConflictException } from "@nestjs/common";
import { IamMemberConflictError } from "@quantum-crm/database";
import type { IamMemberService } from "@quantum-crm/domain";

import type { BootstrapServiceGuard } from "./bootstrap-service-security.js";
import { InternalAdministratorsController } from "./internal-administrators.controller.js";

describe("internal CRM administrators", () => {
  it("creates an administrator membership and returns only ephemeral activation access", async () => {
    const now = new Date("2026-10-08T00:00:00.000Z");
    const memberId = "01999abc-7def-7000-8000-000000000001";
    const invitationId = "01999abc-7def-7000-8000-000000000002";
    const subject = "01999abc-7def-7000-8000-000000000003";
    const inviteAdministratorFromPlatform = vi.fn(async () => ({
      member: {
        id: memberId,
        oidcSubject: null,
        displayName: "David",
        email: "david@example.com",
        status: "INVITED" as const,
        authorizationRevision: 1n,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
      },
      invitation: {
        id: invitationId,
        memberId,
        status: "PENDING" as const,
        expiresAt: new Date("2026-10-11T00:00:00.000Z"),
        acceptedAt: null,
        createdAt: now,
      },
      invitationToken: "unused-by-transport",
    }));
    const assertAuthorized = vi.fn(async () => undefined);
    const issue = vi.fn(async () => ({
      subject,
      url: "https://identity.example.com/activate",
      temporaryPassword: "Aa9!temporary-password",
      expiresAt: "2026-10-08T00:30:00.000Z",
      generation: 1,
    }));
    const recordIssued = vi.fn(async () => ({ replayed: false }));
    const setHeader = vi.fn();
    const controller = new InternalAdministratorsController(
      { inviteAdministratorFromPlatform } as unknown as IamMemberService,
      { assertAuthorized } as unknown as BootstrapServiceGuard,
      { issue },
      { recordIssued },
    );

    await expect(
      controller.create(
        "Bearer service-token",
        "platform-admin-20261008",
        { displayName: "David", email: "david@example.com" },
        { setHeader },
      ),
    ).resolves.toMatchObject({
      data: {
        memberId,
        subject,
        username: "david@example.com",
        activationUrl: "https://identity.example.com/activate",
        temporaryPassword: "Aa9!temporary-password",
      },
    });
    expect(assertAuthorized).toHaveBeenCalledWith(
      "Bearer service-token",
      "iam:create-administrator",
    );
    expect(recordIssued).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId, oidcSubject: subject, generation: 1 }),
    );
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store, max-age=0");
  });

  it("reports a duplicate tenant email as a conflict", async () => {
    const controller = new InternalAdministratorsController(
      {
        inviteAdministratorFromPlatform: vi.fn(async () => {
          throw new IamMemberConflictError();
        }),
      } as unknown as IamMemberService,
      { assertAuthorized: vi.fn(async () => undefined) } as unknown as BootstrapServiceGuard,
      { issue: vi.fn() },
      { recordIssued: vi.fn() },
    );

    await expect(
      controller.create(
        "Bearer service-token",
        "platform-admin-20261008",
        { displayName: "David", email: "david@example.com" },
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
