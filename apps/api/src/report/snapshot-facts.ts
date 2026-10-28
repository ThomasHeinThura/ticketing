import { type SQL, sql } from "drizzle-orm";
import { itemFilterSql, num, selectRows, timeFilterSql } from "./context";
import type { SnapshotMetric } from "./snapshot.logic";
import type { ReportContext } from "./types";

/** UTC day of the last instant inside the exclusive end `to`: a window ending now includes today. */
function lastDay(to: Date): string {
  return new Date(to.getTime() - 1).toISOString().slice(0, 10);
}

/** Aggregated, privacy-minimal fact row stored in metric_snapshot's JSON dimensions/measures. */
export type SnapshotFact = {
  day: string;
  project_id: string | null;
  organisation_id: string | null;
  dimensions: Record<string, string | null>;
  measures: Record<string, number>;
};

type RawFact = {
  day: string;
  project_id: string | null;
  organisation_id: string | null;
  dimensions: Record<string, string | null> | string;
  measures: Record<string, number | string> | string;
};

function parseObject<T extends Record<string, unknown>>(value: T | string): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

const joinedDay = (column: SQL) => sql`to_char(${column}, 'YYYY-MM-DD') AS day`;
const joinedUtcDay = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`;

/**
 * Build the bounded daily projection for one complete snapshot family. These rows intentionally
 * carry identifiers needed for current reach/team filtering and legal-hold retention, never names,
 * comments, descriptions, queries, or rate schedules.
 */
export async function liveFactRows(
  metric: SnapshotMetric,
  workspaceId: string,
  from: Date,
  to: Date,
  ctx?: ReportContext,
): Promise<SnapshotFact[]> {
  const itemScope = ctx
    ? sql`${ctx.reach} AND ${itemFilterSql(ctx)}`
    : sql`true`;
  const timeScope = ctx
    ? sql`${ctx.reach} AND ${timeFilterSql(ctx)}`
    : sql`true`;
  const projectScope = ctx
    ? sql`${ctx.reach}
        AND (${ctx.filters.projectId ? sql`p.id=${ctx.filters.projectId}` : sql`true`})
        AND (${ctx.filters.organisationId ? sql`p.organisation_id=${ctx.filters.organisationId}` : sql`true`})`
    : sql`true`;
  let rows: RawFact[];
  switch (metric) {
    case "item_created":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedDay(sql`w.created_at`)}, p.id AS project_id,
          p.organisation_id, jsonb_build_object('typeId',w.type_id,'priority',w.priority,
            'assigneeId',w.assignee_id,'requesterId',w.requester_id) AS dimensions,
          jsonb_build_object('count',count(*)) AS measures
        FROM work_item w JOIN project p ON p.id = w.project_id
        WHERE w.workspace_id = ${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
          AND ${itemScope}
          AND w.created_at >= ${from.toISOString()}::timestamp AND w.created_at < ${to.toISOString()}::timestamp
        GROUP BY 1,2,3,4`);
      break;
    case "item_resolved":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedDay(sql`w.resolved_at`)}, p.id AS project_id,
          p.organisation_id, jsonb_build_object('typeId',w.type_id,'priority',w.priority,
            'assigneeId',w.assignee_id,'requesterId',w.requester_id) AS dimensions,
          jsonb_build_object('count',count(*),
            'fast',count(*) FILTER (WHERE w.resolved_at - w.created_at < interval '3 days'),
            'slow',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '14 days'),
            'lt1',count(*) FILTER (WHERE w.resolved_at - w.created_at < interval '1 day'),
            'd1_2',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '1 day' AND w.resolved_at - w.created_at < interval '3 days'),
            'd3_7',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '3 days' AND w.resolved_at - w.created_at < interval '8 days'),
            'd8_14',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '8 days' AND w.resolved_at - w.created_at < interval '15 days'),
            'd15_30',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '15 days' AND w.resolved_at - w.created_at < interval '31 days'),
            'gt30',count(*) FILTER (WHERE w.resolved_at - w.created_at >= interval '31 days')) AS measures
        FROM work_item w JOIN project p ON p.id = w.project_id
        JOIN state s ON s.id = w.state_id JOIN state_template st ON st.id = s.state_template_id
        WHERE w.workspace_id = ${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
          AND st."group" = 'completed' AND w.resolved_at IS NOT NULL AND ${itemScope}
          AND w.resolved_at >= ${from.toISOString()}::timestamp AND w.resolved_at < ${to.toISOString()}::timestamp
        GROUP BY 1,2,3,4`);
      break;
    case "sla_due_outcome":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedUtcDay(sql`c.due_at`)}, p.id AS project_id,
          p.organisation_id, jsonb_build_object('typeId',w.type_id,'priority',w.priority,
            'assigneeId',w.assignee_id,'requesterId',w.requester_id,'metric',c.metric,'state',c.state) AS dimensions,
          jsonb_build_object('count',count(*)) AS measures
        FROM work_item_sla_cache c JOIN work_item w ON w.id = c.work_item_id
        JOIN project p ON p.id = w.project_id
        WHERE w.workspace_id = ${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
          AND c.due_at IS NOT NULL AND c.state IN ('met','missed','breached')
          AND ${itemScope} AND c.due_at >= ${from.toISOString()}::timestamptz AND c.due_at < ${to.toISOString()}::timestamptz
        GROUP BY 1,2,3,4`);
      break;
    case "satisfaction_rating":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedUtcDay(sql`sr.created_at`)}, p.id AS project_id,
          p.organisation_id, jsonb_build_object('typeId',w.type_id,'priority',w.priority,
            'assigneeId',w.assignee_id,'requesterId',w.requester_id,'personId',sr.person_id,
            'score',sr.score::text,'requestTypeId',sub.request_type_id) AS dimensions,
          jsonb_build_object('count',count(*)) AS measures
        FROM satisfaction_rating sr JOIN work_item w ON w.id = sr.work_item_id
        JOIN project p ON p.id = w.project_id
        LEFT JOIN LATERAL (SELECT s.request_type_id FROM submission s
          WHERE s.work_item_id = w.id AND s.state <> 'duplicate'
          ORDER BY s.created_at,s.id LIMIT 1) sub ON true
        WHERE w.workspace_id = ${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
          AND ${itemScope} AND sr.created_at >= ${from.toISOString()}::timestamptz AND sr.created_at < ${to.toISOString()}::timestamptz
        GROUP BY 1,2,3,4`);
      break;
    case "time_logged":
      rows =
        await selectRows<RawFact>(sql`SELECT te.date::text AS day, p.id AS project_id, p.organisation_id,
          jsonb_build_object('personId',te.person_id,'activityId',te.activity_id,
            'typeId',w.type_id,'priority',w.priority,'assigneeId',w.assignee_id,
            'requesterId',w.requester_id,'currency',te.currency) AS dimensions,
          jsonb_build_object('minutes',sum(te.minutes),
            'billableMinutes',sum(te.minutes) FILTER (WHERE te.billable),
            'entries',count(*),
            'orphanEntries',count(*) FILTER (WHERE te.work_item_id IS NULL),
            'unpricedMinutes',sum(te.minutes) FILTER (WHERE te.rate_minor IS NULL))
          || ${
            ctx?.showRates === false
              ? sql`'{}'::jsonb`
              : sql`jsonb_build_object(
            'costMinor',sum(te.minutes * te.rate_minor::numeric / 60.0),
            'budgetCostMinor',sum(floor((te.minutes::numeric * te.rate_minor + 30) / 60)))`
          } AS measures
        FROM time_entry te JOIN project p ON p.id = te.project_id JOIN person pe ON pe.id=te.person_id
        LEFT JOIN work_item w ON w.id = te.work_item_id
        WHERE te.workspace_id = ${workspaceId} AND p.deleted_at IS NULL
          AND ${timeScope}
          AND te.date >= ${from.toISOString().slice(0, 10)}::date AND te.date <= ${lastDay(to)}::date
        GROUP BY 1,2,3,4`);
      break;
    case "cost_entry":
      rows =
        await selectRows<RawFact>(sql`SELECT ce.date::text AS day,p.id AS project_id,p.organisation_id,
          jsonb_build_object('personId',ce.person_id,'costTypeId',ce.cost_type_id,
            'typeId',w.type_id,'priority',w.priority,'assigneeId',w.assignee_id,
            'requesterId',w.requester_id,'currency',ce.currency,'creatorId',ce_creator.id) AS dimensions,
          jsonb_build_object('amountMinor',sum(ce.amount_minor),'units',sum(ce.units),'entries',count(*)) AS measures
        FROM cost_entry ce JOIN project p ON p.id=ce.project_id LEFT JOIN work_item w ON w.id=ce.work_item_id
        LEFT JOIN person ce_creator ON ce_creator.user_id=ce.created_by
        WHERE ce.workspace_id=${workspaceId} AND p.deleted_at IS NULL
          AND (${ctx ? sql`(${ctx.reach}) AND (${ctx.filters.projectId ? sql`p.id=${ctx.filters.projectId}` : sql`true`}) AND (${ctx.filters.organisationId ? sql`p.organisation_id=${ctx.filters.organisationId}` : sql`true`}) AND (${ctx.filters.typeId ? sql`w.type_id=${ctx.filters.typeId}` : sql`true`}) AND (${ctx.filters.priority ? sql`w.priority=${ctx.filters.priority}` : sql`true`}) AND (${ctx.filters.teamId ? sql`EXISTS (SELECT 1 FROM team_member tm JOIN person pe ON pe.user_id=tm.user_id JOIN team t ON t.id=tm.team_id AND t.workspace_id=${ctx.workspaceId} WHERE tm.team_id=${ctx.filters.teamId} AND pe.id=ce.person_id)` : sql`true`}) AND (${ctx.readAnyTime ? sql`true` : sql`ce.person_id=${ctx.identity.personId}`})` : sql`true`})
          AND ce.date >= ${from.toISOString().slice(0, 10)}::date AND ce.date <= ${lastDay(to)}::date
        GROUP BY 1,2,3,4`);
      break;
    case "escalation_started":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedUtcDay(sql`e.started_at`)}, p.id AS project_id,p.organisation_id,
          jsonb_build_object('typeId',w.type_id,'priority',w.priority,'assigneeId',w.assignee_id,
            'requesterId',w.requester_id,'escalationPersonId',e.assignee_id_at_start,'metric',e.metric,'state',e.state,'stopReason',e.stop_reason) AS dimensions,
          jsonb_build_object('count',count(*)) AS measures
        FROM sla_escalation e JOIN work_item w ON w.id=e.work_item_id JOIN project p ON p.id=e.project_id
        WHERE e.workspace_id=${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
          AND ${projectScope} AND e.started_at >= ${from.toISOString()}::timestamptz AND e.started_at < ${to.toISOString()}::timestamptz
        GROUP BY 1,2,3,4`);
      break;
    case "kb_deflection":
      rows =
        await selectRows<RawFact>(sql`SELECT ${joinedUtcDay(sql`d.created_at`)},
          COALESCE(a.project_id, p.id) AS project_id, p.organisation_id,
          jsonb_build_object('articleId',a.id,'requestTypeId',d.request_type_id,'personId',d.person_id,
            'abandoned', (d.abandoned_at IS NOT NULL)::text) AS dimensions,
          jsonb_build_object('opened',count(*),'deflected',count(*) FILTER (WHERE d.abandoned_at IS NOT NULL)) AS measures
        FROM deflection_event d JOIN kb_article a ON a.id=d.kb_article_id
        LEFT JOIN project p ON p.id=a.project_id
        WHERE d.workspace_id=${workspaceId}
          AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx ? ctx.reach : sql`true`}))
          AND d.created_at >= ${from.toISOString()}::timestamptz AND d.created_at < ${to.toISOString()}::timestamptz
        GROUP BY 1,2,3,4`);
      break;
    case "cycle_completion":
      rows =
        await selectRows<RawFact>(sql`SELECT to_char(c.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
          p.id AS project_id,p.organisation_id,
          jsonb_build_object('cycleId',c.id,'unit',cs.unit) AS dimensions,
          jsonb_build_object('cycles',1,'scopePoints',cs.scope_points,'completedPoints',cs.completed_points,
            'itemCount',cs.item_count,'completedCount',cs.completed_count,
            'unestimatedCount',cs.unestimated_count) AS measures
        FROM cycle c JOIN project p ON p.id=c.project_id
        JOIN LATERAL (SELECT x.* FROM cycle_snapshot x WHERE x.cycle_id=c.id ORDER BY x.date DESC LIMIT 1) cs ON true
        WHERE c.workspace_id=${workspaceId} AND c.completed_at IS NOT NULL AND p.deleted_at IS NULL AND ${projectScope}
          AND c.completed_at >= ${from.toISOString()}::timestamptz AND c.completed_at < ${to.toISOString()}::timestamptz`);
      break;
    default: {
      if (metric === "sla_resolution" || metric === "sla_first_response") {
        const clock =
          metric === "sla_resolution" ? "resolution" : "first_response";
        const settled =
          metric === "sla_resolution"
            ? sql`w.resolved_at`
            : sql`w.first_response_at`;
        rows =
          await selectRows<RawFact>(sql`SELECT ${joinedDay(settled)},p.id AS project_id,p.organisation_id,
            jsonb_build_object('typeId',w.type_id,'priority',w.priority,'assigneeId',w.assignee_id,
              'requesterId',w.requester_id) AS dimensions,
            jsonb_build_object('met',count(*) FILTER (WHERE c.state='met'),
              'missed',count(*) FILTER (WHERE c.state='missed')) AS measures
          FROM work_item w JOIN project p ON p.id=w.project_id
          JOIN work_item_sla_cache c ON c.work_item_id=w.id AND c.metric=${clock}
          WHERE w.workspace_id=${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
            AND c.state IN ('met','missed') AND ${itemScope} AND ${settled} >= ${from.toISOString()}::timestamp AND ${settled} < ${to.toISOString()}::timestamp
          GROUP BY 1,2,3,4`);
      } else {
        rows =
          await selectRows<RawFact>(sql`SELECT to_char(w.resolved_at,'YYYY-MM-DD') AS day,
            p.id AS project_id,p.organisation_id,
            jsonb_build_object('typeId',w.type_id,'priority',w.priority,'assigneeId',w.assignee_id,
              'requesterId',w.requester_id) AS dimensions,jsonb_build_object('completed',count(*)) AS measures
          FROM work_item w JOIN project p ON p.id=w.project_id
          JOIN state s ON s.id=w.state_id JOIN state_template st ON st.id=s.state_template_id
          WHERE w.workspace_id=${workspaceId} AND w.deleted_at IS NULL AND p.deleted_at IS NULL
            AND st."group"='completed' AND ${itemScope} AND w.resolved_at >= ${from.toISOString()}::timestamp AND w.resolved_at < ${to.toISOString()}::timestamp
          GROUP BY 1,2,3,4`);
      }
    }
  }
  return rows.map((row) => ({
    day: row.day,
    project_id: row.project_id,
    organisation_id: row.organisation_id,
    dimensions: parseObject(row.dimensions),
    measures: Object.fromEntries(
      Object.entries(parseObject(row.measures)).map(([key, value]) => [
        key,
        num(value),
      ]),
    ),
  }));
}

/** Existing source events establish the oldest day eligible for a closed-period snapshot. */
export async function earliestSnapshotSourceDay(
  workspaceId: string,
): Promise<Date | null> {
  const rows = await selectRows<{
    at: string | Date | null;
  }>(sql`SELECT min(source.at) AS at FROM (
      SELECT w.created_at::date AS at FROM work_item w WHERE w.workspace_id=${workspaceId}
      UNION ALL SELECT w.resolved_at::date FROM work_item w WHERE w.workspace_id=${workspaceId} AND w.resolved_at IS NOT NULL
      UNION ALL SELECT w.first_response_at::date FROM work_item w WHERE w.workspace_id=${workspaceId} AND w.first_response_at IS NOT NULL
      UNION ALL SELECT (c.due_at AT TIME ZONE 'UTC')::date FROM work_item_sla_cache c JOIN work_item w ON w.id=c.work_item_id WHERE w.workspace_id=${workspaceId} AND c.due_at IS NOT NULL
      UNION ALL SELECT (sr.created_at AT TIME ZONE 'UTC')::date FROM satisfaction_rating sr JOIN work_item w ON w.id=sr.work_item_id WHERE w.workspace_id=${workspaceId}
      UNION ALL SELECT te.date FROM time_entry te WHERE te.workspace_id=${workspaceId}
      UNION ALL SELECT ce.date FROM cost_entry ce WHERE ce.workspace_id=${workspaceId}
      UNION ALL SELECT (e.started_at AT TIME ZONE 'UTC')::date FROM sla_escalation e WHERE e.workspace_id=${workspaceId}
      UNION ALL SELECT (d.created_at AT TIME ZONE 'UTC')::date FROM deflection_event d WHERE d.workspace_id=${workspaceId}
      UNION ALL SELECT (c.completed_at AT TIME ZONE 'UTC')::date FROM cycle c WHERE c.workspace_id=${workspaceId} AND c.completed_at IS NOT NULL
    ) source`);
  const value = rows[0]?.at;
  if (!value) return null;
  const day =
    typeof value === "string"
      ? value.slice(0, 10)
      : value.toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00.000Z`);
}
