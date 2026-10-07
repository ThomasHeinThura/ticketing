/** IQ-14/16a regression: acceptance is a single durable conversion and two acceptors
 * racing the same submitted version can create exactly one work item. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { acceptSubmission } from "../../apps/api/src/intake/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "work-item type",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "state template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId, stateTemplateId: template.id, isDefault: true })
      .returning(),
    "project state",
  );
}

describe("intake atomic conversion", () => {
  beforeEach(async () => resetTestDatabase());

  it("races acceptors and atomically transfers comments, attachments, watcher, and submission SLA time", async () => {
    const { workspace } = await createWorkspaceMember({ role: "admin" });
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `customer-${randomUUID()}`, name: "Customer" })
        .returning(),
      "organisation",
    );
    const person = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "customer",
          displayName: "Requester",
        })
        .returning(),
      "requester",
    );
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    const type = await makeWorkItemType(workspace.id);
    const chosenType = await makeWorkItemType(workspace.id);
    await makeDefaultState(workspace.id, project.id);
    const formSchema = {
      fields: [
        {
          key: "summary",
          type: "text",
          label: "Summary",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    };
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: workspace.id,
          key: `req-${randomUUID()}`,
          name: "Help",
          group: "General",
          workItemTypeId: type.id,
          defaultProjectId: project.id,
          formSchema,
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema,
          workItemTypeId: type.id,
          defaultProjectId: project.id,
        })
        .returning(),
      "request type version",
    );
    const submittedAt = new Date("2026-01-02T03:04:05.000Z");
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: organisation.id,
          requesterId: person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: { summary: "Cannot sign in" },
          state: "new",
          submittedAt,
          createdAt: submittedAt,
          updatedAt: submittedAt,
        })
        .returning(),
      "submission",
    );
    await db.insert(schema.requestParticipantTable).values({
      submissionId: submission.id,
      personId: person.id,
      addedBy: person.id,
    });
    const customerMessageAt = new Date("2026-01-02T03:05:00.000Z");
    const firstResponseAt = new Date("2026-01-02T03:09:00.000Z");
    await db.insert(schema.submissionMessageTable).values([
      {
        submissionId: submission.id,
        authorId: person.id,
        actorType: "customer",
        body: "Details",
        createdAt: customerMessageAt,
      },
      {
        submissionId: submission.id,
        authorId: person.id,
        actorType: "triager",
        body: "We are checking",
        createdAt: firstResponseAt,
      },
    ]);
    const attachment = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: workspace.id,
          organisationId: organisation.id,
          submissionId: submission.id,
          submissionFieldKey: "evidence",
          objectKey: `pending/${randomUUID()}`,
          filename: "details.txt",
          mimeType: "text/plain",
          size: 6,
          state: "ready",
          customerVisible: true,
          uploadedBy: person.id,
        })
        .returning(),
      "submission attachment",
    );

    const outcomes = await Promise.allSettled([
      acceptSubmission(
        `SUB-${submission.number}`,
        workspace.id,
        person.id,
        project.id,
        chosenType.id,
      ),
      acceptSubmission(
        `SUB-${submission.number}`,
        workspace.id,
        person.id,
        project.id,
        chosenType.id,
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const [converted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, submission.id));
    expect(converted?.state).toBe("accepted");
    const workItemId = converted?.workItemId;
    if (!workItemId) throw new Error("Acceptance did not create a work item");
    const [item] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemId));
    if (!item) throw new Error("Converted work item was not persisted");
    expect(item?.title).toBe("Cannot sign in");
    expect(item?.typeId).toBe(chosenType.id);
    expect(item?.slaStartedAt?.toISOString()).toBe(submittedAt.toISOString());
    expect(item?.firstResponseAt?.toISOString()).toBe(
      firstResponseAt.toISOString(),
    );
    const [movedAttachment] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, attachment.id));
    expect(movedAttachment?.submissionId).toBeNull();
    expect(movedAttachment?.workItemId).toBe(item?.id);
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, item.id));
    expect(
      comments.map((comment) => comment.createdAt.toISOString()).sort(),
    ).toEqual(
      [customerMessageAt.toISOString(), firstResponseAt.toISOString()].sort(),
    );
    const [watcher] = await db
      .select()
      .from(schema.watcherTable)
      .where(eq(schema.watcherTable.workItemId, item.id));
    expect(watcher?.personId).toBe(person.id);
    const [participant] = await db
      .select()
      .from(schema.requestParticipantTable)
      .where(eq(schema.requestParticipantTable.workItemId, item.id));
    expect(participant?.personId).toBe(person.id);

    // IQ-7 permits a triager to override the pinned type, but only with a type in the
    // submission workspace. A foreign-workspace id fails closed before any item is made.
    const { workspace: otherWorkspace } = await createWorkspaceMember({
      role: "admin",
    });
    const foreignType = await makeWorkItemType(otherWorkspace.id);
    const secondSubmission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: organisation.id,
          requesterId: person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: { summary: "Another request" },
          state: "new",
        })
        .returning(),
      "second submission",
    );
    await expect(
      acceptSubmission(
        `SUB-${secondSubmission.number}`,
        workspace.id,
        person.id,
        project.id,
        foreignType.id,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const [notConverted] = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, secondSubmission.id));
    expect(notConverted?.state).toBe("new");
    expect(notConverted?.workItemId).toBeNull();
  });
});
