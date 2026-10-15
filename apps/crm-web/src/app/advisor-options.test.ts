import { describe, expect, it } from "vitest";

import { advisorDisplayName } from "./advisor-options";

describe("advisorDisplayName", () => {
  it("marks invited advisors without modifying the member name", () => {
    expect(advisorDisplayName({ displayName: "Carlos Mejía", status: "INVITED" })).toBe(
      "Carlos Mejía (pendiente de activación)",
    );
    expect(advisorDisplayName({ displayName: "Julio Rafael", status: "ACTIVE" })).toBe(
      "Julio Rafael",
    );
  });
});
