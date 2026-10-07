import { describe, expect, it } from "vitest";

import {
  CreateProfileOperatorSchema,
  ProfileOperatorAccessResponseSchema,
} from "./profile-operator.js";

describe("profile operator contracts", () => {
  it("normalizes an operator creation request", () => {
    expect(
      CreateProfileOperatorSchema.parse({
        displayName: "  Gabriela Nufio  ",
        email: " ADMIN@EXAMPLE.COM ",
      }),
    ).toEqual({ displayName: "Gabriela Nufio", email: "admin@example.com" });
  });

  it("requires a one-time temporary password in the access response", () => {
    expect(() =>
      ProfileOperatorAccessResponseSchema.parse({
        schemaVersion: "profile-operator-access/v1",
        data: {
          operator: {
            id: "01999abc-7def-7000-8000-000000000001",
            tenantProfileId: "01999abc-7def-7000-8000-000000000002",
            displayName: "Gabriela Nufio",
            email: "admin@example.com",
            status: "ACTIVE",
            createdAt: "2026-10-07T12:00:00.000Z",
            updatedAt: "2026-10-07T12:00:00.000Z",
          },
          username: "admin@example.com",
          temporaryPassword: "short",
          loginPath: "/api/auth/login",
        },
      }),
    ).toThrow();
  });
});
