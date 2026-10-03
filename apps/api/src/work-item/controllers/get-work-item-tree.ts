import { and, eq, gt, inArray, notInArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  stateTable,
  stateTemplateTable,
  workItemTable,
} from "../../database/schema";
import { ancestorChain } from "../hierarchy";
import { DEFAULT_WORK_ITEM_LIST_LIMIT } from "../list-query";
import type { WorkItemTreeQuery } from "../schema";

type TreeCursor = { parentId: string; position: string; id: string };

export type WorkItemTreeNode = {
  id: string;
  key: string;
  title: string;
  stateName: string;
  stateCategory: string;
  isCurrent: boolean;
  hasChildren: boolean;
  children: WorkItemTreeNode[];
};

export type WorkItemTreeResult = {
  root: WorkItemTreeNode;
  truncated: boolean;
  page: { nextCursor: string | null; hasMore: boolean };
};

function encodeTreeCursor(cursor: TreeCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function invalidCursor(): never {
  throw new HTTPException(400, {
    message: "cursor: malformed or for another parent",
  });
}

function decodeTreeCursor(raw: string, parentId: string): TreeCursor {
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return invalidCursor();
  }

  if (typeof candidate !== "object" || candidate === null)
    return invalidCursor();
  const value = candidate as Record<string, unknown>;
  if (
    value.parentId !== parentId ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 64 ||
    value.id.includes("\u0000") ||
    typeof value.position !== "string" ||
    value.position.length > 32 ||
    !/^-?\d+(?:\.\d+)?$/.test(value.position)
  ) {
    return invalidCursor();
  }

  return { parentId, id: value.id, position: value.position };
}

/**
 * Preserves the root-to-requested-item path and pages only the requested item's
 * direct children. Each returned child can be expanded by requesting this endpoint
 * with that child's key. The cursor is keyset-bound to the requested item and
 * `(position, id)` order, so it cannot be replayed for another sibling collection.
 */
export async function getWorkItemTree(
  key: string,
  workspaceId: string,
  query: WorkItemTreeQuery,
): Promise<WorkItemTreeResult> {
  const [parent] = await db
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!parent) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  const chainIds = await ancestorChain(db, parent.id);
  const pathRows = await db
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(inArray(workItemTable.id, chainIds));
  const pathById = new Map(pathRows.map((row) => [row.id, row]));
  const path = [...chainIds]
    .reverse()
    .map((id) => pathById.get(id))
    .filter((row) => row !== undefined);
  if (path.length !== chainIds.length) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  const ancestorIds = path.slice(0, -1).map((node) => node.id);
  const pathChildIds = path.slice(1).map((node) => node.id);
  const omittedAncestorBranch =
    ancestorIds.length > 0
      ? await db
          .select({ id: workItemTable.id })
          .from(workItemTable)
          .where(
            and(
              inArray(workItemTable.parentId, ancestorIds),
              notInArray(workItemTable.id, pathChildIds),
            ),
          )
          .limit(1)
      : [];

  const limit = query.limit ?? DEFAULT_WORK_ITEM_LIST_LIMIT;
  const cursor = query.cursor
    ? decodeTreeCursor(query.cursor, parent.id)
    : null;
  const conditions = [eq(workItemTable.parentId, parent.id)];
  if (cursor) {
    const afterCursor = or(
      gt(workItemTable.position, cursor.position),
      and(
        eq(workItemTable.position, cursor.position),
        gt(workItemTable.id, cursor.id),
      ),
    );
    if (!afterCursor)
      throw new Error("tree cursor condition unexpectedly empty");
    conditions.push(afterCursor);
  }

  const rows = await db
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      title: workItemTable.title,
      position: workItemTable.position,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
    })
    .from(workItemTable)
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    .where(and(...conditions))
    .orderBy(workItemTable.position, workItemTable.id)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const childIds = pageRows.map((row) => row.id);
  const childParents =
    childIds.length === 0
      ? []
      : await db
          .selectDistinct({ parentId: workItemTable.parentId })
          .from(workItemTable)
          .where(inArray(workItemTable.parentId, childIds));
  const hasChildrenIds = new Set(
    childParents.flatMap((row) => (row.parentId ? [row.parentId] : [])),
  );
  const last = pageRows.at(-1);
  let currentHasChildren = pageRows.length > 0 || hasMore;
  if (!currentHasChildren && cursor) {
    const [remainingChild] = await db
      .select({ id: workItemTable.id })
      .from(workItemTable)
      .where(eq(workItemTable.parentId, parent.id))
      .limit(1);
    currentHasChildren = remainingChild !== undefined;
  }

  const nodes: WorkItemTreeNode[] = path.map((row) => ({
    ...row,
    isCurrent: row.id === parent.id,
    hasChildren: false,
    children: [],
  }));
  const currentNode = nodes.at(-1);
  if (!currentNode) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  currentNode.children = pageRows.map((row) => ({
    id: row.id,
    key: row.key,
    title: row.title,
    stateName: row.stateName,
    stateCategory: row.stateCategory,
    isCurrent: false,
    hasChildren: hasChildrenIds.has(row.id),
    children: [],
  }));
  currentNode.hasChildren = currentHasChildren;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const node = nodes[index];
    const next = nodes[index + 1];
    if (!node || !next) continue;
    node.children = [next];
    node.hasChildren = true;
  }
  const root = nodes[0];
  if (!root) throw new HTTPException(404, { message: "Work item not found" });

  return {
    root,
    truncated:
      omittedAncestorBranch.length > 0 ||
      cursor !== null ||
      hasMore ||
      pageRows.some((row) => hasChildrenIds.has(row.id)),
    page: {
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeTreeCursor({
              parentId: parent.id,
              position: last.position,
              id: last.id,
            })
          : null,
    },
  };
}

export default getWorkItemTree;
