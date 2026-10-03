import { describe, expect, it } from "vitest";

import {
  ClamAvUnavailableError,
  parseClamAvScanResponse,
  parseClamAvVersion,
} from "./clamav-client.js";

describe("ClamAV protocol", () => {
  it("parses clean and infected responses without retaining content", () => {
    expect(parseClamAvScanResponse("stream: OK\0")).toEqual({ status: "CLEAN" });
    expect(parseClamAvScanResponse("stream: Eicar-Signature FOUND\0")).toEqual({
      status: "INFECTED",
      signature: "Eicar-Signature",
    });
  });

  it("extracts engine and signature metadata used as durable evidence", () => {
    const parsed = parseClamAvVersion("ClamAV 1.4.2/27896/Wed Oct 01 10:00:00 2026\0");
    expect(parsed.engine).toBe("1.4.2");
    expect(parsed.signatureVersion).toBe("27896");
    expect(parsed.signatureDate.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("fails closed for ambiguous scanner responses", () => {
    expect(() => parseClamAvScanResponse("stream: UNKNOWN\0")).toThrow(
      new ClamAvUnavailableError("INVALID_RESPONSE"),
    );
    expect(() => parseClamAvVersion("ClamAV invalid")).toThrow(
      new ClamAvUnavailableError("INVALID_RESPONSE"),
    );
  });
});
