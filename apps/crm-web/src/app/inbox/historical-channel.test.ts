import { describe, expect, it } from "vitest";

import { historicalChannel } from "./historical-channel.js";

describe("historicalChannel", () => {
  it("identifica WhatsApp desde el tipo original aunque el canal este ausente", () => {
    expect(historicalChannel(null, "TYPE_WHATSAPP")).toEqual({ key: "whatsapp", label: "WhatsApp" });
    expect(historicalChannel(" type_whatsapp ")).toEqual({ key: "whatsapp", label: "WhatsApp" });
  });

  it("usa tipos conocidos como respaldo sin sustituir un canal explicito conocido", () => {
    expect(historicalChannel("unrecognized", "TYPE_WHATSAPP").key).toBe("whatsapp");
    expect(historicalChannel("SMS", "TYPE_WHATSAPP")).toEqual({ key: "sms", label: "SMS" });
  });

  it("no inventa un canal para metadatos desconocidos o inexistentes", () => {
    expect(historicalChannel(null, null)).toEqual({ key: "unknown", label: "Canal no informado" });
    expect(historicalChannel("custom-provider", "TYPE_UNKNOWN")).toEqual({
      key: "unknown",
      label: "Canal no identificado",
    });
    expect(historicalChannel(null, "NOT_TYPE_WHATSAPP").key).toBe("unknown");
    expect(historicalChannel("TYPE_PHONE", null).key).toBe("unknown");
  });

  it("distingue TikTok y formularios originales de canales de mensajeria", () => {
    expect(historicalChannel(null, "TYPE_TIKTOK")).toEqual({ key: "tiktok", label: "TikTok" });
    expect(historicalChannel(null, "TYPE_FORM_SUBMISSION")).toEqual({ key: "form", label: "Formulario" });
  });
});
