import { createHmac } from "node:crypto";

import { SecretValue, type YCloudBindingConfig } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import {
  parseYCloudMessage,
  parseYCloudOutboundStatus,
  verifyYCloudSignature,
} from "./ycloud-webhook.controller.js";

const binding: YCloudBindingConfig = {
  wabaId: "1234567890123456",
  businessPhone: "15550001111",
  signingSecret: new SecretValue("test-signing-secret-not-for-production"),
};

describe("YCloud webhook", () => {
  it("validates the raw body signature and rejects altered or stale requests", () => {
    const body = Buffer.from('{"id":"evt_test","type":"whatsapp.smb.history"}');
    const timestamp = 1_800_000_000;
    const signature = createHmac("sha256", binding.signingSecret.expose())
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");
    const header = `t=${timestamp},s=${signature}`;
    expect(
      verifyYCloudSignature(body, header, binding.signingSecret.expose(), timestamp * 1_000),
    ).toBe(true);
    expect(
      verifyYCloudSignature(
        Buffer.from("{}"),
        header,
        binding.signingSecret.expose(),
        timestamp * 1_000,
      ),
    ).toBe(false);
    expect(
      verifyYCloudSignature(
        body,
        header,
        binding.signingSecret.expose(),
        timestamp * 1_000 + 301_000,
      ),
    ).toBe(false);
  });

  it("maps inbound, phone-app echo and shared history to the same customer thread", () => {
    const original = {
      id: "provider-message-1",
      wamid: "wamid.123",
      wabaId: binding.wabaId,
      from: "+50255556666",
      to: `+${binding.businessPhone}`,
      sendTime: "2026-10-11T15:00:00.000Z",
      type: "text",
      text: { body: "Hola" },
      customerProfile: { name: "Cliente Uno" },
    };
    const inbound = parseYCloudMessage(
      { type: "whatsapp.inbound_message.received", whatsappInboundMessage: original },
      binding,
    );
    expect(inbound).toMatchObject({
      phone: "50255556666",
      displayName: "Cliente Uno",
      body: "Hola",
      direction: "INBOUND",
      historical: false,
    });
    const echo = parseYCloudMessage(
      {
        type: "whatsapp.smb.message.echoes",
        whatsappMessage: { ...original, from: original.to, to: original.from },
      },
      binding,
    );
    expect(echo?.externalThreadId).toBe(inbound?.externalThreadId);
    expect(echo?.direction).toBe("OUTBOUND");
    expect(
      parseYCloudMessage(
        { type: "whatsapp.smb.history", whatsappInboundMessage: original },
        binding,
      )?.historical,
    ).toBe(true);
    expect(
      parseYCloudMessage(
        { type: "whatsapp.smb.history", whatsappInboundMessage: { ...original, wabaId: "other" } },
        binding,
      ),
    ).toBeNull();
  });

  it("correlates delivery updates only for the bound sender and internal message", () => {
    const payload = {
      type: "whatsapp.message.updated",
      whatsappMessage: {
        id: "provider-1",
        externalId: "01995f7e-7b52-7000-8000-000000000402",
        wabaId: binding.wabaId,
        from: `+${binding.businessPhone}`,
        to: "+50255556666",
        status: "delivered",
      },
    };
    expect(parseYCloudOutboundStatus(payload, binding)).toEqual({
      messageId: payload.whatsappMessage.externalId,
      externalThreadId: `ycloud:${binding.wabaId}:50255556666`,
      externalMessageId: `ycloud:${binding.wabaId}:provider-1`,
      status: "DELIVERED",
    });
    expect(
      parseYCloudOutboundStatus(
        {
          ...payload,
          whatsappMessage: { ...payload.whatsappMessage, wabaId: "other" },
        },
        binding,
      ),
    ).toBeNull();
  });

  it("captures only signed inbound image and audio references for later scanning", () => {
    const message = {
      id: "provider-media-1",
      wabaId: binding.wabaId,
      from: "+50255556666",
      to: `+${binding.businessPhone}`,
      sendTime: "2026-10-15T16:00:00.000Z",
      type: "audio",
      audio: {
        id: "712063723747110",
        sha256: Buffer.alloc(32, 1).toString("base64"),
        mime_type: "audio/ogg; codecs=opus",
      },
    };
    const inbound = parseYCloudMessage(
      { type: "whatsapp.inbound_message.received", whatsappInboundMessage: message },
      binding,
    );
    expect(inbound).toMatchObject({
      kind: "AUDIO",
      body: "Audio",
      inboundMedia: {
        providerMediaId: "712063723747110",
        declaredMime: "audio/ogg",
      },
    });
    const image = parseYCloudMessage(
      {
        type: "whatsapp.inbound_message.received",
        whatsappInboundMessage: {
          ...message,
          type: "image",
          image: {
            id: "592623615738103",
            sha256: Buffer.alloc(32, 2).toString("base64"),
            mime_type: "image/jpeg",
            caption: "This model",
          },
        },
      },
      binding,
    );
    expect(image).toMatchObject({
      kind: "IMAGE",
      body: "This model",
      inboundMedia: { declaredMime: "image/jpeg" },
    });
    const history = parseYCloudMessage(
      { type: "whatsapp.smb.history", whatsappInboundMessage: message },
      binding,
    );
    expect(history?.inboundMedia).toBeUndefined();
    const malformed = parseYCloudMessage(
      {
        type: "whatsapp.inbound_message.received",
        whatsappInboundMessage: {
          ...message,
          audio: { ...message.audio, id: "../../private" },
        },
      },
      binding,
    );
    expect(malformed?.inboundMedia).toBeUndefined();
  });
});
