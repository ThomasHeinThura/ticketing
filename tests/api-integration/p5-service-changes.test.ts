/**
 * P5 changes (CH-1..CH-6): the change satellite feeds risk and rollback plan into workflow
 * transition guards, the CAB-gated approval needs a rollback plan and no active freeze, freezes
 * are declared and cancelled, the calendar flags same-service conflicts and frozen windows, access
 * is capability and tenant scoped, and the elevated override spends a real step-up proof.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import {
  changeDetailTable,
  changeFreezeTable,
} from "../../apps/api/src/database/schema-p5-service";
import { createApp } from "../../apps/api/src/index";
import {
  buildTenant,
  createApproval,
  runTransition,
  setApproval,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { workItemWorld } from "./helpers/p4-closeout";
import {
  changeDetailOf,
  insertFreeze,
  serviceWorld,
  setServiceFlag,
} from "./helpers/p5-service";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "./helpers/step-up";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

const iso = (offsetDays: number, hour = 0) =>
  new Date(Date.UTC(2031, 0, 10 + offsetDays, hour)).toISOString();

const json = { "content-type": "application/json" };

type ChangeBody = {
  detail: { risk: string | null; rollbackPlan: string | null } | null;
  cabRequired: boolean;
  rollbackPlanPresent: boolean;
  retrospective: boolean;
  freeze: {
    blocked: boolean;
    overridden: boolean;
    freezes: { name: string }[];
    override: { reason: string | null } | null;
  };
  services: { id: string }[];
  impact: { services: number; customers: number };
  conflicts: { key: string }[];
};

beforeEach(async () => resetTestDatabase());

async function tenantWithCatalogue() {
  const t = await buildTenant("chg", { executable: true });
  await setServiceFlag(t.workspaceId, true);
  await grantProjectRole(t.requester.user.id, t.project.id, ["change:manage"]);
  const call = async (
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> => {
    mockAuthenticatedSession(t.requester.user);
    return await t.app.request(path, {
      method: init.method ?? "GET",
      headers: json,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  };
  const patch = async (body: unknown) => {
    const response = await call(`/api/work-items/${t.key}/change`, {
      method: "PATCH",
      body,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as ChangeBody;
  };
  /** A CAB approval that is approved, so only the change gates remain. */
  async function approveCab() {
    const approval = await createApproval(t);
    await db
      .update(schema.approvalTable)
      .set({ transitionId: t.cabOnly.id })
      .where(eq(schema.approvalTable.id, approval.id));
    await setApproval(t, approval.id);
  }
  async function reasons(response: Response) {
    return (
      (await response.json()) as { blockedBy: { reasonCode: string }[] }
    ).blockedBy.map((b) => b.reasonCode);
  }
  return { t, call, patch, approveCab, reasons };
}

async function offerFor(t: Tenant, call: (path: string) => Promise<Response>) {
  const response = await call(`/api/work-items/${t.key}/transitions`);
  expect(response.status).toBe(200);
  const offers = (await response.json()) as {
    transitionId: string;
    available: boolean;
    blockedBy: { reasonCode: string }[];
  }[];
  return offers.find((offer) => offer.transitionId === t.cabOnly.id);
}

describe("change detail and workflow guards", () => {
  it("only a change type has change detail", async () => {
    const w = await serviceWorld();
    const world = await workItemWorld(w.workspaceId, w.project.id);
    const task = await world.makeItem("A plain task");
    const response = await w.ownerCall(`/api/work-items/${task.key}/change`, {
      method: "PATCH",
      body: { risk: "low" },
    });
    expect(response.status).toBe(422);
    const read = await w.ownerCall(`/api/work-items/${task.key}/change`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { isChange: boolean }).isChange).toBe(false);
  });

  it("feeds risk and rollback plan into change_risk_at_most and field_required guards (CH-1, CH-3, CH-6)", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    await db
      .update(schema.workflowTransitionTable)
      .set({
        guards: [
          { type: "field_required", field: "change.rollback_plan" },
          { type: "change_risk_at_most", level: "medium" },
        ],
      })
      .where(eq(schema.workflowTransitionTable.id, t.cabOnly.id));

    const before = await offerFor(t, call);
    expect(before?.available).toBe(false);
    expect(before?.blockedBy.map((b) => b.reasonCode)).toEqual(
      expect.arrayContaining([
        "guard.field_required",
        "guard.change_risk_at_most",
      ]),
    );

    await patch({
      risk: "medium",
      rollbackPlan: "Redeploy the previous image",
    });
    const satisfied = await offerFor(t, call);
    const codes = satisfied?.blockedBy.map((b) => b.reasonCode) ?? [];
    expect(codes).not.toContain("guard.field_required");
    expect(codes).not.toContain("guard.change_risk_at_most");
    expect(codes).toContain("cab.pending");

    await patch({ risk: "high" });
    const high = await offerFor(t, call);
    expect(high?.blockedBy.map((b) => b.reasonCode)).toContain(
      "guard.change_risk_at_most",
    );
  });

  it("derives whether CAB is required from risk (CH-3) and reports it", async () => {
    const { patch } = await tenantWithCatalogue();
    const view = await patch({ risk: "low" });
    // No pre-approval path exists in this workflow, so even low risk goes to CAB.
    expect(view.cabRequired).toBe(true);
    expect(view.detail?.risk).toBe("low");
  });

  it("requires a rollback plan before the CAB-gated approval even without a guard (CH-6)", async () => {
    const { t, approveCab, patch, reasons } = await tenantWithCatalogue();
    await approveCab();
    const blocked = await runTransition(t, t.review.id);
    expect(blocked.status).toBe(422);
    expect(await reasons(blocked)).toContain("change.rollback_plan_missing");
    // Whitespace is not a plan.
    await patch({ rollbackPlan: "   " });
    expect((await runTransition(t, t.review.id)).status).toBe(422);
    await patch({
      rollbackPlan: "Restore the snapshot taken before the change",
    });
    const run = await runTransition(t, t.review.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("leaves existing CAB workflows alone while the service catalogue is off (opt-in)", async () => {
    const { t, approveCab } = await tenantWithCatalogue();
    await setServiceFlag(t.workspaceId, false);
    await approveCab();
    const run = await runTransition(t, t.review.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("applies the rollback and freeze gates to a risk-guarded pre-approval edge too (CH-3, CH-4, CH-6)", async () => {
    const { t, patch, reasons } = await tenantWithCatalogue();
    await db
      .update(schema.workflowTransitionTable)
      .set({ guards: [{ type: "change_risk_at_most", level: "low" }] })
      .where(eq(schema.workflowTransitionTable.id, t.sideStep.id));
    await insertFreeze(t.workspaceId, new Date(iso(0)), new Date(iso(10)));
    await patch({
      risk: "low",
      windowStart: iso(2, 1),
      windowEnd: iso(2, 5),
    });
    const noPlan = await runTransition(t, t.wip.id);
    expect(noPlan.status).toBe(422);
    expect(await reasons(noPlan)).toEqual(
      expect.arrayContaining(["change.rollback_plan_missing", "change.frozen"]),
    );
    await patch({ rollbackPlan: "Revert the release" });
    const frozen = await runTransition(t, t.wip.id);
    expect(frozen.status).toBe(422);
    expect(await reasons(frozen)).toEqual(["change.frozen"]);
    await patch({ windowStart: iso(20, 1), windowEnd: iso(20, 5) });
    const run = await runTransition(t, t.wip.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("blocks approval while the window overlaps an active freeze, and a moved window clears it (CH-4)", async () => {
    const { t, approveCab, patch, reasons } = await tenantWithCatalogue();
    await insertFreeze(t.workspaceId, new Date(iso(0)), new Date(iso(10)));
    await approveCab();
    const view = await patch({
      rollbackPlan: "Roll back",
      windowStart: iso(2, 1),
      windowEnd: iso(2, 5),
    });
    expect(view.freeze.blocked).toBe(true);
    expect(view.freeze.freezes.map((f) => f.name)).toEqual(["Year-end freeze"]);
    const blocked = await runTransition(t, t.review.id);
    expect(blocked.status).toBe(422);
    expect(await reasons(blocked)).toContain("change.frozen");

    const moved = await patch({
      windowStart: iso(20, 1),
      windowEnd: iso(20, 5),
    });
    expect(moved.freeze.blocked).toBe(false);
    const run = await runTransition(t, t.review.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  const nowFreeze = (workspaceId: string) =>
    insertFreeze(
      workspaceId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
  /** A standing override recorded for every active freeze now (the gate path, not the grant API). */
  const standingOverride = async (workItemId: string, workspaceId: string) => {
    const freezes = await db
      .select()
      .from(changeFreezeTable)
      .where(eq(changeFreezeTable.workspaceId, workspaceId));
    await db
      .update(changeDetailTable)
      .set({
        freezeOverride: true,
        freezeOverrideReason: "Customer outage fix, approved by the CTO",
        freezeOverrideAt: new Date(),
        freezeOverrideFreezes: freezes.map((row) => ({
          id: row.id,
          version: row.version,
        })),
      })
      .where(eq(changeDetailTable.workItemId, workItemId));
  };

  it("holds a change with no window against the freezes covering now, and only an override clears it (CH-4, P5-R4-03)", async () => {
    const { t, approveCab, patch, call, reasons } = await tenantWithCatalogue();
    await nowFreeze(t.workspaceId);
    await approveCab();
    const view = await patch({ rollbackPlan: "Roll back" });
    expect(view.freeze.blocked).toBe(true);
    const blocked = await runTransition(t, t.review.id);
    expect(blocked.status).toBe(422);
    expect(await reasons(blocked)).toEqual(["change.frozen"]);
    const offer = await offerFor(t, call);
    expect(offer?.blockedBy.map((b) => b.reasonCode)).toContain(
      "change.frozen",
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    await standingOverride(t.workItem.id, t.workspaceId);
    const run = await runTransition(t, t.review.id);
    expect(run.status, await run.clone().text()).toBe(200);
  });

  it("a freeze declared after a window is planned flags the change and counts it", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    await patch({ windowStart: iso(2, 1), windowEnd: iso(2, 5) });
    const created = await call("/api/change-freezes", {
      method: "POST",
      body: {
        workspaceId: t.workspaceId,
        name: "Audit week",
        startsAt: iso(0),
        endsAt: iso(5),
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    expect(
      ((await created.json()) as { affectedChanges: number }).affectedChanges,
    ).toBe(1);
    const view = await call(`/api/work-items/${t.key}/change`);
    expect(((await view.json()) as ChangeBody).freeze.blocked).toBe(true);
  });

  it("reports how many services and customers a change affects (CH-1, SVC-5)", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    const create = async (body: Record<string, unknown>) => {
      const response = await call("/api/services", {
        method: "POST",
        body: { workspaceId: t.workspaceId, ...body },
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return (await response.json()) as { id: string };
    };
    const base = await create({ name: "Database" });
    const web = await create({
      name: "Web",
      dependsOnServiceIds: [base.id],
      links: [{ kind: "project", projectId: t.project.id }],
    });
    const [org] = await db
      .insert(schema.organisationTable)
      .values({ key: `org-${randomUUID()}`, name: "Acme" })
      .returning();
    await db
      .update(schema.projectTable)
      .set({ organisationId: org?.id as string })
      .where(eq(schema.projectTable.id, t.project.id));
    const view = await patch({ serviceIds: [base.id] });
    expect(view.impact).toEqual({ services: 2, customers: 1 });
    void web;
  });

  it("marks a window in the past as retrospective and allows it", async () => {
    const { patch } = await tenantWithCatalogue();
    const view = await patch({
      windowStart: "2020-01-01T00:00:00Z",
      windowEnd: "2020-01-01T02:00:00Z",
    });
    expect(view.retrospective).toBe(true);
  });

  it("rejects an inverted window and a half window, and refuses a stale version", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    const inverted = await call(`/api/work-items/${t.key}/change`, {
      method: "PATCH",
      body: { windowStart: iso(3), windowEnd: iso(2) },
    });
    expect(inverted.status).toBe(422);
    const half = await call(`/api/work-items/${t.key}/change`, {
      method: "PATCH",
      body: { windowStart: iso(3) },
    });
    expect(half.status).toBe(422);
    await patch({ risk: "low" });
    const stale = await call(`/api/work-items/${t.key}/change`, {
      method: "PATCH",
      body: { risk: "high", version: 99 },
    });
    expect(stale.status).toBe(409);
  });
});

describe("change freeze management", () => {
  it("creates, edits and cancels a freeze, audited (CH-4)", async () => {
    const w = await serviceWorld();
    const created = await w.ownerCall("/api/change-freezes", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Black Friday",
        reason: "Peak trading",
        startsAt: iso(0),
        endsAt: iso(4),
      },
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { freeze } = (await created.json()) as {
      freeze: { id: string; version: number };
    };
    const edited = await w.ownerCall(`/api/change-freezes/${freeze.id}`, {
      method: "PATCH",
      body: { endsAt: iso(6), version: freeze.version },
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const stale = await w.ownerCall(`/api/change-freezes/${freeze.id}`, {
      method: "PATCH",
      body: { name: "Renamed", version: freeze.version },
    });
    expect(stale.status).toBe(409);
    const cancelled = await w.ownerCall(`/api/change-freezes/${freeze.id}`, {
      method: "PATCH",
      body: { cancel: true },
    });
    expect(cancelled.status).toBe(200);
    const list = await w.ownerCall(
      `/api/change-freezes?workspaceId=${w.workspaceId}`,
    );
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(0);
    const all = await w.ownerCall(
      `/api/change-freezes?workspaceId=${w.workspaceId}&includeCancelled=true`,
    );
    expect(((await all.json()) as { data: unknown[] }).data).toHaveLength(1);
    const actions = (
      await db
        .select({ action: schema.auditLogTable.action })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.workspaceId, w.workspaceId))
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "change_freeze.created",
        "change_freeze.updated",
        "change_freeze.cancelled",
      ]),
    );
    const again = await w.ownerCall(`/api/change-freezes/${freeze.id}`, {
      method: "PATCH",
      body: { name: "After cancel" },
    });
    expect(again.status).toBe(409);
  });

  it("rejects an empty or inverted range", async () => {
    const w = await serviceWorld();
    const bad = await w.ownerCall("/api/change-freezes", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Backwards",
        startsAt: iso(4),
        endsAt: iso(1),
      },
    });
    expect(bad.status).toBe(400);
  });

  it("denies a member, lets a viewer read, and isolates tenants", async () => {
    const w = await serviceWorld();
    const freeze = await insertFreeze(
      w.workspaceId,
      new Date(iso(0)),
      new Date(iso(3)),
    );
    const write = await w.as(w.member.user, "/api/change-freezes", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Nope",
        startsAt: iso(0),
        endsAt: iso(1),
      },
    });
    expect(write.status).toBe(403);
    const cancel = await w.as(
      w.member.user,
      `/api/change-freezes/${freeze.id}`,
      { method: "PATCH", body: { cancel: true } },
    );
    expect(cancel.status).toBe(403);
    const read = await w.as(
      w.viewer.user,
      `/api/change-freezes?workspaceId=${w.workspaceId}`,
    );
    expect(read.status, await read.clone().text()).toBe(200);
    const report = await w.as(
      w.viewer.user,
      `/api/change-freezes/overrides?workspaceId=${w.workspaceId}`,
    );
    expect(report.status).toBe(403);
    const foreignList = await w.as(
      w.stranger.user,
      `/api/change-freezes?workspaceId=${w.workspaceId}`,
    );
    expect(foreignList.status).toBe(403);
    const foreignEdit = await w.as(
      w.stranger.user,
      `/api/change-freezes/${freeze.id}`,
      { method: "PATCH", body: { cancel: true } },
    );
    expect(foreignEdit.status).toBe(404);
  });
});

describe("freeze override report", () => {
  it("lists only overrides of changes in projects the caller reaches", async () => {
    const w = await serviceWorld();
    const { project: hidden } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    const visibleWorld = await workItemWorld(w.workspaceId, w.project.id);
    const hiddenWorld = await workItemWorld(w.workspaceId, hidden.id);
    const visibleItem = await visibleWorld.makeItem("Visible change");
    const hiddenItem = await hiddenWorld.makeItem("Secret change");
    for (const [item, reason] of [
      [visibleItem, "Visible override, approved by the CTO"],
      [hiddenItem, "Hidden project override that must not be listed"],
    ] as const)
      await db.transaction((tx) =>
        appendAuditLog(tx, {
          actorId: w.owner.user.id,
          actorType: "person",
          workspaceId: w.workspaceId,
          action: "change.freeze_overridden",
          entityType: "work_item",
          entityId: item.id,
          after: {
            workItemKey: item.key,
            reason,
            freezeNames: ["Year-end freeze"],
          },
        }),
      );
    const report = await w.ownerCall(
      `/api/change-freezes/overrides?workspaceId=${w.workspaceId}`,
    );
    expect(report.status, await report.clone().text()).toBe(200);
    const rows = ((await report.json()) as { data: { workItemKey: string }[] })
      .data;
    expect(rows.map((row) => row.workItemKey)).toEqual([visibleItem.key]);
    expect(JSON.stringify(rows)).not.toContain("Hidden project");
  });
});

describe("change calendar", () => {
  async function plannedChange(
    w: Awaited<ReturnType<typeof serviceWorld>>,
    title: string,
    serviceId: string,
    start: string,
    end: string,
    world: Awaited<ReturnType<typeof workItemWorld>>,
    changeTypeId: string,
  ) {
    const item = await world.makeItem(title);
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeTypeId })
      .where(eq(schema.workItemTable.id, item.id));
    const response = await w.ownerCall(`/api/work-items/${item.key}/change`, {
      method: "PATCH",
      body: { serviceIds: [serviceId], windowStart: start, windowEnd: end },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return item;
  }

  it("shows windows and freezes and flags two changes to the same service in the same window (CH-5)", async () => {
    const w = await serviceWorld();
    const svc = await w.makeService("Payments");
    const other = await w.makeService("Search");
    const world = await workItemWorld(w.workspaceId, w.project.id);
    const changeType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: w.workspaceId,
          key: `chg-${randomUUID().slice(0, 6)}`,
          name: "Change",
          category: "service",
          isChange: true,
        })
        .returning(),
      "change type",
    );
    const a = await plannedChange(
      w,
      "Patch payments",
      svc.id,
      iso(1, 2),
      iso(1, 6),
      world,
      changeType.id,
    );
    const b = await plannedChange(
      w,
      "Upgrade payments",
      svc.id,
      iso(1, 5),
      iso(1, 9),
      world,
      changeType.id,
    );
    const c = await plannedChange(
      w,
      "Reindex search",
      other.id,
      iso(1, 5),
      iso(1, 9),
      world,
      changeType.id,
    );
    await insertFreeze(
      w.workspaceId,
      new Date(iso(4)),
      new Date(iso(6)),
      "Quarter end",
    );

    const response = await w.ownerCall(
      `/api/changes/calendar?workspaceId=${w.workspaceId}&from=${encodeURIComponent(iso(-1))}&to=${encodeURIComponent(iso(10))}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      changes: { key: string; conflict: boolean; frozen: boolean }[];
      conflicts: { changeKeys: string[] }[];
      freezes: { name: string }[];
    };
    expect(body.freezes.map((f) => f.name)).toEqual(["Quarter end"]);
    const byKey = new Map(body.changes.map((x) => [x.key, x]));
    expect(byKey.get(a.key)?.conflict).toBe(true);
    expect(byKey.get(b.key)?.conflict).toBe(true);
    expect(byKey.get(c.key)?.conflict).toBe(false);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]?.changeKeys.sort()).toEqual([a.key, b.key].sort());

    // The same-service conflict also shows on the change itself.
    const detail = await w.ownerCall(`/api/work-items/${a.key}/change`);
    expect(
      ((await detail.json()) as ChangeBody).conflicts.map((x) => x.key),
    ).toEqual([b.key]);
  });

  it("limits the range to 400 days", async () => {
    const w = await serviceWorld();
    const tooLong = await w.ownerCall(
      `/api/changes/calendar?workspaceId=${w.workspaceId}&from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(new Date(Date.UTC(2033, 0, 1)).toISOString())}`,
    );
    expect(tooLong.status).toBe(400);
    const inverted = await w.ownerCall(
      `/api/changes/calendar?workspaceId=${w.workspaceId}&from=${encodeURIComponent(iso(5))}&to=${encodeURIComponent(iso(1))}`,
    );
    expect(inverted.status).toBe(400);
  });

  it("hides changes in projects the caller cannot reach and answers 404 for their change detail", async () => {
    const w = await serviceWorld();
    const { project: hidden } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    const changeType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: w.workspaceId,
          key: `chg-${randomUUID().slice(0, 6)}`,
          name: "Change",
          category: "service",
          isChange: true,
        })
        .returning(),
      "change type",
    );
    const seen = await workItemWorld(w.workspaceId, w.project.id);
    const secret = await workItemWorld(w.workspaceId, hidden.id);
    const visibleItem = await seen.makeItem("Visible change");
    const hiddenItem = await secret.makeItem("Secret change");
    for (const item of [visibleItem, hiddenItem]) {
      await db
        .update(schema.workItemTable)
        .set({ typeId: changeType.id })
        .where(eq(schema.workItemTable.id, item.id));
      await db.insert(changeDetailTable).values({
        workItemId: item.id,
        workspaceId: w.workspaceId,
        windowStart: new Date(iso(1, 1)),
        windowEnd: new Date(iso(1, 3)),
      });
    }
    const url = `/api/changes/calendar?workspaceId=${w.workspaceId}&from=${encodeURIComponent(iso(0))}&to=${encodeURIComponent(iso(5))}`;
    const owner = await w.ownerCall(url);
    expect(owner.status, await owner.clone().text()).toBe(200);
    expect(
      ((await owner.json()) as { changes: { key: string }[] }).changes.map(
        (x) => x.key,
      ),
    ).toEqual([visibleItem.key]);
    const member = await w.as(w.member.user, url);
    expect(member.status).toBe(200);
    expect(((await member.json()) as { changes: unknown[] }).changes).toEqual(
      [],
    );
    const direct = await w.ownerCall(
      `/api/work-items/${hiddenItem.key}/change`,
    );
    expect(direct.status).toBe(404);
    for (const [method, path, body] of [
      ["PATCH", `/api/work-items/${hiddenItem.key}/change`, { risk: "low" }],
      [
        "POST",
        `/api/work-items/${hiddenItem.key}/change/override-freeze`,
        { reason: "Not reachable, so it never reaches the proof" },
      ],
      [
        "POST",
        `/api/work-items/${hiddenItem.key}/service`,
        { serviceId: null },
      ],
    ] as const) {
      const response = await w.ownerCall(path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("freeze override (CH-4)", () => {
  it("is refused without a step-up proof and changes nothing", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    await insertFreeze(t.workspaceId, new Date(iso(0)), new Date(iso(10)));
    await patch({ windowStart: iso(2, 1), windowEnd: iso(2, 5) });
    const response = await call(
      `/api/work-items/${t.key}/change/override-freeze`,
      {
        method: "POST",
        body: { reason: "Customer outage fix, approved by the CTO" },
      },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("step_up_required");
    const detail = await changeDetailOf(t.workItem.id);
    expect(detail?.freezeOverride).toBe(false);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "change.freeze_overridden")),
    ).toHaveLength(0);
  });

  it("is refused to a member who lacks change:manage, and has nothing to override outside a freeze", async () => {
    const { t, call, patch } = await tenantWithCatalogue();
    await patch({ windowStart: iso(2, 1), windowEnd: iso(2, 5) });
    const nothing = await call(
      `/api/work-items/${t.key}/change/override-freeze`,
      {
        method: "POST",
        body: { reason: "No freeze covers this window at all" },
      },
    );
    // Reached the proof spend only after the domain checks: there is no freeze to override.
    expect(nothing.status).toBe(409);
    const short = await call(
      `/api/work-items/${t.key}/change/override-freeze`,
      {
        method: "POST",
        body: { reason: "short" },
      },
    );
    expect(short.status).toBe(400);
    mockAuthenticatedSession(t.approver.user);
    const denied = await t.app.request(
      `/api/work-items/${t.key}/change/override-freeze`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          reason: "An approver without change authority",
        }),
      },
    );
    expect([403, 404]).toContain(denied.status);
  });

  async function realSessionWorld() {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Override",
    });
    expect(created.status).toBe(200);
    const workspaceId = ((await created.json()) as { id: string }).id;
    await setServiceFlag(workspaceId, true);
    const { project } = await createProjectFixture({ workspaceId });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
      "change:manage",
    ]);
    const world = await workItemWorld(workspaceId, project.id);
    const changeType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: `chg-${randomUUID().slice(0, 6)}`,
          name: "Change",
          category: "service",
          isChange: true,
        })
        .returning(),
      "change type",
    );
    const item = await world.makeItem("Emergency fix");
    await db
      .update(schema.workItemTable)
      .set({ typeId: changeType.id })
      .where(eq(schema.workItemTable.id, item.id));
    await insertFreeze(workspaceId, new Date(iso(0)), new Date(iso(10)));
    const cookieCall = (
      path: string,
      init: { method?: string; body?: unknown; token?: string | null } = {},
    ) => {
      const requestInit = {
        method: init.method ?? "GET",
        headers: {
          ...json,
          cookie: owner.cookie,
          ...(init.token ? { [STEP_UP_TOKEN_HEADER]: init.token } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      };
      return requestInit.method === "GET"
        ? app.request(path, requestInit)
        : csrfRequest(app, path, requestInit, owner.cookie);
    };
    const set = await cookieCall(`/api/work-items/${item.key}/change`, {
      method: "PATCH",
      body: { windowStart: iso(2, 1), windowEnd: iso(2, 5) },
    });
    expect(set.status, await set.clone().text()).toBe(200);
    return { app, owner, workspaceId, item, cookieCall };
  }

  it("overrides a change with no window against the freeze covering now, audited (P5-R4-03)", async () => {
    const w = await realSessionWorld();
    await insertFreeze(
      w.workspaceId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
    );
    const clear = await w.cookieCall(`/api/work-items/${w.item.key}/change`, {
      method: "PATCH",
      body: { windowStart: null, windowEnd: null },
    });
    expect(clear.status, await clear.clone().text()).toBe(200);
    expect(((await clear.json()) as ChangeBody).freeze.blocked).toBe(true);
    const reason = "Customer outage fix, approved by the CTO";
    const path = `/api/work-items/${w.item.key}/change/override-freeze`;
    const token = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "change_freeze_override",
      { workspaceId: w.workspaceId, workItemKey: w.item.key, reason },
    );
    const done = await w.cookieCall(path, {
      method: "POST",
      body: { reason },
      token,
    });
    expect(done.status, await done.clone().text()).toBe(200);
    expect(((await done.json()) as ChangeBody).freeze.overridden).toBe(true);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "change.freeze_overridden"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      reason,
      windowStart: null,
      windowEnd: null,
    });
  });

  it("spends exactly one operation-bound proof, records the override and audits it prominently", async () => {
    const w = await realSessionWorld();
    const reason = "Customer outage fix, approved by the CTO";
    const path = `/api/work-items/${w.item.key}/change/override-freeze`;
    const fields = {
      workspaceId: w.workspaceId,
      workItemKey: w.item.key,
      reason,
    };

    // A proof bound to a different reason authorises nothing.
    const wrong = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "change_freeze_override",
      { ...fields, reason: "A different reason that was authorised" },
    );
    const mismatched = await w.cookieCall(path, {
      method: "POST",
      body: { reason },
      token: wrong,
    });
    expect(mismatched.status).toBe(403);
    expect(await mismatched.text()).toBe("step_up_unavailable");
    expect((await changeDetailOf(w.item.id))?.freezeOverride).toBe(false);

    const token = await mintStepUpToken(
      w.app,
      w.owner.cookie,
      "change_freeze_override",
      fields,
    );
    expect(token).not.toBeNull();
    const done = await w.cookieCall(path, {
      method: "POST",
      body: { reason },
      token,
    });
    expect(done.status, await done.clone().text()).toBe(200);
    const view = (await done.json()) as ChangeBody;
    expect(view.freeze.blocked).toBe(false);
    expect(view.freeze.overridden).toBe(true);
    expect(view.freeze.override?.reason).toBe(reason);

    // The same proof cannot be replayed (the override is also already in place).
    const replay = await w.cookieCall(path, {
      method: "POST",
      body: { reason },
      token,
    });
    expect([403, 409]).toContain(replay.status);

    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "change.freeze_overridden"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      reason,
      workItemKey: w.item.key,
      freezeOverride: true,
    });
    const consumed = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_consumed"));
    expect(consumed.length).toBeGreaterThanOrEqual(1);

    // The report lists it prominently.
    const report = await w.cookieCall(
      `/api/change-freezes/overrides?workspaceId=${w.workspaceId}`,
    );
    expect(report.status, await report.clone().text()).toBe(200);
    expect(
      (
        (await report.json()) as {
          data: { reason: string; workItemKey: string }[];
        }
      ).data,
    ).toMatchObject([{ reason, workItemKey: w.item.key }]);

    // The override is freeze-scoped, not window-scoped: moving the window inside the same freeze
    // keeps it, moving it into a freeze it never named does not.
    const moved = await w.cookieCall(`/api/work-items/${w.item.key}/change`, {
      method: "PATCH",
      body: { windowStart: iso(3, 1), windowEnd: iso(3, 5) },
    });
    expect(moved.status).toBe(200);
    const movedBody = (await moved.json()) as ChangeBody;
    expect(movedBody.freeze.overridden).toBe(true);
    expect(movedBody.freeze.blocked).toBe(false);
    await insertFreeze(
      w.workspaceId,
      new Date(iso(20)),
      new Date(iso(30)),
      "Other freeze",
    );
    const elsewhere = await w.cookieCall(
      `/api/work-items/${w.item.key}/change`,
      {
        method: "PATCH",
        body: { windowStart: iso(25, 1), windowEnd: iso(25, 5) },
      },
    );
    expect(elsewhere.status).toBe(200);
    const elsewhereBody = (await elsewhere.json()) as ChangeBody;
    expect(elsewhereBody.freeze.overridden).toBe(false);
    expect(elsewhereBody.freeze.blocked).toBe(true);
  });

  it("does not survive a freeze declared after it, which can be overridden in turn (edge case)", async () => {
    const w = await realSessionWorld();
    const path = `/api/work-items/${w.item.key}/change/override-freeze`;
    const override = async (reason: string) => {
      const fields = {
        workspaceId: w.workspaceId,
        workItemKey: w.item.key,
        reason,
      };
      const token = await mintStepUpToken(
        w.app,
        w.owner.cookie,
        "change_freeze_override",
        fields,
      );
      return w.cookieCall(path, { method: "POST", body: { reason }, token });
    };
    const first = await override("First override, approved by the CTO");
    expect(first.status, await first.clone().text()).toBe(200);
    expect(((await first.json()) as ChangeBody).freeze.blocked).toBe(false);

    // Overriding again changes nothing while no new freeze exists.
    const noop = await override("Second override, nothing new to cover");
    expect(noop.status).toBe(409);

    // A freeze declared afterwards covers the same window: the change is frozen again.
    const declared = await w.cookieCall("/api/change-freezes", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        name: "Audit week",
        startsAt: iso(1),
        endsAt: iso(4),
      },
    });
    expect(declared.status, await declared.clone().text()).toBe(200);
    expect(
      ((await declared.json()) as { affectedChanges: number }).affectedChanges,
    ).toBe(1);
    const view = await w.cookieCall(`/api/work-items/${w.item.key}/change`);
    const frozen = (await view.json()) as ChangeBody;
    expect(frozen.freeze.blocked).toBe(true);
    expect(frozen.freeze.overridden).toBe(false);

    const again = await override("Third override for the audit week freeze");
    expect(again.status, await again.clone().text()).toBe(200);
    expect(((await again.json()) as ChangeBody).freeze.blocked).toBe(false);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "change.freeze_overridden")),
    ).toHaveLength(2);
  });
});

describe("the freeze override is freeze-scoped (CH-4, P5-R5-02, R5-04, R5-10)", () => {
  /**
   * A real-session user in an executable change workflow whose backlog -> In progress edge is a
   * risk-guarded pre-approval edge, so the change is approved through the real transition path.
   */
  async function approvalWorld() {
    const t = await buildTenant("scoped", { executable: true });
    vi.restoreAllMocks();
    await setServiceFlag(t.workspaceId, true);
    await db
      .update(schema.workflowTransitionTable)
      .set({ guards: [{ type: "change_risk_at_most", level: "low" }] })
      .where(eq(schema.workflowTransitionTable.id, t.sideStep.id));
    const user = await signUpUser(t.app);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: t.workspaceId,
      userId: user.user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    await grantProjectRole(user.user.id, t.project.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
      "work_item:transition",
      "change:manage",
    ]);
    const call = async (
      path: string,
      init: { method?: string; body?: unknown; token?: string | null } = {},
    ): Promise<Response> => {
      const requestInit = {
        method: init.method ?? "GET",
        headers: {
          ...json,
          cookie: user.cookie,
          ...(init.token ? { [STEP_UP_TOKEN_HEADER]: init.token } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      };
      return await (requestInit.method === "GET"
        ? t.app.request(path, requestInit)
        : csrfRequest(t.app, path, requestInit, user.cookie));
    };
    const changePath = `/api/work-items/${t.key}/change`;
    const patch = (body: unknown) =>
      call(changePath, { method: "PATCH", body });
    const transition = (toStateTemplateId: string) =>
      call(`/api/work-items/${t.key}/transition`, {
        method: "POST",
        body: { toStateTemplateId },
      });
    const override = async (
      reason: string,
      window?: { windowStart: string; windowEnd: string },
    ) => {
      const token = await mintStepUpToken(
        t.app,
        user.cookie,
        "change_freeze_override",
        {
          workspaceId: t.workspaceId,
          workItemKey: t.key,
          reason,
          ...window,
        },
      );
      return call(`${changePath}/override-freeze`, {
        method: "POST",
        body: { reason, ...window },
        token,
      });
    };
    const overrideAudit = async () =>
      (
        await db
          .select()
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "change.freeze_overridden"))
      ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const prepare = async () => {
      const response = await patch({
        risk: "low",
        rollbackPlan: "Revert the release",
      });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    return {
      t,
      user,
      call,
      patch,
      transition,
      override,
      overrideAudit,
      prepare,
    };
  }

  const nowFreeze = (workspaceId: string) =>
    insertFreeze(
      workspaceId,
      new Date(Date.now() - 86_400_000),
      new Date(Date.now() + 86_400_000),
      "Freeze A",
    );
  const window25 = { windowStart: iso(25, 1), windowEnd: iso(25, 5) };

  it("an override for freeze A never clears freeze B, and one requested for B's window does (R5-02, R5-10)", async () => {
    const w = await approvalWorld();
    const a = await nowFreeze(w.t.workspaceId);
    const b = await insertFreeze(
      w.t.workspaceId,
      new Date(iso(20)),
      new Date(iso(31)),
      "Freeze B",
    );
    await w.prepare();
    expect((await w.transition(w.t.wip.id)).status).toBe(422);

    // Override for A (the freeze covering now), then approve through the real transition.
    const first = await w.override("Customer outage fix, approved by the CTO");
    expect(first.status, await first.clone().text()).toBe(200);
    expect(
      (await changeDetailOf(w.t.workItem.id))?.freezeOverrideFreezes,
    ).toEqual([{ id: a.id, version: a.version }]);
    const approved = await w.transition(w.t.wip.id);
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).not.toBeNull();

    // B was never shown or overridden: planning into it is refused, even though A's override is
    // older than B and B was declared before it.
    const refused = await w.patch(window25);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("change.frozen");
    expect((await changeDetailOf(w.t.workItem.id))?.windowStart).toBeNull();

    // Request an override for the freeze covering the PROPOSED window (the future freeze).
    const second = await w.override(
      "Planned for the January window, approved by the CTO",
      window25,
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const recorded = (await changeDetailOf(w.t.workItem.id))
      ?.freezeOverrideFreezes;
    expect(recorded).toEqual(
      expect.arrayContaining([
        { id: a.id, version: a.version },
        { id: b.id, version: b.version },
      ]),
    );
    const planned = await w.patch(window25);
    expect(planned.status, await planned.clone().text()).toBe(200);
    expect(((await planned.json()) as ChangeBody).freeze.overridden).toBe(true);

    // R5-10: the audit rows record the real prior state and the freeze ids covered.
    const [grantA, grantB] = await w.overrideAudit();
    expect(grantA?.before).toMatchObject({
      freezeOverride: false,
      freezeIds: [],
    });
    expect(grantA?.after).toMatchObject({ freezeIds: [a.id] });
    expect(grantB?.before).toMatchObject({
      freezeOverride: true,
      freezeIds: [a.id],
    });
    expect(grantB?.after).toMatchObject({
      freezeIds: [b.id],
      freezeNames: ["Freeze B"],
      proposedWindowStart: window25.windowStart,
    });

    // Editing B afterwards re-freezes the change: the recorded version no longer holds.
    const edited = await w.call(`/api/change-freezes/${b.id}`, {
      method: "PATCH",
      body: { endsAt: iso(32), version: b.version },
    });
    expect(edited.status, await edited.clone().text()).toBe(200);
    const again = await w.patch({
      windowStart: iso(26, 1),
      windowEnd: iso(26, 5),
    });
    expect(again.status).toBe(409);
  });

  it("a proof minted for no window cannot be spent with a proposed window, and the reverse (R6-03)", async () => {
    const w = await approvalWorld();
    await nowFreeze(w.t.workspaceId);
    await insertFreeze(
      w.t.workspaceId,
      new Date(iso(20)),
      new Date(iso(31)),
      "Freeze B",
    );
    await w.prepare();
    const reason = "Customer outage fix, approved by the CTO";
    const mint = (extra: Record<string, unknown>) =>
      mintStepUpToken(w.t.app, w.user.cookie, "change_freeze_override", {
        workspaceId: w.t.workspaceId,
        workItemKey: w.t.key,
        reason,
        ...extra,
      });
    // The mint above is for the window-free override; spend it WITH a wide window.
    const noWindow = await mint({});
    const widened = await w.call(
      `/api/work-items/${w.t.key}/change/override-freeze`,
      {
        method: "POST",
        body: { reason, ...window25 },
        token: noWindow,
      },
    );
    expect(widened.status).toBe(403);
    expect(
      (await changeDetailOf(w.t.workItem.id))?.freezeOverrideFreezes ?? [],
    ).toEqual([]);
    // A proof bound to the window spends with exactly that window.
    const bound = await mint(window25);
    const ok = await w.call(
      `/api/work-items/${w.t.key}/change/override-freeze`,
      {
        method: "POST",
        body: { reason, ...window25 },
        token: bound,
      },
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it("a change moved straight into an approving-edge target state is approved, so the freeze gate holds (R6-04)", async () => {
    const w = await approvalWorld();
    await insertFreeze(w.t.workspaceId, new Date(iso(20)), new Date(iso(31)));
    const target = (
      await createProjectFixture({ workspaceId: w.t.workspaceId })
    ).project;
    await grantProjectRole(w.user.user.id, target.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
      "work_item:create",
      "work_item:transition",
      "change:manage",
    ]);
    // The item sits in "In progress" without ever taking the approving edge.
    const [wipState] = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.stateTemplateId, w.t.wip.id));
    await db
      .update(schema.workItemTable)
      .set({ stateId: (wipState as { id: string }).id })
      .where(eq(schema.workItemTable.id, w.t.workItem.id));
    await db.insert(schema.stateTable).values({
      projectId: target.id,
      stateTemplateId: w.t.wip.id,
      isDefault: false,
    });
    expect(await changeDetailOf(w.t.workItem.id)).toBeUndefined();
    const [row] = await db
      .select({ version: schema.workItemTable.version })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, w.t.workItem.id));
    const moved = await csrfRequest(
      w.t.app,
      `/api/v2/work-items/${w.t.key}/move`,
      {
        method: "POST",
        headers: {
          ...json,
          cookie: w.user.cookie,
          "if-match": `"${row?.version}"`,
        },
        body: JSON.stringify({
          targetProjectId: target.id,
          moveChildren: false,
        }),
      },
      w.user.cookie,
    );
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).toBeInstanceOf(
      Date,
    );
    const newKey = ((await moved.json()) as { item: { key: string } }).item.key;
    const refused = await w.call(`/api/work-items/${newKey}/change`, {
      method: "PATCH",
      body: window25,
    });
    expect(refused.status, await refused.clone().text()).toBe(409);
    expect(await refused.text()).toContain("change.frozen");
  });

  it("an unapproved change may be planned anywhere; once approved it stays checked after leaving the approval state (R5-04)", async () => {
    const w = await approvalWorld();
    await insertFreeze(w.t.workspaceId, new Date(iso(20)), new Date(iso(31)));
    await w.prepare();
    // Not approved yet: planning into the freeze is allowed (the approval gate checks it later).
    const early = await w.patch(window25);
    expect(early.status, await early.clone().text()).toBe(200);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).toBeNull();
    const frozen = await w.transition(w.t.wip.id);
    expect(frozen.status).toBe(422);
    const clear = await w.patch({
      windowStart: iso(2, 1),
      windowEnd: iso(2, 5),
    });
    expect(clear.status).toBe(200);
    const approved = await w.transition(w.t.wip.id);
    expect(approved.status, await approved.clone().text()).toBe(200);

    // Move out of the exact state the approving edge leads to: still approved.
    const back = await w.transition(w.t.backlog.id);
    expect(back.status, await back.clone().text()).toBe(200);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).not.toBeNull();
    const refused = await w.patch(window25);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("change.frozen");
    const outside = await w.patch({
      windowStart: iso(40, 1),
      windowEnd: iso(40, 5),
    });
    expect(outside.status, await outside.clone().text()).toBe(200);
  });

  it("a failed approving transition does not mark the change approved, and listing stays pure", async () => {
    const w = await approvalWorld();
    await nowFreeze(w.t.workspaceId);
    await w.prepare();
    const listed = await w.call(`/api/work-items/${w.t.key}/transitions`);
    expect(listed.status).toBe(200);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).toBeNull();
    expect((await w.transition(w.t.wip.id)).status).toBe(422);
    expect((await changeDetailOf(w.t.workItem.id))?.approvedAt).toBeNull();
  });
});
