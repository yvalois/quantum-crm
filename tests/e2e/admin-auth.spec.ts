import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const username = process.env.QCRM_E2E_OPERATOR_USERNAME ?? "qcrm-owner";
const passwordFile = process.env.QCRM_E2E_OPERATOR_PASSWORD_FILE;

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replaceAll(/[^A-Z2-7]/gu, "");
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha256", decodeBase32(secret)).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, "0");
}

test("operator completes password, TOTP, authorized API and logout", async ({ page, context }) => {
  if (!passwordFile) throw new Error("QCRM_E2E_OPERATOR_PASSWORD_FILE is required");
  const password = readFileSync(passwordFile, "utf8").trim();
  if (password.length < 14) throw new Error("Invalid E2E password file");

  const unauthenticated = await context.request.get("/api/platform/operators/me", {
    maxRedirects: 0,
  });
  expect(unauthenticated.status()).toBe(401);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/realms\/quantum-platform\/protocol\/openid-connect\/auth/u);
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();

  await page.locator("#mode-manual").click();
  const secretOutput = page.locator("#kc-totp-secret-key");
  await expect(secretOutput).toBeVisible();
  const secret = (await secretOutput.innerText()).replaceAll(/\s/gu, "");
  expect(secret).toMatch(/^[A-Z2-7]+$/u);
  await page.locator("#totp").fill(totp(secret));
  const deviceName = page.locator("#userLabel");
  if (await deviceName.isVisible()) await deviceName.fill("Quantum E2E temporal");
  await page.locator("#saveTOTPBtn, input[type='submit'], button[type='submit']").first().click();

  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole("heading", { name: "Panel administrativo" })).toBeVisible();

  const operatorResponse = await page.evaluate(async () => {
    const response = await fetch("/api/platform/operators/me", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  expect(operatorResponse.status).toBe(200);
  expect(operatorResponse.body).toMatchObject({
    schemaVersion: "platform-operator/v1",
    data: {
      permissions: expect.arrayContaining([
        "tenants:read",
        "tenants:manage",
        "configuration:read",
        "configuration:manage",
        "deployments:read",
        "deployments:execute",
        "operators:manage",
      ]),
    },
  });

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__Host-qcrm_admin_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
  expect(sessionCookie?.value).not.toContain(".");
  const browserStorage = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
    html: document.documentElement.outerHTML,
    url: location.href,
  }));
  const exposed = JSON.stringify(browserStorage);
  expect(exposed).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
  expect(exposed).not.toContain(secret);
  expect(exposed).not.toContain(password);

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    return response.json() as Promise<{ csrfToken: string }>;
  });
  const logoutStatus = await page.evaluate(async (csrfToken) => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      redirect: "follow",
    });
    return { status: response.status, url: response.url };
  }, session.csrfToken);
  expect(logoutStatus.status).toBe(200);
  expect(logoutStatus.url).toMatch(/\/signed-out$/u);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/realms\/quantum-platform\/protocol\/openid-connect\/auth/u);
});
