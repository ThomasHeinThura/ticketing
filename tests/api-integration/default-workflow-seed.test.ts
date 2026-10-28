import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { DEFAULT_WORK_ITEM_TYPES } from "../../apps/api/src/utils/default-work-item-types";
import {
  defaultWorkflowId,
  seedDefaultWorkflow,
} from "../../apps/api/src/utils/seed-default-workflow";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);
async function fixture() {
  const owner = await createWorkspaceMember({ role: "admin" });
  await seedWorkspaceDefaults(owner.workspace.id);
  const { project } = await createProjectFixture({
    workspaceId: owner.workspace.id,
  });
  await seedProjectStates(project.id, owner.workspace.id);
  await grantWorkItemProjectAccess(owner.user.id, project.id);
  await db.insert(schema.sessionTable).values({
    id: `session-${owner.user.id}`,
    token: `token-${owner.user.id}`,
    userId: owner.user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockAuthenticatedSession(owner.user);
  const { app } = createApp();
  const cookie = `__Host-tdk_agent_session=token-${owner.user.id}`;
  const types = await db
    .select()
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, owner.workspace.id));
  const templates = await db
    .select()
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, owner.workspace.id));
  const states = await db
    .select()
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, project.id));
  const post = (path: string, body: unknown) =>
    csrfRequest(
      app,
      path,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      cookie,
    );
  const create = async (typeKey: string) => {
    const type = types.find((row) => row.key === typeKey);
    if (!type) throw new Error("Synthetic type missing");
    const response = await post(`/api/projects/${project.id}/work-items`, {
      typeId: type.id,
      title: "Synthetic default workflow journey",
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      id: string;
      key: string;
      stateId: string;
      version: number;
    }>;
  };
  return {
    owner,
    project,
    app,
    cookie,
    types,
    templates,
    states,
    post,
    create,
  };
}
async function graph(workspaceId: string) {
  const workflows = await db
    .select()
    .from(schema.workflowTable)
    .where(eq(schema.workflowTable.workspaceId, workspaceId));
  const workflow = workflows.find(
    (row) => row.id === defaultWorkflowId(workspaceId),
  );
  if (!workflow?.activeVersionId)
    throw new Error("Published default workflow missing");
  const versions = await db
    .select()
    .from(schema.workflowVersionTable)
    .where(eq(schema.workflowVersionTable.workflowId, workflow.id));
  const edges = await db
    .select()
    .from(schema.workflowTransitionTable)
    .where(
      eq(schema.workflowTransitionTable.versionId, workflow.activeVersionId),
    );
  return { workflows, workflow, versions, edges };
}

describe("validated persisted default workflow seeding", () => {
  it("publishes the twenty non-self edges and permits every directed default board move through the real API", async () => {
    const f = await fixture();
    const seeded = await graph(f.owner.workspace.id);
    expect(seeded.versions).toHaveLength(1);
    expect(seeded.versions[0]?.publishedAt).not.toBeNull();
    expect(seeded.edges).toHaveLength(20);
    expect(
      seeded.edges.every(
        (edge) =>
          edge.fromStateTemplateId !== edge.toStateTemplateId &&
          !edge.requiresApproval &&
          !edge.requiresCab &&
          !edge.roleId &&
          Array.isArray(edge.guards) &&
          edge.guards.length === 0 &&
          Array.isArray(edge.effects) &&
          edge.effects.length === 0,
      ),
    ).toBe(true);
    const reopen = seeded.edges.filter((edge) => edge.isReopen);
    expect(reopen).toHaveLength(1);
    expect(
      f.templates.find((row) => row.id === reopen[0]?.fromStateTemplateId)
        ?.group,
    ).toBe("completed");
    expect(
      f.templates.find((row) => row.id === reopen[0]?.toStateTemplateId)?.group,
    ).toBe("unstarted");
    const item = await f.create("task");
    // Euler tour traverses every directed edge once, through the actual workflow API.
    const adjacency = new Map(
      f.states.map((state) => [
        state.id,
        f.states
          .filter((other) => other.id !== state.id)
          .map((other) => other.id),
      ]),
    );
    const stack = [item.stateId];
    const circuit: string[] = [];
    while (stack.length) {
      const current = stack[stack.length - 1];
      if (!current) throw new Error("Tour state missing");
      const next = adjacency.get(current)?.pop();
      if (next) stack.push(next);
      else {
        circuit.push(current);
        stack.pop();
      }
    }
    const tour = circuit.reverse();
    expect(tour).toHaveLength(21);
    let version = item.version;
    for (const target of tour.slice(1)) {
      const offerResponse = await f.app.request(
        `/api/work-items/${item.key}/transitions`,
      );
      expect(offerResponse.status).toBe(200);
      const offers = (await offerResponse.json()) as {
        toStateId: string;
        toStateTemplateId: string;
        available: boolean;
      }[];
      expect(offers).toHaveLength(4);
      const offer = offers.find((row) => row.toStateId === target);
      expect(offer?.available).toBe(true);
      const response = await f.post(`/api/work-items/${item.key}/transition`, {
        toStateTemplateId: offer?.toStateTemplateId,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        stateId: target,
        version: ++version,
      });
    }
  });
  it("is idempotent and concurrent bootstrap produces one graph without changing existing rows", async () => {
    const owner = await createWorkspaceMember();
    await Promise.all([
      seedWorkspaceDefaults(owner.workspace.id),
      seedWorkspaceDefaults(owner.workspace.id),
    ]);
    const before = await graph(owner.workspace.id);
    const typesBefore = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.workspaceId, owner.workspace.id));
    expect(typesBefore).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
    expect(
      typesBefore.every((row) => row.workflowId === before.workflow.id),
    ).toBe(true);
    await Promise.all([
      seedDefaultWorkflow(owner.workspace.id),
      seedWorkspaceDefaults(owner.workspace.id),
    ]);
    expect(await graph(owner.workspace.id)).toEqual(before);
    expect(
      await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, owner.workspace.id)),
    ).toEqual(typesBefore);
  });
  it("repairs only builtin null-workflow types and preserves configured CAB/custom data and HELP-12", async () => {
    const f = await fixture();
    const custom = requireRow(
      await db
        .insert(schema.workflowTable)
        .values({
          workspaceId: f.owner.workspace.id,
          key: "customer-cab",
          name: "Customer CAB workflow",
        })
        .returning(),
      "customer workflow",
    );
    const version = requireRow(
      await db
        .insert(schema.workflowVersionTable)
        .values({ workflowId: custom.id, number: 1 })
        .returning(),
      "customer draft",
    );
    const from = f.templates.find((row) => row.group === "unstarted");
    const to = f.templates.find((row) => row.group === "completed");
    if (!from || !to) throw new Error("Template missing");
    await db.insert(schema.workflowTransitionTable).values({
      versionId: version.id,
      fromStateTemplateId: from.id,
      toStateTemplateId: to.id,
      requiresApproval: true,
      requiresCab: true,
      approvalPolicy: "any",
    });
    await db
      .update(schema.workflowVersionTable)
      .set({ publishedAt: new Date() })
      .where(eq(schema.workflowVersionTable.id, version.id));
    await db
      .update(schema.workflowTable)
      .set({ activeVersionId: version.id })
      .where(eq(schema.workflowTable.id, custom.id));
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: custom.id })
      .where(
        and(
          eq(schema.workItemTypeTable.workspaceId, f.owner.workspace.id),
          eq(schema.workItemTypeTable.key, "change"),
        ),
      );
    const task = f.types.find((row) => row.key === "task");
    if (!task) throw new Error("Task type missing");
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: null })
      .where(eq(schema.workItemTypeTable.id, task.id));
    const customType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: f.owner.workspace.id,
          key: "customer-type",
          name: "Customer type",
          category: "delivery",
        })
        .returning(),
      "customer type",
    );
    const initial = f.states.find((row) => row.stateTemplateId === from.id);
    if (!initial) throw new Error("Initial state missing");
    const existingItem = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: f.owner.workspace.id,
          projectId: f.project.id,
          typeId: task.id,
          stateId: initial.id,
          number: 12,
          key: "HELP-12",
          title: "Preserve walkthrough item",
          position: "12",
          version: 7,
        })
        .returning(),
      "walkthrough item",
    );
    const statesBefore = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, f.project.id));
    const customBefore = await db
      .select()
      .from(schema.workflowVersionTable)
      .where(eq(schema.workflowVersionTable.workflowId, custom.id));
    const edgesBefore = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(eq(schema.workflowTransitionTable.versionId, version.id));
    expect(await seedDefaultWorkflow(f.owner.workspace.id)).toMatchObject({
      attachedTypes: 1,
    });
    expect(
      requireRow(
        await db
          .select()
          .from(schema.workItemTypeTable)
          .where(eq(schema.workItemTypeTable.id, task.id)),
        "repaired type",
      ).workflowId,
    ).toBe(defaultWorkflowId(f.owner.workspace.id));
    expect(
      requireRow(
        await db
          .select()
          .from(schema.workItemTypeTable)
          .where(eq(schema.workItemTypeTable.id, customType.id)),
        "custom type",
      ).workflowId,
    ).toBeNull();
    expect(
      requireRow(
        await db
          .select()
          .from(schema.workItemTypeTable)
          .where(
            and(
              eq(schema.workItemTypeTable.workspaceId, f.owner.workspace.id),
              eq(schema.workItemTypeTable.key, "change"),
            ),
          ),
        "configured change",
      ).workflowId,
    ).toBe(custom.id);
    expect(
      await db
        .select()
        .from(schema.workflowVersionTable)
        .where(eq(schema.workflowVersionTable.workflowId, custom.id)),
    ).toEqual(customBefore);
    expect(
      await db
        .select()
        .from(schema.workflowTransitionTable)
        .where(eq(schema.workflowTransitionTable.versionId, version.id)),
    ).toEqual(edgesBefore);
    expect(
      await db
        .select()
        .from(schema.stateTable)
        .where(eq(schema.stateTable.projectId, f.project.id)),
    ).toEqual(statesBefore);
    expect(
      requireRow(
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, existingItem.id)),
        "preserved item",
      ),
    ).toEqual(existingItem);
    const change = await f.create("change");
    const response = await f.post(`/api/work-items/${change.key}/transition`, {
      toStateTemplateId: to.id,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      blockedBy: expect.arrayContaining([
        expect.objectContaining({ kind: "cab" }),
      ]),
    });
    const customResponse = await f.post(
      `/api/projects/${f.project.id}/work-items`,
      {
        typeId: customType.id,
        title: "Unconfigured custom workflow remains explicit",
      },
    );
    expect(customResponse.status).toBe(422);
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.typeId, customType.id)),
    ).toHaveLength(0);
  });
  it("fails atomically on an existing customer default key rather than adopting or overwriting it", async () => {
    const owner = await createWorkspaceMember();
    const existing = requireRow(
      await db
        .insert(schema.workflowTable)
        .values({
          id: `customer-${randomUUID()}`,
          workspaceId: owner.workspace.id,
          key: "default",
          name: "Customer-owned default",
        })
        .returning(),
      "customer default",
    );
    await expect(seedWorkspaceDefaults(owner.workspace.id)).rejects.toThrow(
      "collides with customer configuration",
    );
    expect(
      await db
        .select()
        .from(schema.workflowTable)
        .where(eq(schema.workflowTable.workspaceId, owner.workspace.id)),
    ).toEqual([existing]);
    expect(
      await db
        .select()
        .from(schema.workItemTypeTable)
        .where(eq(schema.workItemTypeTable.workspaceId, owner.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.workspaceId, owner.workspace.id)),
    ).toHaveLength(0);
  });
});
