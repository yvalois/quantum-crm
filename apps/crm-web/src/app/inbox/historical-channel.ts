export interface HistoricalChannel {
  readonly key:
    | "whatsapp"
    | "sms"
    | "email"
    | "instagram"
    | "facebook"
    | "chat"
    | "call"
    | "google"
    | "tiktok"
    | "form"
    | "unknown";
  readonly label: string;
}

function knownChannel(value: string | null | undefined): HistoricalChannel | null {
  const normalized = value
    ?.trim()
    .toUpperCase()
    .replace(/^TYPE_/u, "");
  switch (normalized) {
    case "WHATSAPP":
    case "WHATS_APP":
      return { key: "whatsapp", label: "WhatsApp" };
    case "SMS":
    case "MMS":
      return { key: "sms", label: normalized };
    case "EMAIL":
      return { key: "email", label: "Correo" };
    case "INSTAGRAM":
      return { key: "instagram", label: "Instagram" };
    case "TIKTOK":
      return { key: "tiktok", label: "TikTok" };
    case "FORM_SUBMISSION":
      return { key: "form", label: "Formulario" };
    case "FB":
    case "FACEBOOK":
    case "MESSENGER":
    case "FACEBOOK_MESSENGER":
      return { key: "facebook", label: "Messenger" };
    case "LIVE_CHAT":
    case "LIVECHAT":
    case "WEB_CHAT":
    case "WEBCHAT":
      return { key: "chat", label: "Chat web" };
    case "CALL":
    case "PHONE_CALL":
      return { key: "call", label: "Llamada" };
    case "GMB":
    case "GOOGLE_BUSINESS":
      return { key: "google", label: "Google Business" };
    default:
      return null;
  }
}

export function historicalChannel(
  rawChannel: string | null | undefined,
  rawType?: string | null,
): HistoricalChannel {
  return (
    knownChannel(rawChannel) ??
    knownChannel(rawType) ?? {
      key: "unknown",
      label: rawChannel?.trim() || rawType?.trim() ? "Canal no identificado" : "Canal no informado",
    }
  );
}
