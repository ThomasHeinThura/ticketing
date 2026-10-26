/**
 * CH-2 existing-workspace CAB template: a pre-existing workspace has no CAB edges; applying the template adds
 * an Approved state, binds the change types to a new CAB-gated workflow and adopts Approved into the
 * named projects; other work types are untouched; it is refused while a project without the
 * Approved state would be left with stranded change items; a second apply is idempotent; and only
 * `workflow:manage` may apply it.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectManageAccess,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { serviceWorld } from "./helpers/p5-service";

beforeEach(resetTestDatabase);

function must<T>(value: T | undefined, context: string): T {
  if (value === undefined) throw new Error(`${context}: row missing`);
  return value;
}

type Offer = {
  toStateName: string;
  requiresCab: boolean;
  available: boolean;
  blockedBy: { reasonCode: string }[];
};

async function world() {
  const w = await serviceWorld();
  await seedWorkspaceDefaults(w.workspaceId);
  await seedProjectStates(w.project.id, w.workspaceId);

  async function itemIn(projectId: string, typeKey: string) {
    const [type] = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.workspaceId, w.workspaceId),
          eq(schema.workItemTypeTable.key, typeKey),
        ),
      );
    const [state] = await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(
        and(
          eq(schema.stateTable.projectId, projectId),
          eq(schema.stateTemplateTable.key, "to-do"),
        ),
      );
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: w.workspaceId,
          projectId,
          typeId: must(type, "type").id,
          stateId: must(state, "state").id,
          title: `Item ${typeKey}`,
          number: Math.floor(Math.random() * 1_000_000),
          key: `CABT-${randomUUID().slice(0, 8)}`,
        })
        .returning(),
      "item",
    );
  }

  async function offers(key: string) {
    const response = await w.ownerCall(`/api/work-items/${key}/transitions`);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Offer[];
  }

  const apply = (projectIds: string[], as = w.owner.user) =>
    w.as(as, "/api/change-cab-template", {
      method: "POST",
      body: { workspaceId: w.workspaceId, projectIds },
    });

  async function changeTypeEdges() {
    const [type] = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.workspaceId, w.workspaceId),
          eq(schema.workItemTypeTable.key, "change"),
        ),
      );
    const [workflow] = await db
      .select()
      .from(schema.workflowTable)
      .where(eq(schema.workflowTable.id, must(type, "type").workflowId ?? ""));
    const edges = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(
          schema.workflowTransitionTable.versionId,
          must(workflow, "workflow").activeVersionId ?? "",
        ),
      );
    return { workflow: must(workflow, "workflow"), edges };
  }

  async function otherProject() {
    const { project } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    await seedProjectStates(project.id, w.workspaceId);
    await grantProjectManageAccess(w.owner.user.id, project.id);
    await grantWorkItemProjectAccess(w.owner.user.id, project.id);
    return project;
  }

  return { ...w, itemIn, offers, apply, changeTypeEdges, otherProject };
}

describe("the CAB workflow template (CH-2)", () => {
  it("does not retrofit an existing workspace: no CAB edges until explicit apply", async () => {
    const t = await world();
    const { edges } = await t.changeTypeEdges();
    expect(edges.some((edge) => edge.requiresCab)).toBe(false);
    const status = await t.ownerCall(
      `/api/change-cab-template?workspaceId=${t.workspaceId}`,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      applied: false,
      approvedStateTemplateId: null,
    });
    const approved = await db
      .select()
      .from(schema.stateTemplateTable)
      .where(eq(schema.stateTemplateTable.key, "approved"));
    expect(approved).toHaveLength(0);
  });

  it("gates change approval on CAB, leaves other types alone and cannot be bypassed", async () => {
    const t = await world();
    const change = await t.itemIn(t.project.id, "change");
    const task = await t.itemIn(t.project.id, "task");
    const before = await t.offers(change.key);
    expect(before.map((offer) => offer.toStateName)).toContain("In Progress");

    const response = await t.apply([t.project.id]);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = (await response.json()) as {
      alreadyApplied: boolean;
      adoptedProjectIds: string[];
      versionNumber: number;
    };
    expect(result).toMatchObject({
      alreadyApplied: false,
      adoptedProjectIds: [t.project.id],
      versionNumber: 1,
    });

    // The new workflow is bound to the change type; the default graph is untouched.
    const { workflow, edges } = await t.changeTypeEdges();
    expect(workflow.key).toBe("change-cab");
    const cabEdges = edges.filter((edge) => edge.requiresCab);
    expect(cabEdges.length).toBeGreaterThan(0);
    expect(cabEdges.every((edge) => edge.approvalPolicy === "any")).toBe(true);
    const [defaultWorkflow] = await db
      .select()
      .from(schema.workflowTable)
      .where(
        and(
          eq(schema.workflowTable.workspaceId, t.workspaceId),
          eq(schema.workflowTable.key, "default"),
        ),
      );
    const defaultEdges = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(
          schema.workflowTransitionTable.versionId,
          must(defaultWorkflow, "default").activeVersionId ?? "",
        ),
      );
    expect(defaultEdges).toHaveLength(20);
    expect(defaultEdges.some((edge) => edge.requiresCab)).toBe(false);

    // A change in To Do can reach Approved only through the CAB edge, never straight to work.
    const after = await t.offers(change.key);
    const names = after.map((offer) => offer.toStateName);
    expect(names).toContain("Approved");
    expect(names).not.toContain("In Progress");
    expect(names).not.toContain("Done");
    const approvedOffer = after.find(
      (offer) => offer.toStateName === "Approved",
    );
    expect(approvedOffer?.requiresCab).toBe(true);
    expect(approvedOffer?.available).toBe(false);
    expect(approvedOffer?.blockedBy.map((b) => b.reasonCode)).toContain(
      "cab.pending",
    );
    const direct = await t.as(
      t.owner.user,
      `/api/work-items/${change.key}/transition`,
      {
        method: "POST",
        body: {
          toStateTemplateId: edges.find(
            (edge) => !edge.requiresCab && edge.toStateTemplateId,
          )?.toStateTemplateId,
        },
      },
    );
    expect(direct.status).toBeGreaterThanOrEqual(400);

    // A plain task keeps its direct edge.
    const taskOffers = await t.offers(task.key);
    expect(taskOffers.map((offer) => offer.toStateName)).toContain(
      "In Progress",
    );
    expect(taskOffers.map((offer) => offer.toStateName)).not.toContain(
      "Approved",
    );
  });

  it("is idempotent and lets a second project opt in later", async () => {
    const t = await world();
    const second = await t.otherProject();
    const first = await t.apply([t.project.id]);
    expect(await first.json()).toMatchObject({
      unadoptedProjects: [{ id: second.id }],
    });
    // A project created after the template exists adopts Approved with its default states.
    const later = await t.otherProject();
    const laterStates = await db
      .select({ key: schema.stateTemplateTable.key })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(eq(schema.stateTable.projectId, later.id));
    expect(laterStates.map((row) => row.key)).toContain("approved");
    const again = await t.apply([second.id]);
    expect(again.status, await again.clone().text()).toBe(200);
    expect(await again.json()).toMatchObject({
      alreadyApplied: true,
      adoptedProjectIds: [second.id],
      unadoptedProjects: [],
    });
    const repeat = await t.apply([t.project.id, second.id]);
    expect(await repeat.json()).toMatchObject({
      alreadyApplied: true,
      adoptedProjectIds: [],
    });
    const workflows = await db
      .select()
      .from(schema.workflowTable)
      .where(eq(schema.workflowTable.key, "change-cab"));
    expect(workflows).toHaveLength(1);
    const status = await t.ownerCall(
      `/api/change-cab-template?workspaceId=${t.workspaceId}`,
    );
    expect(await status.json()).toMatchObject({ applied: true });
  });

  it("refuses, writing nothing, while a project without Approved holds open changes", async () => {
    const t = await world();
    const other = await t.otherProject();
    await t.itemIn(other.id, "change");
    const refused = await t.apply([t.project.id]);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as {
      message: string;
      projects: { id: string }[];
    };
    expect(body.message).toBe("projects_would_strand_changes");
    expect(body.projects.map((p) => p.id)).toEqual([other.id]);
    expect(
      await db
        .select()
        .from(schema.workflowTable)
        .where(eq(schema.workflowTable.key, "change-cab")),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.stateTemplateTable)
        .where(eq(schema.stateTemplateTable.key, "approved")),
    ).toHaveLength(0);

    // Opting that project in too is accepted.
    const ok = await t.apply([t.project.id, other.id]);
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it("needs workflow:manage and a project of the workspace", async () => {
    const t = await world();
    expect((await t.apply([t.project.id], t.member.user)).status).toBe(403);
    expect((await t.apply([t.project.id], t.viewer.user)).status).toBe(403);
    expect((await t.apply([t.project.id], t.stranger.user)).status).toBe(403);
    const missing = await t.apply(["no-such-project"]);
    expect(missing.status).toBe(404);
    const unauthenticatedRead = await t.as(
      t.viewer.user,
      `/api/change-cab-template?workspaceId=${t.workspaceId}`,
    );
    expect(unauthenticatedRead.status).toBe(200);
  });
});
