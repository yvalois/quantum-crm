import { describe, expect, it } from "vitest";

import { CreateMemberInvitationSchema, UpdateMemberSchema } from "./member.js";

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
  });
});
