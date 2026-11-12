import { eq, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { type CallerReachContext, callerReach } from "../utils/caller-reach";
import { findSavedViewById } from "./repository";

/** Extract only semantic project references, never arbitrary text values. */
export function projectReferences(
  query: unknown,
): { value: string; slugAllowed: boolean }[] {
  const references: { value: string; slugAllowed: boolean }[] = [];
  const add = (value: unknown, slugAllowed: boolean) => {
    if (typeof value === "string") references.push({ value, slugAllowed });
    else if (Array.isArray(value))
      for (const item of value) add(item, slugAllowed);
    else if (value && typeof value === "object")
      for (const item of Object.values(value)) add(item, slugAllowed);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (Object.hasOwn(node, "projectId")) add(node.projectId, false);
    if (node.field === "project") add(node.value, true);
    for (const child of Object.values(node)) visit(child);
  };
  visit(query);
  return references;
}

export async function savedViewQueryFilter(
  reach: CallerReachContext,
  workspaceId: string,
  executor: Executor = db,
) {
  const allowed = new Set(await reach.reachableProjectIds([workspaceId]));
  const projects = await executor
    .select({ id: schema.projectTable.id, slug: schema.projectTable.slug })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));
  const slugs = new Set(
    projects.filter((p) => allowed.has(p.id)).map((p) => p.slug),
  );
  return (query: unknown) =>
    projectReferences(query).every(({ value, slugAllowed }) =>
      slugAllowed ? slugs.has(value) : allowed.has(value),
    );
}

/** Same project-reference rule in SQL, before search ranking and LIMIT. */
export function savedViewQueryReachSql(
  workspaceId: string,
  reachableProjectIds: readonly string[],
) {
  const ids = reachableProjectIds.length
    ? sql`p.id IN (${sql.join(
        reachableProjectIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql`false`;
  return sql`NOT EXISTS (
    SELECT 1
    FROM jsonb_path_query(${schema.savedViewTable.query}, '$.** ? (@.type() == "object")') AS nodes(node)
    CROSS JOIN LATERAL (
      SELECT node->'projectId' AS value, false AS slug_allowed WHERE node ? 'projectId'
      UNION ALL
      SELECT node->'value' AS value, true AS slug_allowed WHERE node->>'field' = 'project' AND node ? 'value'
    ) AS refs
    CROSS JOIN LATERAL jsonb_path_query(refs.value, '$.** ? (@.type() == "string")') AS vals(value)
    WHERE NOT EXISTS (SELECT 1 FROM project p WHERE p.workspace_id = ${workspaceId} AND ${ids}
        AND ((NOT refs.slug_allowed AND p.id = (vals.value #>> '{}')) OR (refs.slug_allowed AND p.slug = (vals.value #>> '{}'))))
  )`;
}

export async function assertSavedViewQueryReach(
  c: Context,
  row: {
    workspaceId: string;
    query: unknown;
    scope?: string;
    scopeId?: string;
  },
  executor: Executor = db,
) {
  const reach = await callerReach(c, c.get("userId") as string);
  if (
    row.scope === "project" &&
    (!row.scopeId ||
      !(await reach.reachableProjectIds([row.workspaceId])).includes(
        row.scopeId,
      ))
  )
    throw new HTTPException(404, { message: "Saved view not found" });
  const visible = await savedViewQueryFilter(reach, row.workspaceId, executor);
  if (!visible(row.query))
    throw new HTTPException(404, { message: "Saved view not found" });
}

export async function requireSavedViewQueryReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(404, { message: "Saved view not found" });
  const row = await findSavedViewById(id);
  if (!row) throw new HTTPException(404, { message: "Saved view not found" });
  await assertSavedViewQueryReach(c, row);
  return next();
}
