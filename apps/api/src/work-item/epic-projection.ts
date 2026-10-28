import { sql } from "drizzle-orm";
import db from "../database";

export type EpicProjection = {
  id: string;
  key: string;
  title: string;
};

export type WorkItemEpicProjection = {
  epic: EpicProjection | null;
  epicAvailable: boolean;
};

type RawProjection = {
  item_id: string;
  epic_id: string | null;
  epic_key: string | null;
  epic_title: string | null;
  epic_available: boolean;
};

// RH-7 caps the number of nodes in a root-to-leaf chain at five, so a row can have at
// most four parent edges above it.
const MAX_PARENT_HOPS = 4;

/**
 * Resolve the epic for every row in one project-list page with one bounded recursive
 * query. The query follows only same-project/same-workspace parent links, detects cycles,
 * and treats lifecycle-hidden/malformed ancestry as unavailable. Hidden ancestor identity
 * and title never leave this function.
 */
export async function resolveWorkItemEpicProjections(
  projectId: string,
  workspaceId: string,
  itemIds: readonly string[],
): Promise<Map<string, WorkItemEpicProjection>> {
  if (itemIds.length === 0) return new Map();

  const requestedIds = sql.join(
    itemIds.map((id) => sql`(${id}::text)`),
    sql`, `,
  );
  const result = await db.execute(sql`
    WITH RECURSIVE requested(item_id) AS (
      VALUES ${requestedIds}
    ), ancestry AS (
      SELECT
        wi.id AS item_id,
        wi.id AS node_id,
        wi.parent_id,
        wi.type_id,
        wi.project_id,
        wi.workspace_id,
        wi.key,
        wi.title,
        wi.archived_at,
        wi.deleted_at,
        ARRAY[wi.id]::text[] AS path,
        0 AS depth
      FROM requested r
      JOIN work_item wi
        ON wi.id = r.item_id
       AND wi.project_id = ${projectId}
       AND wi.workspace_id = ${workspaceId}

      UNION ALL

      SELECT
        a.item_id,
        parent.id,
        parent.parent_id,
        parent.type_id,
        parent.project_id,
        parent.workspace_id,
        parent.key,
        parent.title,
        parent.archived_at,
        parent.deleted_at,
        a.path || parent.id,
        a.depth + 1
      FROM ancestry a
      JOIN work_item parent
        ON parent.id = a.parent_id
       AND parent.project_id = a.project_id
       AND parent.workspace_id = a.workspace_id
      WHERE a.depth < ${MAX_PARENT_HOPS}
        AND NOT (parent.id = ANY(a.path))
    ), availability AS (
      SELECT
        r.item_id,
        EXISTS (
          SELECT 1 FROM ancestry a
          WHERE a.item_id = r.item_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ancestry a
          LEFT JOIN work_item_type wt
            ON wt.id = a.type_id
           AND wt.workspace_id = a.workspace_id
          WHERE a.item_id = r.item_id
            AND (
              wt.id IS NULL
              OR (a.depth > 0 AND (a.archived_at IS NOT NULL OR a.deleted_at IS NOT NULL))
              OR (
                a.parent_id IS NOT NULL
                AND (
                  a.depth >= ${MAX_PARENT_HOPS}
                  OR a.parent_id = ANY(a.path)
                  OR NOT EXISTS (
                    SELECT 1 FROM work_item parent
                    WHERE parent.id = a.parent_id
                      AND parent.project_id = a.project_id
                      AND parent.workspace_id = a.workspace_id
                  )
                )
              )
            )
        ) AS available
      FROM requested r
    )
    SELECT
      r.item_id,
      CASE WHEN v.available THEN epic.id ELSE NULL END AS epic_id,
      CASE WHEN v.available THEN epic.key ELSE NULL END AS epic_key,
      CASE WHEN v.available THEN epic.title ELSE NULL END AS epic_title,
      v.available AS epic_available
    FROM requested r
    JOIN availability v ON v.item_id = r.item_id
    LEFT JOIN LATERAL (
      SELECT a.node_id AS id, a.key, a.title
      FROM ancestry a
      JOIN work_item_type wt
        ON wt.id = a.type_id
       AND wt.workspace_id = a.workspace_id
      WHERE a.item_id = r.item_id
        AND wt.is_epic = true
        AND a.archived_at IS NULL
        AND a.deleted_at IS NULL
      ORDER BY a.depth ASC
      LIMIT 1
    ) epic ON true
  `);
  const rows = ((result as unknown as { rows?: unknown[] }).rows ??
    (result as unknown as unknown[])) as RawProjection[];

  return new Map(
    rows.map((row) => [
      row.item_id,
      {
        epic:
          row.epic_available &&
          row.epic_id !== null &&
          row.epic_key !== null &&
          row.epic_title !== null
            ? { id: row.epic_id, key: row.epic_key, title: row.epic_title }
            : null,
        epicAvailable: row.epic_available,
      },
    ]),
  );
}
