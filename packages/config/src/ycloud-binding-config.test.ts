import { describe, expect, it } from "vitest";

import { parseYCloudBindingConfig } from "./ycloud-binding-config.js";
import type { SecretFileSystem } from "./secret-value.js";

function fileSystem(content: string): SecretFileSystem {
  return {
    lstat: () => ({
      size: content.length,
      isFile: () => true,
      isSymbolicLink: () => false,
    }),
    readFile: () => new TextEncoder().encode(content),
    realpath: (path) => path,
  };
}

describe("YCloud advisor routing binding", () => {
  const base = {
    wabaId: "1234567890123456",
    businessPhone: "50255556666",
    signingSecret: "test-only-signing-secret-1234567890",
  };

  it("is opt-in and bound to the explicit InterAmerican policy", () => {
    const path = "/run/secrets/qcrm_ycloud_binding";
    const binding = parseYCloudBindingConfig(
      "api",
      "staging",
      path,
      fileSystem(JSON.stringify({ ...base, advisorRouting: "interamerican-v54" })),
    );
    expect(binding?.advisorRouting).toBe("interamerican-v54");
    const ordinary = parseYCloudBindingConfig(
      "api",
      "staging",
      path,
      fileSystem(JSON.stringify(base)),
    );
    expect(ordinary?.advisorRouting).toBeUndefined();
  });

  it("rejects an unknown routing policy", () => {
    expect(() =>
      parseYCloudBindingConfig(
        "api",
        "staging",
        "/run/secrets/qcrm_ycloud_binding",
        fileSystem(JSON.stringify({ ...base, advisorRouting: "all-tenants" })),
      ),
    ).toThrow();
  });
});
