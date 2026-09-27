import { describe, expect, it } from "vitest";

import type { IamMemberRepository } from "./member-repository.js";
import { IamAuthorizationError, IamMemberService } from "./member-service.js";

const actorId = "01995f7e-7b52-7000-8000-000000000201";
const now = new Date("2026-09-22T12:00:00.000Z");

describe("IAM member service", () => {
  it("creates a hashed, expiring invitation only for an authorized administrator", async () => {
    let invitationHash = "";
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async (input) => {
        invitationHash = input.invitationTokenHash;
        return { member: input.member, invitation: input.invitation, replayed: false };
      },
      update: async (member) => member,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const service = new IamMemberService(repository, () => now);

    const result = await service.invite({
      actor: { memberId: actorId, permissions: ["iam:members:create"] },
      displayName: "Ana Pérez",
      email: "ana@example.test",
      roleCode: "ADVISOR",
      idempotencyKey: "invite-ana-20260922",
    });

    expect(result.member.status).toBe("INVITED");
    expect(result.invitation.expiresAt).toEqual(new Date("2026-09-25T12:00:00.000Z"));
    expect(result.invitationToken).toHaveLength(43);
    expect(invitationHash).toHaveLength(64);
    expect(invitationHash).not.toContain(result.invitationToken);
  });

  it("denies an invitation before a repository can write it", async () => {
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("must not write");
      },
      update: async (member) => member,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const service = new IamMemberService(repository, () => now);

    await expect(
      service.invite({
        actor: { memberId: actorId, permissions: [] },
        displayName: "Ana Pérez",
        email: "ana@example.test",
        roleCode: "ADVISOR",
        idempotencyKey: "invite-ana-20260922",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("creates only the fixed active administrator through the internal bootstrap command", async () => {
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }), findById: async () => null,
      findByOidcSubject: async () => null, createInvitation: async () => { throw new Error("unused"); },
      update: async (member) => member, acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const result = await new IamMemberService(repository, () => now).bootstrapInitialAdministrator({
      oidcSubject: "01995f7e-7b52-7000-8000-000000000201",
      idempotencyKey: "iam-bootstrap-20260926",
    });
    expect(result.member.status).toBe("ACTIVE");
    expect(result.member.oidcSubject).toBe("01995f7e-7b52-7000-8000-000000000201");
  });
});
