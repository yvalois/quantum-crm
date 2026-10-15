import { describe, expect, it } from "vitest";

import { openYCloudMediaSource, sealYCloudMediaSource } from "./ycloud-media-source.js";

const id = "712063723747110";
const link = `https://api.ycloud.com/v2/whatsapp/media/download/${id}?sig=test&payload=test`;

describe("YCloud inbound media source", () => {
  it("encrypts an exact signed YCloud URL and binds it to the media ID and secret", () => {
    const sealed = sealYCloudMediaSource(link, id, "secret");
    expect(sealed).not.toContain("sig=");
    expect(openYCloudMediaSource(sealed, id, "secret")).toBe(link);
    expect(() => openYCloudMediaSource(sealed, "other", "secret")).toThrow();
    expect(() => openYCloudMediaSource(sealed, id, "wrong-secret")).toThrow();
  });

  it("rejects external hosts and mismatched source IDs", () => {
    expect(() => sealYCloudMediaSource(link.replace("api.ycloud.com", "evil.example"), id, "secret")).toThrow();
    expect(() => sealYCloudMediaSource(link, "other", "secret")).toThrow();
  });
});
