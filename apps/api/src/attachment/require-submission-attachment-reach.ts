import { parseSubmissionReference } from "@taskdesk/domain";
import { resolveFeatureFlag } from "@taskdesk/permissions";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { portalIdentity } from "../intake/repository";
import type { BaseVariables } from "../openapi";

type SubmissionAttachmentVariables = BaseVariables & {
  workspaceId: string;
  workspaceIdSource: "row";
  submissionId: string;
  submissionWorkItemId: string | null;
  requesterId: string;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalPredicateSatisfied: boolean;
  attachmentId?: string;
};
type SubmissionAttachmentContext = Context<{
  Variables: SubmissionAttachmentVariables;
}>;

async function assertIntakeEnabled(workspaceId: string) {
  const [[instance], [workspace]] = await Promise.all([
    db
      .select({
        enabled: schema.instanceFeatureFlagTable.enabled,
        locked: schema.instanceFeatureFlagTable.locked,
      })
      .from(schema.instanceFeatureFlagTable)
      .where(eq(schema.instanceFeatureFlagTable.featureKey, "feature.intake"))
      .limit(1),
    db
      .select({ enabled: schema.workspaceFeatureFlagTable.enabled })
      .from(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.intake"),
        ),
      )
      .limit(1),
  ]);
  if (
    !resolveFeatureFlag({
      feature: "feature.intake",
      instance: instance ?? null,
      workspace: workspace?.enabled ?? null,
    }).enabled
  )
    throw new HTTPException(404, { message: "Submission not found" });
}

export function requireSubmissionAttachmentReach(
  mode:
    | "portal_upload"
    | "portal_complete"
    | "portal_download"
    | "staff_list"
    | "staff_download",
) {
  return async (c: SubmissionAttachmentContext, next: Next) => {
    const ref = c.req.param("ref");
    const number = ref ? parseSubmissionReference(ref) : null;
    if (number === null)
      throw new HTTPException(404, { message: "Submission not found" });
    const [person] = mode.startsWith("portal_")
      ? [await portalIdentity(c.get("userId"))]
      : [null];
    const [row] = await db
      .select({
        submission: schema.submissionTable,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.submissionTable.number, number),
          ...(person
            ? [eq(schema.submissionTable.requesterId, person.personId)]
            : []),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Submission not found" });
    await assertIntakeEnabled(row.workspaceId);
    const organisationId =
      person?.organisationId ?? row.submission.organisationId;
    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("submissionId", row.submission.id);
    c.set("submissionWorkItemId", row.submission.workItemId);
    c.set("requesterId", row.submission.requesterId);
    c.set("policyOrganisationId", organisationId);
    c.set("policyOrganisationIdSource", "row");
    c.set("portalPredicateSatisfied", mode.startsWith("portal_"));
    const id = c.req.param("id");
    if (mode.endsWith("download") || mode === "portal_complete") {
      if (!id)
        throw new HTTPException(400, { message: "Missing attachment id" });
      const permittedParent = mode.endsWith("download")
        ? undefined
        : mode === "portal_complete" &&
            row.submission.state === "accepted" &&
            row.submission.workItemId
          ? or(
              eq(schema.attachmentTable.submissionId, row.submission.id),
              eq(schema.attachmentTable.workItemId, row.submission.workItemId),
            )
          : eq(schema.attachmentTable.submissionId, row.submission.id);
      const [attachment] = await db
        .select()
        .from(schema.attachmentTable)
        .where(
          and(
            eq(schema.attachmentTable.id, id),
            eq(schema.attachmentTable.workspaceId, row.workspaceId),
            permittedParent,
            mode.startsWith("portal_") && mode.endsWith("download")
              ? eq(schema.attachmentTable.customerVisible, true)
              : undefined,
            isNull(schema.attachmentTable.deletedAt),
          ),
        )
        .limit(1);
      const attachedToSubmission =
        attachment?.submissionId === row.submission.id;
      const attachedToAcceptedWorkItem =
        row.submission.state === "accepted" &&
        row.submission.workItemId !== null &&
        attachment?.workItemId === row.submission.workItemId;
      if (
        !attachment ||
        (!attachedToSubmission && !attachedToAcceptedWorkItem) ||
        (mode === "portal_complete" &&
          (attachment.state !== "pending" ||
            (!attachedToSubmission && !attachedToAcceptedWorkItem))) ||
        (mode.endsWith("download") && attachment.state !== "ready")
      )
        throw new HTTPException(404, { message: "Attachment not found" });
      c.set("attachmentId", attachment.id);
    }
    await next();
  };
}
