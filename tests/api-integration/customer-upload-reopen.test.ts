/** WF-21: completing an accepted submission upload uses the shared customer reopen path. */
import { randomUUID } from "node:crypto";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as storage from "../../apps/api/src/storage";
import { executeSystemTransition } from "../../apps/api/src/work-item/controllers/transition-work-item";
import { setSystemTransitionExecutor } from "../../apps/api/src/workflow/system-transition";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function createUploadWorld(withReopenEdge: boolean) {
  const staff = await createWorkspaceMember({ role: "admin" });
  const customer = await createCustomerPrincipal();
  const { project } = await createProjectFixture({
    workspaceId: staff.workspace.id,
  });
  const template = async (name: string, group: "started" | "completed") =>
    requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: staff.workspace.id,
          key: `${name}-${randomUUID()}`,
          name,
          group,
        })
        .returning(),
      `${name} template`,
    );
  const resolvedTemplate = await template("Resolved", "completed");
  const openTemplate = await template("Open", "started");
  const [resolvedState, openState] = await db
    .insert(schema.stateTable)
    .values([
      { projectId: project.id, stateTemplateId: resolvedTemplate.id },
      { projectId: project.id, stateTemplateId: openTemplate.id },
    ])
    .returning();
  if (!resolvedState || !openState) throw new Error("states were not created");
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: staff.workspace.id,
        key: `workflow-${randomUUID()}`,
        name: "Request workflow",
      })
      .returning(),
    "workflow",
  );
  const workflowVersion = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "workflow version",
  );
  if (withReopenEdge) {
    await db.insert(schema.workflowTransitionTable).values({
      versionId: workflowVersion.id,
      fromStateTemplateId: resolvedTemplate.id,
      toStateTemplateId: openTemplate.id,
      isReopen: true,
      guards: [],
      effects: [],
    });
  }
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: workflowVersion.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: staff.workspace.id,
        key: `request-${randomUUID()}`,
        name: "Request",
        category: "service",
        workflowId: workflow.id,
      })
      .returning(),
    "work item type",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: staff.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: resolvedState.id,
        number: 1,
        key: `${project.slug}-1`,
        title: "Resolved request",
        resolvedAt: new Date(),
      })
      .returning(),
    "resolved request",
  );
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: staff.workspace.id,
        key: `request-type-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: type.id,
        formSchema: { fields: [] },
      })
      .returning(),
    "request type",
  );
  const requestTypeVersion = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: staff.workspace.id,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: type.id,
      })
      .returning(),
    "request type version",
  );
  const submission = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: customer.orgId,
        requesterId: customer.person.id,
        requestTypeId: requestType.id,
        requestTypeVersionId: requestTypeVersion.id,
        formData: {},
        state: "accepted",
        submittedAt: new Date(),
        workItemId: item.id,
      })
      .returning(),
    "accepted submission",
  );
  const attachment = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        workspaceId: staff.workspace.id,
        organisationId: customer.orgId,
        workItemId: item.id,
        objectKey: `pending/${randomUUID()}`,
        filename: "customer-upload.txt",
        mimeType: "text/plain",
        size: 4,
        state: "pending",
        customerVisible: true,
        uploadedBy: customer.person.id,
      })
      .returning(),
    "pending upload",
  );
  const identity = await resolveIdentity({
    userId: customer.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("customer identity was not resolved");
  return {
    staff,
    customer,
    item,
    submission,
    attachment,
    identity,
    workspaceId: staff.workspace.id,
    openStateId: openState.id,
  };
}

async function complete(
  world: Awaited<ReturnType<typeof createUploadWorld>>,
  identity: ResolvedIdentity | null | undefined = world.identity,
) {
  return completeSubmissionAttachment({
    attachmentId: world.attachment.id,
    submissionId: world.submission.id,
    submissionWorkItemId: world.item.id,
    requesterId: world.customer.person.id,
    workspaceId: world.workspaceId,
    identity: identity ?? null,
  });
}

describe("WF-21 reopen after a customer upload", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    setSystemTransitionExecutor(executeSystemTransition);
    vi.spyOn(storage, "finalizeStorageObject").mockResolvedValue();
    vi.spyOn(storage, "getObjectSizeAndHeader").mockResolvedValue({
      contentLength: 4,
      header: Buffer.from("text"),
    });
  });

  afterEach(() => {
    setSystemTransitionExecutor(null);
    vi.restoreAllMocks();
  });

  it("completes the upload and reopens through the configured is_reopen edge once", async () => {
    const w = await createUploadWorld(true);
    const ready = await complete(w);
    expect(ready.state).toBe("ready");

    const [item] = await db
      .select({ stateId: schema.workItemTable.stateId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, w.item.id));
    expect(item?.stateId).toBe(w.openStateId);
    const received = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, w.item.id),
          eq(schema.activityTable.verb, "reopen_received"),
        ),
      );
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ actorId: null, actorType: "system" });
    const transitions = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, w.item.id),
          eq(schema.activityTable.verb, "transitioned"),
        ),
      );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      actorId: null,
      actorType: "system",
    });

    await expect(complete(w)).rejects.toMatchObject({ status: 409 });
    expect(
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, w.item.id)),
    ).toHaveLength(2);
  });

  it("keeps the resolved request and writes the existing staff flag when no reopen edge exists", async () => {
    const w = await createUploadWorld(false);
    await complete(w);
    const [item] = await db
      .select({ stateId: schema.workItemTable.stateId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, w.item.id));
    expect(item?.stateId).toBe(w.item.stateId);
    const flags = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, w.item.id),
          eq(schema.activityTable.verb, "reopen_requested"),
        ),
      );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      visibility: "internal",
      actorId: null,
      actorType: "system",
    });
  });

  it("rejects a staff identity, a different customer, or an inactive customer", async () => {
    const w = await createUploadWorld(true);
    const staffIdentity = await resolveIdentity({
      userId: w.staff.user.id,
      credential: "session",
    });
    await expect(complete(w, staffIdentity)).rejects.toMatchObject({
      status: 404,
    });

    const other = await createCustomerPrincipal();
    const otherIdentity = await resolveIdentity({
      userId: other.user.id,
      credential: "session",
    });
    await expect(complete(w, otherIdentity)).rejects.toMatchObject({
      status: 404,
    });

    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, w.customer.person.id));
    const [inactivePerson] = await db
      .select({ active: schema.personTable.active })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, w.customer.person.id));
    expect(inactivePerson?.active).toBe(false);
    const inactiveIdentity = await resolveIdentity({
      userId: w.customer.user.id,
      credential: "session",
    });
    expect(inactiveIdentity).toBeNull();
    await expect(complete(w, inactiveIdentity)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, w.item.id)),
    ).toHaveLength(0);
  });
});
