import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  findLiveCommentVersionParentQuery,
  listCommentVersionPageQuery,
} from "../repository";

export const DEFAULT_COMMENT_VERSION_LIMIT = 5;
export const MAX_COMMENT_VERSION_LIMIT = 10;
// `comment_version.number` is a PostgreSQL `integer`; a larger cursor value would overflow
// when bound into the keyset predicate (500) instead of being refused as a malformed cursor.
const POSTGRES_INTEGER_MAX = 2_147_483_647;

type CommentVersionCursor = {
  v: 1;
  workItemKey: string;
  commentId: string;
  number: number;
  id: string;
};

export function encodeCommentVersionCursor(cursor: CommentVersionCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCommentVersionCursor(
  raw: string,
  workItemKey: string,
  commentId: string,
): CommentVersionCursor {
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error("noncanonical");
    const json = bytes.toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("shape");
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !==
        "commentId,id,number,v,workItemKey" ||
      cursor.v !== 1 ||
      cursor.workItemKey !== workItemKey ||
      cursor.commentId !== commentId ||
      typeof cursor.number !== "number" ||
      !Number.isSafeInteger(cursor.number) ||
      cursor.number < 1 ||
      cursor.number > POSTGRES_INTEGER_MAX ||
      typeof cursor.id !== "string" ||
      cursor.id.length < 1 ||
      cursor.id.length > 128 ||
      cursor.id.includes("\u0000") ||
      JSON.stringify(cursor) !== json
    ) {
      throw new Error("fields");
    }
    return cursor as CommentVersionCursor;
  } catch {
    throw new HTTPException(400, { message: "cursor: malformed" });
  }
}

/** Lists bounded CA-17 history after work-item reach has been established. */
export async function listCommentVersions(
  workItemKey: string,
  workItemId: string,
  commentId: string,
  options: { cursor?: string; limit?: number },
) {
  const { rows, limit } = await db.transaction(async (tx) => {
    const [parent] = await findLiveCommentVersionParentQuery(
      tx,
      commentId,
      workItemId,
    );
    if (!parent) throw new HTTPException(404, { message: "Comment not found" });

    const limit = options.limit ?? DEFAULT_COMMENT_VERSION_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_COMMENT_VERSION_LIMIT
    ) {
      throw new HTTPException(400, { message: "Invalid limit" });
    }
    const after = options.cursor
      ? decodeCommentVersionCursor(options.cursor, workItemKey, commentId)
      : undefined;
    const rows = await listCommentVersionPageQuery(
      tx,
      commentId,
      after ? { number: after.number, id: after.id } : undefined,
      limit + 1,
    );
    return { rows, limit };
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    data: pageRows.map(({ number, body, editedBy, createdAt }) => ({
      number,
      body,
      editedBy,
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    })),
    page: {
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCommentVersionCursor({
              v: 1,
              workItemKey,
              commentId,
              number: last.number,
              id: last.id,
            })
          : null,
    },
  };
}
