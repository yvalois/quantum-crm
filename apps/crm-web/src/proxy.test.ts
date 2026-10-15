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

  it("sirve el favicon sin sesion sin abrir otras rutas del CRM", () => {
    const icon = proxy(new NextRequest("https://crm.example.test/icon.png?icon.test.png"));
    const protectedPage = proxy(new NextRequest("https://crm.example.test/pipelines"));

    expect(icon.status).toBe(200);
    expect(icon.headers.get("location")).toBeNull();
    expect(protectedPage.status).toBe(307);
  });

  it("mantiene protegida la administracion de formularios", () => {
    const response = proxy(new NextRequest("https://crm.example.test/forms"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/api/auth/login?returnTo=%2Fforms",
    );
  });

  it("mantiene protegida la configuración de pipelines", () => {
    const response = proxy(new NextRequest("https://crm.example.test/pipelines"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://crm.example.test/api/auth/login?returnTo=%2Fpipelines",
    );
  });

  it("does not accept a legacy unprefixed session cookie over HTTPS", () => {
    const request = new NextRequest("https://crm.example.test/pipelines");
    request.cookies.set("qcrm_crm_session", "legacy-session");

    expect(proxy(request).status).toBe(307);
  });

  it("autoriza solo el origen HTTPS exacto del almacenamiento hermano", () => {
    const request = new NextRequest("https://interamerican.2-25-172-119.nip.io/documents");
    request.cookies.set("__Host-qcrm_crm_session", "opaque-session");

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("img-src 'self' blob: data: https://storage.2-25-172-119.nip.io");
    expect(policy).toContain("media-src 'self' https://storage.2-25-172-119.nip.io");
    expect(policy).toContain("connect-src 'self' https://storage.2-25-172-119.nip.io");
    expect(policy).not.toContain("https://*.nip.io");
  });

  it("no permite medios externos cuando no existe un origen de almacenamiento verificado", () => {
    const policy = proxy(new NextRequest("http://localhost:3000/inbox")).headers.get(
      "content-security-policy",
    );

    expect(policy?.split("; ").find((directive) => directive.startsWith("media-src"))).toBe(
      "media-src 'self'",
    );
  });

  it("usa el host publico reenviado cuando Next recibe un host interno", () => {
    const request = new NextRequest("https://0.0.0.0/documents", {
      headers: { "x-forwarded-host": "interamerican.2-25-172-119.nip.io" },
    });
    request.cookies.set("__Host-qcrm_crm_session", "opaque-session");

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https://storage.2-25-172-119.nip.io");
    expect(policy).not.toContain("storage.0.0.0");
  });
});
