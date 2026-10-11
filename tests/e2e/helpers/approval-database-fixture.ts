import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "../../api-integration/helpers/fixtures";

type Member = Awaited<ReturnType<typeof createWorkspaceMember>>;

async function personOf(userId: string) {
  return requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "approvals E2E staff person",
  );
}

export async function seedApprovalTenant(
  createWorkItem: (input: {
    projectId: string;
    typeId: string;
    title: string;
    requester: Member;
  }) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
) {
  const requester = await createWorkspaceMember({ role: "owner" });
  const requesterPerson = await personOf(requester.user.id);
  const { project } = await createProjectFixture({
    workspaceId: requester.workspace.id,
    slug: `approval-e2e-${randomUUID().slice(0, 10)}`,
  });
  await grantProjectRole(requester.user.id, project.id, [
    "project:read",
    "work_item:read",
    "work_item:create",
    "work_item:transition",
    "approval:request",
    "approval:request_cab",
    "approval:decide",
    "approval:decide_cab",
  ]);

  const workspaceId = requester.workspace.id;
  const now = new Date();
  const template = async (group: string, name: string) =>
    requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId,
          key: `${name.toLowerCase().replaceAll(" ", "-")}-${randomUUID()}`,
          name,
          group,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "approvals E2E state template",
    );
  const backlog = await template("backlog", "Backlog");
  const done = await template("completed", "Done");
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId,
        key: `approval-e2e-${randomUUID()}`,
        name: "Approvals E2E workflow",
      })
      .returning(),
    "approvals E2E workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: now })
      .returning(),
    "approvals E2E workflow version",
  );
  const transition = requireRow(
    await db
      .insert(schema.workflowTransitionTable)
      .values({
        versionId: version.id,
        fromStateTemplateId: backlog.id,
        toStateTemplateId: done.id,
        requiresApproval: true,
        requiresCab: false,
        approvalPolicy: "any",
        notePolicy: "none",
        noteVisibility: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "approvals E2E gated transition",
  );
  await db.insert(schema.workflowTransitionTable).values({
    versionId: version.id,
    fromStateTemplateId: done.id,
    toStateTemplateId: backlog.id,
    requiresApproval: false,
    requiresCab: false,
    approvalPolicy: "any",
    notePolicy: "none",
    noteVisibility: "internal",
    createdAt: now,
    updatedAt: now,
  });
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));

  const states = await db
    .insert(schema.stateTable)
    .values([
      {
        projectId: project.id,
        stateTemplateId: backlog.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project.id,
        stateTemplateId: done.id,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .returning();
  if (states.length !== 2)
    throw new Error("Approvals E2E states were not created.");

  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `approval-e2e-${randomUUID()}`,
        name: "Approvals E2E change",
        category: "service",
        workflowId: workflow.id,
        isChange: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "approvals E2E work item type",
  );

  const approver = await createWorkspaceMember({
    role: "owner",
    userName: "Approvals E2E Approver",
  });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: approver.user.id,
    role: "owner",
    joinedAt: now,
  });
  await grantProjectRole(approver.user.id, project.id, [
    "project:read",
    "work_item:read",
    "approval:decide",
    "approval:decide_cab",
  ]);
  const approverPerson = await personOf(approver.user.id);
  await db
    .update(schema.personTable)
    .set({ displayName: approver.user.name })
    .where(eq(schema.personTable.id, approverPerson.id));
  const cabTeam = requireRow(
    await db
      .insert(schema.teamTable)
      .values({
        id: `approval-e2e-cab-${randomUUID()}`,
        name: "Approvals E2E CAB",
        workspaceId,
        isCab: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "approvals E2E CAB team",
  );
  await db.insert(schema.teamMemberTable).values([
    {
      id: `approval-e2e-cab-approver-${randomUUID()}`,
      teamId: cabTeam.id,
      userId: approver.user.id,
      createdAt: now,
    },
    {
      id: `approval-e2e-cab-requester-${randomUUID()}`,
      teamId: cabTeam.id,
      userId: requester.user.id,
      createdAt: now,
    },
  ]);

  const title = "Approvals E2E work item";
  const created = await createWorkItem({
    projectId: project.id,
    typeId: type.id,
    title,
    requester,
  });
  if (!created.ok) {
    throw new Error(
      "The deployed API refused to create the approvals E2E work item.",
    );
  }
  const item = (await created.json()) as { id: string; key: string };
  await db
    .update(schema.workItemTable)
    .set({ customerVisibility: "organisation" })
    .where(eq(schema.workItemTable.id, item.id));
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId,
    featureKey: "feature.approvals",
    enabled: true,
  });

  return {
    requester,
    requesterPerson,
    approver,
    approverPerson,
    workspaceId,
    project,
    type,
    transition,
    backlog,
    done,
    key: item.key,
  };
}

export async function addApprovalE2ECustomer(workspaceId: string) {
  const organisationId = `approval-e2e-customer-org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id: organisationId,
    key: organisationId,
    name: "Approvals E2E customer",
    isInternal: false,
    portalAccess: true,
  });
  await db
    .update(schema.workspaceTable)
    .set({ organisationId })
    .where(eq(schema.workspaceTable.id, workspaceId));

  const customerRole = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "organisation",
        workspaceId: null,
        key: "customer",
        name: "Customer",
        rank: 0,
        capabilities: ["approval:decide", "work_item:read"],
      })
      .returning(),
    "approvals E2E customer role",
  );
  const customerId = `approval-e2e-customer-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: customerId,
        name: "Approvals E2E customer",
        email: `${customerId}@example.test`,
      })
      .returning(),
    "approvals E2E customer user",
  );
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: user.id,
        organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "approvals E2E customer person",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: organisationId,
    roleId: customerRole.id,
    seesAll: false,
  });
  return { user, person, organisationId };
}
