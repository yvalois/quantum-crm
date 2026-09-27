import { describe, expect, it } from "vitest";

import { AddTeamMemberSchema, CreateTeamSchema, TeamListResponseSchema } from "./team.js";

describe("team contracts", () => {
  it("normalizes team names and member ids", () => {
    expect(CreateTeamSchema.parse({ name: " Ventas " })).toEqual({ name: "Ventas" });
    expect(
      AddTeamMemberSchema.parse({ memberId: "01995f7e-7b52-7000-8000-000000000001" }),
    ).toHaveProperty("memberId");
  });

  it("rejects empty names and malformed team responses", () => {
    expect(() => CreateTeamSchema.parse({ name: " " })).toThrow();
    expect(() => TeamListResponseSchema.parse({ data: [{ id: "nope" }] })).toThrow();
  });
});
