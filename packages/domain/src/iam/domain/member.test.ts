import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  activateMember,
  createInvitation,
  createInvitedMember,
  deactivateMember,
  IamMemberValidationError,
  permissionsForInitialRole,
  updateMemberProfile,
} from "./member.js";

const memberId = "01995f7e-7b52-7000-8000-000000000201";
const invitationId = "01995f7e-7b52-7000-8000-000000000202";
const now = new Date("2026-09-22T12:00:00.000Z");

describe("IAM member lifecycle", () => {
  it("activates an invitation once and advances authorization revision", () => {
    const member = createInvitedMember({
      id: memberId,
      displayName: " Ana Pérez ",
      email: "ANA@EXAMPLE.TEST",
      now,
    });
    const invitation = createInvitation({
      id: invitationId,
      memberId,
      now,
      expiresAt: new Date("2026-09-23T12:00:00.000Z"),
    });
    const accepted = acceptInvitation({ invitation, now: new Date("2026-09-22T12:01:00.000Z") });
    const active = activateMember({
      member,
      oidcSubject: "keycloak-crm-user",
      now: accepted.acceptedAt!,
    });

    expect(active).toMatchObject({
      status: "ACTIVE",
      displayName: "Ana Pérez",
      email: "ana@example.test",
      authorizationRevision: 2n,
    });
    expect(() => acceptInvitation({ invitation: accepted, now })).toThrow(IamMemberValidationError);
  });

  it("preserves the member while deactivation invalidates authorization", () => {
    const invited = createInvitedMember({
      id: memberId,
      displayName: "Ana Pérez",
      email: "ana@example.test",
      now,
    });
    const active = activateMember({
      member: invited,
      oidcSubject: "keycloak-crm-user",
      now,
    });
    const edited = updateMemberProfile({ member: active, displayName: "Ana Gómez", now });
    const deactivated = deactivateMember({ member: edited, now });

    expect(deactivated).toMatchObject({
      id: memberId,
      displayName: "Ana Gómez",
      status: "DEACTIVATED",
      authorizationRevision: 3n,
      deactivatedAt: now,
    });
  });

  it("allows an advisor to move only its own opportunities without pipeline configuration", () => {
    const permissions = permissionsForInitialRole("ADVISOR");

    expect(permissions).toContain("crm:sales:move");
    expect(permissions).not.toContain("crm:sales:configure");
    expect(permissions).not.toContain("iam:members:read");
    expect(permissions).toContain("crm:files:upload");
    expect(permissions).toContain("crm:files:download");
    expect(permissions).not.toContain("crm:files:delete");
  });
});
