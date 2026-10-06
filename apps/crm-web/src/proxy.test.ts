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
});
