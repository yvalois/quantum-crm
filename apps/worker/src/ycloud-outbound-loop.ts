import { randomUUID } from "node:crypto";

import type { YCloudBindingConfig } from "@quantum-crm/config";
import type {
  ConversationOutboundDispatcher,
  ConversationOutboundLease,
} from "@quantum-crm/domain";

export interface YCloudOutboundOptions {
  readonly repository: ConversationOutboundDispatcher;
  readonly binding: YCloudBindingConfig;
  readonly apiKey: string;
  readonly pollIntervalMs: number;
  readonly workerId?: string;
  readonly fetcher?: typeof fetch;
  readonly onError?: (error: unknown) => void;
}

export interface YCloudOutboundLoop {
  readonly close: () => Promise<void>;
}

interface SendResult {
  readonly outcome: "SENT" | "RETRY" | "FAILED" | "UNKNOWN";
  readonly externalMessageId?: string;
  readonly errorCode?: string;
}

const threadPattern = /^ycloud:([0-9]{5,30}):([0-9]{8,20})$/u;

export async function sendYCloudText(
  options: Pick<YCloudOutboundOptions, "binding" | "apiKey" | "fetcher">,
  lease: ConversationOutboundLease,
): Promise<SendResult> {
  const match = threadPattern.exec(lease.externalThreadId);
  if (
    !match ||
    match[1] !== options.binding.wabaId ||
    lease.kind !== "TEXT" ||
    lease.body.length > 4096
  ) {
    return { outcome: "FAILED", errorCode: "UNSUPPORTED_MESSAGE" };
  }
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: {
        "X-API-Key": options.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: `+${options.binding.businessPhone}`,
        to: `+${match[2]}`,
        type: "text",
        text: { body: lease.body },
        externalId: lease.messageId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The provider may have accepted the request before the connection failed.
    return { outcome: "UNKNOWN", errorCode: "DELIVERY_UNCERTAIN" };
  }
  if (response.status === 429) {
    return lease.attempt >= 5
      ? { outcome: "FAILED", errorCode: "RATE_LIMIT_EXHAUSTED" }
      : { outcome: "RETRY", errorCode: "RATE_LIMIT" };
  }
  if (!response.ok) {
    return {
      outcome: response.status >= 500 ? "UNKNOWN" : "FAILED",
      errorCode: response.status >= 500 ? "PROVIDER_UNCERTAIN" : "PROVIDER_REJECTED",
    };
  }
  try {
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("id" in payload) ||
      typeof payload.id !== "string" ||
      payload.id.length < 1 ||
      payload.id.length > 400
    ) {
      return { outcome: "UNKNOWN", errorCode: "INVALID_PROVIDER_RESPONSE" };
    }
    return {
      outcome: "SENT",
      externalMessageId: `ycloud:${options.binding.wabaId}:${payload.id}`,
    };
  } catch {
    return { outcome: "UNKNOWN", errorCode: "INVALID_PROVIDER_RESPONSE" };
  }
}

export async function dispatchYCloudMessage(
  options: YCloudOutboundOptions,
  lease: ConversationOutboundLease,
  workerId: string,
): Promise<void> {
  const outcome = await sendYCloudText(options, lease);
  const persisted = await options.repository.complete({
    lease,
    workerId,
    ...outcome,
  });
  if (!persisted) throw new Error("YCloud outbound lease was lost");
}

export function startYCloudOutboundLoop(options: YCloudOutboundOptions): YCloudOutboundLoop {
  const workerId = options.workerId ?? randomUUID();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  const schedule = () => {
    if (closed) return;
    timer = setTimeout(() => {
      running = tick();
    }, options.pollIntervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const lease = await options.repository.claimNext({ workerId, leaseSeconds: 45 });
      if (lease) await dispatchYCloudMessage(options, lease, workerId);
    } catch (error) {
      options.onError?.(error);
    } finally {
      schedule();
    }
  };
  running = tick();
  return Object.freeze({
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  });
}
