import {
  parseDashboardLayout,
  type DashboardPreferences,
  type DashboardRepository,
} from "@quantum-crm/domain";

import { contactVisibility, visibility } from "./commercial-postgres-database.js";
import { conversationAccess } from "./conversation-postgres-repository.js";
import {
  historicalConversationAccess,
  historicalThreadChannelSelection,
} from "./historical-conversation-postgres-repository.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

const defaultLayout: DashboardPreferences["layout"] = {
  period: "all",
  widgets: [
    {
      id: "018f96c4-3210-7000-8000-000000000001",
      metric: "contacts",
      chart: "number",
      width: "half",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000002",
      metric: "conversations",
      chart: "number",
      width: "half",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000003",
      metric: "openOpportunities",
      chart: "number",
      width: "half",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000004",
      metric: "pipelineValue",
      chart: "number",
      width: "half",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000005",
      metric: "contacts",
      chart: "line",
      width: "full",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000006",
      metric: "openOpportunities",
      chart: "bar",
      width: "half",
    },
    {
      id: "018f96c4-3210-7000-8000-000000000007",
      metric: "conversations",
      chart: "donut",
      width: "half",
    },
  ],
};

interface CountRow {
  readonly value: string;
}
interface GroupRow {
  readonly label: string;
  readonly value: string;
}
interface MoneyRow {
  readonly currency: string;
  readonly amount_minor: string;
}
interface PreferenceRow {
  readonly layout: unknown;
  readonly version: string;
  readonly updated_at: Date;
}
const count = (row: CountRow | undefined): number => Number(row?.value ?? 0);
const groups = (rows: readonly GroupRow[]): { label: string; value: number }[] =>
  rows.map((row) => ({ label: row.label, value: Number(row.value) }));

/** Reporting's bounded, read-only model. All predicates use the same scope builders as the owning repositories. */
export function createReportingPostgresRepository(pool: PostgresPool): DashboardRepository {
  async function queryRows<T>(sql: string, params: unknown[]): Promise<readonly T[]> {
    // pg requires exactly as many values as the highest placeholder. PROFILE
    // intentionally omits the member predicate, and only tasks use the clock.
    const parameterCount = Math.max(
      0,
      ...[...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1])),
    );
    const result = (await pool.query(sql, params.slice(0, parameterCount))) as {
      readonly rows: readonly T[];
    };
    return result.rows;
  }
  return Object.freeze<DashboardRepository>({
    snapshot: async ({ actor, from, now, period, access }) => {
      try {
        const values = [from, actor.memberId, now];
        const contactScope = contactVisibility(actor, 2).sql;
        const salesScope = visibility(actor, 2, ["opportunity.owner_member_id"]).sql;
        const taskScope = visibility(actor, 2, [
          "task.created_by_member_id",
          "task.assignee_member_id",
        ]).sql;
        const nativeScope = conversationAccess(actor, 2).sql;
        const historicalScope = historicalConversationAccess(actor, 2).sql;
        const window = (column: string): string =>
          `($1::timestamptz IS NULL OR ${column} >= $1::timestamptz)`;

        const [
          contacts,
          trend,
          openSales,
          wonSales,
          money,
          stages,
          native,
          historical,
          nativeChannels,
          historicalChannels,
          overdue,
        ] = await Promise.all([
          access.contacts
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM contacts.contacts contact WHERE contact.archived_at IS NULL AND ${contactScope} AND ${window("contact.created_at")}`,
                values,
              )
            : null,
          access.contacts
            ? queryRows<GroupRow>(
                `SELECT to_char(date_trunc('month', contact.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS label, count(*)::text AS value FROM contacts.contacts contact WHERE contact.archived_at IS NULL AND ${contactScope} AND ${window("contact.created_at")} GROUP BY 1 ORDER BY 1 DESC LIMIT 18`,
                values,
              )
            : null,
          access.sales
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM sales.opportunities opportunity WHERE ${salesScope} AND opportunity.status = 'open' AND ${window("opportunity.created_at")}`,
                values,
              )
            : null,
          access.sales
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM sales.opportunities opportunity WHERE ${salesScope} AND opportunity.status = 'won' AND ${window("opportunity.closed_at")}`,
                values,
              )
            : null,
          access.sales
            ? queryRows<MoneyRow>(
                `SELECT opportunity.currency, coalesce(sum(opportunity.amount_minor), 0)::text AS amount_minor FROM sales.opportunities opportunity WHERE ${salesScope} AND opportunity.status = 'open' AND ${window("opportunity.created_at")} GROUP BY opportunity.currency ORDER BY opportunity.currency`,
                values,
              )
            : null,
          access.sales
            ? queryRows<GroupRow>(
                `SELECT stage.name AS label, count(*)::text AS value FROM sales.opportunities opportunity JOIN sales.pipeline_stages stage ON stage.id = opportunity.stage_id WHERE ${salesScope} AND opportunity.status = 'open' AND ${window("opportunity.created_at")} GROUP BY stage.id, stage.name, stage.position ORDER BY stage.position, stage.name LIMIT 30`,
                values,
              )
            : null,
          access.conversations
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM conversations.conversations conversation WHERE ${nativeScope} AND ${window("conversation.created_at")}`,
                values,
              )
            : null,
          access.conversations
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM conversations.historical_threads thread WHERE ${historicalScope} AND ${window("COALESCE(thread.source_created_at, thread.imported_at)")}`,
                values,
              )
            : null,
          access.conversations
            ? queryRows<GroupRow>(
                `SELECT upper(conversation.channel) AS label, count(*)::text AS value FROM conversations.conversations conversation WHERE ${nativeScope} AND ${window("conversation.created_at")} GROUP BY 1`,
                values,
              )
            : null,
          access.conversations
            ? queryRows<GroupRow>(
                `SELECT channel.label, count(*)::text AS value FROM (SELECT COALESCE(NULLIF(regexp_replace(upper(btrim(${historicalThreadChannelSelection})), '^TYPE_', ''), ''), 'SIN CLASIFICAR') AS label FROM conversations.historical_threads thread WHERE ${historicalScope} AND ${window("COALESCE(thread.source_created_at, thread.imported_at)")}) channel GROUP BY channel.label`,
                values,
              )
            : null,
          access.tasks
            ? queryRows<CountRow>(
                `SELECT count(*)::text AS value FROM tasks.tasks task WHERE ${taskScope} AND $2::uuid IS NOT NULL AND task.status IN ('pending', 'in_progress') AND task.due_at < $3::timestamptz AND ${window("task.due_at")}`,
                values,
              )
            : null,
        ]);
        const channelTotals = new Map<string, number>();
        for (const item of [...(nativeChannels ?? []), ...(historicalChannels ?? [])])
          channelTotals.set(item.label, (channelTotals.get(item.label) ?? 0) + Number(item.value));
        const snapshot: Awaited<ReturnType<DashboardRepository["snapshot"]>> = {
          period,
          generatedAt: now.toISOString(),
          metrics: {
            contacts: access.contacts ? count(contacts?.[0]) : null,
            conversations: access.conversations
              ? count(native?.[0]) + count(historical?.[0])
              : null,
            openOpportunities: access.sales ? count(openSales?.[0]) : null,
            wonOpportunities: access.sales ? count(wonSales?.[0]) : null,
            overdueTasks: access.tasks ? count(overdue?.[0]) : null,
            pipelineValue: access.sales
              ? (money ?? []).map((row) => ({
                  currency: row.currency,
                  amountMinor: row.amount_minor,
                }))
              : null,
          },
          contactsTrend: groups([...(trend ?? [])].reverse()),
          opportunityStages: groups(stages ?? []),
          conversationChannels: [...channelTotals]
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value),
        };
        return snapshot;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    preferences: async (memberId): Promise<DashboardPreferences> => {
      try {
        const result = await queryRows<PreferenceRow>(
          `SELECT layout, version::text, updated_at FROM reporting.dashboard_preferences WHERE member_id = $1::uuid`,
          [memberId],
        );
        const row = result[0];
        return row
          ? {
              layout: parseDashboardLayout(row.layout),
              version: row.version,
              updatedAt: row.updated_at.toISOString(),
            }
          : { layout: defaultLayout, version: "0", updatedAt: null };
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
    savePreferences: async (
      memberId,
      layout,
      expectedVersion,
    ): Promise<DashboardPreferences | null> => {
      try {
        const result = await queryRows<PreferenceRow>(
          `INSERT INTO reporting.dashboard_preferences (member_id, layout, version) SELECT $1::uuid, $2::jsonb, 1 WHERE $3::bigint = 0 ON CONFLICT (member_id) DO UPDATE SET layout = EXCLUDED.layout, version = reporting.dashboard_preferences.version + 1, updated_at = CURRENT_TIMESTAMP WHERE reporting.dashboard_preferences.version = $3::bigint RETURNING layout, version::text, updated_at`,
          [memberId, JSON.stringify(layout), expectedVersion.toString()],
        );
        const row = result[0];
        return row
          ? {
              layout: parseDashboardLayout(row.layout),
              version: row.version,
              updatedAt: row.updated_at.toISOString(),
            }
          : null;
      } catch {
        throw new DatabaseUnavailableError();
      }
    },
  });
}
