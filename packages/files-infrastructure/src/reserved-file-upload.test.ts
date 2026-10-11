import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { uploadReservedFile, type ReservedFileUploadOptions } from "./reserved-file-upload.js";

const bytes = new TextEncoder().encode("synthetic attachment");
const now = new Date("2026-10-11T12:00:00Z");

function options(fetcher: typeof fetch): ReservedFileUploadOptions {
  return {
    authorization: {
      url: "https://storage.example.test/incoming",
      expiresAt: new Date(now.getTime() + 600_000),
      fields: {
        key: "incoming/opaque-file-id",
        "Content-Type": "text/plain",
        "x-amz-meta-qcrm-sha256": createHash("sha256").update(bytes).digest("base64"),
        policy: "synthetic-policy",
        success_action_status: "201",
      },
    },
    bytes,
    maxBytes: bytes.byteLength,
    requestTimeoutMs: 1_000,
    fetch: fetcher,
    now: () => now,
  };
}

describe("reserved file upload", () => {
  it("posts only the signed form and bounded bytes without forwarding provider credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 201,
        headers: { "x-amz-version-id": "version-1", etag: '"receipt-1"' },
      }),
    );

    await expect(uploadReservedFile(options(fetcher))).resolves.toEqual({
      versionId: "version-1",
      receipt: '"receipt-1"',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const request = fetcher.mock.calls[0]![1]!;
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.headers).toBeUndefined();
    const body = request.body as FormData;
    expect(body.get("policy")).toBe("synthetic-policy");
    const file = body.get("file") as File;
    expect(file.name).toBe("upload");
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe("synthetic attachment");
  });

  it("allows completion to inspect the immutable version when upload headers are absent", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 201 }));
    await expect(uploadReservedFile(options(fetcher))).resolves.toEqual({});
  });

  it("rejects checksum mismatch, oversized bytes and expired reservations before any request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const input = options(fetcher);
    await expect(
      uploadReservedFile({ ...input, bytes: new TextEncoder().encode("changed bytes") }),
    ).rejects.toMatchObject({ failure: "INVALID_INPUT" });
    await expect(
      uploadReservedFile({ ...input, maxBytes: bytes.byteLength - 1 }),
    ).rejects.toMatchObject({ failure: "INVALID_INPUT" });
    await expect(
      uploadReservedFile({
        ...input,
        authorization: { ...input.authorization, expiresAt: now },
      }),
    ).rejects.toMatchObject({ failure: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects endpoint credentials and a form that could override the uploaded bytes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const input = options(fetcher);
    await expect(
      uploadReservedFile({
        ...input,
        authorization: { ...input.authorization, url: "https://user:secret@storage.test/upload" },
      }),
    ).rejects.toMatchObject({ failure: "INVALID_INPUT" });
    await expect(
      uploadReservedFile({
        ...input,
        authorization: {
          ...input.authorization,
          fields: { ...input.authorization.fields, file: "substitution" },
        },
      }),
    ).rejects.toMatchObject({ failure: "INVALID_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [302, "INVALID_RESPONSE"],
    [403, "PERMISSION_DENIED"],
    [413, "TOO_LARGE"],
    [429, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ] as const)("maps HTTP %i to a safe error without exposing the response", async (status, failure) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private-response-canary", { status }));
    const attempt = uploadReservedFile(options(fetcher));
    await expect(attempt).rejects.toMatchObject({ failure });
    await expect(attempt).rejects.not.toThrow("private-response-canary");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not retry an uncertain upload and strips private transport diagnostics", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("private-signed-url-canary"));
    const attempt = uploadReservedFile(options(fetcher));
    await expect(attempt).rejects.toMatchObject({ failure: "UNAVAILABLE" });
    await expect(attempt).rejects.not.toThrow("private-signed-url-canary");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
