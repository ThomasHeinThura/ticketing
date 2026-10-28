import { sql } from "drizzle-orm";
import { itemFrom, num, OPEN, selectRows } from "../context";
import { countValue } from "../logic";
import type { ReportDefinition, Row } from "../types";
import { col, emptyBody, itemsOf, pageLimit, pageRows } from "./shared";

const ASSIGNEE_NAME = sql`COALESCE(pe.display_name, u.name, 'Unknown')`;

type InactiveAssigneeRow = {
  assignee_id: string;
  name: string | null;
  assigned: string;
  open: string;
  total_assigned: string;
};

const inactiveAssignees: ReportDefinition = {
  key: "inactive_assignees",
  category: "people",
  title: "Work assigned to inactive people",
  live: true,
  pagedExport: true,
  async compute(ctx) {
    const rows = await selectRows<InactiveAssigneeRow>(sql`WITH grouped AS (
        SELECT w.assignee_id, ${ASSIGNEE_NAME} AS name,
          count(*)::int AS assigned,
          count(*) FILTER (WHERE ${OPEN})::int AS open
        ${itemFrom(
          ctx,
          sql`JOIN person pe ON pe.id = w.assignee_id AND pe.active = false
          LEFT JOIN "user" u ON u.id = pe.user_id`,
        )}
          AND w.assignee_id IS NOT NULL
        GROUP BY w.assignee_id, ${ASSIGNEE_NAME}
      )
      SELECT grouped.*,
        sum(grouped.assigned) OVER ()::int AS total_assigned
      FROM grouped
      ORDER BY grouped.assigned DESC, grouped.name ASC, grouped.assignee_id
      ${pageLimit(ctx, 200)}`);
    const page = pageRows(ctx, rows, 200);
    const visibleRows = page.rows;
    const assigned = num(rows[0]?.total_assigned);
    const table: Row[] = visibleRows.map((row) => ({
      assignee: row.name ?? "Unknown",
      inactive: "Inactive",
      assigned: num(row.assigned),
      open: num(row.open),
      _drill: row.assignee_id,
    }));

    return emptyBody({
      metrics: [
        {
          key: "assigned",
          label: "Assigned work",
          unit: "count",
          ...countValue(assigned),
        },
      ],
      columns: [
        col("assignee", "Assignee"),
        col("inactive", "Status"),
        col("assigned", "Assigned work", "number"),
        col("open", "Open work", "number"),
      ],
      rows: table,
      population: assigned,
      truncated: page.truncated,
      drill: true,
    });
  },
  drillItems: (ctx, handle, limit) =>
    itemsOf(
      ctx,
      handle ? sql`w.assignee_id = ${handle}` : sql`false`,
      limit,
      sql`w.updated_at DESC`,
      sql`JOIN person inactive_assignee ON inactive_assignee.id = w.assignee_id
        AND inactive_assignee.active = false`,
    ),
};

export const inactiveAssigneeReports: ReportDefinition[] = [inactiveAssignees];
