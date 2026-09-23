import { describe, expect, it, vi } from "vitest";

import type { IamMemberService } from "@quantum-crm/domain";

import { CRM_AUTH_CONTEXT } from "./crm-security.js";
import { MembersController } from "./members.controller.js";

const member = {
  id: "01995f7e-7b52-7000-8000-000000000201",
  oidcSubject: null,
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  status: "INVITED" as const,
  authorizationRevision: 1n,
  createdAt: new Date("2026-09-23T01:00:00.000Z"),
  updatedAt: new Date("2026-09-23T01:00:00.000Z"),
  deactivatedAt: null,
};

const request = {
  [CRM_AUTH_CONTEXT]: {
    principal: { id: "01995f7e-7b52-7000-8000-000000000101" },
    permissions: [
      "iam:members:read",
      "iam:members:create",
      "iam:members:update",
      "iam:members:deactivate",
    ],
  },
} as never;

describe("MembersController", () => {
  it("creates an invitation without exposing its one-time token", async () => {
    const service = {
      invite: vi.fn(async () => ({
        member,
        invitation: {
          id: "01995f7e-7b52-7000-8000-000000000202",
          memberId: member.id,
          status: "PENDING" as const,
          expiresAt: new Date("2026-09-26T01:00:00.000Z"),
          acceptedAt: null,
          createdAt: new Date("2026-09-23T01:00:00.000Z"),
        },
        invitationToken: "never-returned-to-the-api-client",
      })),
    } as unknown as IamMemberService;
    const controller = new MembersController(service);

    const response = await controller.invite(request, "invite-member-0001", {
      displayName: member.displayName,
      email: member.email,
      roleCode: "ADVISOR",
    });

    expect(response).toMatchObject({ data: { memberId: member.id, status: "PENDING" } });
    expect(JSON.stringify(response)).not.toContain("never-returned-to-the-api-client");
  });

  it("updates and deactivates only a UUID member identifier", async () => {
    const service = {
      updateProfile: vi.fn(async () => member),
      deactivate: vi.fn(async () => ({ ...member, status: "DEACTIVATED" as const })),
    } as unknown as IamMemberService;
    const controller = new MembersController(service);

    await expect(
      controller.update(request, member.id, { displayName: "Ada Byron" }),
    ).resolves.toMatchObject({ data: { displayName: "Ada Lovelace" } });
    await expect(controller.deactivate(request, member.id)).resolves.toMatchObject({
      data: { status: "DEACTIVATED" },
    });
    await expect(controller.deactivate(request, "tenant-controlled")).rejects.toBeDefined();
  });
});
