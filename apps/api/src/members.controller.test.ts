import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import type { IamMemberService } from "@quantum-crm/domain";

import { MembersController } from "./members.controller.js";
import { CRM_AUTH_CONTEXT } from "./crm-security.js";

const memberId = "01999abc-7def-7000-8000-000000000001";
const invitationId = "01999abc-7def-7000-8000-000000000002";

describe("member invitation reissue", () => {
  it("exposes pipeline management only from the server-granted configure permission", () => {
    const controller = new MembersController({} as IamMemberService, {} as never, {} as never);
    const capabilities = (permissions: string[]) =>
      controller.capabilities({
        headers: {},
        [CRM_AUTH_CONTEXT]: { principal: { id: memberId }, permissions },
      } as never);
    expect(capabilities(["crm:sales:assign"]).data).toMatchObject({
      canAssignSales: true,
      canConfigureSales: false,
    });
    expect(capabilities(["crm:sales:configure"]).data).toMatchObject({
      canAssignSales: false,
      canConfigureSales: true,
    });
  });

  it("reserves a generation and returns the new access only once", async () => {
    const reserveReissue = vi.fn(async () => ({
      invitationId,
      email: "advisor@example.com",
      displayName: "Advisor",
      generation: 2,
    }));
    const issue = vi.fn(async () => ({
      subject: "subject-1",
      url: "https://identity.example.com/action",
      temporaryPassword: "Aa9!temporary-password",
      expiresAt: "2026-10-15T00:30:00.000Z",
      generation: 2,
    }));
    const recordIssued = vi.fn(async () => ({ replayed: false }));
    const controller = new MembersController(
      {} as IamMemberService,
      { issue },
      { reserveReissue, recordIssued },
    );
    const request = {
      headers: {},
      [CRM_AUTH_CONTEXT]: { principal: { id: memberId }, permissions: ["iam:members:update"] },
    };
    await expect(
      controller.reissueInvitation(request as never, memberId, "reissue-request-1"),
    ).resolves.toEqual({
      url: "https://identity.example.com/action",
      temporaryPassword: "Aa9!temporary-password",
      expiresAt: "2026-10-15T00:30:00.000Z",
    });
    expect(reserveReissue).toHaveBeenCalledWith(
      expect.objectContaining({ memberId, requestKey: "reissue-request-1" }),
    );
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ invitationId, generation: 2 }));
    expect(recordIssued).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId, generation: 2 }),
    );
  });

  it("does not call identity when the reservation is unavailable", async () => {
    const issue = vi.fn();
    const controller = new MembersController(
      {} as IamMemberService,
      { issue },
      { reserveReissue: vi.fn(async () => null), recordIssued: vi.fn() },
    );
    await expect(
      controller.reissueInvitation(
        { headers: {}, [CRM_AUTH_CONTEXT]: { principal: { id: memberId } } } as never,
        memberId,
        "reissue-request-1",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(issue).not.toHaveBeenCalled();
  });
});
