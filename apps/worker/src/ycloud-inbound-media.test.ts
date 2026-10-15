import { createHash } from "node:crypto";

import { SecretValue } from "@quantum-crm/config";
import type { InboundMediaLease } from "@quantum-crm/domain";
import { sealYCloudMediaSource } from "@quantum-crm/files-infrastructure";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeInboundMedia,
  downloadInboundMedia,
  InboundMediaError,
} from "./ycloud-inbound-media.js";

const bytes = new Uint8Array([79, 103, 103, 83, 0, 1, 2]);
const lease: InboundMediaLease = {
  messageId: "019b0000-0000-7000-8000-000000000001",
  conversationId: "019b0000-0000-7000-8000-000000000002",
  providerMediaId: "712063723747110",
  sealedSource: sealYCloudMediaSource(
    "https://api.ycloud.com/v2/whatsapp/media/download/712063723747110?sig=test&payload=test",
    "712063723747110",
    "test-source-secret",
  ),
  expectedSha256: createHash("sha256").update(bytes).digest("base64"),
  declaredMime: "audio/ogg",
  kind: "AUDIO",
  caption: "Audio",
  fileId: null,
  generation: 1n,
};
const apiKey = new SecretValue("test-key-not-for-production");
const sourceSecret = new SecretValue("test-source-secret");

describe("inbound provider media", () => {
  it("downloads only the fixed YCloud endpoint and checks the provider checksum", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe("https://api.ycloud.com/v2/whatsapp/media/download/712063723747110?sig=test&payload=test");
      expect(init?.headers).toMatchObject({ "X-API-Key": "test-key-not-for-production" });
      expect(init?.redirect).toBe("error");
      return new Response(bytes);
    });
    expect(await downloadInboundMedia({ lease, apiKey, sourceSecret, fetcher })).toEqual(bytes);
    await expect(
      downloadInboundMedia({
        lease: { ...lease, expectedSha256: Buffer.alloc(32).toString("base64") },
        apiKey,
        sourceSecret,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_INTEGRITY" });
    await expect(
      downloadInboundMedia({ lease: { ...lease, providerMediaId: "../bad" }, apiKey, sourceSecret, fetcher }),
    ).rejects.toBeInstanceOf(InboundMediaError);
  });

  it("transcribes received audio in its original language", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ text: "I need an SUV tomorrow" }), { status: 200 });
    });
    expect(
      await analyzeInboundMedia({ lease, bytes, mimeType: "audio/ogg", apiKey, fetcher }),
    ).toBe("I need an SUV tomorrow");
  });

  it("describes an image as internal context, not a customer-facing answer", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe("https://api.openai.com/v1/responses");
      const request = JSON.parse(String(init?.body));
      expect(request.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/u);
      expect(request.instructions).toContain("Do not reply to the customer");
      return new Response(
        JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text: "A red SUV on a road" }] },
          ],
        }),
        { status: 200 },
      );
    });
    expect(
      await analyzeInboundMedia({
        lease: { ...lease, kind: "IMAGE" },
        bytes,
        mimeType: "image/jpeg",
        apiKey,
        fetcher,
      }),
    ).toBe("A red SUV on a road");
  });
});
