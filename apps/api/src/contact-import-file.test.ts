import { describe, expect, it } from "vitest";

import { ContactImportFileError, parseContactImportFile } from "./contact-import-file.js";

describe("contact import file", () => {
  it("parses CSV headers and preserves row numbers", () => {
    const contentBase64 = Buffer.from("displayName,email\nAda,ada@example.test\n").toString(
      "base64",
    );
    expect(parseContactImportFile({ fileName: "contacts.csv", contentBase64 })).toEqual([
      {
        rowNumber: 2,
        displayName: "Ada",
        email: "ada@example.test",
        phone: null,
      },
    ]);
  });

  it("requires a display name and at least one contact channel", () => {
    const contentBase64 = Buffer.from("email\nada@example.test\n").toString("base64");
    expect(() => parseContactImportFile({ fileName: "contacts.csv", contentBase64 })).toThrow(
      ContactImportFileError,
    );
  });
});
