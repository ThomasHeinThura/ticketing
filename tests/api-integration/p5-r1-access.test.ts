/**
 * P5 round-1 review fixes: soft-deleted projects are not found by the P5 project routes
 * (P5-R1-04), rate visibility is resolved at the project (P5-R1-06), a budget threshold webhook
 * goes only to an owner who may see the budget (P5-R1-07) and the hard deletes of modules,
 * services, KB categories and dashboards respect legal holds (P5-R1-08).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteModuleRow } from "../../apps/api/src/agile/module.repository";
import db, { schema } from "../../apps/api/src/database";
import {
  cycleTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import { kbCategoryTable } from "../../apps/api/src/database/schema-p5-kb";
import { dashboardTable } from "../../apps/api/src/database/schema-p5-reports";
import { serviceTable } from "../../apps/api/src/database/schema-p5-service";
import { deleteCategoryRow } from "../../apps/api/src/kb/repository";
import {
  deleteDashboardRow,
  lockDashboard,
} from "../../apps/api/src/report/dashboard.repository";
import { deleteServiceRow } from "../../apps/api/src/service-management/service-repository";
import { decideOwnerReach } from "../../apps/api/src/webhook/reach";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole, requireRow } from "./helpers/fixtures";
import { type AgileWorld, agileWorld } from "./helpers/p5-agile";
import { type PagesWorld, pagesWorld } from "./helpers/p5-pages";
import { personIdOf } from "./helpers/p5-time";

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("soft-deleted projects are not found by pages, cycles, modules, estimates and automations (P5-R1-04)", () => {
  let w: AgileWorld;
  beforeEach(async () => {
    await resetTestDatabase();
    w = await agileWorld();
  });

  it("answers 404 for reads and writes on every P5 project surface once the project is deleted", async () => {
    const [cycle] = await db
      .insert(cycleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.project.id,
        name: "Cycle",
        startDate: day(-3),
        endDate: day(4),
      })
      .returning();
    const [mod] = await db
      .insert(moduleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.project.id,
        name: "Module",
      })
      .returning();
    const key = w.project.slug;
    const cases: Array<[string, string, unknown?]> = [
      ["GET", `/api/projects/${key}/cycles`],
      [
        "POST",
        `/api/projects/${key}/cycles`,
        { name: "N", startDate: day(60), endDate: day(70) },
      ],
      ["GET", `/api/cycles/${cycle?.id}`],
      ["GET", `/api/projects/${key}/modules`],
      ["POST", `/api/projects/${key}/modules`, { name: "N" }],
      ["GET", `/api/modules/${mod?.id}`],
      ["GET", `/api/projects/${key}/estimates`],
      ["GET", `/api/projects/${key}/automations`],
      ["GET", `/api/projects/${key}/wip-limits`],
    ];
    // Control: the project is served while it exists.
    const control = await w.call(w.manager.user, `/api/projects/${key}/cycles`);
    expect(control.status).toBe(200);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));
    for (const [method, path, body] of cases) {
      const response = await w.call(w.manager.user, path, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // Nothing was written by the refused POSTs.
    expect(
      await db
        .select()
        .from(cycleTable)
        .where(eq(cycleTable.projectId, w.project.id)),
    ).toHaveLength(1);
  });
});

describe("soft-deleted projects are not found by pages (P5-R1-04)", () => {
  let w: PagesWorld;
  beforeEach(async () => {
    await resetTestDatabase();
    w = await pagesWorld();
  });

  it("answers 404 for the page routes of a deleted project, by id and by key", async () => {
    const created = await w.call(w.editor.user, w.base(), {
      method: "POST",
      body: { title: "Runbook", content: { type: "doc", content: [] } },
    });
    expect([200, 201]).toContain(created.status);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));
    for (const ref of [w.project.id, w.project.slug]) {
      const list = await w.call(w.editor.user, w.base(ref));
      expect(list.status, ref).toBe(404);
      const write = await w.call(w.editor.user, w.base(ref), {
        method: "POST",
        body: { title: "Another", content: { type: "doc", content: [] } },
      });
      expect(write.status, ref).toBe(404);
    }
  });
});

describe("legal-hold fences of hard deletes (P5-R1-08)", () => {
  let w: AgileWorld;
  beforeEach(async () => {
    await resetTestDatabase();
    w = await agileWorld();
  });

  const actor = (userId: string, personId: string) => ({
    userId,
    personId,
    actorType: "person" as const,
    apiKeyId: null,
  });
  const hold = async (scope: "person" | "organisation", scopeId: string) =>
    requireRow(
      await db
        .insert(schema.legalHoldTable)
        .values({
          scope,
          scopeId,
          placedBy: "integration-test",
          reason: "fence test",
        })
        .returning(),
      "hold",
    );
  const lift = (id: string) =>
    db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date(), liftedBy: "integration-test" })
      .where(eq(schema.legalHoldTable.id, id));
  const workspaceOrganisation = async () =>
    requireRow(
      await db
        .select({ id: schema.workspaceTable.organisationId })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, w.workspaceId)),
      "workspace",
    ).id;

  async function expectHeldThenDeletable(
    attempt: () => Promise<unknown>,
    held: { id: string },
    stillThere: () => Promise<number>,
  ) {
    await expect(attempt()).rejects.toMatchObject({
      status: 409,
      message: "legal_hold",
    });
    expect(await stillThere()).toBe(1);
    await lift(held.id);
    await attempt();
    expect(await stillThere()).toBe(0);
  }

  it("keeps a module while a hold covers its lead, and deletes it once lifted", async () => {
    const lead = await personIdOf(w.reader.user.id);
    const [mod] = await db
      .insert(moduleTable)
      .values({
        workspaceId: w.workspaceId,
        projectId: w.project.id,
        name: "Held module",
        leadId: lead,
      })
      .returning();
    if (!mod) throw new Error("module missing");
    const held = await hold("person", lead);
    await expectHeldThenDeletable(
      () =>
        db.transaction((tx) =>
          deleteModuleRow(tx, mod, actor(w.manager.user.id, lead)),
        ),
      held,
      async () =>
        (await db.select().from(moduleTable).where(eq(moduleTable.id, mod.id)))
          .length,
    );
  });

  it("keeps a service while a hold covers its creator, and deletes it once lifted", async () => {
    const [service] = await db
      .insert(serviceTable)
      .values({
        workspaceId: w.workspaceId,
        name: "Held service",
        createdBy: w.reader.user.id,
      })
      .returning();
    if (!service) throw new Error("service missing");
    const held = await hold("person", await personIdOf(w.reader.user.id));
    await expectHeldThenDeletable(
      () =>
        db.transaction((tx) =>
          deleteServiceRow(tx, service.id, w.workspaceId, {
            userId: w.manager.user.id,
            actorType: "person",
          } as never),
        ),
      held,
      async () =>
        (
          await db
            .select()
            .from(serviceTable)
            .where(eq(serviceTable.id, service.id))
        ).length,
    );
  });

  it("keeps a KB category while a hold covers the workspace's organisation, and deletes it once lifted", async () => {
    const [category] = await db
      .insert(kbCategoryTable)
      .values({ workspaceId: w.workspaceId, name: "Held category" })
      .returning();
    if (!category) throw new Error("category missing");
    const held = await hold("organisation", await workspaceOrganisation());
    await expectHeldThenDeletable(
      () =>
        db.transaction((tx) =>
          deleteCategoryRow(tx, category.id, w.workspaceId, {
            userId: w.manager.user.id,
            actorType: "person",
          } as never),
        ),
      held,
      async () =>
        (
          await db
            .select()
            .from(kbCategoryTable)
            .where(eq(kbCategoryTable.id, category.id))
        ).length,
    );
  });

  it("keeps a dashboard while a hold covers its owner, and deletes it once lifted", async () => {
    const owner = await personIdOf(w.reader.user.id);
    const [dashboard] = await db
      .insert(dashboardTable)
      .values({
        workspaceId: w.workspaceId,
        ownerId: owner,
        name: "Held dashboard",
        scope: "personal",
      })
      .returning();
    if (!dashboard) throw new Error("dashboard missing");
    const held = await hold("person", owner);
    await expectHeldThenDeletable(
      () =>
        db.transaction(async (tx) => {
          const row = await lockDashboard(tx, dashboard.id);
          if (!row) throw new Error("dashboard missing");
          return deleteDashboardRow(tx, row, {
            userId: w.manager.user.id,
            actorType: "person",
          } as never);
        }),
      held,
      async () =>
        (
          await db
            .select()
            .from(dashboardTable)
            .where(eq(dashboardTable.id, dashboard.id))
        ).length,
    );
  });
});

describe("budget.threshold_reached webhooks need budget:read and manage_rates (P5-R1-07)", () => {
  let w: AgileWorld;
  beforeEach(async () => {
    await resetTestDatabase();
    w = await agileWorld();
  });

  it("reaches an owner who may see the budget at the project, not one who may not", async () => {
    const subject = {
      workspaceId: w.workspaceId,
      projectId: w.project.id,
      workItemEvent: false,
      eventKind: "budget.threshold_reached",
    };
    // The reader may read the project but holds neither budget:read nor manage_rates.
    const reader = await personIdOf(w.reader.user.id);
    expect(await decideOwnerReach(db, reader, subject)).toEqual({
      kind: "out_of_reach",
    });
    // The manager is given both capabilities at the project (the project role widens).
    await grantProjectRole(w.manager.user.id, w.project.id, [
      "budget:read",
      "time_entry:manage_rates",
    ]);
    expect(
      await decideOwnerReach(db, await personIdOf(w.manager.user.id), subject),
    ).toEqual({ kind: "in_reach" });
    // The same reader still receives an event that carries no budget figure.
    expect(
      await decideOwnerReach(db, reader, {
        ...subject,
        eventKind: "work_item.created",
      }),
    ).toEqual({ kind: "in_reach" });
  });
});
