import { createHmac, timingSafeEqual } from "node:crypto";

import { Controller, HttpException, Inject, Post, Req } from "@nestjs/common";
import type { YCloudBindingConfig } from "@quantum-crm/config";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import type { ConversationMessageKind } from "@quantum-crm/domain";

import { CrmPublicRoute } from "./crm-security.js";

export const YCLOUD_BINDING = Symbol("YCLOUD_BINDING");

type Json = Record<string, unknown>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
interface WebhookRequest {
  readonly rawBody?: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function digits(value: unknown): string | null {
  const normalized = string(value)?.replace(/[^0-9]/gu, "") ?? "";
  return /^[0-9]{8,20}$/u.test(normalized) ? normalized : null;
}

export function verifyYCloudSignature(
  rawBody: Buffer,
  header: string | string[] | undefined,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (typeof header !== "string") return false;
  const match = /^t=([0-9]{10,13}),s=([a-f0-9]{64})$/iu.exec(header);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp * 1_000) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.`).update(rawBody).digest();
  const received = Buffer.from(match[2]!, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface ParsedYCloudMessage {
  readonly phone: string;
  readonly displayName: string;
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly kind: ConversationMessageKind;
  readonly body: string;
  readonly occurredAt: Date;
  readonly historical: boolean;
  readonly inboundMedia?: {
    readonly providerMediaId: string;
    readonly expectedSha256: string;
    readonly declaredMime: string;
  };
}

export interface ParsedYCloudOutboundStatus {
  readonly messageId: string;
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  readonly failureCode?: string;
}

export function parseYCloudOutboundStatus(
  payload: unknown,
  binding: YCloudBindingConfig,
): ParsedYCloudOutboundStatus | null {
  const event = object(payload);
  if (string(event?.type) !== "whatsapp.message.updated") return null;
  const message = object(event?.whatsappMessage);
  if (
    !message ||
    string(message.wabaId) !== binding.wabaId ||
    digits(message.from) !== binding.businessPhone
  )
    return null;
  const phone = digits(message.to);
  const messageId = string(message.externalId);
  const providerId = string(message.id);
  const rawStatus = string(message.status);
  if (
    !phone ||
    !messageId ||
    !uuidPattern.test(messageId) ||
    !providerId ||
    providerId.length > 400 ||
    !rawStatus ||
    !["sent", "delivered", "read", "failed"].includes(rawStatus)
  )
    return null;
  const errorCode = string(message.errorCode);
  return {
    messageId,
    externalThreadId: `ycloud:${binding.wabaId}:${phone}`,
    externalMessageId: `ycloud:${binding.wabaId}:${providerId}`,
    status: rawStatus.toUpperCase() as ParsedYCloudOutboundStatus["status"],
    ...(errorCode && /^[A-Z0-9_]{1,120}$/u.test(errorCode) ? { failureCode: errorCode } : {}),
  };
}

export function parseYCloudMessage(
  payload: unknown,
  binding: YCloudBindingConfig,
): ParsedYCloudMessage | null {
  const event = object(payload);
  if (!event) return null;
  const type = string(event.type);
  if (
    ![
      "whatsapp.inbound_message.received",
      "whatsapp.smb.message.echoes",
      "whatsapp.smb.history",
    ].includes(type ?? "")
  )
    return null;
  const inbound = object(event.whatsappInboundMessage);
  const outbound = object(event.whatsappMessage);
  const message = inbound ?? outbound;
  if (!message || string(message.wabaId) !== binding.wabaId) return null;
  const businessPhone = digits(inbound ? message.to : message.from);
  if (businessPhone !== binding.businessPhone) return null;
  const phone = digits(inbound ? message.from : message.to);
  const externalMessageId = string(message.wamid) ?? string(message.id);
  if (!phone || !externalMessageId || externalMessageId.length > 400) return null;
  const timestamp = new Date(string(message.sendTime) ?? string(event.createTime) ?? "");
  if (Number.isNaN(timestamp.getTime())) return null;
  const messageType = string(message.type) ?? "unknown";
  const media = object(message[messageType]);
  const mediaId = string(media?.id);
  const mediaChecksum = string(media?.sha256);
  const mediaMime = string(media?.mime_type)?.split(";", 1)[0]?.toLowerCase();
  const caption = string(media?.caption)?.trim();
  const text = string(object(message.text)?.body)?.trim();
  const labels: Readonly<Record<string, string>> = {
    image: "Imagen",
    audio: "Audio",
    video: "Video",
    document: "Documento",
    sticker: "Sticker",
    location: "Ubicación",
    contacts: "Contacto",
  };
  const body = (text || caption || labels[messageType] || "Mensaje de WhatsApp").slice(0, 16_000);
  const kind: ConversationMessageKind =
    messageType === "image"
      ? "IMAGE"
      : messageType === "audio"
        ? "AUDIO"
        : messageType === "document" || messageType === "video"
          ? "DOCUMENT"
          : "TEXT";
  const customerProfile = object(message.customerProfile);
  const displayName = (string(customerProfile?.name)?.trim() || `+${phone}`).slice(0, 160);
  return Object.freeze({
    phone,
    displayName,
    externalThreadId: `ycloud:${binding.wabaId}:${phone}`,
    externalMessageId: `ycloud:${binding.wabaId}:${externalMessageId}`,
    direction: inbound ? "INBOUND" : "OUTBOUND",
    kind,
    body,
    occurredAt: timestamp,
    historical: type === "whatsapp.smb.history",
    ...(inbound &&
    type !== "whatsapp.smb.history" &&
    ["image", "audio"].includes(messageType) &&
    mediaId &&
    /^[A-Za-z0-9_-]{1,80}$/u.test(mediaId) &&
    mediaChecksum &&
    /^[A-Za-z0-9+/]{43}=$/u.test(mediaChecksum) &&
    mediaMime &&
    (messageType === "image"
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["audio/mpeg", "audio/ogg", "audio/wav", "audio/webm"]
    ).includes(mediaMime)
      ? {
          inboundMedia: {
            providerMediaId: mediaId,
            expectedSha256: mediaChecksum,
            declaredMime: mediaMime,
          },
        }
      : {}),
  });
}

@Controller("api/v1/webhooks/ycloud")
@CrmPublicRoute()
export class YCloudWebhookController {
  public constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: CrmPostgresDatabase,
    @Inject(YCLOUD_BINDING) private readonly binding: YCloudBindingConfig | undefined,
  ) {}

  @Post()
  public async receive(@Req() request: WebhookRequest): Promise<{ received: true }> {
    if (!this.binding) throw new HttpException("Channel unavailable", 404);
    const rawBody = request.rawBody;
    if (
      !rawBody ||
      rawBody.byteLength > 1_048_576 ||
      !verifyYCloudSignature(
        rawBody,
        request.headers["ycloud-signature"],
        this.binding.signingSecret.expose(),
      )
    ) {
      throw new HttpException("Invalid webhook signature", 401);
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new HttpException("Invalid webhook payload", 400);
    }
    const outboundStatus = parseYCloudOutboundStatus(event, this.binding);
    if (outboundStatus) {
      await this.database.commercial.externalConversations.reconcileOutbound(outboundStatus);
      return { received: true };
    }
    const message = parseYCloudMessage(event, this.binding);
    if (!message) return { received: true };
    const providerMessage = object(object(event)?.whatsappMessage);
    const correlatedId = string(providerMessage?.externalId);
    if (message.direction === "OUTBOUND" && correlatedId && uuidPattern.test(correlatedId)) {
      const correlated = await this.database.commercial.externalConversations.reconcileOutbound({
        messageId: correlatedId,
        externalThreadId: message.externalThreadId,
        externalMessageId: `ycloud:${this.binding.wabaId}:${string(providerMessage?.id) ?? correlatedId}`,
        status: "SENT",
      });
      if (correlated) return { received: true };
    }
    const contact = await this.database.commercial.externalContacts.resolvePhone(
      message.phone,
      message.displayName,
    );
    await this.database.commercial.externalConversations.receive({
      contactId: contact.id,
      contactDisplayName: contact.displayName,
      externalThreadId: message.externalThreadId,
      externalMessageId: message.externalMessageId,
      direction: message.direction,
      kind: message.kind,
      body: message.body,
      occurredAt: message.occurredAt,
      historical: message.historical,
      ...(message.inboundMedia ? { inboundMedia: message.inboundMedia } : {}),
    });
    return { received: true };
  }
}
