import { readFile } from "node:fs/promises";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy.js";

describe("crm-web proxy", () => {
  it("renderiza las paginas dinamicamente para propagar el nonce CSP", async () => {
    const layout = await readFile(new URL("./app/layout.tsx", import.meta.url), "utf8");

    expect(layout).toContain('export const dynamic = "force-dynamic";');
  });

  it("permite abrir un formulario publicado sin sesion", () => {
    const response = proxy(new NextRequest("https://crm.example.test/f/contacto-comercial"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("mantiene protegida la administracion de formularios", () => {
    const response = proxy(new NextRequest("https://crm.example.test/forms"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/api/auth/login?returnTo=%2Fforms",
    );
  });

  it("autoriza solo el origen HTTPS exacto del almacenamiento hermano", () => {
    const request = new NextRequest("https://interamerican.2-25-172-119.nip.io/documents");
    request.cookies.set("qcrm_crm_session", "opaque-session");

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("img-src 'self' blob: data: https://storage.2-25-172-119.nip.io");
    expect(policy).toContain("connect-src 'self' https://storage.2-25-172-119.nip.io");
    expect(policy).not.toContain("https://*.nip.io");
  });

  it("usa el host publico reenviado cuando Next recibe un host interno", () => {
    const request = new NextRequest("https://0.0.0.0/documents", {
      headers: { "x-forwarded-host": "interamerican.2-25-172-119.nip.io" },
    });
    request.cookies.set("qcrm_crm_session", "opaque-session");

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https://storage.2-25-172-119.nip.io");
    expect(policy).not.toContain("storage.0.0.0");
  });
});
