/**
 * WF-19 / WF-21 / AU-9 through the REAL system-actor executor and the real reconstruction
 * query. Written, NOT YET RUN: needs the integration database (coordinator runs it).
 */
import { randomUUID } from "node:crypto";
import { reconstructAt } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listActivityForReconstruction } from "../../apps/api/src/audit/work-item-history.repository";
import db, { schema } from "../../apps/api/src/database";
import { postSubmissionMessage } from "../../apps/api/src/intake/repository";
import { runScheduledTransitions } from "../../apps/api/src/scheduler/scheduled-transition";
import { recordWorkItemActivity } from "../../apps/api/src/work-item/activity";
import transitionWorkItem, {
  executeSystemTransition,
} from "../../apps/api/src/work-item/controllers/transition-work-item";
import { cancelPendingScheduledTransitions } from "../../apps/api/src/work-item/scheduled-transition-cancel";
import { requestCustomerReopen } from "../../apps/api/src/workflow/customer-reopen";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

type Edge = {
  from: string;
  to: string;
  roleId?: string | null;
  requiresApproval?: boolean;
  isReopen?: boolean;
  guards?: { type: string }[];
};

async function world(edges: (t: Record<string, string>) => Edge[]) {
  const owner = await createWorkspaceMember({ role: "admin" });
  const workspaceId = owner.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const templates: Record<string, string> = {};
  const states: Record<string, string> = {};
  for (const [name, group] of [
    ["open", "started"],
    ["waiting", "started"],
    ["resolved", "completed"],
    ["closed", "completed"],
  ] as const) {
    const t = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({ workspaceId, key: randomUUID(), name, group })
        .returning(),
      "template",
    );
    templates[name] = t.id;
    states[name] = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId: project.id, stateTemplateId: t.id })
        .returning(),
      "state",
    ).id;
  }
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: randomUUID(), name: "W" })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "version",
  );
  const rows = await db
    .insert(schema.workflowTransitionTable)
    .values(
      edges(templates).map((e) => ({
        versionId: version.id,
        fromStateTemplateId: e.from,
        toStateTemplateId: e.to,
        roleId: e.roleId ?? null,
        requiresApproval: e.requiresApproval ?? false,
        approvalPolicy: e.requiresApproval ? "any" : null,
        isReopen: e.isReopen ?? false,
        guards: e.guards ?? [],
        effects: [],
      })),
    )
    .returning();
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "T",
        category: "service",
        workflowId: workflow.id,
      })
      .returning(),
    "type",
  );
  let n = 0;
  const makeItem = async (state: string, resolvedAt: Date | null = null) => {
    n++;
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId,
          projectId: project.id,
          typeId: type.id,
          stateId: states[state] as string,
          number: n,
          key: `${project.slug}-${n}`,
          title: `Item ${n}`,
          resolvedAt,
        })
        .returning(),
      "item",
    );
  };
  return { owner, workspaceId, project, templates, states, rows, makeItem };
}

type World = Awaited<ReturnType<typeof world>>;

async function hop(w: World, itemId: string, from: string, to: string) {
  const anyEdge = requireRow(w.rows.slice(0, 1), "edge");
  return requireRow(
    await db
      .insert(schema.scheduledTransitionTable)
      .values({
        projectId: w.project.id,
        workItemId: itemId,
        transitionId: anyEdge.id,
        fromStateId: w.states[from] as string,
        toStateId: w.states[to] as string,
        dueAt: new Date(Date.now() - 5 * 60_000),
      })
      .returning(),
    "scheduled row",
  );
}

const activityOf = (itemId: string, verb: string) =>
  db
    .select()
    .from(schema.activityTable)
    .where(
      and(
        eq(schema.activityTable.workItemId, itemId),
        eq(schema.activityTable.verb, verb),
      ),
    );
const stateOf = async (itemId: string) =>
  (
    await db
      .select({ s: schema.workItemTable.stateId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, itemId))
  )[0]?.s;
const rowState = async (id: string) =>
  (
    await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(eq(schema.scheduledTransitionTable.id, id))
  )[0]?.state;

describe("WF-19 scheduled hop through the real executor", () => {
  beforeEach(async () => resetTestDatabase());

  it("applies the stored hop once as the system actor, with no edge in the workflow", async () => {
    const w = await world((t) => [
      { from: t.open as string, to: t.waiting as string },
    ]);
    const item = await w.makeItem("waiting");
    const row = await hop(w, item.id, "waiting", "resolved");
    const first = await runScheduledTransitions(executeSystemTransition);
    expect(first.fired).toBe(1);
    expect(await stateOf(item.id)).toBe(w.states.resolved);
    expect(await rowState(row.id)).toBe("fired");
    const [activity] = await activityOf(item.id, "transitioned");
    expect(activity).toMatchObject({ actorType: "system", actorId: null });
    await runScheduledTransitions(executeSystemTransition);
    expect(await activityOf(item.id, "transitioned")).toHaveLength(1);
  });

  it("two concurrent runs fire the row exactly once", async () => {
    const w = await world((t) => [
      { from: t.open as string, to: t.waiting as string },
    ]);
    const item = await w.makeItem("waiting");
    await hop(w, item.id, "waiting", "resolved");
    await Promise.all([
      runScheduledTransitions(executeSystemTransition),
      runScheduledTransitions(executeSystemTransition),
    ]);
    expect(await activityOf(item.id, "transitioned")).toHaveLength(1);
    expect(await stateOf(item.id)).toBe(w.states.resolved);
  });

  it("refuses a hop whose current edge needs approval: cancelled and flagged, item unchanged", async () => {
    const w = await world((t) => [
      {
        from: t.waiting as string,
        to: t.resolved as string,
        requiresApproval: true,
      },
    ]);
    const item = await w.makeItem("waiting");
    const row = await hop(w, item.id, "waiting", "resolved");
    const outcome = await runScheduledTransitions(executeSystemTransition);
    expect(outcome.fired).toBe(0);
    expect(outcome.cancelled).toBeGreaterThanOrEqual(1);
    expect(await stateOf(item.id)).toBe(w.states.waiting);
    expect(await rowState(row.id)).toBe("cancelled");
    const [flag] = await activityOf(item.id, "scheduled_transition_cancelled");
    expect(flag?.visibility).toBe("internal");
  });

  it("a null identity skips role legality only: a role-gated edge still applies", async () => {
    const w = await world((t) => [
      { from: t.waiting as string, to: t.resolved as string, roleId: null },
    ]);
    // Role-gate the edge to a role nobody holds.
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: w.workspaceId,
          key: `nobody-${randomUUID()}`,
          name: "Nobody",
          rank: 999,
        })
        .returning(),
      "role",
    );
    await db.update(schema.workflowTransitionTable).set({ roleId: role.id });
    const item = await w.makeItem("waiting");
    await hop(w, item.id, "waiting", "resolved");
    expect((await runScheduledTransitions(executeSystemTransition)).fired).toBe(
      1,
    );
    expect(await stateOf(item.id)).toBe(w.states.resolved);
  });

  async function secondRole(w: World) {
    return requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: w.workspaceId,
          key: `other-${randomUUID()}`,
          name: "Other",
          rank: 998,
        })
        .returning(),
      "role",
    );
  }

  // S2: two edges for one template pair, one gated and one not; the outcome must not depend
  // on which one the version lists first.
  for (const gatedFirst of [true, false]) {
    it(`refuses a hop when one of two edges for the pair needs approval (gated listed ${gatedFirst ? "first" : "second"})`, async () => {
      const w = await world((t) => {
        const gated = {
          from: t.waiting as string,
          to: t.resolved as string,
          requiresApproval: true,
        };
        const plain = { from: t.waiting as string, to: t.resolved as string };
        return gatedFirst ? [gated, plain] : [plain, gated];
      });
      // Distinguish the two edges by role (the pair is unique per role).
      const role = await secondRole(w);
      const plainRow = w.rows.find((r) => !r.requiresApproval);
      await db
        .update(schema.workflowTransitionTable)
        .set({ roleId: role.id })
        .where(eq(schema.workflowTransitionTable.id, plainRow?.id as string));
      const item = await w.makeItem("waiting");
      const row = await hop(w, item.id, "waiting", "resolved");
      const outcome = await runScheduledTransitions(executeSystemTransition);
      expect(outcome.fired).toBe(0);
      expect(await stateOf(item.id)).toBe(w.states.waiting);
      expect(await rowState(row.id)).toBe("cancelled");
    });
  }

  for (const guardedFirst of [true, false]) {
    it(`refuses a hop when any matching edge's guard fails (guarded listed ${guardedFirst ? "first" : "second"})`, async () => {
      const w = await world((t) => {
        const guarded = {
          from: t.waiting as string,
          to: t.resolved as string,
          guards: [{ type: "assignee_present" }],
        };
        const plain = { from: t.waiting as string, to: t.resolved as string };
        return guardedFirst ? [guarded, plain] : [plain, guarded];
      });
      const role = await secondRole(w);
      const plainRow = w.rows.find((r) => (r.guards as unknown[]).length === 0);
      await db
        .update(schema.workflowTransitionTable)
        .set({ roleId: role.id })
        .where(eq(schema.workflowTransitionTable.id, plainRow?.id as string));
      const item = await w.makeItem("waiting"); // no assignee: the guard fails
      await hop(w, item.id, "waiting", "resolved");
      expect(
        (await runScheduledTransitions(executeSystemTransition)).fired,
      ).toBe(0);
      expect(await stateOf(item.id)).toBe(w.states.waiting);
    });
  }

  it("cancels quietly (no flag) a hop whose item left from_state_id", async () => {
    const w = await world((t) => [
      { from: t.open as string, to: t.waiting as string },
    ]);
    const item = await w.makeItem("open");
    const row = await hop(w, item.id, "waiting", "resolved");
    await runScheduledTransitions(executeSystemTransition);
    expect(await rowState(row.id)).toBe("cancelled");
    expect(await stateOf(item.id)).toBe(w.states.open);
    expect(
      await activityOf(item.id, "scheduled_transition_cancelled"),
    ).toHaveLength(0);
  });
});

describe("R4: leaving a state cancels its pending hops in the transition transaction", () => {
  beforeEach(async () => resetTestDatabase());

  it("a B->A bounce cancels the stale row before the sweep runs", async () => {
    const w = await world((t) => [
      { from: t.waiting as string, to: t.open as string },
      { from: t.open as string, to: t.waiting as string },
    ]);
    const item = await w.makeItem("waiting");
    const stale = await hop(w, item.id, "waiting", "resolved");
    await transitionWorkItem(item.id, null, null, null, "system", {
      toStateTemplateId: w.templates.open as string,
    });
    expect(await rowState(stale.id)).toBe("cancelled");
  });

  it("the helper keeps rows waiting in the excepted state and cancels the rest", async () => {
    const w = await world((t) => [
      { from: t.open as string, to: t.waiting as string },
    ]);
    const item = await w.makeItem("waiting");
    const keep = await hop(w, item.id, "waiting", "resolved");
    const drop = await hop(w, item.id, "open", "resolved");
    await db.transaction((tx) =>
      cancelPendingScheduledTransitions(tx, item.id, {
        exceptFromStateId: w.states.waiting as string,
      }),
    );
    expect(await rowState(keep.id)).toBe("pending");
    expect(await rowState(drop.id)).toBe("cancelled");
    await db.transaction((tx) =>
      cancelPendingScheduledTransitions(tx, item.id),
    );
    expect(await rowState(keep.id)).toBe("cancelled");
  });
});

describe("WF-21 customer reopen through the real executor", () => {
  beforeEach(async () => resetTestDatabase());

  it("reopens a resolved item through the is_reopen edge as the system actor", async () => {
    const w = await world((t) => [
      {
        from: t.resolved as string,
        to: t.open as string,
        isReopen: true,
      },
    ]);
    const item = await w.makeItem("resolved", new Date());
    const result = await requestCustomerReopen({
      workItemId: item.id,
      source: "reply",
    });
    expect(result).toEqual({ kind: "reopened" });
    expect(await stateOf(item.id)).toBe(w.states.open);
    const [activity] = await activityOf(item.id, "transitioned");
    expect(activity).toMatchObject({ actorType: "system", actorId: null });
  });

  it("writes the flagged internal row when the version has no is_reopen edge", async () => {
    const w = await world((t) => [
      { from: t.resolved as string, to: t.open as string },
    ]);
    const item = await w.makeItem("resolved", new Date());
    const result = await requestCustomerReopen({
      workItemId: item.id,
      source: "upload",
    });
    expect(result).toEqual({
      kind: "flagged",
      reason: "no_reopen_transition",
      duplicate: false,
    });
    expect(await stateOf(item.id)).toBe(w.states.resolved);
    const [flag] = await activityOf(item.id, "reopen_requested");
    expect(flag).toMatchObject({ visibility: "internal", actorType: "system" });

    // One flag per pending refusal: a second identical refusal is reported as a duplicate and
    // writes no further staff flag.
    expect(
      await requestCustomerReopen({ workItemId: item.id, source: "upload" }),
    ).toEqual({
      kind: "flagged",
      reason: "no_reopen_transition",
      duplicate: true,
    });
    expect(await activityOf(item.id, "reopen_requested")).toHaveLength(1);
  });

  it("flags a reopen outside the window and a reopen edge that needs approval", async () => {
    const w = await world((t) => [
      {
        from: t.resolved as string,
        to: t.open as string,
        isReopen: true,
        requiresApproval: true,
      },
    ]);
    const old = await w.makeItem(
      "resolved",
      new Date(Date.now() - 400 * 86_400_000),
    );
    expect(
      await requestCustomerReopen({ workItemId: old.id, source: "reply" }),
    ).toEqual({
      kind: "flagged",
      reason: "outside_reopen_window",
      duplicate: false,
    });
    const fresh = await w.makeItem("resolved", new Date());
    expect(
      await requestCustomerReopen({ workItemId: fresh.id, source: "reply" }),
    ).toEqual({ kind: "flagged", reason: "reopen_blocked", duplicate: false });
    expect(await stateOf(fresh.id)).toBe(w.states.resolved);
  });
});

describe("AU-9 reconstruction of state at several instants", () => {
  beforeEach(async () => resetTestDatabase());

  it("answers state at creation, after each transition and across a project move", async () => {
    const w = await world((t) => [
      { from: t.open as string, to: t.waiting as string },
      { from: t.waiting as string, to: t.resolved as string },
    ]);
    const item = await w.makeItem("open");
    const base = Date.now() - 10 * 86_400_000;
    const day = (n: number) => new Date(base + n * 86_400_000);
    await recordWorkItemActivity(db, [
      {
        workspaceId: w.workspaceId,
        workItemId: item.id,
        actorId: null,
        actorType: "system",
        verb: "created",
        payload: { key: item.key, title: item.title },
        createdAt: day(0),
      },
    ]);
    // Two real transitions (system actor), then back-date their journal rows.
    await transitionWorkItem(item.id, null, null, null, "system", {
      toStateTemplateId: w.templates.waiting as string,
    });
    await transitionWorkItem(item.id, null, null, null, "system", {
      toStateTemplateId: w.templates.resolved as string,
    });
    const transitions = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, item.id),
          eq(schema.activityTable.verb, "transitioned"),
        ),
      )
      .orderBy(schema.activityTable.seq);
    expect(transitions).toHaveLength(2);
    for (const [i, row] of transitions.entries())
      await db
        .update(schema.activityTable)
        .set({ createdAt: day(2 + i * 3) })
        .where(eq(schema.activityTable.id, row.id));

    const stateAt = async (at: Date) => {
      const { rows, current } = await listActivityForReconstruction(
        w.workspaceId,
        item.id,
        at,
      );
      return reconstructAt(rows, at, { current })?.fields.stateId;
    };
    expect(await stateAt(day(1))).toBe(w.states.open);
    expect(await stateAt(day(2))).toBe(w.states.waiting);
    expect(await stateAt(day(4))).toBe(w.states.waiting);
    expect(await stateAt(day(5))).toBe(w.states.resolved);
    expect(await stateAt(day(9))).toBe(w.states.resolved);
    expect(await stateAt(new Date(base - 86_400_000))).toBeUndefined();

    // A project move journals field `project` with the remapped state ids in its payload.
    await recordWorkItemActivity(db, [
      {
        workspaceId: w.workspaceId,
        workItemId: item.id,
        actorId: null,
        actorType: "system",
        verb: "updated",
        field: "project",
        oldValue: { projectId: w.project.id, key: item.key },
        newValue: { projectId: "other-project", key: "OTH-1" },
        payload: {
          fromStateId: w.states.resolved,
          toStateId: w.states.open,
        },
        visibility: "internal",
        createdAt: day(7),
      },
    ]);
    await db
      .update(schema.workItemTable)
      .set({ stateId: w.states.open as string })
      .where(eq(schema.workItemTable.id, item.id));
    expect(await stateAt(day(6))).toBe(w.states.resolved);
    expect(await stateAt(day(8))).toBe(w.states.open);
    expect(await stateAt(day(1))).toBe(w.states.open);
  });
});

describe("WF-21 customer reply on a resolved request, through the real reply path", () => {
  beforeEach(async () => resetTestDatabase());

  async function acceptedSubmission(w: World, itemId: string) {
    const principal = await createCustomerPrincipal();
    const type = requireRow(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, itemId)),
      "item",
    );
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: w.workspaceId,
          key: `req-${randomUUID()}`,
          name: "Help",
          group: "General",
          workItemTypeId: type.typeId,
          formSchema: { fields: [] },
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: w.workspaceId,
          requestTypeId: requestType.id,
          number: 1,
          formSchema: { fields: [] },
          workItemTypeId: type.typeId,
        })
        .returning(),
      "version",
    );
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: principal.orgId,
          requesterId: principal.person.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: version.id,
          formData: {},
          state: "accepted",
          submittedAt: new Date(),
          workItemId: itemId,
        })
        .returning(),
      "submission",
    );
    return { principal, submission };
  }

  const warningFlags = async (itemId: string) =>
    (await activityOf(itemId, "reopen_requested")).filter(
      (row) => row.visibility === "internal",
    );

  it("a successful reopen leaves exactly one transition and zero warning flags", async () => {
    const w = await world((t) => [
      { from: t.resolved as string, to: t.open as string, isReopen: true },
    ]);
    const item = await w.makeItem("resolved", new Date());
    const { principal, submission } = await acceptedSubmission(w, item.id);
    await postSubmissionMessage({
      ref: `SUB-${submission.number}`,
      requesterId: principal.person.id,
      actorId: principal.person.id,
      actorType: "customer",
      body: "Still broken",
    });
    expect(await stateOf(item.id)).toBe(w.states.open);
    expect(await activityOf(item.id, "transitioned")).toHaveLength(1);
    expect(await warningFlags(item.id)).toHaveLength(0);
  });

  it("a refused reopen leaves exactly one warning flag and the item resolved", async () => {
    const w = await world((t) => [
      { from: t.resolved as string, to: t.open as string },
    ]);
    const item = await w.makeItem("resolved", new Date());
    const { principal, submission } = await acceptedSubmission(w, item.id);
    await postSubmissionMessage({
      ref: `SUB-${submission.number}`,
      requesterId: principal.person.id,
      actorId: principal.person.id,
      actorType: "customer",
      body: "Still broken",
    });
    expect(await stateOf(item.id)).toBe(w.states.resolved);
    const flags = await warningFlags(item.id);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.payload).toMatchObject({ reason: "no_reopen_transition" });
  });
});
