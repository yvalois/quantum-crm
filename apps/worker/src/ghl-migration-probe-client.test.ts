import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import { GhlReadOnlyClient } from "./ghl-migration-probe-client.js";

const token = "synthetic-ghl-read-only-token";

function createClient(input: {
  readonly fetcher: typeof fetch;
  readonly maxAttempts?: number;
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  readonly deadlineEpochMilliseconds?: number;
  readonly now?: () => number;
}): GhlReadOnlyClient {
  return new GhlReadOnlyClient({
    apiOrigin: "https://services.leadconnectorhq.com",
    locationId: "location_123",
    token: new SecretValue(token),
    requestTimeoutMs: input.requestTimeoutMs ?? 1_000,
    fetcher: input.fetcher,
    ...(input.deadlineEpochMilliseconds !== undefined
      ? { deadlineEpochMilliseconds: input.deadlineEpochMilliseconds }
      : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.maxResponseBytes !== undefined ? { maxResponseBytes: input.maxResponseBytes } : {}),
    ...(input.sleep ? { sleep: input.sleep } : {}),
  });
}

describe("GHL read-only probe client", () => {
  it("allows source-pinned pagination but refuses a mixed page/cursor or incomplete opportunity cursor", async () => {
    const calls: string[] = [];
    const client = createClient({
      fetcher: async (input) => {
        calls.push(String(input));
        return new Response("{}", { status: 200 });
      },
    });
    await client.request({
      resource: "CONTACTS",
      method: "POST",
      path: "/contacts/search",
      body: {
        locationId: "location_123",
        pageLimit: 100,
        searchAfter: [12345, "synthetic_contact"],
      },
    });
    await client.request({
      resource: "OPPORTUNITIES",
      method: "GET",
      path: "/opportunities/search?locationId=location_123&status=all&order=added_asc&limit=100&startAfter=12345&startAfterId=synthetic_opportunity",
    });
    await client.request({
      resource: "CONVERSATIONS",
      method: "GET",
      path: "/conversations/search?locationId=location_123&limit=100&sort=asc&sortBy=last_message_date&startAfterDate=12345",
    });
    await client.request({
      resource: "MESSAGES",
      method: "GET",
      path: "/conversations/messages/export?locationId=location_123&limit=500&cursor=synthetic-cursor",
    });
    expect(calls).toHaveLength(4);
    await expect(
      client.request({
        resource: "CONTACTS",
        method: "POST",
        path: "/contacts/search",
        body: {
          locationId: "location_123",
          page: 1,
          pageLimit: 100,
          searchAfter: [12345, "synthetic_contact"],
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      client.request({
        resource: "OPPORTUNITIES",
        method: "GET",
        path: "/opportunities/search?locationId=location_123&status=all&order=added_asc&limit=100&startAfter=12345",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(calls).toHaveLength(4);
  });

  it("stops a streaming response as soon as its byte budget is exceeded", async () => {
    let cancelled = false;
    const client = createClient({
      maxResponseBytes: 32,
      fetcher: async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(40));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    });
    await expect(
      client.request({ resource: "TAGS", method: "GET", path: "/locations/location_123/tags" }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("uses the current GHL API version and retries a rate-limited read", async () => {
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const waits: number[] = [];
    let attempt = 0;
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      attempt += 1;
      if (attempt === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    };
    const client = createClient({
      fetcher,
      sleep: async (durationMs) => {
        waits.push(durationMs);
      },
    });

    const result = await client.request({
      resource: "CONTACTS",
      method: "POST",
      path: "/contacts/search",
      body: { locationId: "location_123", page: 1, pageLimit: 20 },
    });

    expect(result).toEqual({ contacts: [] });
    expect(requests).toHaveLength(2);
    expect(waits).toEqual([0]);
    expect(requests[0]?.url).toContain("/contacts/search");
    expect(requests[0]?.init?.headers).toMatchObject({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: "v3",
    });
  });

  it("refuses any request shape that could write outside the discovery contract", async () => {
    let called = false;
    const client = createClient({
      fetcher: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });

    await expect(
      client.request({
        resource: "CONTACTS",
        method: "POST",
        path: "/contacts/contact_123",
        body: { tags: ["would-write"] },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      client.request({
        resource: "CONTACTS",
        method: "POST",
        path: "/contacts/search",
        body: { locationId: "location_123", page: 1, pageLimit: 20, query: "unbounded" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(called).toBe(false);
  });

  it("pins every read to the configured GHL location", async () => {
    let called = false;
    const client = createClient({
      fetcher: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });

    await expect(
      client.request({
        resource: "TAGS",
        method: "GET",
        path: "/locations/another_location/tags",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", resource: "TAGS" });
    await expect(
      client.request({
        resource: "OPPORTUNITIES",
        method: "GET",
        path: "/opportunities/search?locationId=another_location&status=all&order=added_asc&limit=10",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST", resource: "OPPORTUNITIES" });
    expect(called).toBe(false);
  });

  it("uses the current GHL v3 version for message-export reads", async () => {
    const versions: string[] = [];
    const client = createClient({
      fetcher: async (_input, init) => {
        const headers = init?.headers as Readonly<Record<string, string>> | undefined;
        versions.push(headers?.Version ?? "");
        return new Response("{}", { status: 200 });
      },
    });

    await client.request({
      resource: "MESSAGES",
      method: "GET",
      path: "/conversations/messages/export?locationId=location_123&limit=10",
    });

    expect(versions).toEqual(["v3"]);
  });

  it("bounds unexpected payloads and redacts its token from errors", async () => {
    const client = createClient({
      fetcher: async () => new Response("payload-that-is-too-large", { status: 200 }),
      maxResponseBytes: 4,
    });

    let thrown: unknown;
    try {
      await client.request({
        resource: "TAGS",
        method: "GET",
        path: "/locations/location_123/tags",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "RESPONSE_TOO_LARGE", resource: "TAGS" });
    expect(String(thrown)).not.toContain(token);
  });

  it("reports a timeout without exposing request data", async () => {
    const client = createClient({
      fetcher: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")));
        }),
      maxAttempts: 1,
      requestTimeoutMs: 1,
    });

    await expect(
      client.request({ resource: "TAGS", method: "GET", path: "/locations/location_123/tags" }),
    ).rejects.toMatchObject({ code: "TIMEOUT", resource: "TAGS" });
  });

  it("does not let retries exceed the ephemeral probe deadline", async () => {
    let calls = 0;
    const client = createClient({
      fetcher: async () => {
        calls += 1;
        return new Response("", { status: 429, headers: { "retry-after": "30" } });
      },
      deadlineEpochMilliseconds: 1_010,
      now: () => 1_000,
      sleep: async () => undefined,
    });

    await expect(
      client.request({ resource: "TAGS", method: "GET", path: "/locations/location_123/tags" }),
    ).rejects.toMatchObject({ code: "TIMEOUT", resource: "TAGS" });
    expect(calls).toBe(1);
  });
});
