import { randomUUID } from "node:crypto";

import type { YCloudBindingConfig } from "@quantum-crm/config";
import type {
  ConversationOutboundDispatcher,
  ConversationOutboundLease,
} from "@quantum-crm/domain";
import {
  FileNotFoundError,
  FileStateConflictError,
  FileValidationError,
} from "@quantum-crm/domain";
import type { OutboundMedia } from "@quantum-crm/files-infrastructure";

export interface YCloudOutboundOptions {
  readonly repository: ConversationOutboundDispatcher;
  readonly binding: YCloudBindingConfig;
  readonly apiKey: string;
  readonly pollIntervalMs: number;
  readonly workerId?: string;
  readonly fetcher?: typeof fetch;
  readonly mediaFor?: (lease: ConversationOutboundLease) => Promise<OutboundMedia>;
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
  options: Pick<YCloudOutboundOptions, "binding" | "apiKey" | "fetcher" | "mediaFor">,
  lease: ConversationOutboundLease,
): Promise<SendResult> {
  const match = threadPattern.exec(lease.externalThreadId);
  if (
    !match ||
    match[1] !== options.binding.wabaId ||
    !["TEXT", "IMAGE", "AUDIO", "DOCUMENT"].includes(lease.kind) ||
    lease.body.length > 4096
  ) {
    return { outcome: "FAILED", errorCode: "UNSUPPORTED_MESSAGE" };
  }
  let content: Record<string, unknown> = { type: "text", text: { body: lease.body } };
  if (lease.kind !== "TEXT") {
    if (!lease.fileId || !options.mediaFor) {
      return { outcome: "FAILED", errorCode: "MEDIA_MISSING" };
    }
    let media: OutboundMedia;
    try {
      media = await options.mediaFor(lease);
    } catch (error) {
      if (
        error instanceof FileNotFoundError ||
        error instanceof FileStateConflictError ||
        error instanceof FileValidationError
      ) {
        return { outcome: "FAILED", errorCode: "MEDIA_NOT_AVAILABLE" };
      }
      return lease.attempt >= 5
        ? { outcome: "FAILED", errorCode: "MEDIA_READ_EXHAUSTED" }
        : { outcome: "RETRY", errorCode: "MEDIA_READ_FAILED" };
    }
    const file = new FormData();
    file.append(
      "file",
      new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }),
      media.filename,
    );
    let uploaded: Response;
    try {
      uploaded = await (options.fetcher ?? fetch)(
        `https://api.ycloud.com/v2/whatsapp/media/${encodeURIComponent(`+${options.binding.businessPhone}`)}/upload`,
        {
          method: "POST",
          headers: { "X-API-Key": options.apiKey },
          body: file,
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      return lease.attempt >= 5
        ? { outcome: "FAILED", errorCode: "MEDIA_UPLOAD_EXHAUSTED" }
        : { outcome: "RETRY", errorCode: "MEDIA_UPLOAD_FAILED" };
    }
    if (!uploaded.ok) {
      if (uploaded.status >= 500 || uploaded.status === 429) {
        return lease.attempt >= 5
          ? { outcome: "FAILED", errorCode: "MEDIA_UPLOAD_EXHAUSTED" }
          : { outcome: "RETRY", errorCode: "MEDIA_UPLOAD_FAILED" };
      }
      return { outcome: "FAILED", errorCode: "MEDIA_REJECTED" };
    }
    let mediaId: string | undefined;
    try {
      const payload: unknown = await uploaded.json();
      if (
        payload &&
        typeof payload === "object" &&
        "id" in payload &&
        typeof payload.id === "string" &&
        payload.id.length <= 400
      )
        mediaId = payload.id;
    } catch {
      /* invalid provider response */
    }
    if (!mediaId) return { outcome: "FAILED", errorCode: "INVALID_MEDIA_RESPONSE" };
    const mediaType = lease.kind.toLowerCase();
    content = {
      type: mediaType,
      [mediaType]: {
        id: mediaId,
        ...(lease.kind === "AUDIO" ? {} : { caption: lease.body }),
        ...(lease.kind === "DOCUMENT" ? { filename: media.filename } : {}),
      },
    };
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
        ...content,
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
