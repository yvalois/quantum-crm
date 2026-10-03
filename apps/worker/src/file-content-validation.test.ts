import { describe, expect, it } from "vitest";

import { FileValidationError } from "@quantum-crm/domain";

import { detectAllowedMime } from "./file-content-validation.js";

describe("file content validation", () => {
  it("recognizes approved document and image signatures", () => {
    expect(
      detectAllowedMime(
        "IMAGE",
        "image/png",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(
      detectAllowedMime("DOCUMENT", "application/pdf", new TextEncoder().encode("%PDF-1.7")),
    ).toBe("application/pdf");
  });

  it("rejects a fake MIME and active formats outside the allowlist", () => {
    expect(() =>
      detectAllowedMime("IMAGE", "image/png", new TextEncoder().encode("<svg onload=alert(1)>")),
    ).toThrow(FileValidationError);
    expect(() =>
      detectAllowedMime("DOCUMENT", "application/pdf", new TextEncoder().encode("not a pdf")),
    ).toThrow(FileValidationError);
  });

  it("accepts valid UTF-8 text and rejects binary text", () => {
    expect(
      detectAllowedMime("DOCUMENT", "text/csv", new TextEncoder().encode("name,email\nA,a@b.test")),
    ).toBe("text/csv");
    expect(() =>
      detectAllowedMime("DOCUMENT", "text/plain", new Uint8Array([0x00, 0x01, 0x02])),
    ).toThrow(FileValidationError);
  });
});
