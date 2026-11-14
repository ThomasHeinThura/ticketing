/**
 * S4c customer portal projects: `GET /api/portal/projects` and `GET /api/portal/projects/{key}`
 * (`feature-contracts-p3.md` "Customer portal API"; CP-1, CP-2, CP-4; D2/D3).
 *
 * Contoso is the seeded intake customer organisation; Fabrikam is a second organisation with its
 * own project in the same workspace.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { createCalendar } from "../../apps/api/src/service-calendar/repository";
import {
  addCustomer,
  buildTenant,
  portalRequest,
  request,
} from "./helpers/approval-fixtures";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";
import { type IntakeSeed, seedIntake, submitAs } from "./helpers/intake-http";

type ProjectSummary = {
  key: string;
  name: string;
  kind: string;
  status: string;
  health: string | null;
  counts: { actionRequired: number; outstanding: number };
};

type ProjectDetail = ProjectSummary & {
  description: string | null;
  createdAt: string;
  supportLevel: string | null;
  serviceCalendarName: string | null;
  summary: Record<string, string | null>;
  goLive: { name: string; date: string; reached: boolean } | null;
  milestones: Array<{ id: string; name: string; reachedAt: string | null }>;
  prerequisites: Array<{ title: string; completedAt: string | null }>;
  documents: Array<{ id: string; title: string; url: string }>;
  contacts: Array<{
    kind: string;
    role: string | null;
    name: string | null;
    email: string | null;
  }>;
  contract: {
    startDate: string;
    endDate: string;
    period: {
      state: string;
      totalDays: number;
      elapsedDays: number;
      daysRemaining: number;
      elapsedPct: number;
    };
    hours: {
      contractedMinutes: number;
      usedMinutes: number;
      remainingMinutes: number;
      usedPct: number;
    };
  } | null;
};

function isoDaysFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

let s: IntakeSeed;
let contosoKey: string;

async function list(as: { user: { id: string } } & Record<string, unknown>) {
  const response = await portalRequest(
    s.t,
    as as never,
    "/api/portal/projects",
  );
  return response;
}

async function detail(as: unknown, key: string) {
  return portalRequest(
    s.t,
    as as never,
    `/api/portal/projects/${encodeURIComponent(key)}`,
  );
}

/** `GET /api/portal/home?project=KEY` as the Projects counts' shape (S4b dashboard). */
async function homeCounts(
  tenant: Parameters<typeof portalRequest>[0],
  as: unknown,
  key: string,
) {
  const response = await portalRequest(
    tenant,
    as as never,
    `/api/portal/home?project=${encodeURIComponent(key)}`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const home = (await response.json()) as {
    actionRequired: { total: number };
    outstanding: number;
  };
  return {
    actionRequired: home.actionRequired.total,
    outstanding: home.outstanding,
  };
}

async function setProject(
  projectId: string,
  values: Partial<typeof schema.projectTable.$inferInsert>,
) {
  await db
    .update(schema.projectTable)
    .set(values)
    .where(eq(schema.projectTable.id, projectId));
}

beforeEach(async () => {
  await resetTestDatabase();
  s = await seedIntake("s4c");
  contosoKey = s.t.project.slug;
  await setProject(s.t.project.id, { name: "Contoso rollout" });
});

describe("GET /api/portal/projects", () => {
  it("lists only the caller's organisation's live, portal-enabled projects", async () => {
    const fabrikam = await createCustomerPrincipal();
    const { project: fabrikamProject } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Fabrikam support",
    });
    const calendar = await createCalendar({
      workspaceId: s.t.workspaceId,
      name: "Business hours",
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
      actor: {
        actorId: s.t.requester.user.id,
        actorType: "person",
        apiKeyId: null,
      },
    });
    await setProject(fabrikamProject.id, {
      organisationId: fabrikam.orgId,
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendar.id,
      serviceCalendarMode: "override",
    });
    await db
      .insert(schema.customerProjectAccessTable)
      .values({ personId: fabrikam.person.id, projectId: fabrikamProject.id });
    const { project: archived } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Contoso archived",
    });
    await setProject(archived.id, {
      organisationId: s.customer.orgId,
      archivedAt: new Date(),
    });
    const { project: deleted } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Contoso deleted",
    });
    await setProject(deleted.id, {
      organisationId: s.customer.orgId,
      deletedAt: new Date(),
    });
    const { project: portalOff } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Contoso internal",
    });
    await setProject(portalOff.id, { organisationId: s.customer.orgId });
    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: portalOff.id,
      featureKey: "feature.customer_portal",
      enabled: false,
    });
    invalidateFeatureFlagCache();
    // An internal project of the same workspace with no customer organisation.
    await createProjectFixture({
      workspaceId: s.t.workspaceId,
      name: "Unbound",
    });

    const contoso = await list(s.customer);
    expect(contoso.status).toBe(200);
    const contosoBody = (await contoso.json()) as { data: ProjectSummary[] };
    expect(contosoBody.data.map((row) => row.name)).toEqual([
      "Contoso rollout",
    ]);
    expect(contosoBody.data[0]).toEqual({
      key: contosoKey,
      name: "Contoso rollout",
      kind: "project",
      status: "active",
      health: null,
      counts: { actionRequired: 0, outstanding: 0 },
    });

    const other = await list(fabrikam);
    const otherBody = (await other.json()) as { data: ProjectSummary[] };
    expect(otherBody.data.map((row) => [row.name, row.kind])).toEqual([
      ["Fabrikam support", "managed_service"],
    ]);

    for (const project of [archived, deleted, portalOff])
      expect((await detail(s.customer, project.slug)).status).toBe(404);
    // CP-2: another organisation's key is the same 404 as an unknown one.
    const foreign = await detail(s.customer, fabrikamProject.slug);
    const unknown = await detail(s.customer, "NOPE");
    const malformed = await detail(s.customer, "bad key!");
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await foreign.text()).toEqual(await unknown.text());
    expect((await detail(fabrikam, contosoKey)).status).toBe(404);
  });

  it("refuses a staff session and hides projects once the organisation loses portal access", async () => {
    const staff = await portalRequest(
      s.t,
      s.t.requester,
      "/api/portal/projects",
    );
    expect(staff.status).not.toBe(200);
    await db
      .update(schema.organisationTable)
      .set({ portalAccess: false })
      .where(eq(schema.organisationTable.id, s.customer.orgId));
    const closed = await list(s.customer);
    expect(closed.status).not.toBe(200);
  });

  it("counts outstanding and action-required requests per project like the dashboard", async () => {
    const colleague = await addCustomer(s.t);
    const ref = await submitAs(s, s.customer, "Printer down");
    const number = Number(ref.replace("SUB-", ""));
    await db
      .update(schema.submissionTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.submissionTable.number, number));

    let mine = (await (await list(s.customer)).json()) as {
      data: ProjectSummary[];
    };
    expect(mine.data[0]?.counts).toEqual({ actionRequired: 0, outstanding: 1 });

    // Clarifying: need more information. Action required for every reader of the case, the
    // colleague included (same rule as GET /api/portal/home).
    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying" })
      .where(eq(schema.submissionTable.number, number));
    mine = (await (await list(s.customer)).json()) as {
      data: ProjectSummary[];
    };
    expect(mine.data[0]?.counts).toEqual({ actionRequired: 1, outstanding: 1 });
    const theirs = (await (await list(colleague)).json()) as {
      data: ProjectSummary[];
    };
    expect(theirs.data[0]?.counts).toEqual({
      actionRequired: 1,
      outstanding: 1,
    });

    // A private submission of a colleague is never counted for the caller (CP-16).
    await submitAs(s, colleague, "Private question");
    const privateRef = await db
      .select({ number: schema.submissionTable.number })
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.requesterId, colleague.person.id));
    await db
      .update(schema.submissionTable)
      .set({ customerVisibility: "private" })
      .where(
        eq(schema.submissionTable.number, requireRow(privateRef, "sub").number),
      );
    mine = (await (await list(s.customer)).json()) as {
      data: ProjectSummary[];
    };
    expect(mine.data[0]?.counts).toEqual({ actionRequired: 1, outstanding: 1 });

    // D6: a request raised by staff for the customer, waiting on the customer.
    const [state] = await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.stateTemplateId, s.t.wip.id));
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: s.t.workspaceId,
          projectId: s.t.project.id,
          typeId: s.t.type.id,
          stateId: requireRow([state], "state").id,
          title: "Raised by staff",
          number: 9000,
          key: `S4C-${randomUUID().slice(0, 8)}`,
          requesterId: s.customer.person.id,
        })
        .returning(),
      "item",
    );
    await db.insert(slaPauseTable).values({
      workItemId: item.id,
      metric: "resolution",
      reason: "waiting_customer",
    });
    const detailBody = (await (
      await detail(s.customer, contosoKey)
    ).json()) as ProjectDetail;
    // The staff-raised item waiting on the customer is outstanding and action required (same
    // rule as GET /api/portal/home).
    expect(detailBody.counts).toEqual({ actionRequired: 2, outstanding: 2 });
  });

  it("keeps a submission merged into a colleague's private item as two separate cases", async () => {
    // S4b's case source: the submission joins its work item only when both share a requester,
    // and the item stays a direct row unless a submission by the same requester shows it. So
    // the caller never sees the status of a colleague's private item, and the colleague keeps
    // their own case.
    const colleague = await addCustomer(s.t);
    const ref = await submitAs(s, s.customer, "Printer down");
    const number = Number(ref.replace("SUB-", ""));
    const [state] = await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.stateTemplateId, s.t.wip.id));
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: s.t.workspaceId,
          projectId: s.t.project.id,
          typeId: s.t.type.id,
          stateId: requireRow([state], "state").id,
          title: "Colleague's private case",
          number: 9001,
          key: `S4C-${randomUUID().slice(0, 8)}`,
          requesterId: colleague.person.id,
          customerVisibility: "private",
        })
        .returning(),
      "item",
    );
    await db.insert(slaPauseTable).values({
      workItemId: item.id,
      metric: "resolution",
      reason: "waiting_customer",
    });
    // Staff merge the caller's private submission into the colleague's item as a duplicate.
    await db
      .update(schema.submissionTable)
      .set({
        state: "duplicate",
        workItemId: item.id,
        customerVisibility: "private",
      })
      .where(eq(schema.submissionTable.number, number));

    const countsOf = async (as: unknown) =>
      (
        (await (await list(as as never)).json()) as { data: ProjectSummary[] }
      ).data.find((project) => project.key === contosoKey)?.counts;

    // Caller: their submission is open (no readable item, so in progress); the colleague's
    // private item and its waiting-on-customer pause are not readable, so not counted.
    expect(await countsOf(s.customer)).toEqual({
      actionRequired: 0,
      outstanding: 1,
    });
    // Colleague: their own item stays a direct case waiting on them, outstanding and action
    // required; the caller's private submission is not counted.
    expect(await countsOf(colleague)).toEqual({
      actionRequired: 1,
      outstanding: 1,
    });
  });

  it("counts a colleague's organisation-visible cases that need more information as action required", async () => {
    // Regression (S4c review): action required covers every readable case waiting on the
    // customer, not only the caller's own submissions.
    const colleague = await addCustomer(s.t);
    const ref = await submitAs(s, colleague, "Colleague question");
    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying", customerVisibility: "organisation" })
      .where(
        eq(schema.submissionTable.number, Number(ref.replace("SUB-", ""))),
      );
    const [state] = await db
      .select({ id: schema.stateTable.id })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.stateTemplateId, s.t.wip.id));
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: s.t.workspaceId,
          projectId: s.t.project.id,
          typeId: s.t.type.id,
          stateId: requireRow([state], "state").id,
          title: "Raised by staff for a colleague",
          number: 9002,
          key: `S4C-${randomUUID().slice(0, 8)}`,
          requesterId: colleague.person.id,
          customerVisibility: "organisation",
        })
        .returning(),
      "item",
    );
    await db.insert(slaPauseTable).values({
      workItemId: item.id,
      metric: "resolution",
      reason: "waiting_customer",
    });

    const listed = (
      (await (await list(s.customer)).json()) as { data: ProjectSummary[] }
    ).data.find((project) => project.key === contosoKey)?.counts;
    expect(listed).toEqual({ actionRequired: 2, outstanding: 2 });
    const detailed = (
      (await (await detail(s.customer, contosoKey)).json()) as ProjectDetail
    ).counts;
    expect(detailed).toEqual({ actionRequired: 2, outstanding: 2 });
    // The same figures as the dashboard for that project (one shared case source).
    expect(await homeCounts(s.t, s.customer, contosoKey)).toEqual({
      actionRequired: 2,
      outstanding: 2,
    });
    // The colleague sees the same two cases waiting on the organisation.
    const colleagueListed = (
      (await (await list(colleague as never)).json()) as {
        data: ProjectSummary[];
      }
    ).data.find((project) => project.key === contosoKey)?.counts;
    expect(colleagueListed).toEqual(
      await homeCounts(s.t, colleague, contosoKey),
    );
  });
});

describe("GET /api/portal/projects/{key}", () => {
  it("returns the customer view only: summary, milestones, prerequisites, documents and contacts", async () => {
    const project = s.t.project;
    await setProject(project.id, {
      description: "Customer onboarding programme",
      objective: "Go live on the new portal",
      inScope: "Migration",
      outOfScope: "Hardware",
      successCriteria: "All users migrated",
      statusNote: "INTERNAL: customer is slow to respond",
      status: "planning",
      health: "amber",
      managerId: s.t.requesterPerson.id,
      defaultAssigneeId: s.t.approverPerson.id,
    });
    await db
      .update(schema.personTable)
      .set({ displayName: "Mara Manager" })
      .where(eq(schema.personTable.id, s.t.requesterPerson.id));
    await db
      .update(schema.personTable)
      .set({ displayName: "Sam Stakeholder" })
      .where(eq(schema.personTable.id, s.t.approverPerson.id));
    await db.insert(schema.milestoneTable).values([
      { projectId: project.id, name: "Kick-off", date: new Date("2026-01-10") },
      { projectId: project.id, name: "Launch", date: new Date("2026-06-30") },
      {
        projectId: project.id,
        name: "Design",
        date: new Date("2026-03-01"),
        reachedAt: new Date("2026-03-02"),
      },
    ]);
    await db.insert(schema.prerequisiteTable).values([
      {
        projectId: project.id,
        title: "Provide VPN access",
        ownerSide: "customer",
        isBlocking: true,
      },
      {
        projectId: project.id,
        title: "Sign data agreement",
        ownerSide: "both",
        isBlocking: true,
        completedAt: new Date(),
      },
      {
        projectId: project.id,
        title: "Internal staffing",
        ownerSide: "us",
        isBlocking: true,
      },
      {
        projectId: project.id,
        title: "Nice to have logo",
        ownerSide: "customer",
        isBlocking: false,
      },
    ]);
    await db.insert(schema.documentLinkTable).values([
      {
        projectId: project.id,
        title: "Statement of work",
        url: "https://docs.example.test/sow",
        customerVisible: true,
      },
      {
        projectId: project.id,
        title: "Internal margin sheet",
        url: "https://docs.example.test/margin",
        customerVisible: false,
      },
    ]);
    const customerStakeholder = await addCustomer(s.t);
    await db.insert(schema.stakeholderTable).values([
      {
        projectId: project.id,
        personId: s.t.approverPerson.id,
        role: "Technical lead",
        escalationOrder: 1,
      },
      {
        projectId: project.id,
        personId: customerStakeholder.person.id,
        role: "Customer sponsor",
        escalationOrder: 2,
      },
    ]);

    const response = await detail(s.customer, contosoKey);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text) as ProjectDetail;
    expect(body).toMatchObject({
      key: contosoKey,
      name: "Contoso rollout",
      kind: "project",
      status: "planning",
      health: "amber",
      description: "Customer onboarding programme",
      summary: {
        objective: "Go live on the new portal",
        inScope: "Migration",
        outOfScope: "Hardware",
        successCriteria: "All users migrated",
      },
      goLive: { name: "Launch", reached: false },
      contract: null,
    });
    expect(body.milestones.map((row) => row.name)).toEqual([
      "Kick-off",
      "Design",
      "Launch",
    ]);
    expect(body.prerequisites.map((row) => row.title)).toEqual([
      "Provide VPN access",
      "Sign data agreement",
    ]);
    expect(body.documents.map((row) => row.title)).toEqual([
      "Statement of work",
    ]);
    expect(body.contacts).toEqual([
      {
        kind: "manager",
        role: null,
        name: "Mara Manager",
        email: s.t.requester.user.email,
      },
      {
        kind: "stakeholder",
        role: "Technical lead",
        name: "Sam Stakeholder",
        email: s.t.approver.user.email,
      },
    ]);
    // CP-4 and the internal note: never in any portal shape.
    expect(text).not.toContain("INTERNAL");
    expect(text).not.toContain("statusNote");
    expect(text).not.toMatch(/assignee/i);
    expect(text).not.toContain("margin");
    expect(text).not.toContain("Customer sponsor");
    expect(text).not.toContain("Internal staffing");

    // A stood-down stakeholder and a deactivated manager drop out.
    await db
      .update(schema.stakeholderTable)
      .set({ active: false })
      .where(eq(schema.stakeholderTable.personId, s.t.approverPerson.id));
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, s.t.requesterPerson.id));
    const after = (await (
      await detail(s.customer, contosoKey)
    ).json()) as ProjectDetail;
    expect(after.contacts).toEqual([]);
  });

  it("shows the contract period and aggregate hours only (D2/D3)", async () => {
    const project = s.t.project;
    await db.insert(schema.projectContractTable).values({
      projectId: project.id,
      startDate: isoDaysFromToday(-30),
      endDate: isoDaysFromToday(29),
      contractedMinutes: 600,
      coverage: "9x5",
      kickoffStatus: "completed",
    });
    const activity = requireRow(
      await db
        .insert(timeActivityTable)
        .values({ workspaceId: s.t.workspaceId, name: "Support" })
        .returning(),
      "activity",
    );
    const entry = (date: string, minutes: number, billable = true) => ({
      workspaceId: s.t.workspaceId,
      projectId: project.id,
      personId: s.t.requesterPerson.id,
      date,
      minutes,
      activityId: activity.id,
      billable,
      description: "secret time entry detail",
    });
    await db
      .insert(timeEntryTable)
      .values([
        entry(isoDaysFromToday(-10), 120),
        entry(isoDaysFromToday(-5), 90),
        entry(isoDaysFromToday(-4), 500, false),
        entry(isoDaysFromToday(-90), 300),
      ]);

    const response = await detail(s.customer, contosoKey);
    const text = await response.text();
    const body = JSON.parse(text) as ProjectDetail;
    expect(body.contract).toEqual({
      startDate: isoDaysFromToday(-30),
      endDate: isoDaysFromToday(29),
      period: {
        state: "active",
        totalDays: 60,
        elapsedDays: 31,
        daysRemaining: 29,
        elapsedPct: 52,
      },
      hours: {
        contractedMinutes: 600,
        usedMinutes: 210,
        remainingMinutes: 390,
        usedPct: 35,
      },
    });
    expect(text).not.toContain("secret time entry detail");
    expect(text).not.toContain(s.t.requesterPerson.id);
    expect(text).not.toContain("recentEntries");
    expect(text).not.toContain("coverage");
    expect(text).not.toContain("kickoff");

    // Overdrawn: remaining goes negative; an ended period is clamped.
    await db
      .update(schema.projectContractTable)
      .set({
        contractedMinutes: 60,
        startDate: isoDaysFromToday(-40),
        endDate: isoDaysFromToday(-1),
      })
      .where(eq(schema.projectContractTable.projectId, project.id));
    const ended = (await (
      await detail(s.customer, contosoKey)
    ).json()) as ProjectDetail;
    expect(ended.contract?.period).toEqual({
      state: "ended",
      totalDays: 40,
      elapsedDays: 40,
      daysRemaining: 0,
      elapsedPct: 100,
    });
    expect(ended.contract?.hours).toEqual({
      contractedMinutes: 60,
      usedMinutes: 210,
      remainingMinutes: -150,
      usedPct: 350,
    });
  });
});

describe("action required: pending customer approvals addressed to the caller", () => {
  it("counts a pending addressed approval, not a decided one or one on a hidden project", async () => {
    const t = await buildTenant("s4c-approval");
    const approver = await addCustomer(t);
    const colleague = await addCustomer(t);
    const created = await request(t, t.requester, {
      kind: "customer",
      approverId: approver.person.id,
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const { id } = (await created.json()) as { id: string };
    // The organisation's only project going portal-off also turns the portal off for the
    // organisation (the feature-data gate answers first), so "absent" covers both answers.
    const counts = async (as: typeof approver) => {
      const response = await portalRequest(t, as, "/api/portal/projects");
      if (response.status !== 200) return undefined;
      return ((await response.json()) as { data: ProjectSummary[] }).data.find(
        (row) => row.key === t.project.slug,
      )?.counts;
    };

    expect(await counts(approver)).toEqual({
      actionRequired: 1,
      outstanding: 0,
    });
    // The same approval count as the dashboard for that project.
    expect(await homeCounts(t, approver, t.project.slug)).toEqual({
      actionRequired: 1,
      outstanding: 0,
    });
    // Addressed to someone else: not this colleague's action.
    expect(await counts(colleague)).toEqual({
      actionRequired: 0,
      outstanding: 0,
    });

    // The customer portal off for the project hides the project and its approval.
    await db.insert(schema.projectFeatureFlagTable).values({
      projectId: t.project.id,
      featureKey: "feature.customer_portal",
      enabled: false,
    });
    invalidateFeatureFlagCache();
    expect(await counts(approver)).toBeUndefined();
    await db
      .delete(schema.projectFeatureFlagTable)
      .where(eq(schema.projectFeatureFlagTable.projectId, t.project.id));
    invalidateFeatureFlagCache();
    expect((await counts(approver))?.actionRequired).toBe(1);

    // Decided: no longer an action.
    const decided = await portalRequest(
      t,
      approver,
      `/api/portal/approvals/${id}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(decided.status, await decided.clone().text()).toBe(200);
    expect((await counts(approver))?.actionRequired).toBe(0);
  });
});
