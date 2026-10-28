import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  countHierarchyChildrenQuery,
  findHierarchyAncestorQuery,
  findHierarchyPageParentQuery,
  hierarchyProgressQuery,
  listHierarchyChildrenQuery,
} from "../hierarchy-page.repository";
import {
  DEFAULT_HIERARCHY_PAGE_LIMIT,
  decodeHierarchyPageCursor,
  encodeHierarchyPageCursor,
  MAX_HIERARCHY_PAGE_LIMIT,
} from "../hierarchy-page-cursor";

export async function listHierarchyChildren(
  identity: ResolvedIdentity,
  key: string,
  workspaceId: string,
  options: {
    cursor?: string;
    limit?: number;
    allowArchivedForRead?: true;
  },
) {
  const limit = options.limit ?? DEFAULT_HIERARCHY_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HIERARCHY_PAGE_LIMIT)
    throw new HTTPException(400, { message: "Invalid limit" });
  if (identity.side !== "staff")
    throw new HTTPException(404, { message: "Work item not found" });
  return db.transaction(
    async (tx) => {
      const item = await findHierarchyPageParentQuery(
        tx,
        identity,
        key,
        workspaceId,
        { allowArchivedForRead: options.allowArchivedForRead },
      );
      if (!item)
        throw new HTTPException(404, { message: "Work item not found" });
      const scope = {
        workspaceId,
        projectId: item.projectId,
        parentId: item.id,
      };
      const after = options.cursor
        ? decodeHierarchyPageCursor(options.cursor, { ...scope, limit })
        : undefined;
      const rows = await listHierarchyChildrenQuery(
        tx,
        scope,
        after,
        limit + 1,
      );
      const total = await countHierarchyChildrenQuery(tx, scope);
      const progress = await hierarchyProgressQuery(tx, scope);
      const ancestors: NonNullable<
        Awaited<ReturnType<typeof findHierarchyAncestorQuery>>
      >[] = [];
      const seen = new Set([item.id]);
      let ancestorId = item.parentId;
      while (ancestorId) {
        if (seen.has(ancestorId) || ancestors.length >= 4)
          throw new HTTPException(409, {
            message: "Invalid hierarchy; refresh and retry",
          });
        seen.add(ancestorId);
        const ancestor = await findHierarchyAncestorQuery(
          tx,
          scope,
          ancestorId,
          options.allowArchivedForRead,
        );
        if (!ancestor) break;
        ancestors.unshift(ancestor);
        ancestorId = ancestor.parentId;
      }
      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit);
      const last = data.at(-1);
      const {
        projectId: _projectId,
        workspaceId: _workspaceId,
        ...parent
      } = item;
      return {
        parent,
        ancestors,
        data: data.map(({ position: _position, ...row }) => row),
        page: {
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeHierarchyPageCursor({ ...scope, limit }, last)
              : null,
        },
        meta: { total },
        progress,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
