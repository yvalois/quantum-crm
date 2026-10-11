import { describe, expect, it, vi } from "vitest";

import type { GhlReadOnlyRequest } from "./ghl-migration-probe-client.js";
import {
  exportGhlMigration,
  type GhlMigrationExportClient,
  type GhlMigrationExportConfig,
  type GhlMigrationExportPage,
  type GhlMigrationExportReport,
  type GhlMigrationExportSink,
} from "./ghl-migration-export.js";

const locationId = "location_123";

function config(overrides: Partial<GhlMigrationExportConfig> = {}): GhlMigrationExportConfig {
  return {
    exportId: "019b0000-0000-7000-8000-000000000999",
    locationId,
    maxRequests: 100,
    deadlineEpochMilliseconds: 100_000,
    pageSizes: {
      contacts: 1,
      opportunities: 1,
      conversations: 1,
      messages: 10,
    },
    ...overrides,
  };
}

function createSink(): {
  readonly sink: GhlMigrationExportSink;
  readonly pages: GhlMigrationExportPage[];
  readonly reports: GhlMigrationExportReport[];
} {
  const pages: GhlMigrationExportPage[] = [];
  const reports: GhlMigrationExportReport[] = [];
  return {
    pages,
    reports,
    sink: {
      writePage: async (page) => {
        pages.push(page);
      },
      finish: async (report) => {
        reports.push(report);
      },
    },
  };
}

function requestUrl(input: GhlReadOnlyRequest): URL {
  return new URL(input.path, "https://services.leadconnectorhq.com");
}

function emptyResponse(input: GhlReadOnlyRequest): Readonly<Record<string, unknown>> {
  const pathname = requestUrl(input).pathname;
  if (pathname === "/contacts/search") return { contacts: [], total: 0 };
  if (pathname.endsWith("/tags")) return { tags: [] };
  if (pathname.endsWith("/customFields")) return { customFields: [] };
  if (pathname === "/opportunities/pipelines") return { pipelines: [] };
  if (pathname === "/opportunities/search") return { opportunities: [], meta: { total: 0 } };
  if (pathname === "/conversations/search") return { conversations: [], total: 0 };
  if (pathname === "/conversations/messages/export") {
    return { messages: [], total: 0, nextCursor: null };
  }
  throw new Error("unexpected synthetic GHL request");
}

function fakeClock(): {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly waits: number[];
} {
  let currentTime = 1_000;
  const waits: number[] = [];
  return {
    waits,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  };
}

describe("GHL migration full export", () => {
  it("exports every stream with the documented cursor shapes and atomic JSONL pages", async () => {
    const requests: GhlReadOnlyRequest[] = [];
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        requests.push(input);
        const url = requestUrl(input);
        if (url.pathname === "/contacts/search") {
          const searchAfter = input.body?.searchAfter;
          return searchAfter === undefined
            ? {
                contacts: [
                  {
                    id: "contact_1",
                    locationId,
                    searchAfter: [10, "contact_1"],
                    name: "Private one",
                  },
                ],
                total: 2,
              }
            : {
                contacts: [
                  {
                    id: "contact_2",
                    locationId,
                    searchAfter: [20, "contact_2"],
                    name: "Private two",
                  },
                ],
                total: 2,
              };
        }
        if (url.pathname.endsWith("/tags")) {
          return { tags: [{ id: "tag_1", locationId, name: "Private tag" }] };
        }
        if (url.pathname.endsWith("/customFields")) {
          return { customFields: [{ id: "field_1", locationId, name: "Private field" }] };
        }
        if (url.pathname === "/opportunities/pipelines") {
          return { pipelines: [{ id: "pipeline_1", locationId, name: "Private pipeline" }] };
        }
        if (url.pathname === "/opportunities/search") {
          return url.searchParams.has("startAfter")
            ? {
                opportunities: [{ id: "opportunity_2", locationId }],
                meta: { total: 2, startAfter: 20, startAfterId: "opportunity_2" },
              }
            : {
                opportunities: [{ id: "opportunity_1", locationId }],
                meta: { total: 2, startAfter: 10, startAfterId: "opportunity_1" },
              };
        }
        if (url.pathname === "/conversations/search") {
          return url.searchParams.has("startAfterDate")
            ? { conversations: [{ id: "conversation_2", locationId, sort: [20] }], total: 2 }
            : { conversations: [{ id: "conversation_1", locationId, sort: [10] }], total: 2 };
        }
        if (url.pathname === "/conversations/messages/export") {
          if (url.searchParams.get("channel") === "Email") {
            return {
              messages: [{ id: "message_email_1", locationId, body: "Private email" }],
              total: 1,
              nextCursor: null,
            };
          }
          return url.searchParams.has("cursor")
            ? {
                messages: [{ id: "message_sms_2", locationId, body: "Private SMS two" }],
                total: 2,
                nextCursor: null,
              }
            : {
                messages: [{ id: "message_sms_1", locationId, body: "Private SMS one" }],
                total: 2,
                nextCursor: "message-cursor-1",
              };
        }
        throw new Error("unexpected synthetic GHL request");
      },
    };
    const captured = createSink();
    const clock = fakeClock();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const report = await exportGhlMigration(config(), client, captured.sink, clock);

      expect(report.status).toBe("COMPLETE");
      expect(report.requestsMade).toBe(12);
      expect(report.pagesWritten).toBe(12);
      expect(report.recordsWritten).toBe(12);
      expect(report.duplicatesSkipped).toBe(0);
      expect(report.streams).toHaveLength(8);
      expect(report.streams.every((stream) => stream.status === "COMPLETE")).toBe(true);
      expect(report.limitationCodes).toEqual([
        "NO_DESTINATION_WRITES",
        "RESTART_ONLY",
        "NO_SOURCE_SNAPSHOT",
        "ATTACHMENT_REFERENCES_ONLY",
        "MESSAGE_EXPORT_EXCLUSIONS",
      ]);
      expect(captured.reports).toEqual([report]);
      expect(captured.pages).toHaveLength(12);
      expect(captured.pages.every((page) => page.records.every((line) => JSON.parse(line)))).toBe(
        true,
      );
      expect(consoleLog).not.toHaveBeenCalled();

      const contactRequests = requests.filter((request) => request.resource === "CONTACTS");
      expect(contactRequests[0]?.body).toEqual({ locationId, page: 1, pageLimit: 1 });
      expect(contactRequests[1]?.body).toEqual({
        locationId,
        pageLimit: 1,
        searchAfter: [10, "contact_1"],
      });

      const secondOpportunity = requests
        .filter((request) => request.resource === "OPPORTUNITIES")
        .map(requestUrl)[1];
      expect(secondOpportunity?.searchParams.get("startAfter")).toBe("10");
      expect(secondOpportunity?.searchParams.get("startAfterId")).toBe("opportunity_1");

      const secondConversation = requests
        .filter((request) => request.resource === "CONVERSATIONS")
        .map(requestUrl)[1];
      expect(secondConversation?.searchParams.get("sort")).toBe("asc");
      expect(secondConversation?.searchParams.get("sortBy")).toBe("last_message_date");
      expect(secondConversation?.searchParams.get("startAfterDate")).toBe("10");

      const messageRequests = requests.filter((request) => request.resource === "MESSAGES");
      expect(messageRequests.map(requestUrl).map((url) => url.searchParams.get("channel"))).toEqual(
        [null, null, "Email"],
      );
      expect(messageRequests.map(requestUrl).map((url) => url.searchParams.get("sortBy"))).toEqual([
        null,
        null,
        null,
      ]);
      expect(
        messageRequests.map(requestUrl).map((url) => url.searchParams.get("sortOrder")),
      ).toEqual([null, null, null]);
      expect(messageRequests.map(requestUrl)[1]?.searchParams.get("cursor")).toBe(
        "message-cursor-1",
      );
      expect(clock.waits).toEqual(Array.from({ length: 11 }, () => 450));
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("deduplicates records and stops on a cursor that does not advance", async () => {
    let contactPage = 0;
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        if (input.resource !== "CONTACTS") return emptyResponse(input);
        contactPage += 1;
        if (contactPage === 1) {
          return {
            contacts: [
              { id: "contact_1", locationId, searchAfter: [10, "contact_1"] },
              { id: "contact_1", locationId, searchAfter: [10, "contact_1"] },
            ],
            total: 3,
          };
        }
        return {
          contacts: [{ id: "contact_2", locationId, searchAfter: [10, "contact_1"] }],
          total: 3,
        };
      },
    };
    const captured = createSink();
    const clock = fakeClock();

    const report = await exportGhlMigration(
      config({ pageSizes: { contacts: 2, opportunities: 1, conversations: 1, messages: 10 } }),
      client,
      captured.sink,
      clock,
    );

    expect(report.status).toBe("PARTIAL");
    expect(report.streams[0]).toMatchObject({
      stream: "CONTACTS",
      status: "PARTIAL",
      recordsWritten: 2,
      duplicatesSkipped: 1,
      partialReason: "CURSOR_NOT_ADVANCING",
    });
    expect(captured.pages.filter((page) => page.stream === "CONTACTS")).toHaveLength(2);
    expect(captured.pages[1]?.checkpoint).toMatchObject({
      complete: false,
      nextCursor: null,
      partialReason: "CURSOR_NOT_ADVANCING",
    });
  });

  it("marks total mismatches and cross-location records partial without persisting unsafe data", async () => {
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        if (input.resource === "CONTACTS") return { contacts: [], total: 2 };
        if (input.resource === "TAGS") {
          return { tags: [{ id: "tag_wrong_location", locationId: "another_location" }] };
        }
        return emptyResponse(input);
      },
    };
    const captured = createSink();
    const clock = fakeClock();

    const report = await exportGhlMigration(config(), client, captured.sink, clock);

    expect(report.streams[0]).toMatchObject({
      stream: "CONTACTS",
      status: "PARTIAL",
      partialReason: "TOTAL_MISMATCH",
      recordsWritten: 0,
    });
    expect(report.streams[1]).toMatchObject({
      stream: "TAGS",
      status: "PARTIAL",
      partialReason: "MALFORMED_RESPONSE",
      recordsWritten: 0,
    });
    expect(
      captured.pages
        .flatMap((page) => page.records)
        .some((line) => line.includes("another_location")),
    ).toBe(false);
  });

  it("returns explicit request-budget and deadline partial states", async () => {
    const requests: GhlReadOnlyRequest[] = [];
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        requests.push(input);
        return emptyResponse(input);
      },
    };
    const budgetSink = createSink();
    const budgetClock = fakeClock();
    const budgetReport = await exportGhlMigration(
      config({ maxRequests: 1 }),
      client,
      budgetSink.sink,
      budgetClock,
    );

    expect(budgetReport.requestsMade).toBe(1);
    expect(budgetReport.streams[0]?.status).toBe("COMPLETE");
    expect(
      budgetReport.streams.slice(1).every((stream) => stream.partialReason === "REQUEST_LIMIT"),
    ).toBe(true);

    let currentTime = 1_000;
    const deadlineSink = createSink();
    const deadlineReport = await exportGhlMigration(
      config({ deadlineEpochMilliseconds: 1_400 }),
      client,
      deadlineSink.sink,
      {
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      },
    );

    expect(deadlineReport.requestsMade).toBe(1);
    expect(deadlineReport.streams[0]?.status).toBe("COMPLETE");
    expect(
      deadlineReport.streams.slice(1).every((stream) => stream.partialReason === "DEADLINE"),
    ).toBe(true);
  });

  it("continues message cursors and reports changing source totals without discarding pages", async () => {
    let nonEmailPage = 0;
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        const url = requestUrl(input);
        if (input.resource !== "MESSAGES" || url.searchParams.get("channel") === "Email") {
          return emptyResponse(input);
        }
        nonEmailPage += 1;
        return nonEmailPage === 1
          ? {
              messages: [{ id: "message_1", locationId }],
              total: 1,
              nextCursor: "next-message-page",
            }
          : {
              messages: [{ id: "message_2", locationId }],
              total: 2,
              nextCursor: null,
            };
      },
    };
    const captured = createSink();
    const clock = fakeClock();

    const report = await exportGhlMigration(config(), client, captured.sink, clock);
    const messages = report.streams.find((stream) => stream.stream === "MESSAGES_NON_EMAIL");

    expect(messages).toMatchObject({
      status: "PARTIAL",
      partialReason: "TOTAL_CHANGED",
      recordsWritten: 2,
      sourceReportedTotal: 1,
      sourceReportedTotalMaximum: 2,
      sourceTotalChanged: true,
    });
    expect(captured.pages.filter((page) => page.stream === "MESSAGES_NON_EMAIL")).toHaveLength(2);
  });

  it("accepts a stable message-session cursor while pages contain new IDs", async () => {
    let page = 0;
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        if (input.resource !== "MESSAGES" || requestUrl(input).searchParams.has("channel")) {
          return emptyResponse(input);
        }
        page += 1;
        return {
          messages: [{ id: `synthetic_message_${page}`, locationId }],
          total: 3,
          nextCursor: page === 3 ? null : "same-opaque-session-cursor",
        };
      },
    };
    const captured = createSink();
    const report = await exportGhlMigration(config(), client, captured.sink, fakeClock());
    expect(report.streams.find((stream) => stream.stream === "MESSAGES_NON_EMAIL")).toMatchObject({
      status: "COMPLETE", recordsWritten: 3, requestsMade: 3,
    });
  });

  it("propagates sink failures instead of reporting an uncommitted page", async () => {
    const client: GhlMigrationExportClient = { request: async (input) => emptyResponse(input) };
    const sink: GhlMigrationExportSink = {
      writePage: async () => {
        throw new Error("synthetic durable sink failure");
      },
      finish: async () => undefined,
    };
    const clock = fakeClock();

    await expect(exportGhlMigration(config(), client, sink, clock)).rejects.toThrow(
      "synthetic durable sink failure",
    );
  });

  it("rejects page sizes or throttles that violate the source contract before any request", async () => {
    let called = false;
    const client: GhlMigrationExportClient = {
      request: async (input) => {
        called = true;
        return emptyResponse(input);
      },
    };
    const captured = createSink();
    const clock = fakeClock();

    await expect(
      exportGhlMigration(
        config({ pageSizes: { contacts: 1, opportunities: 1, conversations: 1, messages: 9 } }),
        client,
        captured.sink,
        clock,
      ),
    ).rejects.toThrow("invalid GHL migration export message page size");
    await expect(
      exportGhlMigration(
        config({ minimumRequestIntervalMilliseconds: 424 }),
        client,
        captured.sink,
        clock,
      ),
    ).rejects.toThrow("unsafe GHL migration export request interval");
    expect(called).toBe(false);
  });
});
