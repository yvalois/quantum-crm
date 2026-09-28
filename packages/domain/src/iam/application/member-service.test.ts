import { describe, expect, it, vi } from "vitest";

import { IamMemberValidationError } from "../domain/member.js";
import type { IamMemberRepository } from "./member-repository.js";
import {
  IamAuthorizationError,
  IamInvitationAcceptanceError,
  IamInvitationRevocationError,
  IamMemberService,
} from "./member-service.js";

const actorId = "01995f7e-7b52-7000-8000-000000000201";
const now = new Date("2026-09-22T12:00:00.000Z");

describe("IAM member service", () => {
  it("revokes only a pending invitation and keeps the member record", async () => {
    const member = Object.freeze({
      id: "01995f7e-7b52-7000-8000-000000000202",
      oidcSubject: null,
      displayName: "Ana Pérez",
      email: "ana@example.test",
      status: "INVITED" as const,
      authorizationRevision: 1n,
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
    });
    const invitation = Object.freeze({
      id: "01995f7e-7b52-7000-8000-000000000203",
      memberId: member.id,
      status: "REVOKED" as const,
      expiresAt: new Date("2026-09-25T12:00:00.000Z"),
      acceptedAt: null,
      createdAt: now,
    });
    const revokeInvitation = vi.fn(async () => invitation);
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => member,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (value) => value,
      assignRole: async () => null,
      acceptInvitation: async () => null,
      revokeInvitation,
      bootstrapInitialAdministrator: async ({ member: value }) => ({
        member: value,
        replayed: false,
      }),
    };
    const result = await new IamMemberService(repository, () => now).revokeInvitation({
      actor: { memberId: actorId, permissions: ["iam:members:update"] },
      memberId: member.id,
    });

    expect(result.status).toBe("REVOKED");
    expect(revokeInvitation).toHaveBeenCalledWith({ memberId: member.id, now });
  });

  it("does not revoke when the invitation repository cannot transition it", async () => {
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => ({
        id: "01995f7e-7b52-7000-8000-000000000202",
        oidcSubject: null,
        displayName: "Ana Pérez",
        email: "ana@example.test",
        status: "INVITED",
        authorizationRevision: 1n,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
      }),
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (value) => value,
      assignRole: async () => null,
      acceptInvitation: async () => null,
      revokeInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member: value }) => ({
        member: value,
        replayed: false,
      }),
    };
    await expect(
      new IamMemberService(repository, () => now).revokeInvitation({
        actor: { memberId: actorId, permissions: ["iam:members:update"] },
        memberId: "01995f7e-7b52-7000-8000-000000000202",
      }),
    ).rejects.toBeInstanceOf(IamInvitationRevocationError);
  });

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
      assignRole: async () => null,
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
      assignRole: async () => null,
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
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (member) => member,
      assignRole: async () => null,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const result = await new IamMemberService(repository, () => now).bootstrapInitialAdministrator({
      oidcSubject: "01995f7e-7b52-7000-8000-000000000201",
      idempotencyKey: "iam-bootstrap-20260926",
    });
    expect(result.member.status).toBe("ACTIVE");
    expect(result.member.oidcSubject).toBe("01995f7e-7b52-7000-8000-000000000201");
  });

  it("accepts an invitation through the confirmed Keycloak subject without carrying its token", async () => {
    const acceptInvitation = vi.fn(
      async (input: Parameters<IamMemberRepository["acceptInvitation"]>[0]) =>
        Object.freeze({
          id: actorId,
          oidcSubject: input.oidcSubject,
          displayName: "Ana PÃ©rez",
          email: "ana@example.test",
          status: "ACTIVE" as const,
          authorizationRevision: 2n,
          createdAt: now,
          updatedAt: input.now,
          deactivatedAt: null,
        }),
    );
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (member) => member,
      assignRole: async () => null,
      acceptInvitation,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };

    const result = await new IamMemberService(repository, () => now).acceptConfirmedInvitation({
      invitationId: "01995f7e-7b52-7000-8000-000000000202",
      oidcSubject: "keycloak-crm-user",
    });

    expect(result).toMatchObject({ status: "ACTIVE", oidcSubject: "keycloak-crm-user" });
    expect(acceptInvitation).toHaveBeenCalledWith({
      invitationId: "01995f7e-7b52-7000-8000-000000000202",
      oidcSubject: "keycloak-crm-user",
      now,
    });
    expect(acceptInvitation.mock.calls[0]?.[0]).not.toHaveProperty("invitationToken");
    expect(acceptInvitation.mock.calls[0]?.[0]).not.toHaveProperty("invitationTokenHash");
  });

  it("does not accept an expired, revoked, consumed or unknown invitation", async () => {
    const acceptInvitation = vi.fn(async () => null);
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (member) => member,
      assignRole: async () => null,
      acceptInvitation,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const service = new IamMemberService(repository, () => now);

    await expect(
      service.acceptConfirmedInvitation({
        invitationId: "01995f7e-7b52-7000-8000-000000000202",
        oidcSubject: "keycloak-crm-user",
      }),
    ).rejects.toBeInstanceOf(IamInvitationAcceptanceError);
    expect(acceptInvitation).toHaveBeenCalledOnce();
  });

  it("rejects malformed acceptance identifiers before entering the repository transaction", async () => {
    const acceptInvitation = vi.fn(async () => null);
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => null,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (member) => member,
      assignRole: async () => null,
      acceptInvitation,
      bootstrapInitialAdministrator: async ({ member }) => ({ member, replayed: false }),
    };
    const service = new IamMemberService(repository, () => now);

    await expect(
      service.acceptConfirmedInvitation({
        invitationId: "not-a-uuid",
        oidcSubject: "keycloak-crm-user",
      }),
    ).rejects.toBeInstanceOf(IamMemberValidationError);
    await expect(
      service.acceptConfirmedInvitation({
        invitationId: "01995f7e-7b52-7000-8000-000000000202",
        oidcSubject: "subject with whitespace",
      }),
    ).rejects.toBeInstanceOf(IamMemberValidationError);
    expect(acceptInvitation).not.toHaveBeenCalled();
  });

  it("requires the dedicated role permission and delegates a role change", async () => {
    const member = Object.freeze({
      id: actorId,
      oidcSubject: "keycloak-crm-user",
      displayName: "Ana Pérez",
      email: "ana@example.test",
      status: "ACTIVE" as const,
      authorizationRevision: 2n,
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
    });
    const assignRole = vi.fn(async () =>
      Object.freeze({ ...member, authorizationRevision: 3n, updatedAt: now }),
    );
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => member,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (value) => value,
      assignRole,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member: value }) => ({
        member: value,
        replayed: false,
      }),
    };
    const service = new IamMemberService(repository, () => now);

    await expect(
      service.updateProfile({
        actor: { memberId: actorId, permissions: ["iam:members:update"] },
        memberId: actorId,
        roleCode: "SUPERVISOR",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      service.updateProfile({
        actor: {
          memberId: actorId,
          permissions: ["iam:members:update", "iam:members:roles"],
        },
        memberId: actorId,
        roleCode: "SUPERVISOR",
      }),
    ).resolves.toMatchObject({ authorizationRevision: 3n });
    expect(assignRole).toHaveBeenCalledWith({ memberId: actorId, roleCode: "SUPERVISOR", now });
  });

  it("updates commercial scope through the IAM repository and returns its new revision", async () => {
    const targetMemberId = "01995f7e-7b52-7000-8000-000000000203";
    const member = Object.freeze({
      id: targetMemberId,
      oidcSubject: "keycloak-crm-user",
      displayName: "Ana Pérez",
      email: "ana@example.test",
      status: "ACTIVE" as const,
      authorizationRevision: 2n,
      createdAt: now,
      updatedAt: now,
      deactivatedAt: null,
      commercialScope: "ASSIGNED" as const,
    });
    const updateCommercialScope = vi.fn(async () =>
      Object.freeze({ ...member, commercialScope: "TEAM" as const, authorizationRevision: 3n }),
    );
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => member,
      findByOidcSubject: async () => null,
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (value) => value,
      updateCommercialScope,
      assignRole: async () => null,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member: value }) => ({
        member: value,
        replayed: false,
      }),
    };
    const result = await new IamMemberService(repository, () => now).updateProfile({
      actor: { memberId: actorId, permissions: ["iam:members:update", "iam:members:roles"] },
      memberId: targetMemberId,
      commercialScope: "TEAM",
      expectedAuthorizationRevision: 2n,
    });
    expect(result.commercialScope).toBe("TEAM");
    expect(result.authorizationRevision).toBe(3n);
    expect(updateCommercialScope).toHaveBeenCalledWith({
      memberId: targetMemberId,
      scope: "TEAM",
      now,
      expectedAuthorizationRevision: 2n,
    });
  });

  it("does not allow a member without role-management permission to widen data scope", async () => {
    const repository: IamMemberRepository = {
      list: async () => ({ members: [], nextCursor: null }),
      findById: async () => ({
        id: actorId,
        oidcSubject: "keycloak-crm-user",
        displayName: "Ana Pérez",
        email: "ana@example.test",
        status: "ACTIVE",
        authorizationRevision: 2n,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: null,
        commercialScope: "ASSIGNED",
      }),
      createInvitation: async () => {
        throw new Error("unused");
      },
      update: async (value) => value,
      updateCommercialScope: async () => {
        throw new Error("scope repository must not be reached");
      },
      assignRole: async () => null,
      acceptInvitation: async () => null,
      bootstrapInitialAdministrator: async ({ member: value }) => ({
        member: value,
        replayed: false,
      }),
    };
    await expect(
      new IamMemberService(repository, () => now).updateProfile({
        actor: { memberId: actorId, permissions: ["iam:members:update"] },
        memberId: actorId,
        commercialScope: "PROFILE",
        expectedAuthorizationRevision: 2n,
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    await expect(
      new IamMemberService(repository, () => now).updateProfile({
        actor: { memberId: actorId, permissions: ["iam:members:update", "iam:members:roles"] },
        memberId: actorId,
        commercialScope: "PROFILE",
        expectedAuthorizationRevision: 2n,
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });
});
