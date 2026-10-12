import { Buffer } from "node:buffer";
import {
  ConversationValidationError,
  type UnifiedInboxRecord,
  type UnifiedInboxRepository,
} from "@quantum-crm/domain";
import {
  conversationAccess,
  conversationFromRow,
  conversationSelection,
  type ConversationRow,
} from "./conversation-postgres-repository.js";
import {
  historicalConversationAccess,
  historicalThreadChannelSelection,
  historicalThreadFromRow,
  threadSelection,
  type ThreadRow,
} from "./historical-conversation-postgres-repository.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

type InboxChannel = NonNullable<Parameters<UnifiedInboxRepository["list"]>[1]["channel"]>;
const nativeChannels: ReadonlySet<InboxChannel> = new Set(["EMAIL", "WHATSAPP", "WEBCHAT", "SMS"]);
const historicalChannelAliases = {
  EMAIL: ["EMAIL"],
  WHATSAPP: ["WHATSAPP", "WHATS_APP"],
  SMS: ["SMS", "MMS"],
  WEBCHAT: ["WEBCHAT", "WEB_CHAT", "LIVECHAT", "LIVE_CHAT"],
  INSTAGRAM: ["INSTAGRAM"],
  FACEBOOK: ["FB", "FACEBOOK", "MESSENGER", "FACEBOOK_MESSENGER"],
  TIKTOK: ["TIKTOK"],
  GOOGLE: ["GMB", "GOOGLE_BUSINESS"],
  CALL: ["CALL", "PHONE_CALL"],
  FORM: ["FORM_SUBMISSION"],
} satisfies Record<Exclude<InboxChannel, "UNKNOWN">, readonly string[]>;
const knownHistoricalChannels = Object.values(historicalChannelAliases).flat();

interface InboxRow {
  readonly id: string;
  readonly source_rank: 0 | 1;
  readonly activity_at: string;
  readonly quantum: ConversationRow | null;
  readonly ghl: ThreadRow | null;
}
interface Cursor {
  readonly v: 1;
  readonly at: string;
  readonly source: 0 | 1;
  readonly id: string;
}
function decode(value: string): Cursor {
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      data.v !== 1 ||
      (data.source !== 0 && data.source !== 1) ||
      typeof data.at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(data.at) ||
      !Number.isFinite(Date.parse(data.at)) ||
      typeof data.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(data.id)
    )
      throw new Error();
    return data as Cursor;
  } catch {
    throw new ConversationValidationError();
  }
}

/** One profile-bound SQL statement orders both stores before hydrating the bounded page. */
export function createUnifiedInboxPostgresRepository(pool: PostgresPool): UnifiedInboxRepository {
  return Object.freeze<UnifiedInboxRepository>({
    list: async (actor, query) => {
      try {
        const params: unknown[] = [];
        const bind = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        const nativeAccess = conversationAccess(actor, params.length + 1);
        params.push(...nativeAccess.params);
        const historicalAccess = historicalConversationAccess(actor, params.length + 1);
        params.push(...historicalAccess.params);
        const native = [nativeAccess.sql];
        const historical = [historicalAccess.sql];
        if (query.contactId) {
          const contact = bind(query.contactId);
          native.push(`conversation.contact_id = ${contact}::uuid`);
          historical.push(`thread.contact_id = ${contact}::uuid`);
        }
        if (query.contactState === "LINKED") historical.push("thread.contact_id IS NOT NULL");
        if (query.contactState === "UNLINKED") {
          native.push("FALSE");
          historical.push("thread.contact_id IS NULL");
        }
        if (query.query) {
          const search = bind(`%${query.query.replace(/[\\%_]/gu, "\\$&")}%`);
          native.push(`(conversation.subject ILIKE ${search}
            OR conversation.last_message_preview ILIKE ${search}
            OR EXISTS (SELECT 1 FROM conversations.messages searched
              WHERE searched.conversation_id = conversation.id AND searched.body ILIKE ${search}))`);
          historical.push(`(thread.subject ILIKE ${search} OR thread.source_external_id ILIKE ${search}
            OR EXISTS (SELECT 1 FROM conversations.historical_messages searched
              WHERE searched.thread_id = thread.id AND searched.body ILIKE ${search}))`);
        }
        if (query.channel) {
          native.push(
            nativeChannels.has(query.channel)
              ? `conversation.channel = ${bind(query.channel.toLowerCase())}`
              : "FALSE",
          );
          // Classify the same inferred raw channel returned to the inbox for display.
          const channel = `regexp_replace(upper(btrim(${historicalThreadChannelSelection})), '^TYPE_', '')`;
          historical.push(
            query.channel === "UNKNOWN"
              ? `NOT COALESCE(${channel} = ANY(${bind(knownHistoricalChannels)}::text[]), FALSE)`
              : `${channel} = ANY(${bind(historicalChannelAliases[query.channel])}::text[])`,
          );
        }
        if (query.status) {
          native.push(`conversation.status = ${bind(query.status.toLowerCase())}`);
          // Provider read/unread values are not Quantum workflow statuses.
          historical.push(`upper(btrim(thread.raw_status)) = ${bind(query.status)}`);
        }
        if (query.attentionMode) {
          native.push(`conversation.attention_mode = ${bind(query.attentionMode.toLowerCase())}`);
          historical.push("FALSE");
        }
        if (query.unassigned === true) {
          native.push("conversation.assignee_member_id IS NULL");
          historical.push("thread.assignee_member_id IS NULL");
        }
        const nativeActivity = "COALESCE(conversation.last_message_at, conversation.created_at)";
        const historicalActivity =
          "COALESCE(thread.last_message_at, thread.source_updated_at, thread.source_created_at, thread.imported_at)";
        if (query.cursor) {
          const cursor = decode(query.cursor);
          const boundary = `(${bind(cursor.at)}::timestamptz, ${bind(cursor.source)}::integer, ${bind(cursor.id)}::uuid)`;
          native.push(`(${nativeActivity}, 1, conversation.id) < ${boundary}`);
          historical.push(`(${historicalActivity}, 0, thread.id) < ${boundary}`);
        }
        const limit = bind(query.limit + 1);
        const result = (await pool.query(
          `WITH page AS MATERIALIZED (
            SELECT * FROM (
              (SELECT conversation.id, 1 AS source_rank, ${nativeActivity} AS activity_at
                FROM conversations.conversations conversation WHERE ${native.join(" AND ")}
                ORDER BY ${nativeActivity} DESC, conversation.id DESC LIMIT ${limit})
              UNION ALL
              (SELECT thread.id, 0 AS source_rank, ${historicalActivity} AS activity_at
                FROM conversations.historical_threads thread WHERE ${historical.join(" AND ")}
                ORDER BY ${historicalActivity} DESC, thread.id DESC LIMIT ${limit})
            ) candidates ORDER BY activity_at DESC, source_rank DESC, id DESC LIMIT ${limit}
          )
          SELECT page.id::text, page.source_rank,
            to_char(page.activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS activity_at,
            (SELECT to_jsonb(native_record) FROM (
              SELECT ${conversationSelection} FROM conversations.conversations conversation
              WHERE page.source_rank = 1 AND conversation.id = page.id
            ) native_record) AS quantum,
            (SELECT to_jsonb(historical_record) FROM (
              SELECT ${threadSelection} FROM conversations.historical_threads thread
              WHERE page.source_rank = 0 AND thread.id = page.id
            ) historical_record) AS ghl
          FROM page ORDER BY page.activity_at DESC, page.source_rank DESC, page.id DESC`,
          params,
        )) as { rows: InboxRow[] };
        const rows = result.rows.slice(0, query.limit);
        const last = rows.at(-1);
        return {
          items: rows.map((row): UnifiedInboxRecord => {
            if (row.source_rank === 1 && row.quantum)
              return { source: "QUANTUM", conversation: conversationFromRow(row.quantum) };
            if (row.source_rank === 0 && row.ghl)
              return { source: "GHL", conversation: historicalThreadFromRow(row.ghl) };
            throw new DatabaseUnavailableError();
          }),
          nextCursor:
            result.rows.length > query.limit && last
              ? Buffer.from(
                  JSON.stringify({
                    v: 1,
                    at: last.activity_at,
                    source: last.source_rank,
                    id: last.id,
                  }),
                ).toString("base64url")
              : null,
        };
      } catch (error) {
        if (error instanceof ConversationValidationError) throw error;
        throw new DatabaseUnavailableError();
      }
    },
  });
}
