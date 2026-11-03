/**
 * U-11 engagement-scoped status: Project Details shows the dashboard's figures and cases for one
 * engagement (`GET /api/portal/home?project=KEY`, `GET /api/portal/requests?project=KEY`), and
 * the agent Overview shows the same closed-in-30-days and average-first-response figures for
 * staff (`GET /api/project/{id}/overview`).
 *
 * Contoso is the seeded intake customer organisation; Fabrikam is a second organisation with its
 * own project in the same workspace.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { addCustomer, portalRequest } from "./helpers/approval-fixtures";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import {
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submitAs,
} from "./helpers/intake-http";

type Home = {
  actionRequired: { total: number; cases: number; approvals: number };
  outstanding: number;
  closedLast30Days: number;
  averageFirstResponse: { seconds: number; sampleSize: number } | null;
};

type CasePage = { cases: Array<{ ref: string }>; meta: { total: number } };

const DAY = 86_400_000;
const OUTSTANDING = "received,need_more_info,in_progress";

let s: IntakeSeed;
let contosoKey: string;

async function portalJson<T>(as: unknown, path: string): Promise<T> {
  const response = await portalRequest(s.t, as as never, path);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

const home = (as: unknown, key: string) =>
  portalJson<Home>(as, `/api/portal/home?project=${encodeURIComponent(key)}`);

const cases = (as: unknown, key: string, query: string) =>
  portalJson<CasePage>(
    as,
    `/api/portal/requests?project=${encodeURIComponent(key)}&${query}`,
  );

async function staffOverview(projectId: string) {
  const response = await staffRequest(
    s.t,
    s.t.requester,
    `/api/project/${projectId}/overview`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    counts: { open: number; waiting: number; closedLast30Days: number };
    averageFirstResponse: Home["averageFirstResponse"];
    slaEnabled: boolean;
  };
}

async function setFlag(featureKey: string, on: boolean) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey, enabled: true, locked: false })
    .onConflictDoNothing();
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId: s.t.workspaceId, featureKey, enabled: on })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled: on },
    });
  invalidateFeatureFlagCache();
}

async function stateOf(projectId: string, templateId: string) {
  return requireRow(
    await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(
        and(
          eq(schema.stateTable.projectId, projectId),
          eq(schema.stateTable.stateTemplateId, templateId),
        ),
      )
      .limit(1),
    "state",
  ).id;
}

let itemNumber = 9000;

/**
 * A request raised by staff (D6): no submission, so it is a `direct` portal case when its
 * requester is a customer. `requesterId: null` is internal work no customer sees.
 */
async function raiseItem(values: {
  projectId?: string;
  stateId: string;
  requesterId: string | null;
  waiting?: boolean;
  createdAt?: Date;
  firstResponseAt?: Date;
  resolvedAt?: Date;
}) {
  itemNumber += 1;
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: s.t.workspaceId,
        projectId: values.projectId ?? s.t.project.id,
        typeId: s.t.type.id,
        stateId: values.stateId,
        title: `Raised by staff ${itemNumber}`,
        number: itemNumber,
        key: `U11-${randomUUID().slice(0, 8)}`,
        requesterId: values.requesterId,
        customerVisibility: "organisation",
        ...(values.createdAt
          ? { createdAt: values.createdAt, slaStartedAt: values.createdAt }
          : {}),
        ...(values.firstResponseAt
          ? { firstResponseAt: values.firstResponseAt }
          : {}),
        ...(values.resolvedAt ? { resolvedAt: values.resolvedAt } : {}),
      })
      .returning(),
    "item",
  );
  if (values.waiting)
    await db.insert(slaPauseTable).values({
      workItemId: item.id,
      metric: "resolution",
      reason: "waiting_customer",
    });
  return item;
}

beforeEach(async () => {
  await resetTestDatabase();
  s = await seedIntake("u11");
  contosoKey = s.t.project.slug;
  await setFlag("feature.sla", true);
});

describe("U-11 Project Details figures and cases", () => {
  it("shows the same counts as the scoped dashboard and list for each viewer", async () => {
    const colleague = await addCustomer(s.t);
    // Contoso: a clarifying organisation-visible submission, a new private one, and a request
    // staff raised for the customer that waits on them.
    const clarifying = await submitAs(s, s.customer, "Printer down");
    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying", customerVisibility: "organisation" })
      .where(
        eq(
          schema.submissionTable.number,
          Number(clarifying.replace("SUB-", "")),
        ),
      );
    const privateRef = await submitAs(s, s.customer, "VPN access");
    await db
      .update(schema.submissionTable)
      .set({ customerVisibility: "private" })
      .where(
        eq(
          schema.submissionTable.number,
          Number(privateRef.replace("SUB-", "")),
        ),
      );
    await raiseItem({
      stateId: await stateOf(s.t.project.id, s.t.wip.id),
      requesterId: s.customer.person.id,
      waiting: true,
    });

    for (const [viewer, expected] of [
      [s.customer, { outstanding: 3, needMoreInfo: 2, mine: 3 }],
      // The colleague reads the two organisation-visible cases, raises none.
      [colleague, { outstanding: 2, needMoreInfo: 2, mine: 0 }],
    ] as const) {
      const figures = await home(viewer, contosoKey);
      const outstanding = await cases(
        viewer,
        contosoKey,
        `scope=all&status=${OUTSTANDING}&limit=10`,
      );
      const needMoreInfo = await cases(
        viewer,
        contosoKey,
        "scope=all&status=need_more_info&limit=10",
      );
      const mine = await cases(
        viewer,
        contosoKey,
        `scope=mine&status=${OUTSTANDING}&limit=10`,
      );
      expect(figures.outstanding).toBe(expected.outstanding);
      expect(outstanding.meta.total).toBe(figures.outstanding);
      expect(figures.actionRequired.cases).toBe(expected.needMoreInfo);
      expect(needMoreInfo.meta.total).toBe(figures.actionRequired.cases);
      expect(mine.meta.total).toBe(expected.mine);
      // Project Details' own counts are the same figures (S4c).
      const detail = await portalJson<{
        counts: { actionRequired: number; outstanding: number };
      }>(viewer, `/api/portal/projects/${encodeURIComponent(contosoKey)}`);
      expect(detail.counts).toEqual({
        actionRequired: figures.actionRequired.total,
        outstanding: figures.outstanding,
      });
    }
  });

  it("keeps each organisation's engagement figures and cases to itself (CP-1, CP-2)", async () => {
    const fabrikam = await createCustomerPrincipal();
    const { project: fabrikamProject } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Fabrikam support",
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: fabrikam.orgId })
      .where(eq(schema.projectTable.id, fabrikamProject.id));
    const fabrikamState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: fabrikamProject.id,
          stateTemplateId: s.t.wip.id,
        })
        .returning(),
      "fabrikam state",
    ).id;
    await raiseItem({
      projectId: fabrikamProject.id,
      stateId: fabrikamState,
      requesterId: fabrikam.person.id,
      waiting: true,
    });
    await submitAs(s, s.customer, "Contoso only");

    const own = await home(fabrikam, fabrikamProject.slug);
    expect(own.outstanding).toBe(1);
    expect(own.actionRequired.cases).toBe(1);

    // Contoso asking for Fabrikam's key sees nothing of it, as for an unknown key.
    const foreign = await home(s.customer, fabrikamProject.slug);
    expect(foreign).toEqual(await home(s.customer, "NOPE"));
    expect(foreign).toMatchObject({
      outstanding: 0,
      closedLast30Days: 0,
      averageFirstResponse: null,
      actionRequired: { total: 0, cases: 0, approvals: 0 },
    });
    expect(
      (await cases(s.customer, fabrikamProject.slug, "scope=all")).meta.total,
    ).toBe(0);
    expect(
      (
        await portalRequest(
          s.t,
          s.customer as never,
          `/api/portal/projects/${encodeURIComponent(fabrikamProject.slug)}`,
        )
      ).status,
    ).toBe(404);
    // And the other way round.
    expect((await home(fabrikam, contosoKey)).outstanding).toBe(0);
    expect((await cases(fabrikam, contosoKey, "scope=all")).meta.total).toBe(0);
  });
});

/** Sets a submission's triage state (and visibility) by its `SUB-n` reference. */
async function setSubmission(
  ref: string,
  values: Partial<typeof schema.submissionTable.$inferInsert>,
) {
  await db
    .update(schema.submissionTable)
    .set(values)
    .where(eq(schema.submissionTable.number, Number(ref.replace("SUB-", ""))));
}

describe("U-11 agent Overview closed and first-response figures", () => {
  it("equals the portal figures when every item is a case the customer can read", async () => {
    const now = Date.now();
    const done = await stateOf(s.t.project.id, s.t.done.id);
    const wip = await stateOf(s.t.project.id, s.t.wip.id);
    // Closed 2 days ago, first answered 1h after it started.
    await raiseItem({
      stateId: done,
      requesterId: s.customer.person.id,
      createdAt: new Date(now - 3 * DAY),
      firstResponseAt: new Date(now - 3 * DAY + 3_600_000),
      resolvedAt: new Date(now - 2 * DAY),
    });
    // Open, first answered 2h after it started.
    await raiseItem({
      stateId: wip,
      requesterId: s.customer.person.id,
      createdAt: new Date(now - DAY),
      firstResponseAt: new Date(now - DAY + 7_200_000),
    });
    // Closed and answered more than 30 days ago: outside both windows.
    await raiseItem({
      stateId: done,
      requesterId: s.customer.person.id,
      createdAt: new Date(now - 45 * DAY),
      firstResponseAt: new Date(now - 44 * DAY),
      resolvedAt: new Date(now - 40 * DAY),
    });

    const portal = await home(s.customer, contosoKey);
    const staff = await staffOverview(s.t.project.id);
    expect(portal.closedLast30Days).toBe(1);
    expect(portal.averageFirstResponse).toEqual({
      seconds: 5400,
      sampleSize: 2,
    });
    expect(staff.counts.closedLast30Days).toBe(portal.closedLast30Days);
    expect(staff.averageFirstResponse).toEqual(portal.averageFirstResponse);
    expect(staff.slaEnabled).toBe(true);

    // Both hide the average while feature.sla is off for the project (D4). Staff are told the
    // flag is off, so an answered project is not shown as having no first response.
    await setFlag("feature.sla", false);
    expect(
      (await home(s.customer, contosoKey)).averageFirstResponse,
    ).toBeNull();
    const slaOff = await staffOverview(s.t.project.id);
    expect(slaOff.averageFirstResponse).toBeNull();
    expect(slaOff.slaEnabled).toBe(false);
    // The answered items are still there: switching the flag back restores the same figure.
    await setFlag("feature.sla", true);
    expect(await staffOverview(s.t.project.id)).toMatchObject({
      averageFirstResponse: { seconds: 5400, sampleSize: 2 },
      slaEnabled: true,
    });
  });

  it("counts internal work for staff only, so the figures then differ", async () => {
    const now = Date.now();
    const done = await stateOf(s.t.project.id, s.t.done.id);
    await raiseItem({
      stateId: done,
      requesterId: s.customer.person.id,
      resolvedAt: new Date(now - DAY),
    });
    // Internal work (no customer requester) closed yesterday: never a portal case.
    await raiseItem({
      stateId: done,
      requesterId: null,
      resolvedAt: new Date(now - DAY),
    });
    expect((await home(s.customer, contosoKey)).closedLast30Days).toBe(1);
    expect((await staffOverview(s.t.project.id)).counts.closedLast30Days).toBe(
      2,
    );
  });

  // Decision (U-11 review): the Overview counts work items only. Submissions still in triage
  // (new, clarifying) or declined there have no work item, so the portal home counts them and
  // the Overview does not. This pins the documented difference so neither side drifts silently.
  it("counts work items only, excluding submissions awaiting or declined in triage", async () => {
    // The intake seed already holds internal work in the project, which only staff count.
    const before = (await staffOverview(s.t.project.id)).counts;
    const clarifying = await submitAs(s, s.customer, "Printer down");
    await setSubmission(clarifying, {
      state: "clarifying",
      customerVisibility: "organisation",
    });
    await submitAs(s, s.customer, "VPN access");
    await raiseItem({
      stateId: await stateOf(s.t.project.id, s.t.wip.id),
      requesterId: s.customer.person.id,
      waiting: true,
    });
    const declined = await submitAs(s, s.customer, "Duplicate of VPN access");
    await setSubmission(declined, { state: "declined" });

    const portal = await home(s.customer, contosoKey);
    const staff = await staffOverview(s.t.project.id);
    // Portal: the new and clarifying submissions plus the raised item are outstanding; the
    // clarifying one and the raised item wait on the customer; the declined one is closed.
    expect(portal.outstanding).toBe(3);
    expect(portal.actionRequired.cases).toBe(2);
    expect(portal.closedLast30Days).toBe(1);
    // Overview: of these, only the raised work item exists.
    expect(staff.counts.open).toBe(before.open + 1);
    expect(staff.counts.waiting).toBe(before.waiting + 1);
    expect(staff.counts.closedLast30Days).toBe(before.closedLast30Days);
  });
});
