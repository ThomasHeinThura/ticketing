import { type SQL, sql } from "drizzle-orm";
import type { ReportContext } from "./types";

// RH-7 caps the path from any node to its root at five nodes.
const MAX_PARENT_HOPS = 4;

/**
 * A report-wide, project/reach-scoped ancestry map. It keeps valid no-epic rows distinct from
 * malformed or lifecycle-hidden ancestry and never returns ancestor identity for unavailable
 * paths. Both grouping and drill-down use this same mapping.
 */
export function epicReportCtes(ctx: ReportContext): SQL {
  return sql`WITH RECURSIVE epic_report_items AS (
      SELECT
        wi.id, wi.parent_id, wi.type_id, wi.state_id, wi.project_id, wi.workspace_id,
        wi.key, wi.title, wi.archived_at, wi.deleted_at,
        wt.id AS valid_type_id, wt.is_epic
      FROM work_item wi
      JOIN project p ON p.id = wi.project_id
      LEFT JOIN work_item_type wt
        ON wt.id = wi.type_id AND wt.workspace_id = wi.workspace_id
      WHERE wi.workspace_id = ${ctx.workspaceId}
        AND wi.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND ${ctx.reach}
    ), epic_ancestry AS (
      SELECT
        item.id AS item_id, item.id AS node_id, item.parent_id, item.type_id, item.state_id,
        item.project_id, item.workspace_id, item.key, item.title,
        item.archived_at, item.deleted_at, item.valid_type_id, item.is_epic,
        ARRAY[item.id]::text[] AS path, 0 AS depth
      FROM epic_report_items item

      UNION ALL

      SELECT
        ancestry.item_id, parent.id, parent.parent_id, parent.type_id, parent.state_id,
        parent.project_id, parent.workspace_id, parent.key, parent.title,
        parent.archived_at, parent.deleted_at, parent.valid_type_id, parent.is_epic,
        ancestry.path || parent.id, ancestry.depth + 1
      FROM epic_ancestry ancestry
      JOIN epic_report_items parent
        ON parent.id = ancestry.parent_id
       AND parent.project_id = ancestry.project_id
       AND parent.workspace_id = ancestry.workspace_id
      WHERE ancestry.depth < ${MAX_PARENT_HOPS}
        AND NOT (parent.id = ANY(ancestry.path))
    ), epic_path_quality AS (
      SELECT
        ancestry.item_id,
        bool_and(
          ancestry.valid_type_id IS NOT NULL
          AND (ancestry.depth = 0 OR (ancestry.archived_at IS NULL AND ancestry.deleted_at IS NULL))
          AND NOT (ancestry.is_epic AND ancestry.parent_id IS NOT NULL)
        ) AS nodes_valid,
        bool_and(
          ancestry.parent_id IS NULL
          OR (
            ancestry.depth < ${MAX_PARENT_HOPS}
            AND EXISTS (
              SELECT 1 FROM epic_ancestry next
              WHERE next.item_id = ancestry.item_id
                AND next.depth = ancestry.depth + 1
            )
          )
        ) AS links_valid,
        (array_agg(ancestry.node_id ORDER BY ancestry.depth)
          FILTER (WHERE ancestry.is_epic))[1] AS epic_id
      FROM epic_ancestry ancestry
      GROUP BY ancestry.item_id
    ), epic_mapping AS (
      SELECT
        quality.item_id,
        (quality.nodes_valid AND quality.links_valid) AS available,
        CASE WHEN quality.nodes_valid AND quality.links_valid THEN epic.id ELSE NULL END AS epic_id,
        CASE WHEN quality.nodes_valid AND quality.links_valid THEN epic.key ELSE NULL END AS epic_key,
        CASE WHEN quality.nodes_valid AND quality.links_valid THEN epic.title ELSE NULL END AS epic_title
      FROM epic_path_quality quality
      LEFT JOIN epic_report_items epic
        ON epic.id = quality.epic_id
       AND epic.is_epic = true
       AND epic.archived_at IS NULL
       AND epic.deleted_at IS NULL
    ), epic_progress AS (
      SELECT
        mapping.epic_id,
        count(*)::text AS total,
        count(*) FILTER (WHERE template."group" IN ('completed', 'cancelled'))::text AS completed
      FROM epic_mapping mapping
      JOIN epic_report_items descendant ON descendant.id = mapping.item_id
      JOIN state item_state ON item_state.id = descendant.state_id
      JOIN state_template template ON template.id = item_state.state_template_id
      WHERE mapping.available = true
        AND mapping.epic_id IS NOT NULL
        AND mapping.item_id <> mapping.epic_id
        AND descendant.archived_at IS NULL
        AND descendant.deleted_at IS NULL
      GROUP BY mapping.epic_id
    )`;
}

export type EpicDrillHandle =
  | { kind: "epic"; id: string }
  | { kind: "none" }
  | { kind: "unavailable" };

/** Parse opaque, bounded handles. IDs are parameters to SQL and are re-scoped on every use. */
export function parseEpicDrillHandle(handle: string): EpicDrillHandle | null {
  if (handle === "epic-none") return { kind: "none" };
  if (handle === "epic-unavailable") return { kind: "unavailable" };
  if (!handle.startsWith("epic:")) return null;
  const id = handle.slice("epic:".length);
  return /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? { kind: "epic", id } : null;
}
