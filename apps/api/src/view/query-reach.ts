import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { type CallerReachContext, callerReach } from "../utils/caller-reach";
import { findSavedViewById } from "./repository";

/** A workspace view can embed project IDs in its stored filter as well as its scope. */
export async function savedViewQueryFilter(
  reach: CallerReachContext,
  workspaceId: string,
) {
  const allowed = new Set(await reach.reachableProjectIds([workspaceId]));
  const projects = await db
    .select({ id: schema.projectTable.id, slug: schema.projectTable.slug })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, workspaceId));
  const allowedIdentifiers = new Set(
    projects.filter((p) => allowed.has(p.id)).flatMap((p) => [p.id, p.slug]),
  );
  const hidden = new Set(
    (await reach.projectFactsFor([workspaceId]))
      .filter((p) => !allowed.has(p.id))
      .map((p) => p.id),
  );
  for (const project of projects)
    if (!allowed.has(project.id)) hidden.add(project.slug);
  const containsHidden = (value: unknown): boolean => {
    if (typeof value === "string") return hidden.has(value);
    if (Array.isArray(value)) return value.some(containsHidden);
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (
        typeof object.projectId === "string" &&
        !allowed.has(object.projectId)
      )
        return true;
      if (
        object.field === "project" &&
        typeof object.value === "string" &&
        !allowedIdentifiers.has(object.value)
      )
        return true;
      return Object.values(object).some(containsHidden);
    }
    return false;
  };
  return (query: unknown) => !containsHidden(query);
}

export async function requireSavedViewQueryReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(404, { message: "Saved view not found" });
  const row = await findSavedViewById(id);
  if (!row) throw new HTTPException(404, { message: "Saved view not found" });
  const reach = await callerReach(c, c.get("userId") as string);
  const visible = await savedViewQueryFilter(reach, row.workspaceId);
  if (!visible(row.query))
    throw new HTTPException(404, { message: "Saved view not found" });
  return next();
}
