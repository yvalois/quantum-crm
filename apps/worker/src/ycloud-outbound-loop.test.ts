import { SecretValue, type YCloudBindingConfig } from "@quantum-crm/config";
import type { ConversationOutboundLease } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { sendYCloudText } from "./ycloud-outbound-loop.js";

const binding: YCloudBindingConfig = {
  wabaId: "1234567890123456",
  businessPhone: "573015234370",
  signingSecret: new SecretValue("test-signing-secret-not-for-production"),
};
const lease: ConversationOutboundLease = {
  outboxId: "01995f7e-7b52-7000-8000-000000000401",
  messageId: "01995f7e-7b52-7000-8000-000000000402",
  externalThreadId: "ycloud:1234567890123456:50255556666",
  body: "Hola",
  kind: "TEXT",
  attempt: 1,
};

describe("YCloud outbound", () => {
  it("sends only to the bound WABA and records the provider ID", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        from: "+573015234370",
        to: "+50255556666",
        type: "text",
        text: { body: "Hola" },
        externalId: lease.messageId,
      });
      return new Response(JSON.stringify({ id: "msg_123" }), { status: 200 });
    });
    expect(await sendYCloudText({ binding, apiKey: "test", fetcher }, lease)).toEqual({
      outcome: "SENT",
      externalMessageId: "ycloud:1234567890123456:msg_123",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects another WABA and unsupported media before a network call", async () => {
    const fetcher = vi.fn();
    expect(
      await sendYCloudText(
        { binding, apiKey: "test", fetcher },
        {
          ...lease,
          externalThreadId: "ycloud:9999999999:50255556666",
        },
      ),
    ).toMatchObject({ outcome: "FAILED" });
    expect(
      await sendYCloudText(
        { binding, apiKey: "test", fetcher },
        {
          ...lease,
          kind: "IMAGE",
        },
      ),
    ).toMatchObject({ outcome: "FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retry an uncertain provider result", async () => {
    expect(
      await sendYCloudText(
        {
          binding,
          apiKey: "test",
          fetcher: vi.fn(async () => {
            throw new Error("timeout");
          }),
        },
        lease,
      ),
    ).toEqual({ outcome: "UNKNOWN", errorCode: "DELIVERY_UNCERTAIN" });
  });

  it("limits rate-limit retries", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    expect(await sendYCloudText({ binding, apiKey: "test", fetcher }, lease)).toEqual({
      outcome: "RETRY",
      errorCode: "RATE_LIMIT",
    });
    expect(
      await sendYCloudText({ binding, apiKey: "test", fetcher }, { ...lease, attempt: 5 }),
    ).toEqual({ outcome: "FAILED", errorCode: "RATE_LIMIT_EXHAUSTED" });
  });
});
