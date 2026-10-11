import { describe, expect, it } from "vitest";
import { attachmentFormat, attachmentUrl, publicIpv4 } from "./ghl-attachment-download.js";
describe("GHL attachment source boundary", () => {
  it("allows only exact HTTPS providers without credentials or custom ports", () => {
    expect(attachmentUrl("https://storage.googleapis.com/bucket/a.png").hostname).toBe(
      "storage.googleapis.com",
    );
    for (const value of [
      "http://storage.googleapis.com/a",
      "https://storage.googleapis.com.evil.test/a",
      "https://u:p@storage.googleapis.com/a",
      "https://storage.googleapis.com:8443/a",
      "https://127.0.0.1/a",
      "file:///etc/passwd",
    ])
      expect(() => attachmentUrl(value)).toThrow();
  });
  it("denies private DNS resolutions before sending a request", () => {
    for (const value of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.100.100.200",
      "198.18.0.1",
      "224.0.0.1",
      "::1",
    ])
      expect(publicIpv4(value)).toBe(false);
    expect(publicIpv4("8.8.8.8")).toBe(true);
  });
  it("bounds formats and rejects masquerading active or Office content", () => {
    expect(
      attachmentFormat(new URL("https://storage.googleapis.com/a.png"), "image/png").maxBytes,
    ).toBe(20 * 1024 * 1024);
    expect(
      attachmentFormat(new URL("https://storage.googleapis.com/asset"), "application/pdf")
        .fileClass,
    ).toBe("DOCUMENT");
    expect(() =>
      attachmentFormat(new URL("https://storage.googleapis.com/a.png"), "text/html"),
    ).toThrow();
    expect(() =>
      attachmentFormat(
        new URL("https://storage.googleapis.com/a.docx"),
        "application/octet-stream",
      ),
    ).toThrow();
  });
});
