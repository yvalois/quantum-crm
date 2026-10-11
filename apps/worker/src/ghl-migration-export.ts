import type {
  GhlProbeResource,
  GhlReadOnlyClient,
  GhlReadOnlyRequest,
} from "./ghl-migration-probe-client.js";

// Pagination contracts: https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced
// https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity
// https://marketplace.gohighlevel.com/docs/ghl/conversations/search-conversation
// https://marketplace.gohighlevel.com/docs/ghl/conversations/export-messages-by-location

type JsonRecord = Readonly<Record<string, unknown>>;
type CursorScalar = string | number;

export type GhlMigrationExportStream =
  | "CONTACTS"
  | "TAGS"
  | "CUSTOM_FIELDS"
  | "PIPELINES"
  | "OPPORTUNITIES"
  | "CONVERSATIONS"
  | "MESSAGES_NON_EMAIL"
  | "MESSAGES_EMAIL";

export type GhlMigrationExportPartialReason =
  | "REQUEST_LIMIT"
  | "DEADLINE"
  | "SOURCE_REQUEST_FAILED"
  | "MALFORMED_RESPONSE"
  | "TOTAL_MISMATCH"
  | "TOTAL_CHANGED"
  | "MISSING_CURSOR"
  | "CURSOR_NOT_ADVANCING";

export type GhlMigrationExportCursor =
  | Readonly<{ readonly kind: "CONTACTS"; readonly searchAfter: readonly CursorScalar[] }>
  | Readonly<{
      readonly kind: "OPPORTUNITIES";
      readonly startAfter: CursorScalar;
      readonly startAfterId: string;
    }>
  | Readonly<{ readonly kind: "CONVERSATIONS"; readonly startAfterDate: CursorScalar }>
  | Readonly<{ readonly kind: "MESSAGES"; readonly cursor: string }>;

export interface GhlMigrationExportCheckpoint {
  readonly schemaVersion: "ghl-migration-export-checkpoint/v1";
  readonly exportId: string;
  readonly resource: GhlProbeResource;
  readonly stream: GhlMigrationExportStream;
  readonly page: number;
  readonly complete: boolean;
  readonly nextCursor: GhlMigrationExportCursor | null;
  readonly sourceRecordsRead: number;
  readonly recordsWritten: number;
  readonly duplicatesSkipped: number;
  /** First total observed from the source. */
  readonly sourceReportedTotal: number | null;
  readonly sourceReportedTotalMaximum: number | null;
  readonly sourceTotalChanged: boolean;
  readonly partialReason?: GhlMigrationExportPartialReason;
}

export interface GhlMigrationExportPage {
  readonly schemaVersion: "ghl-migration-export-page/v1";
  readonly exportId: string;
  readonly resource: GhlProbeResource;
  readonly stream: GhlMigrationExportStream;
  /** One compact JSON object per entry; the sink owns separators, encryption and durability. */
  readonly records: readonly string[];
  /** The sink must commit records and checkpoint atomically. */
  readonly checkpoint: GhlMigrationExportCheckpoint;
}

export interface GhlMigrationExportStreamReport {
  readonly resource: GhlProbeResource;
  readonly stream: GhlMigrationExportStream;
  readonly status: "COMPLETE" | "PARTIAL";
  readonly requestsMade: number;
  readonly pagesWritten: number;
  readonly sourceRecordsRead: number;
  readonly recordsWritten: number;
  readonly duplicatesSkipped: number;
  /** First total observed from the source. */
  readonly sourceReportedTotal: number | null;
  readonly sourceReportedTotalMaximum: number | null;
  readonly sourceTotalChanged: boolean;
  readonly partialReason?: GhlMigrationExportPartialReason;
}

export interface GhlMigrationExportReport {
  readonly schemaVersion: "ghl-migration-export-report/v1";
  readonly mode: "READ_ONLY";
  readonly status: "COMPLETE" | "PARTIAL";
  readonly generatedAt: string;
  readonly requestsMade: number;
  readonly pagesWritten: number;
  readonly recordsWritten: number;
  readonly duplicatesSkipped: number;
  readonly streams: readonly GhlMigrationExportStreamReport[];
  readonly limitationCodes: readonly [
    "NO_DESTINATION_WRITES",
    "RESTART_ONLY",
    "NO_SOURCE_SNAPSHOT",
    "ATTACHMENT_REFERENCES_ONLY",
    "MESSAGE_EXPORT_EXCLUSIONS",
  ];
}

export interface GhlMigrationExportSink {
  /** Persist the encrypted page and its checkpoint as one durable operation. */
  readonly writePage: (page: GhlMigrationExportPage) => Promise<void>;
  /** Persist the aggregate manifest only after every stream has reached a terminal state. */
  readonly finish: (report: GhlMigrationExportReport) => Promise<void>;
}

export interface GhlMigrationExportPageSizes {
  readonly contacts: number;
  readonly opportunities: number;
  readonly conversations: number;
  readonly messages: number;
}

export interface GhlMigrationExportConfig {
  readonly exportId: string;
  readonly locationId: string;
  readonly maxRequests: number;
  readonly deadlineEpochMilliseconds: number;
  readonly pageSizes?: Partial<GhlMigrationExportPageSizes>;
  /** Defaults to 450 ms and may not be lower than 425 ms (below 25 requests per 10 s). */
  readonly minimumRequestIntervalMilliseconds?: number;
}

export interface GhlMigrationExportRuntime {
  readonly now?: () => number;
  readonly sleep?: (durationMilliseconds: number) => Promise<void>;
}

/** Each call must perform at most one upstream attempt; throttling is per request invocation. */
export type GhlMigrationExportClient = Pick<GhlReadOnlyClient, "request">;

interface NormalizedConfig {
  readonly exportId: string;
  readonly locationId: string;
  readonly maxRequests: number;
  readonly deadlineEpochMilliseconds: number;
  readonly minimumRequestIntervalMilliseconds: number;
  readonly pageSizes: GhlMigrationExportPageSizes;
}

interface ExportContext {
  readonly config: NormalizedConfig;
  readonly client: GhlMigrationExportClient;
  readonly sink: GhlMigrationExportSink;
  readonly now: () => number;
  readonly sleep: (durationMilliseconds: number) => Promise<void>;
  readonly seenIdsByResource: Map<GhlProbeResource, Set<string>>;
  requestsMade: number;
  lastRequestStartedAt: number | null;
}

interface StreamState {
  readonly resource: GhlProbeResource;
  readonly stream: GhlMigrationExportStream;
  readonly seenIds: Set<string>;
  readonly seenCursors: Set<string>;
  requestsMade: number;
  pagesWritten: number;
  sourceRecordsRead: number;
  recordsWritten: number;
  duplicatesSkipped: number;
  sourceReportedTotal: number | null;
  sourceReportedTotalMaximum: number | null;
  sourceTotalChanged: boolean;
}

interface CollectionResult {
  readonly valid: boolean;
  readonly records: readonly JsonRecord[];
}

interface ProcessedRecords {
  readonly lines: readonly string[];
  readonly malformed: boolean;
  readonly newSourceIds: number;
}

type RequestResult =
  | Readonly<{ readonly ok: true; readonly body: JsonRecord }>
  | Readonly<{ readonly ok: false; readonly reason: GhlMigrationExportPartialReason }>;

const defaultPageSizes: GhlMigrationExportPageSizes = Object.freeze({
  contacts: 100,
  opportunities: 100,
  conversations: 100,
  messages: 250,
});
const defaultRequestIntervalMilliseconds = 450;
const minimumSafeRequestIntervalMilliseconds = 425;

function delay(durationMilliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMilliseconds));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedRecord(value: JsonRecord, key: string): JsonRecord | undefined {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : undefined;
}

function collection(body: JsonRecord, keys: readonly string[]): CollectionResult {
  const containers = [body, nestedRecord(body, "data")].filter(
    (value): value is JsonRecord => value !== undefined,
  );
  for (const container of containers) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
      const value = container[key];
      if (!Array.isArray(value) || !value.every(isRecord)) {
        return Object.freeze({ valid: false, records: Object.freeze([]) });
      }
      return Object.freeze({ valid: true, records: Object.freeze([...value]) });
    }
  }
  return Object.freeze({ valid: false, records: Object.freeze([]) });
}

function reportedTotal(body: JsonRecord): number | null {
  const candidates = [body, nestedRecord(body, "meta"), nestedRecord(body, "data")].filter(
    (value): value is JsonRecord => value !== undefined,
  );
  for (const candidate of candidates) {
    for (const key of ["total", "totalCount", "count"]) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
      if (typeof value === "string" && /^\d+$/u.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) return parsed;
      }
    }
  }
  return null;
}

function cursorScalar(value: unknown): CursorScalar | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function contactCursor(record: JsonRecord | undefined): GhlMigrationExportCursor | null {
  const candidate = record?.searchAfter;
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  const values = candidate.map(cursorScalar);
  if (values.some((value) => value === undefined)) return null;
  return Object.freeze({
    kind: "CONTACTS",
    searchAfter: Object.freeze(values as CursorScalar[]),
  });
}

function opportunityCursor(body: JsonRecord): GhlMigrationExportCursor | null {
  const meta = nestedRecord(body, "meta");
  const startAfter = cursorScalar(meta?.startAfter);
  const startAfterId = meta?.startAfterId;
  if (startAfter === undefined || typeof startAfterId !== "string" || startAfterId.length === 0) {
    return null;
  }
  return Object.freeze({ kind: "OPPORTUNITIES", startAfter, startAfterId });
}

function conversationCursor(record: JsonRecord | undefined): GhlMigrationExportCursor | null {
  const sort = record?.sort;
  const sortedValue = Array.isArray(sort) && sort.length > 0 ? cursorScalar(sort[0]) : undefined;
  const fallback = cursorScalar(record?.lastMessageDate);
  const startAfterDate = sortedValue ?? fallback;
  return startAfterDate === undefined
    ? null
    : Object.freeze({ kind: "CONVERSATIONS", startAfterDate });
}

function messageCursor(body: JsonRecord): GhlMigrationExportCursor | null {
  const candidate = body.nextCursor ?? nestedRecord(body, "data")?.nextCursor;
  return typeof candidate === "string" && candidate.length > 0
    ? Object.freeze({ kind: "MESSAGES", cursor: candidate })
    : null;
}

function sourceId(record: JsonRecord): string | null {
  const candidate = record.id;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function jsonLine(
  resource: GhlProbeResource,
  stream: GhlMigrationExportStream,
  id: string,
  record: JsonRecord,
): string | null {
  try {
    const serialized = JSON.stringify({
      schemaVersion: "ghl-migration-export-record/v1",
      resource,
      stream,
      sourceId: id,
      record,
    });
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function processRecords(
  context: ExportContext,
  state: StreamState,
  records: readonly JsonRecord[],
): ProcessedRecords {
  const lines: string[] = [];
  let malformed = false;
  let newSourceIds = 0;
  const resourceIds = context.seenIdsByResource.get(state.resource);
  if (!resourceIds) throw new Error("missing GHL export resource deduplication set");
  for (const record of records) {
    state.sourceRecordsRead += 1;
    if (
      Object.prototype.hasOwnProperty.call(record, "locationId") &&
      record.locationId !== context.config.locationId
    ) {
      malformed = true;
      continue;
    }
    const id = sourceId(record);
    if (id === null) {
      malformed = true;
      continue;
    }
    if (state.seenIds.has(id)) {
      state.duplicatesSkipped += 1;
      continue;
    }
    state.seenIds.add(id);
    newSourceIds += 1;
    if (resourceIds.has(id)) {
      state.duplicatesSkipped += 1;
      continue;
    }
    const line = jsonLine(state.resource, state.stream, id, record);
    if (line === null) {
      malformed = true;
      continue;
    }
    resourceIds.add(id);
    lines.push(line);
  }
  state.recordsWritten += lines.length;
  return Object.freeze({ lines: Object.freeze(lines), malformed, newSourceIds });
}

function positiveInteger(name: string, value: number, maximum?: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || (maximum !== undefined && value > maximum)) {
    throw new Error(`invalid GHL migration export ${name}`);
  }
  return value;
}

function normalizeConfig(config: GhlMigrationExportConfig, now: number): NormalizedConfig {
  if (config.exportId.trim().length === 0) throw new Error("invalid GHL migration export id");
  if (config.locationId.trim().length === 0) throw new Error("invalid GHL migration location id");
  if (
    !Number.isSafeInteger(config.deadlineEpochMilliseconds) ||
    config.deadlineEpochMilliseconds <= now
  ) {
    throw new Error("invalid GHL migration export deadline");
  }
  const minimumRequestIntervalMilliseconds =
    config.minimumRequestIntervalMilliseconds ?? defaultRequestIntervalMilliseconds;
  if (
    !Number.isSafeInteger(minimumRequestIntervalMilliseconds) ||
    minimumRequestIntervalMilliseconds < minimumSafeRequestIntervalMilliseconds
  ) {
    throw new Error("unsafe GHL migration export request interval");
  }
  return Object.freeze({
    exportId: config.exportId,
    locationId: config.locationId,
    maxRequests: positiveInteger("request limit", config.maxRequests),
    deadlineEpochMilliseconds: config.deadlineEpochMilliseconds,
    minimumRequestIntervalMilliseconds,
    pageSizes: Object.freeze({
      contacts: positiveInteger(
        "contact page size",
        config.pageSizes?.contacts ?? defaultPageSizes.contacts,
        100,
      ),
      opportunities: positiveInteger(
        "opportunity page size",
        config.pageSizes?.opportunities ?? defaultPageSizes.opportunities,
        100,
      ),
      conversations: positiveInteger(
        "conversation page size",
        config.pageSizes?.conversations ?? defaultPageSizes.conversations,
        100,
      ),
      messages: (() => {
        const value = positiveInteger(
          "message page size",
          config.pageSizes?.messages ?? defaultPageSizes.messages,
          1_000,
        );
        if (value < 10) throw new Error("invalid GHL migration export message page size");
        return value;
      })(),
    }),
  });
}

function queryPath(path: string, values: readonly (readonly [string, string | number])[]): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of values) parameters.set(key, String(value));
  return `${path}?${parameters.toString()}`;
}

async function requestSource(
  context: ExportContext,
  state: StreamState,
  request: GhlReadOnlyRequest,
): Promise<RequestResult> {
  if (context.requestsMade >= context.config.maxRequests) {
    return Object.freeze({ ok: false, reason: "REQUEST_LIMIT" });
  }
  let currentTime = context.now();
  if (currentTime >= context.config.deadlineEpochMilliseconds) {
    return Object.freeze({ ok: false, reason: "DEADLINE" });
  }
  if (context.lastRequestStartedAt !== null) {
    const waitFor = Math.max(
      0,
      context.lastRequestStartedAt +
        context.config.minimumRequestIntervalMilliseconds -
        currentTime,
    );
    if (currentTime + waitFor >= context.config.deadlineEpochMilliseconds) {
      return Object.freeze({ ok: false, reason: "DEADLINE" });
    }
    if (waitFor > 0) await context.sleep(waitFor);
    currentTime = context.now();
    if (currentTime >= context.config.deadlineEpochMilliseconds) {
      return Object.freeze({ ok: false, reason: "DEADLINE" });
    }
  }
  context.lastRequestStartedAt = currentTime;
  context.requestsMade += 1;
  state.requestsMade += 1;
  try {
    return Object.freeze({ ok: true, body: await context.client.request(request) });
  } catch {
    return Object.freeze({ ok: false, reason: "SOURCE_REQUEST_FAILED" });
  }
}

function createState(resource: GhlProbeResource, stream: GhlMigrationExportStream): StreamState {
  return {
    resource,
    stream,
    seenIds: new Set<string>(),
    seenCursors: new Set<string>(),
    requestsMade: 0,
    pagesWritten: 0,
    sourceRecordsRead: 0,
    recordsWritten: 0,
    duplicatesSkipped: 0,
    sourceReportedTotal: null,
    sourceReportedTotalMaximum: null,
    sourceTotalChanged: false,
  };
}

function terminalReport(
  state: StreamState,
  status: "COMPLETE" | "PARTIAL",
  partialReason?: GhlMigrationExportPartialReason,
): GhlMigrationExportStreamReport {
  return Object.freeze({
    resource: state.resource,
    stream: state.stream,
    status,
    requestsMade: state.requestsMade,
    pagesWritten: state.pagesWritten,
    sourceRecordsRead: state.sourceRecordsRead,
    recordsWritten: state.recordsWritten,
    duplicatesSkipped: state.duplicatesSkipped,
    sourceReportedTotal: state.sourceReportedTotal,
    sourceReportedTotalMaximum: state.sourceReportedTotalMaximum,
    sourceTotalChanged: state.sourceTotalChanged,
    ...(partialReason ? { partialReason } : {}),
  });
}

function checkpoint(
  context: ExportContext,
  state: StreamState,
  complete: boolean,
  nextCursor: GhlMigrationExportCursor | null,
  partialReason?: GhlMigrationExportPartialReason,
): GhlMigrationExportCheckpoint {
  return Object.freeze({
    schemaVersion: "ghl-migration-export-checkpoint/v1",
    exportId: context.config.exportId,
    resource: state.resource,
    stream: state.stream,
    page: state.pagesWritten + 1,
    complete,
    nextCursor,
    sourceRecordsRead: state.sourceRecordsRead,
    recordsWritten: state.recordsWritten,
    duplicatesSkipped: state.duplicatesSkipped,
    sourceReportedTotal: state.sourceReportedTotal,
    sourceReportedTotalMaximum: state.sourceReportedTotalMaximum,
    sourceTotalChanged: state.sourceTotalChanged,
    ...(partialReason ? { partialReason } : {}),
  });
}

async function writePage(
  context: ExportContext,
  state: StreamState,
  lines: readonly string[],
  complete: boolean,
  nextCursor: GhlMigrationExportCursor | null,
  partialReason?: GhlMigrationExportPartialReason,
): Promise<void> {
  await context.sink.writePage(
    Object.freeze({
      schemaVersion: "ghl-migration-export-page/v1",
      exportId: context.config.exportId,
      resource: state.resource,
      stream: state.stream,
      records: Object.freeze([...lines]),
      checkpoint: checkpoint(context, state, complete, nextCursor, partialReason),
    }),
  );
  state.pagesWritten += 1;
}

function updateTotal(state: StreamState, body: JsonRecord): void {
  const total = reportedTotal(body);
  if (total === null) return;
  if (state.sourceReportedTotal === null) {
    state.sourceReportedTotal = total;
    state.sourceReportedTotalMaximum = total;
    return;
  }
  if (total !== state.sourceReportedTotal) state.sourceTotalChanged = true;
  state.sourceReportedTotalMaximum = Math.max(state.sourceReportedTotalMaximum ?? total, total);
}

function cursorKey(cursor: GhlMigrationExportCursor): string {
  return JSON.stringify(cursor);
}

function cursorAdvances(state: StreamState, cursor: GhlMigrationExportCursor): boolean {
  const key = cursorKey(cursor);
  if (state.seenCursors.has(key)) return false;
  state.seenCursors.add(key);
  return true;
}

function totalRelation(state: StreamState): "UNKNOWN" | "UNDER" | "EQUAL" | "OVER" {
  if (state.sourceReportedTotalMaximum === null) return "UNKNOWN";
  if (state.seenIds.size < state.sourceReportedTotalMaximum) return "UNDER";
  if (state.seenIds.size > state.sourceReportedTotalMaximum) return "OVER";
  return "EQUAL";
}

async function totalMismatchPage(
  context: ExportContext,
  state: StreamState,
  lines: readonly string[],
): Promise<GhlMigrationExportStreamReport> {
  await writePage(context, state, lines, false, null, "TOTAL_MISMATCH");
  return terminalReport(state, "PARTIAL", "TOTAL_MISMATCH");
}

async function totalChangedPage(
  context: ExportContext,
  state: StreamState,
  lines: readonly string[],
): Promise<GhlMigrationExportStreamReport> {
  await writePage(context, state, lines, false, null, "TOTAL_CHANGED");
  return terminalReport(state, "PARTIAL", "TOTAL_CHANGED");
}

async function malformedPage(
  context: ExportContext,
  state: StreamState,
  lines: readonly string[] = Object.freeze([]),
): Promise<GhlMigrationExportStreamReport> {
  await writePage(context, state, lines, false, null, "MALFORMED_RESPONSE");
  return terminalReport(state, "PARTIAL", "MALFORMED_RESPONSE");
}

async function runContacts(context: ExportContext): Promise<GhlMigrationExportStreamReport> {
  const state = createState("CONTACTS", "CONTACTS");
  let cursor: GhlMigrationExportCursor | null = null;
  while (true) {
    const body: Record<string, unknown> = {
      locationId: context.config.locationId,
      pageLimit: context.config.pageSizes.contacts,
      ...(cursor?.kind === "CONTACTS" ? { searchAfter: cursor.searchAfter } : { page: 1 }),
    };
    const response = await requestSource(context, state, {
      resource: "CONTACTS",
      method: "POST",
      path: "/contacts/search",
      body,
    });
    if (!response.ok) return terminalReport(state, "PARTIAL", response.reason);
    const entries = collection(response.body, ["contacts"]);
    if (!entries.valid) return malformedPage(context, state);
    updateTotal(state, response.body);
    const processed = processRecords(context, state, entries.records);
    if (processed.malformed) return malformedPage(context, state, processed.lines);
    const relation = totalRelation(state);
    if (entries.records.length === 0 && state.sourceTotalChanged) {
      return totalChangedPage(context, state, processed.lines);
    }
    if (!state.sourceTotalChanged && relation === "OVER") {
      return totalMismatchPage(context, state, processed.lines);
    }
    if (!state.sourceTotalChanged && entries.records.length === 0 && relation === "UNDER") {
      return totalMismatchPage(context, state, processed.lines);
    }
    const complete =
      entries.records.length === 0 ||
      (!state.sourceTotalChanged && relation === "EQUAL") ||
      (state.sourceReportedTotal === null &&
        entries.records.length < context.config.pageSizes.contacts);
    if (complete) {
      await writePage(context, state, processed.lines, true, null);
      return terminalReport(state, "COMPLETE");
    }
    const nextCursor = contactCursor(entries.records.at(-1));
    if (nextCursor === null) {
      await writePage(context, state, processed.lines, false, null, "MISSING_CURSOR");
      return terminalReport(state, "PARTIAL", "MISSING_CURSOR");
    }
    if (processed.newSourceIds === 0 || !cursorAdvances(state, nextCursor)) {
      await writePage(context, state, processed.lines, false, null, "CURSOR_NOT_ADVANCING");
      return terminalReport(state, "PARTIAL", "CURSOR_NOT_ADVANCING");
    }
    await writePage(context, state, processed.lines, false, nextCursor);
    cursor = nextCursor;
  }
}

async function runUnpaged(
  context: ExportContext,
  resource: "TAGS" | "CUSTOM_FIELDS" | "PIPELINES",
  stream: "TAGS" | "CUSTOM_FIELDS" | "PIPELINES",
  path: string,
  keys: readonly string[],
): Promise<GhlMigrationExportStreamReport> {
  const state = createState(resource, stream);
  const response = await requestSource(context, state, { resource, method: "GET", path });
  if (!response.ok) return terminalReport(state, "PARTIAL", response.reason);
  const entries = collection(response.body, keys);
  if (!entries.valid) return malformedPage(context, state);
  updateTotal(state, response.body);
  if (state.sourceReportedTotal === null) {
    state.sourceReportedTotal = entries.records.length;
    state.sourceReportedTotalMaximum = entries.records.length;
  }
  const processed = processRecords(context, state, entries.records);
  if (processed.malformed) return malformedPage(context, state, processed.lines);
  if (totalRelation(state) !== "EQUAL") {
    return totalMismatchPage(context, state, processed.lines);
  }
  await writePage(context, state, processed.lines, true, null);
  return terminalReport(state, "COMPLETE");
}

async function runOpportunities(context: ExportContext): Promise<GhlMigrationExportStreamReport> {
  const state = createState("OPPORTUNITIES", "OPPORTUNITIES");
  let cursor: GhlMigrationExportCursor | null = null;
  while (true) {
    const values: Array<readonly [string, string | number]> = [
      ["locationId", context.config.locationId],
      ["status", "all"],
      ["order", "added_asc"],
      ["limit", context.config.pageSizes.opportunities],
    ];
    if (cursor?.kind === "OPPORTUNITIES") {
      values.push(["startAfter", cursor.startAfter], ["startAfterId", cursor.startAfterId]);
    }
    const response = await requestSource(context, state, {
      resource: "OPPORTUNITIES",
      method: "GET",
      path: queryPath("/opportunities/search", values),
    });
    if (!response.ok) return terminalReport(state, "PARTIAL", response.reason);
    const entries = collection(response.body, ["opportunities"]);
    if (!entries.valid) return malformedPage(context, state);
    updateTotal(state, response.body);
    const processed = processRecords(context, state, entries.records);
    if (processed.malformed) return malformedPage(context, state, processed.lines);
    const relation = totalRelation(state);
    if (entries.records.length === 0 && state.sourceTotalChanged) {
      return totalChangedPage(context, state, processed.lines);
    }
    if (
      !state.sourceTotalChanged &&
      (relation === "OVER" || (entries.records.length === 0 && relation === "UNDER"))
    ) {
      return totalMismatchPage(context, state, processed.lines);
    }
    if (entries.records.length === 0 || (!state.sourceTotalChanged && relation === "EQUAL")) {
      await writePage(context, state, processed.lines, true, null);
      return terminalReport(state, "COMPLETE");
    }
    const nextCursor = opportunityCursor(response.body);
    if (
      nextCursor === null &&
      state.sourceReportedTotal === null &&
      entries.records.length < context.config.pageSizes.opportunities
    ) {
      await writePage(context, state, processed.lines, true, null);
      return terminalReport(state, "COMPLETE");
    }
    if (nextCursor === null) {
      await writePage(context, state, processed.lines, false, null, "MISSING_CURSOR");
      return terminalReport(state, "PARTIAL", "MISSING_CURSOR");
    }
    if (processed.newSourceIds === 0 || !cursorAdvances(state, nextCursor)) {
      await writePage(context, state, processed.lines, false, null, "CURSOR_NOT_ADVANCING");
      return terminalReport(state, "PARTIAL", "CURSOR_NOT_ADVANCING");
    }
    await writePage(context, state, processed.lines, false, nextCursor);
    cursor = nextCursor;
  }
}

async function runConversations(context: ExportContext): Promise<GhlMigrationExportStreamReport> {
  const state = createState("CONVERSATIONS", "CONVERSATIONS");
  let cursor: GhlMigrationExportCursor | null = null;
  while (true) {
    const values: Array<readonly [string, string | number]> = [
      ["locationId", context.config.locationId],
      ["limit", context.config.pageSizes.conversations],
      ["sort", "asc"],
      ["sortBy", "last_message_date"],
    ];
    if (cursor?.kind === "CONVERSATIONS") {
      values.push(["startAfterDate", cursor.startAfterDate]);
    }
    const response = await requestSource(context, state, {
      resource: "CONVERSATIONS",
      method: "GET",
      path: queryPath("/conversations/search", values),
    });
    if (!response.ok) return terminalReport(state, "PARTIAL", response.reason);
    const entries = collection(response.body, ["conversations"]);
    if (!entries.valid) return malformedPage(context, state);
    updateTotal(state, response.body);
    const processed = processRecords(context, state, entries.records);
    if (processed.malformed) return malformedPage(context, state, processed.lines);
    const relation = totalRelation(state);
    if (entries.records.length === 0 && state.sourceTotalChanged) {
      return totalChangedPage(context, state, processed.lines);
    }
    if (
      !state.sourceTotalChanged &&
      (relation === "OVER" || (entries.records.length === 0 && relation === "UNDER"))
    ) {
      return totalMismatchPage(context, state, processed.lines);
    }
    if (
      entries.records.length === 0 ||
      (!state.sourceTotalChanged && relation === "EQUAL") ||
      (state.sourceReportedTotal === null &&
        entries.records.length < context.config.pageSizes.conversations)
    ) {
      await writePage(context, state, processed.lines, true, null);
      return terminalReport(state, "COMPLETE");
    }
    const nextCursor = conversationCursor(entries.records.at(-1));
    if (nextCursor === null) {
      await writePage(context, state, processed.lines, false, null, "MISSING_CURSOR");
      return terminalReport(state, "PARTIAL", "MISSING_CURSOR");
    }
    if (processed.newSourceIds === 0 || !cursorAdvances(state, nextCursor)) {
      await writePage(context, state, processed.lines, false, null, "CURSOR_NOT_ADVANCING");
      return terminalReport(state, "PARTIAL", "CURSOR_NOT_ADVANCING");
    }
    await writePage(context, state, processed.lines, false, nextCursor);
    cursor = nextCursor;
  }
}

async function runMessages(
  context: ExportContext,
  stream: "MESSAGES_NON_EMAIL" | "MESSAGES_EMAIL",
): Promise<GhlMigrationExportStreamReport> {
  const state = createState("MESSAGES", stream);
  let cursor: GhlMigrationExportCursor | null = null;
  while (true) {
    const values: Array<readonly [string, string | number]> = [
      ["locationId", context.config.locationId],
      ["limit", context.config.pageSizes.messages],
    ];
    if (stream === "MESSAGES_EMAIL") values.push(["channel", "Email"]);
    if (cursor?.kind === "MESSAGES") values.push(["cursor", cursor.cursor]);
    const response = await requestSource(context, state, {
      resource: "MESSAGES",
      method: "GET",
      path: queryPath("/conversations/messages/export", values),
    });
    if (!response.ok) return terminalReport(state, "PARTIAL", response.reason);
    const entries = collection(response.body, ["messages"]);
    if (!entries.valid) return malformedPage(context, state);
    updateTotal(state, response.body);
    const processed = processRecords(context, state, entries.records);
    if (processed.malformed) return malformedPage(context, state, processed.lines);
    const nextCursor = messageCursor(response.body);
    const relation = totalRelation(state);
    if (nextCursor === null) {
      if (state.sourceTotalChanged) return totalChangedPage(context, state, processed.lines);
      if (relation === "UNDER" || relation === "OVER") {
        return totalMismatchPage(context, state, processed.lines);
      }
      await writePage(context, state, processed.lines, true, null);
      return terminalReport(state, "COMPLETE");
    }
    // GHL can reuse the same opaque export-session cursor while its records advance.
    // Detect an actual stall by source IDs, not by the token changing text.
    if (processed.newSourceIds === 0) {
      await writePage(context, state, processed.lines, false, null, "CURSOR_NOT_ADVANCING");
      return terminalReport(state, "PARTIAL", "CURSOR_NOT_ADVANCING");
    }
    await writePage(context, state, processed.lines, false, nextCursor);
    cursor = nextCursor;
  }
}

function aggregateReport(
  context: ExportContext,
  streams: readonly GhlMigrationExportStreamReport[],
): GhlMigrationExportReport {
  return Object.freeze({
    schemaVersion: "ghl-migration-export-report/v1",
    mode: "READ_ONLY",
    status: streams.every((stream) => stream.status === "COMPLETE") ? "COMPLETE" : "PARTIAL",
    generatedAt: new Date(context.now()).toISOString(),
    requestsMade: context.requestsMade,
    pagesWritten: streams.reduce((sum, stream) => sum + stream.pagesWritten, 0),
    recordsWritten: streams.reduce((sum, stream) => sum + stream.recordsWritten, 0),
    duplicatesSkipped: streams.reduce((sum, stream) => sum + stream.duplicatesSkipped, 0),
    streams: Object.freeze([...streams]),
    limitationCodes: Object.freeze([
      "NO_DESTINATION_WRITES",
      "RESTART_ONLY",
      "NO_SOURCE_SNAPSHOT",
      "ATTACHMENT_REFERENCES_ONLY",
      "MESSAGE_EXPORT_EXCLUSIONS",
    ] as const),
  });
}

export async function exportGhlMigration(
  config: GhlMigrationExportConfig,
  client: GhlMigrationExportClient,
  sink: GhlMigrationExportSink,
  runtime: GhlMigrationExportRuntime = {},
): Promise<GhlMigrationExportReport> {
  const now = runtime.now ?? Date.now;
  const normalizedConfig = normalizeConfig(config, now());
  const resources: readonly GhlProbeResource[] = Object.freeze([
    "CONTACTS",
    "TAGS",
    "CUSTOM_FIELDS",
    "PIPELINES",
    "OPPORTUNITIES",
    "CONVERSATIONS",
    "MESSAGES",
  ]);
  const context: ExportContext = {
    config: normalizedConfig,
    client,
    sink,
    now,
    sleep: runtime.sleep ?? delay,
    seenIdsByResource: new Map(resources.map((resource) => [resource, new Set<string>()] as const)),
    requestsMade: 0,
    lastRequestStartedAt: null,
  };
  const locationPath = encodeURIComponent(normalizedConfig.locationId);
  const streams: GhlMigrationExportStreamReport[] = [];
  streams.push(await runContacts(context));
  streams.push(
    await runUnpaged(context, "TAGS", "TAGS", `/locations/${locationPath}/tags`, ["tags"]),
  );
  streams.push(
    await runUnpaged(
      context,
      "CUSTOM_FIELDS",
      "CUSTOM_FIELDS",
      `/locations/${locationPath}/customFields?model=all`,
      ["customFields", "fields"],
    ),
  );
  streams.push(
    await runUnpaged(
      context,
      "PIPELINES",
      "PIPELINES",
      queryPath("/opportunities/pipelines", [["locationId", normalizedConfig.locationId]]),
      ["pipelines"],
    ),
  );
  streams.push(await runOpportunities(context));
  streams.push(await runConversations(context));
  streams.push(await runMessages(context, "MESSAGES_NON_EMAIL"));
  streams.push(await runMessages(context, "MESSAGES_EMAIL"));
  const report = aggregateReport(context, streams);
  await sink.finish(report);
  return report;
}
