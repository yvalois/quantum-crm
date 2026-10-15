import { SecretValue } from "@quantum-crm/config";
import type { InboundMediaDispatcher, InboundMediaLease } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import {
  processInboundMedia,
  type InboundMediaLoopOptions,
} from "./conversation-inbound-media-loop.js";

vi.mock("@quantum-crm/files-infrastructure", async (importOriginal) => {
  const original = await importOriginal<typeof import("@quantum-crm/files-infrastructure")>();
  return {
    ...original,
    readAvailableInboundMedia: vi.fn(async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      filename: "incoming.jpg",
    })),
  };
});

const lease: InboundMediaLease = {
  messageId: "019b0000-0000-7000-8000-000000000001",
  conversationId: "019b0000-0000-7000-8000-000000000002",
  providerMediaId: "123456",
  sealedSource: null,
  expectedSha256: "A".repeat(43) + "=",
  declaredMime: "image/jpeg",
  kind: "IMAGE",
  caption: "Imagen",
  fileId: "019b0000-0000-7000-8000-000000000003",
  generation: 1n,
};

function harness(
  status: string,
  fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: "A red SUV" }] }],
        }),
        { status: 200 },
      ),
  ),
) {
  const get = vi.fn(async () => ({ status }));
  const attachReference = vi.fn(async () => ({ replayed: false }));
  const waitForScan = vi.fn(async () => true);
  const complete = vi.fn(async () => true);
  const fail = vi.fn(async () => true);
  const options = {
    repository: { waitForScan, complete, fail } as unknown as InboundMediaDispatcher,
    filesFor: () =>
      ({ get, attachReference }) as unknown as ReturnType<InboundMediaLoopOptions["filesFor"]>,
    fileRepository: {} as InboundMediaLoopOptions["fileRepository"],
    storage: {} as InboundMediaLoopOptions["storage"],
    ycloudApiKey: new SecretValue("synthetic"),
    ycloudSourceSecret: new SecretValue("synthetic"),
    openAiApiKey: new SecretValue("synthetic"),
    actor: { memberId: "019b0000-0000-7000-8000-000000000004", scope: "PROFILE" as const },
    pollIntervalMs: 2000,
    fetcher,
  } satisfies InboundMediaLoopOptions;
  return { options, get, attachReference, waitForScan, complete, fail, fetcher };
}

describe("inbound media agent gate", () => {
  it("does not analyze or trigger the agent while Files is scanning", async () => {
    const h = harness("SCANNING");
    await processInboundMedia(h.options, lease, "worker");
    expect(h.waitForScan).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.attachReference).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("analyzes an AVAILABLE object and then atomically exposes it to the agent", async () => {
    const h = harness("AVAILABLE");
    await processInboundMedia(h.options, lease, "worker");
    expect(h.get).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["crm:conversations:read"]),
      lease.fileId,
    );
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(h.attachReference).toHaveBeenCalledOnce();
    expect(h.complete).toHaveBeenCalledWith(lease, "worker", lease.fileId, "A red SUV");
    expect(h.fail).not.toHaveBeenCalled();
  });
});
