import { createId } from "@paralleldrive/cuid2";
import { schema } from "../../database";
import type { ImportComment, ImportRecord } from "../schema";
import { resolveImportPerson } from "./people";
import { claimEntityProvenance, commentExternalId } from "./provenance";
import { readSourceTime } from "./time";
import { type ImportWriterContext, recordLoss } from "./types";

const COMMENT = schema.commentTable;

/** Tiptap document for a plain-text source comment: one paragraph per blank-line separated block. */
export function plainTextToDocument(text: string) {
  const paragraphs = text
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [""]).map((block) => ({
      type: "paragraph",
      ...(block ? { content: [{ type: "text", text: block }] } : {}),
    })),
  };
}

export type CommentWriteCounts = { created: number; duplicate: number };

/**
 * Write the record's comments (IM-6, IM-7). Visibility is `internal` unless the source says
 * `public` (a source with no public/internal distinction, like ADO and Plane, is therefore never
 * exposed to a customer by accident). Authorship is the matched staff member, or a placeholder for
 * an unknown address; the source time is stored with the `imported` origin marker. A rerun finds
 * the provenance row first and writes nothing. Each comment runs in its own savepoint so one bad
 * comment is reported and the rest of the chunk continues.
 */
export async function writeImportedComments(
  ctx: ImportWriterContext,
  input: { workItemId: string; record: ImportRecord },
): Promise<CommentWriteCounts> {
  const counts: CommentWriteCounts = { created: 0, duplicate: 0 };
  const { record } = input;
  for (const comment of record.comments ?? []) {
    // Resolved outside the comment's savepoint: a placeholder created for this author must survive
    // even if this one comment is later rolled back, because the per-run cache remembers it.
    let authorId: string | null = null;
    if (comment.authorEmail) {
      const person = await resolveImportPerson(ctx, {
        email: comment.authorEmail,
        name: comment.authorName,
      });
      if (person) authorId = person.personId;
      else
        recordLoss(ctx, {
          code: "author_unresolved",
          sourceType: record.sourceType,
          sourceId: record.sourceId,
          entity: "comment",
          entitySourceId: comment.sourceId,
        });
    }
    try {
      const outcome = await ctx.tx.transaction(async (savepoint) =>
        writeOne(
          { ...ctx, tx: savepoint },
          input.workItemId,
          record,
          comment,
          authorId,
        ),
      );
      counts[outcome] += 1;
    } catch {
      recordLoss(ctx, {
        code: "comment_invalid",
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        entity: "comment",
        entitySourceId: comment.sourceId,
      });
    }
  }
  return counts;
}

async function writeOne(
  ctx: ImportWriterContext,
  workItemId: string,
  record: ImportRecord,
  comment: ImportComment,
  authorId: string | null,
): Promise<"created" | "duplicate"> {
  const created = readSourceTime(comment.createdAt, ctx.now, ctx.now);
  if (!created.valid)
    recordLoss(ctx, {
      code: "timestamp_invalid",
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      entity: "comment",
      entitySourceId: comment.sourceId,
    });
  const updated = readSourceTime(comment.updatedAt, created.at, ctx.now);
  const updatedAt =
    updated.valid && updated.at.getTime() >= created.at.getTime()
      ? updated.at
      : created.at;

  const commentId = createId();
  const claim = await claimEntityProvenance(ctx, {
    entityType: "comment",
    externalId: commentExternalId(
      record.sourceType,
      record.sourceId,
      comment.sourceId,
    ),
    entityId: commentId,
    workItemId,
    sourceCreatedAt: created.valid ? created.at : null,
    sourceUpdatedAt: updated.valid ? updated.at : null,
  });
  if (claim.conflict)
    recordLoss(ctx, {
      code: "provenance_duplicate",
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      entity: "comment",
      entitySourceId: comment.sourceId,
    });
  if (!claim.claimed) return "duplicate";

  await ctx.tx.insert(COMMENT).values({
    id: commentId,
    workspaceId: ctx.workspaceId,
    workItemId,
    authorId,
    actorType: authorId ? "person" : "system",
    body:
      typeof comment.body === "string"
        ? plainTextToDocument(comment.body)
        : comment.body,
    visibility: comment.visibility ?? "internal",
    createdAt: created.at,
    updatedAt,
    origin: "imported",
    importedAt: ctx.now,
  });
  return "created";
}
