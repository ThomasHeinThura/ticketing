/**
 * P5-R2-01: the shared legal-hold predicate (`utils/legal-hold-scope.ts`) fences every P5 table
 * that stores a person or customer id and cascades away on a project purge or a workspace hard
 * delete (pages and versions, knowledge base articles, versions, feedback and deflection events,
 * agile rows, time rows, dashboards, services, releases, change freezes and invitations), and the
 * page purge reuses the same page list.
 *
 * Every case is two-sided: the row is retained while a person-scope hold covers a person whose
 * ONLY footprint is that column, and is removed once the hold is lifted, so "retained" cannot
 * mean "nothing matched".
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { checklistItemTable } from "../../apps/api/src/database/schema";
import {
  cycleScopeEventTable,
  cycleTable,
  estimateChangeTable,
  estimateTable,
  moduleTable,
} from "../../apps/api/src/database/schema-p5-agile";
import {
  deflectionEventTable,
  kbArticleFeedbackTable,
  kbArticleTable,
  kbArticleVersionTable,
} from "../../apps/api/src/database/schema-p5-kb";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { dashboardTable } from "../../apps/api/src/database/schema-p5-reports";
import {
  changeFreezeTable,
  releaseTable,
  serviceTable,
} from "../../apps/api/src/database/schema-p5-service";
import {
  budgetTable,
  hourlyRateTable,
} from "../../apps/api/src/database/schema-p5-time";
import { purgeSoftDeletedPages } from "../../apps/api/src/scheduler/page-purge";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import {
  assertWorkspaceNotUnderLegalHold,
  WorkspaceUnderLegalHoldError,
} from "../../apps/api/src/utils/workspace-legal-hold";
import { deleteWorkspaceRoleDependents } from "../../apps/api/src/workspace/controllers/delete-workspace-role-dependents";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const body = { type: "doc", content: [] };

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "p5 hold scope test",
      })
      .returning(),
    "hold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

async function workspaceIsHeld(t: Tenant): Promise<boolean> {
  return db.transaction(async (tx) => {
    try {
      await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
      return false;
    } catch (error) {
      if (error instanceof WorkspaceUnderLegalHoldError) return true;
      throw error;
    }
  });
}

/** A person with no membership and no other footprint, so only the seeded column can fence. */
async function bystander(t: Tenant, side: "staff" | "customer" = "staff") {
  const userId = `user-${randomUUID()}`;
  await db.insert(schema.userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: true,
    name: "Bystander",
  });
  const organisationId = requireRow(
    await db
      .select({ id: schema.personTable.organisationId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, t.requesterPerson.id)),
    "organisation",
  ).id;
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({ userId, organisationId, side, active: true })
      .returning(),
    "bystander person",
  );
  return { userId, person };
}
type Bystander = Awaited<ReturnType<typeof bystander>>;

async function projectExists(id: string) {
  const rows = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, id));
  return rows.length === 1;
}

async function softDeleteProject(t: Tenant) {
  await db
    .update(schema.projectTable)
    .set({
      deletedAt: new Date(Date.now() - 31 * DAY_MS),
      purgeAfter: new Date(Date.now() - DAY_MS),
    })
    .where(eq(schema.projectTable.id, t.project.id));
}

async function article(
  t: Tenant,
  values: Partial<typeof kbArticleTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(kbArticleTable)
      .values({
        workspaceId: t.workspaceId,
        title: "Article",
        body,
        ...values,
      })
      .returning(),
    "article",
  );
}

async function page(
  t: Tenant,
  values: Partial<typeof projectPageTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(projectPageTable)
      .values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        title: "Page",
        body,
        ...values,
      })
      .returning(),
    "page",
  );
}

type Case = {
  name: string;
  /** `project`: the row cascades with a project purge AND a workspace delete. */
  scope: "project" | "workspace";
  seed: (t: Tenant, by: Bystander) => Promise<void>;
};

const projectArticle = (t: Tenant, extra: object = {}) =>
  article(t, { projectId: t.project.id, ...extra });

/** A release of a fresh service with one checklist item ticked by `doneBy` (a person id). */
async function seedReleaseChecklistItem(workspaceId: string, doneBy: string) {
  const svc = requireRow(
    await db
      .insert(serviceTable)
      .values({ workspaceId, name: "Svc" })
      .returning(),
    "service",
  );
  const release = requireRow(
    await db
      .insert(releaseTable)
      .values({ workspaceId, serviceId: svc.id, name: "R-checklist" })
      .returning(),
    "release",
  );
  await db.insert(checklistItemTable).values({
    workspaceId,
    releaseId: release.id,
    position: 1,
    text: "Smoke test passed",
    doneAt: new Date(),
    doneBy,
  });
}

const cases: Case[] = [
  {
    name: "project_page.created_by",
    scope: "project",
    seed: async (t, by) => {
      await page(t, { createdBy: by.person.id });
    },
  },
  {
    name: "project_page.updated_by",
    scope: "project",
    seed: async (t, by) => {
      await page(t, { updatedBy: by.person.id });
    },
  },
  {
    name: "project_page_version.created_by",
    scope: "project",
    seed: async (t, by) => {
      const p = await page(t);
      await db.insert(projectPageVersionTable).values({
        pageId: p.id,
        number: 1,
        title: "v1",
        body,
        createdBy: by.person.id,
      });
    },
  },
  {
    name: "project-scoped kb_article.author_id",
    scope: "project",
    seed: async (t, by) => {
      await projectArticle(t, { authorId: by.person.id });
    },
  },
  {
    name: "project-scoped kb_article.owner_id",
    scope: "project",
    seed: async (t, by) => {
      await projectArticle(t, { ownerId: by.person.id });
    },
  },
  {
    name: "kb_article_version.created_by of a project article",
    scope: "project",
    seed: async (t, by) => {
      const a = await projectArticle(t);
      await db.insert(kbArticleVersionTable).values({
        articleId: a.id,
        number: 1,
        title: "v1",
        body,
        createdBy: by.person.id,
      });
    },
  },
  {
    name: "kb_article_feedback.person_id of a project article",
    scope: "project",
    seed: async (t, by) => {
      const a = await projectArticle(t);
      await db
        .insert(kbArticleFeedbackTable)
        .values({ articleId: a.id, personId: by.person.id, helpful: true });
    },
  },
  {
    name: "deflection_event.person_id of a project article",
    scope: "project",
    seed: async (t, by) => {
      const a = await projectArticle(t);
      await db.insert(deflectionEventTable).values({
        workspaceId: t.workspaceId,
        personId: by.person.id,
        kbArticleId: a.id,
        query: "reset password",
      });
    },
  },
  {
    name: "module.lead_id",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(moduleTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        name: "Module",
        leadId: by.person.id,
      });
    },
  },
  {
    name: "module.created_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(moduleTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        name: "Module",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "cycle.completed_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(cycleTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        name: "Cycle",
        startDate: "2026-01-01",
        endDate: "2026-01-14",
        completedBy: by.userId,
      });
    },
  },
  {
    name: "cycle_scope_event.actor_id (a user id)",
    scope: "project",
    seed: async (t, by) => {
      const cycle = requireRow(
        await db
          .insert(cycleTable)
          .values({
            workspaceId: t.workspaceId,
            projectId: t.project.id,
            name: "Cycle",
            startDate: "2026-01-01",
            endDate: "2026-01-14",
          })
          .returning(),
        "cycle",
      );
      await db.insert(cycleScopeEventTable).values({
        workspaceId: t.workspaceId,
        cycleId: cycle.id,
        workItemId: t.workItem.id,
        kind: "added",
        actorId: by.userId,
      });
    },
  },
  {
    name: "estimate.created_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(estimateTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        system: "points",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "estimate_change.actor_id (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(estimateChangeTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        kind: "system",
        toSystem: "points",
        actorId: by.userId,
      });
    },
  },
  {
    name: "budget.created_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(budgetTable).values({
        workspaceId: t.workspaceId,
        projectId: t.project.id,
        name: "Budget",
        plannedAmountMinor: 1000,
        currency: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "hourly_rate.created_by (a user id)",
    scope: "project",
    seed: async (t, by) => {
      await db.insert(hourlyRateTable).values({
        workspaceId: t.workspaceId,
        personId: t.requesterPerson.id,
        projectId: t.project.id,
        rateMinor: 5000,
        currency: "USD",
        effectiveFrom: "2026-01-01",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "workspace kb_article.author_id",
    scope: "workspace",
    seed: async (t, by) => {
      await article(t, { authorId: by.person.id });
    },
  },
  {
    name: "kb_article_feedback.person_id of a customer",
    scope: "workspace",
    seed: async (t) => {
      const customer = await bystander(t, "customer");
      const a = await article(t);
      await db.insert(kbArticleFeedbackTable).values({
        articleId: a.id,
        personId: customer.person.id,
        helpful: false,
        comment: "did not help",
      });
      customerOf.set(t, customer);
    },
  },
  {
    name: "deflection_event.person_id of a customer",
    scope: "workspace",
    seed: async (t) => {
      const customer = await bystander(t, "customer");
      const a = await article(t);
      await db.insert(deflectionEventTable).values({
        workspaceId: t.workspaceId,
        personId: customer.person.id,
        kbArticleId: a.id,
        query: "vpn down",
      });
      customerOf.set(t, customer);
    },
  },
  {
    name: "dashboard.owner_id",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(dashboardTable).values({
        workspaceId: t.workspaceId,
        ownerId: by.person.id,
        name: "Mine",
        scope: "personal",
      });
    },
  },
  {
    name: "saved_view.created_by",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(schema.savedViewTable).values({
        workspaceId: t.workspaceId,
        createdBy: by.person.id,
        name: "View",
        scope: "workspace",
        scopeId: t.workspaceId,
        visibility: "private",
        query: { entity: "work_item" },
        layout: "list",
      });
    },
  },
  {
    name: "service.created_by (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(serviceTable).values({
        workspaceId: t.workspaceId,
        name: "Svc",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "release.created_by (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      const svc = requireRow(
        await db
          .insert(serviceTable)
          .values({ workspaceId: t.workspaceId, name: "Svc" })
          .returning(),
        "service",
      );
      await db.insert(releaseTable).values({
        workspaceId: t.workspaceId,
        serviceId: svc.id,
        name: "R1",
        createdBy: by.userId,
      });
    },
  },
  {
    name: "checklist_item.done_by on a release checklist (a person id)",
    scope: "workspace",
    seed: async (t, by) => {
      await seedReleaseChecklistItem(t.workspaceId, by.person.id);
    },
  },
  {
    name: "change_freeze.cancelled_by (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(changeFreezeTable).values({
        workspaceId: t.workspaceId,
        name: "Freeze",
        startsAt: new Date("2026-12-01T00:00:00Z"),
        endsAt: new Date("2026-12-02T00:00:00Z"),
        cancelledAt: new Date(),
        cancelledBy: by.userId,
      });
    },
  },
  {
    name: "invitation.accepted_person_id",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(schema.invitationTable).values({
        workspaceId: t.workspaceId,
        email: `${randomUUID()}@example.com`,
        expiresAt: new Date(Date.now() + DAY_MS),
        inviterId: t.requester.user.id,
        status: "accepted",
        acceptedPersonId: by.person.id,
      });
    },
  },
  {
    name: "invitation.inviter_id (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(schema.invitationTable).values({
        workspaceId: t.workspaceId,
        email: `${randomUUID()}@example.com`,
        expiresAt: new Date(Date.now() + DAY_MS),
        inviterId: by.userId,
      });
    },
  },
  {
    name: "workspace-default hourly_rate.person_id of a former member",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(hourlyRateTable).values({
        workspaceId: t.workspaceId,
        personId: by.person.id,
        projectId: null,
        rateMinor: 5000,
        currency: "EUR",
        effectiveFrom: "2026-01-01",
      });
    },
  },
  {
    name: "workspace-default hourly_rate.created_by (a user id)",
    scope: "workspace",
    seed: async (t, by) => {
      await db.insert(hourlyRateTable).values({
        workspaceId: t.workspaceId,
        personId: t.requesterPerson.id,
        projectId: null,
        rateMinor: 5000,
        currency: "EUR",
        effectiveFrom: "2026-01-01",
        createdBy: by.userId,
      });
    },
  },
];

/** Cases that seed their own (customer) person register it here so the test holds that person. */
const customerOf = new WeakMap<Tenant, Bystander>();

describe("a person hold on a P5 author or customer fences the purge and the workspace delete (P5-R2-01)", () => {
  beforeEach(() => resetTestDatabase());

  for (const c of cases) {
    it(`${c.name} (${c.scope})`, async () => {
      const t = await buildTenant(`p5-hold-${randomUUID()}`);
      const by = await bystander(t);
      await c.seed(t, by);
      const held = customerOf.get(t) ?? by;

      // Control: nothing fences before the hold.
      expect(await workspaceIsHeld(t)).toBe(false);
      const hold = await placeHold("person", held.person.id);
      expect(await workspaceIsHeld(t)).toBe(true);

      if (c.scope === "project") {
        await softDeleteProject(t);
        await purgeSoftDeletedRows();
        expect(await projectExists(t.project.id)).toBe(true);
        await liftHold(hold.id);
        expect(await workspaceIsHeld(t)).toBe(false);
        await purgeSoftDeletedRows();
        expect(await projectExists(t.project.id)).toBe(false);
      } else {
        await liftHold(hold.id);
        expect(await workspaceIsHeld(t)).toBe(false);
      }
    });
  }

  it("a held customer's KB feedback refuses the workspace delete, and the delete runs once the hold lifts", async () => {
    const t = await buildTenant("p5-hold-ws-delete");
    const customer = await bystander(t, "customer");
    const a = await article(t);
    await db
      .insert(kbArticleFeedbackTable)
      .values({ articleId: a.id, personId: customer.person.id, helpful: true });
    await db.insert(deflectionEventTable).values({
      workspaceId: t.workspaceId,
      personId: customer.person.id,
      kbArticleId: a.id,
    });
    const hold = await placeHold("person", customer.person.id);

    const hardDelete = () =>
      db.transaction(async (tx) => {
        await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
        await deleteWorkspaceRoleDependents(tx, [t.workspaceId]);
        await tx
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, t.workspaceId));
      });
    await expect(hardDelete()).rejects.toBeInstanceOf(
      WorkspaceUnderLegalHoldError,
    );
    expect(
      await db
        .select({ id: kbArticleFeedbackTable.id })
        .from(kbArticleFeedbackTable),
    ).toHaveLength(1);

    await liftHold(hold.id);
    await hardDelete();
    expect(
      await db
        .select({ id: kbArticleFeedbackTable.id })
        .from(kbArticleFeedbackTable),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: deflectionEventTable.id })
        .from(deflectionEventTable),
    ).toHaveLength(0);
  });

  it("a former member's workspace-default rate refuses the workspace hard delete until the hold lifts (P5-R3-04)", async () => {
    const t = await buildTenant("p5-hold-default-rate");
    const by = await bystander(t); // no workspace_member row: only the rate row can fence
    await db.insert(hourlyRateTable).values({
      workspaceId: t.workspaceId,
      personId: by.person.id,
      projectId: null,
      rateMinor: 5000,
      currency: "EUR",
      effectiveFrom: "2026-01-01",
    });
    const hold = await placeHold("person", by.person.id);
    const hardDelete = () =>
      db.transaction(async (tx) => {
        await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
        await deleteWorkspaceRoleDependents(tx, [t.workspaceId]);
        await tx
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, t.workspaceId));
      });
    await expect(hardDelete()).rejects.toBeInstanceOf(
      WorkspaceUnderLegalHoldError,
    );
    expect(
      await db.select({ id: hourlyRateTable.id }).from(hourlyRateTable),
    ).toHaveLength(1);
    await liftHold(hold.id);
    await hardDelete();
    expect(
      await db.select({ id: hourlyRateTable.id }).from(hourlyRateTable),
    ).toHaveLength(0);
  });

  it("a former member who only ticked a release checklist item refuses the workspace hard delete until the hold lifts (P5-R4-06)", async () => {
    const t = await buildTenant("p5-hold-release-checklist");
    const by = await bystander(t); // no workspace_member row: only the checklist item can fence
    await seedReleaseChecklistItem(t.workspaceId, by.person.id);
    const hold = await placeHold("person", by.person.id);
    const hardDelete = () =>
      db.transaction(async (tx) => {
        await assertWorkspaceNotUnderLegalHold(tx, t.workspaceId);
        await deleteWorkspaceRoleDependents(tx, [t.workspaceId]);
        await tx
          .delete(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, t.workspaceId));
      });
    await expect(hardDelete()).rejects.toBeInstanceOf(
      WorkspaceUnderLegalHoldError,
    );
    expect(
      await db.select({ id: checklistItemTable.id }).from(checklistItemTable),
    ).toHaveLength(1);
    await liftHold(hold.id);
    await hardDelete();
    expect(
      await db.select({ id: checklistItemTable.id }).from(checklistItemTable),
    ).toHaveLength(0);
  });

  it("a held user who added an item to a cycle keeps the soft-deleted item, and the purge runs once the hold lifts (P5-R3-03)", async () => {
    const t = await buildTenant("p5-hold-scope-event-item");
    const by = await bystander(t);
    const cycle = requireRow(
      await db
        .insert(cycleTable)
        .values({
          workspaceId: t.workspaceId,
          projectId: t.project.id,
          name: "Cycle",
          startDate: "2026-01-01",
          endDate: "2026-01-14",
        })
        .returning(),
      "cycle",
    );
    await db.insert(cycleScopeEventTable).values({
      workspaceId: t.workspaceId,
      cycleId: cycle.id,
      workItemId: t.workItem.id,
      kind: "added",
      actorId: by.userId,
    });
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date(Date.now() - 40 * DAY_MS) })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    const itemRows = () =>
      db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, t.workItem.id));
    const hold = await placeHold("person", by.person.id);

    await purgeSoftDeletedRows();
    expect(await itemRows()).toHaveLength(1);
    await liftHold(hold.id);
    await purgeSoftDeletedRows();
    expect(await itemRows()).toHaveLength(0);
  });

  it("an organisation hold still fences a project that holds only P5 rows", async () => {
    const t = await buildTenant("p5-hold-org");
    await page(t);
    await softDeleteProject(t);
    const orgId = requireRow(
      await db
        .select({ id: schema.workspaceTable.organisationId })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, t.workspaceId)),
      "workspace",
    ).id;
    const hold = await placeHold("organisation", orgId);
    await purgeSoftDeletedRows();
    expect(await projectExists(t.project.id)).toBe(true);
    await liftHold(hold.id);
    await purgeSoftDeletedRows();
    expect(await projectExists(t.project.id)).toBe(false);
  });

  it("page-purge uses the same page list: a held version author keeps a deleted page", async () => {
    const t = await buildTenant("p5-hold-page-purge");
    const by = await bystander(t);
    const p = await page(t, {
      deletedAt: new Date(Date.now() - 31 * DAY_MS),
      purgeAfter: new Date(Date.now() - DAY_MS),
    });
    await db.insert(projectPageVersionTable).values({
      pageId: p.id,
      number: 1,
      title: "v1",
      body,
      createdBy: by.person.id,
    });
    const hold = await placeHold("person", by.person.id);
    const pageRows = () =>
      db
        .select({ id: projectPageTable.id })
        .from(projectPageTable)
        .where(eq(projectPageTable.id, p.id));

    expect((await purgeSoftDeletedPages()).purged).toBe(0);
    expect(await pageRows()).toHaveLength(1);
    await liftHold(hold.id);
    expect((await purgeSoftDeletedPages()).purged).toBe(1);
    expect(await pageRows()).toHaveLength(0);
  });
});
