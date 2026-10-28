import { eq } from "drizzle-orm";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import type { ImportRecord } from "../schema";
import {
  stampCreatedActivityAsImported,
  writeImportedHistory,
} from "./activity";
import { type ImportAttachmentJob, planImportAttachments } from "./attachments";
import { writeImportedComments } from "./comments";
import { applyImportedCustomFields, applyImportedState } from "./fields";
import { resolveImportAssignee, resolveImportPerson } from "./people";
import { upsertWorkItemProvenance } from "./provenance";
import { writeImportedLinks } from "./relations";
import { type ImportWriterContext, recordLoss } from "./types";

export * from "./activity";
export * from "./attachments";
export * from "./comments";
export * from "./fields";
export * from "./people";
export * from "./provenance";
export * from "./relations";
export * from "./safe-fetch";
export * from "./time";
export * from "./types";

/** Writer context for one run inside one commit transaction. */
export async function createImportWriterContext(
  tx: Transaction,
  run: {
    id: string;
    workspaceId: string;
    projectId: string;
    pluginId: string;
    sourceRef: string;
  },
): Promise<ImportWriterContext> {
  const [workspace] = await tx
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, run.workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Import workspace not found");
  return {
    tx,
    workspaceId: run.workspaceId,
    organisationId: workspace.organisationId,
    projectId: run.projectId,
    runId: run.id,
    pluginId: run.pluginId,
    system: run.sourceRef,
    now: new Date(),
    people: new Map(),
    losses: [],
    stats: { placeholdersCreated: 0 },
  };
}

/**
 * Map an imported assignee email to the person to assign. Only a matched, active, roster-eligible
 * staff member is ever assigned; a placeholder can never hold an assignment. Anything else leaves
 * the item unassigned and reports the loss.
 */
export async function resolveImportedAssigneeId(
  ctx: ImportWriterContext,
  record: ImportRecord,
): Promise<string | undefined> {
  if (!record.assigneeEmail || record.item.assigneeId !== undefined)
    return undefined;
  const outcome = await resolveImportAssignee(ctx, record.assigneeEmail);
  if (outcome.kind === "ok") return outcome.personId;
  recordLoss(ctx, {
    code:
      outcome.kind === "unmatched"
        ? "assignee_unmatched"
        : "assignee_not_eligible",
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    entity: "work_item",
  });
  return undefined;
}

export type RecordExtrasCounts = {
  comments: number;
  history: number;
  relations: number;
  parents: number;
  attachmentsQueued: number;
};

/**
 * Everything a v2 record carries beyond the canonical item fields, written inside the commit
 * transaction for one item: journal stamp, state, custom fields (first import only), parent and
 * relations (deferring targets not imported yet), provenance, comments, history, and the plan for
 * attachments (downloaded after commit). Idempotent: a rerun adds nothing that already exists.
 */
export async function writeImportedRecordExtras(
  ctx: ImportWriterContext,
  input: {
    record: ImportRecord;
    workItemId: string;
    created: boolean;
    chunkRowId: string;
  },
): Promise<{
  counts: RecordExtrasCounts;
  attachmentJobs: ImportAttachmentJob[];
}> {
  const { record, workItemId } = input;
  if (input.created) {
    await stampCreatedActivityAsImported(ctx, { workItemId, record });
    await applyImportedState(ctx, { workItemId, record });
    await applyImportedCustomFields(ctx, { workItemId, record });
  }
  const links = await writeImportedLinks(ctx, { workItemId, record });
  await upsertWorkItemProvenance(ctx, {
    workItemId,
    record,
    deferred: links.deferred,
  });
  const comments = await writeImportedComments(ctx, { workItemId, record });
  const history = await writeImportedHistory(ctx, { workItemId, record });
  const attachmentJobs = await planImportAttachments(ctx, {
    workItemId,
    record,
    chunkRowId: input.chunkRowId,
    uploaderPersonId: async (email, name) =>
      email
        ? ((await resolveImportPerson(ctx, { email, name }))?.personId ?? null)
        : null,
  });
  return {
    counts: {
      comments: comments.created,
      history: history.created,
      relations: links.counts.relationsCreated,
      parents: links.counts.parentsSet,
      attachmentsQueued: attachmentJobs.length,
    },
    attachmentJobs,
  };
}
