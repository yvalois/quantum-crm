import { describe, expect, it } from "vitest";

import { createPlatformOperatorSelf, PlatformOperatorSelfSchema } from "./operator-self.js";

describe("platform-operator/v1 contract", () => {
  it("serializes bigint revisions without exposing identity-provider data", () => {
    expect(
      createPlatformOperatorSelf({
        id: "01995f7e-7b52-7000-8000-000000000101",
        permissions: ["tenants:read"],
        authorizationRevision: 2n,
        authenticatedAt: "2026-09-20T15:00:00.000Z",
      }),
    ).toEqual({
      schemaVersion: "platform-operator/v1",
      data: {
        id: "01995f7e-7b52-7000-8000-000000000101",
        permissions: ["tenants:read"],
        authorizationRevision: "2",
        authenticatedAt: "2026-09-20T15:00:00.000Z",
      },
    });
  });

  it("rejects unknown permissions and fields", () => {
    expect(() =>
      PlatformOperatorSelfSchema.parse({
        schemaVersion: "platform-operator/v1",
        data: {
          id: "01995f7e-7b52-7000-8000-000000000101",
          permissions: ["root:anything"],
          authorizationRevision: "1",
          authenticatedAt: "2026-09-20T15:00:00.000Z",
          token: "must-not-pass",
        },
      }),
    ).toThrow();
  });
});
