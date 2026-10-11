import { createHmac, timingSafeEqual } from "node:crypto";

import { Controller, HttpException, Inject, Post, Req } from "@nestjs/common";
import type { YCloudBindingConfig } from "@quantum-crm/config";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import type { ConversationMessageKind } from "@quantum-crm/domain";

import { CrmPublicRoute } from "./crm-security.js";

export const YCLOUD_BINDING = Symbol("YCLOUD_BINDING");

type Json = Record<string, unknown>;
interface WebhookRequest {
  readonly rawBody?: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

function object(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
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
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp * 1_000) > 300_000)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${match[1]}.`)
    .update(rawBody)
    .digest();
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
}

export function parseYCloudMessage(payload: unknown, binding: YCloudBindingConfig): ParsedYCloudMessage | null {
  const event = object(payload);
  if (!event) return null;
  const type = string(event.type);
  if (![
    "whatsapp.inbound_message.received",
    "whatsapp.smb.message.echoes",
    "whatsapp.smb.history",
  ].includes(type ?? "")) return null;
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
  const caption = string(media?.caption)?.trim();
  const text = string(object(message.text)?.body)?.trim();
  const labels: Readonly<Record<string, string>> = {
    image: "Imagen", audio: "Audio", video: "Video", document: "Documento",
    sticker: "Sticker", location: "Ubicación", contacts: "Contacto",
  };
  const body = (text || caption || labels[messageType] || "Mensaje de WhatsApp").slice(0, 16_000);
  const kind: ConversationMessageKind = messageType === "image" ? "IMAGE"
    : messageType === "audio" ? "AUDIO"
    : messageType === "document" || messageType === "video" ? "DOCUMENT" : "TEXT";
  const customerProfile = object(message.customerProfile);
  const displayName = (string(customerProfile?.name)?.trim() || `+${phone}`).slice(0, 160);
  return Object.freeze({
    phone, displayName,
    externalThreadId: `ycloud:${binding.wabaId}:${phone}`,
    externalMessageId: `ycloud:${binding.wabaId}:${externalMessageId}`,
    direction: inbound ? "INBOUND" : "OUTBOUND",
    kind, body, occurredAt: timestamp,
    historical: type === "whatsapp.smb.history",
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
    if (!rawBody || rawBody.byteLength > 1_048_576 ||
        !verifyYCloudSignature(rawBody, request.headers["ycloud-signature"], this.binding.signingSecret.expose())) {
      throw new HttpException("Invalid webhook signature", 401);
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new HttpException("Invalid webhook payload", 400);
    }
    const message = parseYCloudMessage(event, this.binding);
    if (!message) return { received: true };
    const contact = await this.database.commercial.externalContacts.resolvePhone(
      message.phone, message.displayName,
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
    });
    return { received: true };
  }
}
