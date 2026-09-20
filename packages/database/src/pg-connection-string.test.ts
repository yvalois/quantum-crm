import { describe, expect, it } from "vitest";

import { normalizePgConnectionString } from "./pg-connection-string.js";

describe("normalizePgConnectionString", () => {
  it("removes sslmode=disable for an internal non-TLS PostgreSQL connection", () => {
    expect(
      normalizePgConnectionString(
        "postgresql://migrator:secret@platform-postgres:5432/qcrm_platform?sslmode=disable",
      ),
    ).toBe("postgresql://migrator:secret@platform-postgres:5432/qcrm_platform");
  });

  it("preserves SSL modes required by other environments", () => {
    expect(
      normalizePgConnectionString(
        "postgresql://migrator:secret@postgres.example:5432/qcrm_platform?sslmode=require",
      ),
    ).toBe("postgresql://migrator:secret@postgres.example:5432/qcrm_platform?sslmode=require");
  });
});
