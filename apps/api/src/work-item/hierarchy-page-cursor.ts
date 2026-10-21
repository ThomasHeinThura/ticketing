import { HTTPException } from "hono/http-exception";

export const DEFAULT_HIERARCHY_PAGE_LIMIT = 50;
export const MAX_HIERARCHY_PAGE_LIMIT = 200;
export type HierarchyPageScope = {
  workspaceId: string;
  projectId: string;
  parentId: string;
  limit: number;
};
type Cursor = HierarchyPageScope & { v: 1; position: string; id: string };
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !value.includes("\u0000");
// PostgreSQL numeric(20,10). Preserve decimal strings: Number loses the tie-break precision.
const position = (value: unknown): value is string =>
  typeof value === "string" && /^-?\d{1,10}(?:\.\d{1,10})?$/.test(value);

export function encodeHierarchyPageCursor(
  scope: HierarchyPageScope,
  after: { position: string; id: string },
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      parentId: scope.parentId,
      limit: scope.limit,
      position: after.position,
      id: after.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeHierarchyPageCursor(
  raw: string,
  scope: HierarchyPageScope,
): Cursor {
  try {
    if (raw.length > 2048) throw new Error("size");
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error("encoding");
    const json = bytes.toString("utf8");
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("shape");
    const cursor = value as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !==
        "id,limit,parentId,position,projectId,v,workspaceId" ||
      cursor.v !== 1 ||
      cursor.workspaceId !== scope.workspaceId ||
      cursor.projectId !== scope.projectId ||
      cursor.parentId !== scope.parentId ||
      cursor.limit !== scope.limit ||
      !identifier(cursor.id) ||
      !position(cursor.position) ||
      JSON.stringify(cursor) !== json
    )
      throw new Error("fields");
    return cursor as Cursor;
  } catch {
    throw new HTTPException(400, {
      message: "cursor: malformed or different hierarchy scope",
    });
  }
}
