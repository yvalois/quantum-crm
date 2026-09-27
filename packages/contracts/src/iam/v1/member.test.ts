import { describe, expect, it } from "vitest";

import {
  AcceptInvitationParamsSchema,
  AcceptInvitationResponseSchema,
  CreateMemberInvitationSchema,
  UpdateMemberSchema,
} from "./member.js";

describe("member contracts", () => {
  it("normalizes an invitation email without accepting an empty name", () => {
    expect(
      CreateMemberInvitationSchema.parse({
        displayName: "Ana Pérez",
        email: "ANA@EXAMPLE.TEST",
      }),
    ).toEqual({
      displayName: "Ana Pérez",
      email: "ana@example.test",
      roleCode: "ADVISOR",
    });
    expect(() =>
      CreateMemberInvitationSchema.parse({
        displayName: " ",
        email: "ana@example.test",
      }),
    ).toThrow();
  });

  it("requires an actual profile edit", () => {
    expect(() => UpdateMemberSchema.parse({})).toThrow();
    expect(UpdateMemberSchema.parse({ displayName: "Ana Gómez" })).toEqual({
      displayName: "Ana Gómez",
    });
    expect(UpdateMemberSchema.parse({ roleCode: "SUPERVISOR" })).toEqual({
      roleCode: "SUPERVISOR",
    });
    expect(UpdateMemberSchema.parse({ commercialScope: "TEAM" })).toEqual({
      commercialScope: "TEAM",
    });
    expect(() => UpdateMemberSchema.parse({ commercialScope: "ALL" })).toThrow();
  });

  it("keeps invitation acceptance identity-free at the HTTP boundary", () => {
    const invitationId = "01995f7e-7b52-7000-8000-000000000202";
    expect(AcceptInvitationParamsSchema.parse({ invitationId })).toEqual({ invitationId });
    expect(
      AcceptInvitationParamsSchema.safeParse({ invitationId, oidcSubject: "forged" }).success,
    ).toBe(false);
    expect(AcceptInvitationResponseSchema.shape.data.shape.status).toBeDefined();
  });

  it("keeps invitation acceptance identity-free at the HTTP boundary", () => {
    const invitationId = "01995f7e-7b52-7000-8000-000000000202";
    expect(AcceptInvitationParamsSchema.parse({ invitationId })).toEqual({ invitationId });
    expect(
      AcceptInvitationParamsSchema.safeParse({ invitationId, oidcSubject: "forged" }).success,
    ).toBe(false);
    expect(AcceptInvitationResponseSchema.shape.data.shape.status).toBeDefined();
  });
});
