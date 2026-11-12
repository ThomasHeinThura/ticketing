/**
 * S4b portal cases: `GET /api/portal/requests`, `/requests/export.csv`, `/home` and `/me`.
 * Tenant isolation (CP-1/CP-2), CP-16 colleague privacy, CP-3 internal comments, CP-4 no
 * assignee, D5 colleague names, D6 requests raised by staff, every filter, CSV escaping and the
 * dashboard arithmetic.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { slaPauseTable } from "../../apps/api/src/database/migration-schema";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import {
  addCustomer,
  request as approvalRequest,
  buildTenant,
  PORTAL_HOST,
  portalRequest,
  type Tenant,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture, requireRow } from "./helpers/fixtures";

type Customer = Awaited<ReturnType<typeof addCustomer>>;
type CaseRow = {
  ref: string;
  source: "submission" | "direct";
  title: string;
  requestTypeName: string;
  priority: string | null;
  customerStatus: string;
  createdAt: string;
  updatedAt: string;
  project: { key: string; name: string } | null;
  createdBy: { name: string | null; isYou: boolean };
  isRequester: boolean;
  customerVisibility: string;
  sla: unknown;
};
type CasePage = {
  cases: CaseRow[];
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { total: number };
};

const FORM_SCHEMA = {
  fields: [
    {
      key: "summary",
      type: "text",
      label: "Summary",
      required: true,
      mapsTo: { field: "title" },
    },
    {
      key: "severity",
      type: "select",
      label: "Severity",
      required: false,
      options: ["low", "medium", "high", "urgent"],
      mapsTo: { field: "priority" },
    },
  ],
};

async function setFlag(workspaceId: string, featureKey: string, on: boolean) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey, enabled: true, locked: false })
    .onConflictDoNothing();
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey, enabled: on })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled: on },
    });
  invalidateFeatureFlagCache();
}

async function requestTypeFor(
  tenant: Tenant,
  name: string,
  defaultProjectId: string | null = null,
) {
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: tenant.workspaceId,
        key: `case-${randomUUID()}`,
        name,
        group: "General",
        workItemTypeId: tenant.type.id,
        defaultProjectId,
        formSchema: FORM_SCHEMA,
        published: true,
        customerVisible: true,
      })
      .returning(),
    "request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: tenant.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: FORM_SCHEMA,
        workItemTypeId: tenant.type.id,
      })
      .returning(),
    "request type version",
  );
  return { requestType, version };
}

async function submission(
  type: Awaited<ReturnType<typeof requestTypeFor>>,
  input: {
    organisationId: string;
    requesterId: string;
    summary: string;
    severity?: string;
    state?: string;
    visibility?: "private" | "organisation";
    workItemId?: string;
    createdAt?: Date;
  },
) {
  const row = requireRow(
    await db
      .insert(schema.submissionTable)
      .values({
        organisationId: input.organisationId,
        requesterId: input.requesterId,
        requestTypeId: type.requestType.id,
        requestTypeVersionId: type.version.id,
        formData: {
          summary: input.summary,
          ...(input.severity ? { severity: input.severity } : {}),
        },
        state: input.state ?? "new",
        submittedAt: new Date(),
        customerVisibility: input.visibility ?? "private",
        workItemId: input.workItemId ?? null,
        ...(input.createdAt
          ? { createdAt: input.createdAt, updatedAt: input.createdAt }
          : {}),
      })
      .returning(),
    "submission",
  );
  return { ...row, ref: `SUB-${row.number}` };
}

async function workItem(
  tenant: Tenant,
  title: string,
  patch: Partial<typeof schema.workItemTable.$inferInsert> = {},
) {
  mockAuthenticatedSession(tenant.requester.user);
  const response = await tenant.app.request(
    `/api/projects/${tenant.project.id}/work-items`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ typeId: tenant.type.id, title }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const { id } = (await response.json()) as { id: string };
  if (Object.keys(patch).length)
    await db
      .update(schema.workItemTable)
      .set(patch)
      .where(eq(schema.workItemTable.id, id));
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, id))
      .limit(1),
    "work item",
  );
}

async function stateIn(tenant: Tenant, group: string) {
  const now = new Date();
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: tenant.workspaceId,
        key: `${group}-${randomUUID()}`,
        name: group,
        group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: tenant.project.id,
        stateTemplateId: template.id,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state",
  ).id;
}

/** A second customer of the same organisation as `first`. */
async function colleagueOf(tenant: Tenant, displayName: string) {
  const colleague = await addCustomer(tenant);
  await db
    .update(schema.personTable)
    .set({ displayName })
    .where(eq(schema.personTable.id, colleague.person.id));
  return colleague;
}

async function getJson<T>(tenant: Tenant, who: Customer, path: string) {
  const response = await portalRequest(tenant, who, path);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

async function list(tenant: Tenant, who: Customer, query = "") {
  return getJson<CasePage>(
    tenant,
    who,
    `/api/portal/requests${query ? `?${query}` : ""}`,
  );
}

function refs(page: CasePage) {
  return page.cases.map((row) => row.ref).sort();
}

function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, into);
  else if (value && typeof value === "object")
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      keysDeep(nested, into);
    }
  return into;
}

async function seed() {
  const contoso = await buildTenant("cases-contoso");
  const fabrikam = await buildTenant("cases-fabrikam");
  const alice = await addCustomer(contoso);
  await db
    .update(schema.personTable)
    .set({ displayName: "Alice Contoso" })
    .where(eq(schema.personTable.id, alice.person.id));
  const bob = await colleagueOf(contoso, "Bob Contoso");
  const frank = await addCustomer(fabrikam);
  await db
    .update(schema.projectTable)
    .set({ name: "Contoso Support", slug: "CONTOSO" })
    .where(eq(schema.projectTable.id, contoso.project.id));
  for (const tenant of [contoso, fabrikam]) {
    await setFlag(tenant.workspaceId, "feature.intake", true);
    await setFlag(tenant.workspaceId, "feature.sla", true);
  }

  // A project in Contoso's workspace that serves Fabrikam: its name must never reach Alice.
  const { project: fabrikamHosted } = await createProjectFixture({
    workspaceId: contoso.workspaceId,
    name: "Fabrikam Secret Rollout",
    slug: "FABSECRET",
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: frank.orgId })
    .where(eq(schema.projectTable.id, fabrikamHosted.id));

  const support = await requestTypeFor(contoso, "Support", contoso.project.id);
  const leaky = await requestTypeFor(contoso, "Access", fabrikamHosted.id);
  const fabType = await requestTypeFor(fabrikam, "Fabrikam help");

  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86_400_000);
  const cancelledState = await stateIn(contoso, "cancelled");

  // Alice's own submissions.
  const aliceNew = await submission(support, {
    organisationId: alice.orgId,
    requesterId: alice.person.id,
    summary: "Printer jammed",
    severity: "high",
    createdAt: days(3),
  });
  const aliceFormula = await submission(leaky, {
    organisationId: alice.orgId,
    requesterId: alice.person.id,
    summary: '=HYPERLINK("http://x","click"), with comma',
    severity: "low",
    createdAt: days(10),
  });
  const aliceDeclined = await submission(support, {
    organisationId: alice.orgId,
    requesterId: alice.person.id,
    summary: "Declined ask",
    state: "declined",
  });
  const waitingItem = await workItem(contoso, "Need your logs", {
    requesterId: alice.person.id,
    customerVisibility: "organisation",
    priority: "urgent",
    createdAt: days(5),
    slaStartedAt: days(5),
    firstResponseAt: new Date(days(5).getTime() + 3_600_000),
    assigneeId: contoso.requesterPerson.id,
  });
  await db.insert(slaPauseTable).values({
    workItemId: waitingItem.id,
    metric: "resolution",
    startedAt: days(1),
    reason: "waiting_customer",
  });
  const aliceWaiting = await submission(support, {
    organisationId: alice.orgId,
    requesterId: alice.person.id,
    summary: "Need your logs",
    state: "accepted",
    workItemId: waitingItem.id,
    createdAt: days(5),
  });
  // An internal comment on Alice's accepted request: never in any portal response (CP-3).
  await db.insert(schema.commentTable).values({
    workspaceId: contoso.workspaceId,
    workItemId: waitingItem.id,
    authorId: contoso.requesterPerson.id,
    actorType: "person",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "INTERNAL-ONLY-NOTE" }],
        },
      ],
    },
    visibility: "internal",
  });

  // Bob's submissions: organisation-visible, private, and organisation-visible over a private item.
  const bobClarifying = await submission(support, {
    organisationId: bob.orgId,
    requesterId: bob.person.id,
    summary: "Bob shared question",
    state: "clarifying",
    visibility: "organisation",
  });
  const bobPrivate = await submission(support, {
    organisationId: bob.orgId,
    requesterId: bob.person.id,
    summary: "Bob private payroll",
    visibility: "private",
  });
  const bobPrivateItem = await workItem(contoso, "Bob private item", {
    requesterId: bob.person.id,
    customerVisibility: "private",
  });
  const bobMixed = await submission(support, {
    organisationId: bob.orgId,
    requesterId: bob.person.id,
    summary: "Bob mixed",
    state: "accepted",
    visibility: "organisation",
    workItemId: bobPrivateItem.id,
  });
  const bobWithAlice = await submission(support, {
    organisationId: bob.orgId,
    requesterId: bob.person.id,
    summary: "Bob added Alice",
    visibility: "private",
  });
  await db.insert(schema.requestParticipantTable).values({
    submissionId: bobWithAlice.id,
    personId: alice.person.id,
    addedBy: bob.person.id,
  });

  // D6: requests raised by staff for a customer (no submission).
  const directAlice = await workItem(contoso, "Staff raised for Alice", {
    requesterId: alice.person.id,
    customerVisibility: "private",
    priority: "medium",
    createdAt: days(2),
    slaStartedAt: days(2),
    firstResponseAt: new Date(days(2).getTime() + 7_200_000),
    resolvedAt: days(1),
    assigneeId: contoso.requesterPerson.id,
  });
  const directBobShared = await workItem(contoso, "Staff raised for Bob", {
    requesterId: bob.person.id,
    customerVisibility: "organisation",
    stateId: cancelledState,
  });
  const directBobPrivate = await workItem(contoso, "Staff raised Bob private", {
    requesterId: bob.person.id,
    customerVisibility: "private",
  });
  // An internal item requested by staff never appears.
  const staffOnly = await workItem(contoso, "Staff internal", {
    customerVisibility: "organisation",
  });

  // Fabrikam.
  const fabrikamSubmission = await submission(fabType, {
    organisationId: frank.orgId,
    requesterId: frank.person.id,
    summary: "Fabrikam only",
    visibility: "organisation",
  });
  const fabrikamDirect = await workItem(fabrikam, "Fabrikam direct", {
    requesterId: frank.person.id,
    customerVisibility: "organisation",
  });

  return {
    contoso,
    fabrikam,
    alice,
    bob,
    frank,
    aliceNew,
    aliceFormula,
    aliceDeclined,
    aliceWaiting,
    waitingItem,
    bobClarifying,
    bobPrivate,
    bobMixed,
    bobPrivateItem,
    bobWithAlice,
    directAlice,
    directBobShared,
    directBobPrivate,
    staffOnly,
    fabrikamSubmission,
    fabrikamDirect,
    support,
    fabType,
  };
}

describe("portal cases (S4b)", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists exactly the readable cases of the caller's organisation", async () => {
    const s = await seed();
    const all = await list(s.contoso, s.alice, "scope=all&limit=100");
    expect(refs(all)).toEqual(
      [
        s.aliceNew.ref,
        s.aliceFormula.ref,
        s.aliceDeclined.ref,
        s.aliceWaiting.ref,
        s.bobClarifying.ref,
        s.bobWithAlice.ref,
        s.directAlice.key,
        s.directBobShared.key,
      ].sort(),
    );
    expect(all.meta.total).toBe(8);
    // CP-16: Bob's private submission, Bob's private work item behind an organisation-visible
    // submission, and his private staff-raised request are absent; staff-only items too.
    for (const hidden of [
      s.bobPrivate.ref,
      s.bobMixed.ref,
      s.directBobPrivate.key,
      s.staffOnly.key,
      s.contoso.key,
    ])
      expect(refs(all)).not.toContain(hidden);
    // CP-1: nothing of Fabrikam's.
    expect(refs(all)).not.toContain(s.fabrikamSubmission.ref);
    expect(refs(all)).not.toContain(s.fabrikamDirect.key);

    const mine = await list(s.contoso, s.alice, "scope=mine&limit=100");
    expect(refs(mine)).toEqual(
      [
        s.aliceNew.ref,
        s.aliceFormula.ref,
        s.aliceDeclined.ref,
        s.aliceWaiting.ref,
        s.directAlice.key,
      ].sort(),
    );

    const fabrikam = await list(s.fabrikam, s.frank, "limit=100");
    expect(refs(fabrikam)).toEqual(
      [s.fabrikamSubmission.ref, s.fabrikamDirect.key].sort(),
    );
    // CP-2: another organisation's request is the constant 404.
    const foreign = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${s.fabrikamSubmission.ref}`,
    );
    expect(foreign.status).toBe(404);
  });

  it("projects rows with customer status, D5 names, D6 source and no internal data", async () => {
    const s = await seed();
    const response = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/requests?limit=100",
    );
    const text = await response.clone().text();
    const page = (await response.json()) as CasePage;
    const byRef = new Map(page.cases.map((row) => [row.ref, row]));

    const own = byRef.get(s.aliceNew.ref);
    expect(own).toMatchObject({
      source: "submission",
      title: "Printer jammed",
      requestTypeName: "Support",
      priority: "high",
      customerStatus: "received",
      project: { key: "CONTOSO", name: "Contoso Support" },
      createdBy: { name: null, isYou: true },
      isRequester: true,
    });
    // The default project serves another organisation: no project is shown.
    expect(byRef.get(s.aliceFormula.ref)?.project).toBeNull();
    expect(text).not.toContain("Fabrikam Secret Rollout");
    expect(text).not.toContain("FABSECRET");
    // An open waiting_customer pause is "need more information".
    expect(byRef.get(s.aliceWaiting.ref)).toMatchObject({
      customerStatus: "need_more_info",
      title: "Need your logs",
      priority: "urgent",
    });
    expect(byRef.get(s.aliceDeclined.ref)?.customerStatus).toBe("declined");
    // D5: a same-organisation colleague is named.
    expect(byRef.get(s.bobClarifying.ref)).toMatchObject({
      customerStatus: "need_more_info",
      createdBy: { name: "Bob Contoso", isYou: false },
      isRequester: false,
    });
    // D6: requests raised by staff carry the request key and their own status.
    expect(byRef.get(s.directAlice.key)).toMatchObject({
      source: "direct",
      title: "Staff raised for Alice",
      customerStatus: "resolved",
      createdBy: { isYou: true },
      project: { key: "CONTOSO", name: "Contoso Support" },
    });
    expect(byRef.get(s.directBobShared.key)?.customerStatus).toBe("closed");

    // CP-3 / CP-4: no comment text and no assignee or claimer in any shape.
    expect(text).not.toContain("INTERNAL-ONLY-NOTE");
    const keys = keysDeep(page);
    for (const forbidden of [
      "assignee",
      "assigneeId",
      "assigneeName",
      "claimedBy",
      "claimedAt",
      "comments",
    ])
      expect(keys.has(forbidden)).toBe(false);
    expect(Object.keys(page.cases[0] ?? {}).sort()).toEqual(
      [
        "createdAt",
        "createdBy",
        "customerStatus",
        "customerVisibility",
        "isRequester",
        "priority",
        "project",
        "ref",
        "requestTypeName",
        "sla",
        "source",
        "title",
        "updatedAt",
      ].sort(),
    );
  });

  it("applies every filter, sort and keyset page", async () => {
    const s = await seed();
    const status = await list(
      s.contoso,
      s.alice,
      "status=need_more_info&limit=100",
    );
    expect(refs(status)).toEqual(
      [s.aliceWaiting.ref, s.bobClarifying.ref].sort(),
    );
    const priority = await list(
      s.contoso,
      s.alice,
      "priority=high,urgent&limit=100",
    );
    expect(refs(priority)).toEqual([s.aliceNew.ref, s.aliceWaiting.ref].sort());
    const project = await list(s.contoso, s.alice, "project=CONTOSO&limit=100");
    expect(refs(project)).not.toContain(s.aliceFormula.ref);
    expect(project.meta.total).toBe(7);
    const foreignProject = await list(
      s.contoso,
      s.alice,
      "project=FABSECRET&limit=100",
    );
    expect(foreignProject.meta.total).toBe(0);
    const byTitle = await list(s.contoso, s.alice, "q=printer");
    expect(refs(byTitle)).toEqual([s.aliceNew.ref]);
    const byRef = await list(s.contoso, s.alice, `q=${s.directAlice.key}`);
    expect(refs(byRef)).toEqual([s.directAlice.key]);
    const byType = await list(s.contoso, s.alice, "q=access");
    expect(refs(byType)).toEqual([s.aliceFormula.ref]);
    const wildcard = await list(s.contoso, s.alice, "q=%25");
    expect(wildcard.meta.total).toBe(0);

    const day = (offset: number) =>
      new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const window = await list(
      s.contoso,
      s.alice,
      `from=${day(6)}&to=${day(4)}&limit=100`,
    );
    expect(refs(window)).toEqual([s.aliceWaiting.ref]);

    const createdAsc = await list(
      s.contoso,
      s.alice,
      "sort=created_asc&limit=100",
    );
    const created = createdAsc.cases.map((row) => row.createdAt);
    expect(created).toEqual([...created].sort());
    const updatedDesc = await list(s.contoso, s.alice, "limit=100");
    const updated = updatedDesc.cases.map((row) => row.updatedAt);
    expect(updated).toEqual([...updated].sort().reverse());

    // Keyset paging: three pages of three, no duplicates, nothing missing.
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: CasePage = await list(
        s.contoso,
        s.alice,
        `limit=3${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...page.cases.map((row) => row.ref));
      cursor = page.page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen.length).toBe(new Set(seen).size);
    expect(seen.sort()).toEqual(refs(updatedDesc));

    const first = await list(s.contoso, s.alice, "limit=3");
    const reused = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests?limit=3&status=received&cursor=${first.page.nextCursor}`,
    );
    expect(reused.status).toBe(400);
    for (const bad of [
      "status=open",
      "priority=critical",
      "scope=everyone",
      "sort=title",
      "from=2026-13-01",
      "project=../x",
      "cursor=not-a-cursor",
    ]) {
      const response = await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/requests?${bad}`,
      );
      expect(response.status, bad).toBe(400);
    }
  });

  it("exports the filtered cases as escaped CSV", async () => {
    const s = await seed();
    const response = await portalRequest(
      s.contoso,
      s.alice,
      "/api/portal/requests/export.csv?scope=mine",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("x-export-truncated")).toBe("false");
    expect(response.headers.get("x-export-total")).toBe("5");
    const csv = await response.text();
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Reference,Title,Request type,Severity,Status,Project,Created by,Created,Updated",
    );
    expect(lines).toHaveLength(6);
    // CSV injection: the formula is neutralised, and quotes and commas are escaped.
    expect(csv).toContain(
      `${s.aliceFormula.ref},"'=HYPERLINK(""http://x"",""click""), with comma",Access,low,Received,,You,`,
    );
    expect(csv).toContain("Need more information");
    expect(csv).not.toContain("Bob");
    expect(csv).not.toContain("INTERNAL-ONLY-NOTE");
    expect(csv.toLowerCase()).not.toContain("assignee");

    const foreign = await portalRequest(
      s.fabrikam,
      s.frank,
      "/api/portal/requests/export.csv",
    );
    const foreignCsv = await foreign.text();
    expect(foreignCsv).toContain(s.fabrikamSubmission.ref);
    expect(foreignCsv).not.toContain(s.aliceNew.ref);
    expect(foreignCsv).not.toContain("Contoso");
  });

  it("computes the dashboard figures from the same readable set", async () => {
    const s = await seed();
    const approval = await approvalRequest(s.contoso, s.contoso.requester, {
      kind: "customer",
      approverId: s.alice.person.id,
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    // Clarifying requests Alice cannot read never count: Bob's private one (CP-16) and
    // Fabrikam's (CP-1).
    await submission(s.support, {
      organisationId: s.bob.orgId,
      requesterId: s.bob.person.id,
      summary: "Bob private clarifying",
      state: "clarifying",
      visibility: "private",
    });
    await submission(s.fabType, {
      organisationId: s.frank.orgId,
      requesterId: s.frank.person.id,
      summary: "Fabrikam clarifying",
      state: "clarifying",
      visibility: "organisation",
    });
    // An item first answered within 30 days, in a project with feature.sla on: 1h and 2h.
    const home = await getJson<{
      actionRequired: { total: number; cases: number; approvals: number };
      outstanding: number;
      closedLast30Days: number;
      averageFirstResponse: { seconds: number; sampleSize: number } | null;
    }>(s.contoso, s.alice, "/api/portal/home");
    const outstanding = await list(
      s.contoso,
      s.alice,
      "status=received,need_more_info,in_progress&limit=1",
    );
    expect(home.outstanding).toBe(outstanding.meta.total);
    expect(home.outstanding).toBe(5);
    // Alice reads two need-more-info cases: her waiting pause and Bob's organisation-visible
    // clarifying submission. Private colleague cases and other organisations' are left out.
    const needMoreInfo = await list(
      s.contoso,
      s.alice,
      "scope=all&status=need_more_info&limit=100",
    );
    expect(refs(needMoreInfo)).toEqual(
      [s.aliceWaiting.ref, s.bobClarifying.ref].sort(),
    );
    // Action required counts exactly the list the card opens: both readable cases.
    expect(home.actionRequired.cases).toBe(needMoreInfo.meta.total);
    expect(home.actionRequired.cases).toBe(2);
    const approvals = await getJson<{ approvals: unknown[] }>(
      s.contoso,
      s.alice,
      "/api/portal/approvals",
    );
    expect(home.actionRequired.approvals).toBe(approvals.approvals.length);
    expect(home.actionRequired.approvals).toBe(1);
    expect(home.actionRequired.total).toBe(3);
    // Declined (Alice), resolved staff-raised (Alice) and cancelled staff-raised (Bob).
    expect(home.closedLast30Days).toBe(3);
    expect(home.averageFirstResponse).toEqual({ seconds: 5400, sampleSize: 2 });
    expect(keysDeep(home).has("assignee")).toBe(false);

    const scoped = await getJson<typeof home>(
      s.contoso,
      s.alice,
      "/api/portal/home?project=FABSECRET",
    );
    expect(scoped).toMatchObject({
      outstanding: 0,
      closedLast30Days: 0,
      averageFirstResponse: null,
      actionRequired: { total: 0, cases: 0, approvals: 0 },
    });
    // Fabrikam counts only its own clarifying request, which is its whole linked list.
    const fabrikamHome = await getJson<typeof home>(
      s.fabrikam,
      s.frank,
      "/api/portal/home",
    );
    const fabrikamList = await list(
      s.fabrikam,
      s.frank,
      "scope=all&status=need_more_info&limit=100",
    );
    expect(fabrikamHome.actionRequired.cases).toBe(fabrikamList.meta.total);
    expect(fabrikamHome.actionRequired).toEqual({
      total: 1,
      cases: 1,
      approvals: 0,
    });

    // D4 respects feature.sla per project.
    await setFlag(s.contoso.workspaceId, "feature.sla", false);
    const slaOff = await getJson<typeof home>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    expect(slaOff.averageFirstResponse).toBeNull();

    // A response older than 30 days is outside the window.
    await setFlag(s.contoso.workspaceId, "feature.sla", true);
    await db
      .update(schema.workItemTable)
      .set({
        createdAt: new Date(Date.now() - 40 * 86_400_000),
        slaStartedAt: new Date(Date.now() - 40 * 86_400_000),
        firstResponseAt: new Date(Date.now() - 39 * 86_400_000),
      })
      .where(eq(schema.workItemTable.id, s.waitingItem.id));
    const older = await getJson<typeof home>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    expect(older.averageFirstResponse).toEqual({
      seconds: 7200,
      sampleSize: 1,
    });

    // Closing the pause returns the item to "in progress".
    await db
      .update(slaPauseTable)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(slaPauseTable.workItemId, s.waitingItem.id),
          eq(slaPauseTable.reason, "waiting_customer"),
        ),
      );
    const resumed = await list(s.contoso, s.alice, `q=${s.aliceWaiting.ref}`);
    expect(resumed.cases[0]?.customerStatus).toBe("in_progress");
    const detail = await getJson<{ customerStatus: string }>(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${s.aliceWaiting.ref}`,
    );
    expect(detail.customerStatus).toBe("in_progress");
  });

  it("counts as action required exactly the need-more-information list the card opens", async () => {
    const s = await seed();
    // A staff-raised item for Alice waiting on her (D6): listed, so it is counted too.
    const directWaiting = await workItem(s.contoso, "Staff raised waiting", {
      requesterId: s.alice.person.id,
      customerVisibility: "private",
    });
    await db.insert(slaPauseTable).values({
      workItemId: directWaiting.id,
      metric: "resolution",
      startedAt: new Date(),
      reason: "waiting_customer",
    });
    const linked = "scope=all&status=need_more_info&limit=100";
    type Home = {
      actionRequired: { total: number; cases: number; approvals: number };
    };
    const alice = await list(s.contoso, s.alice, linked);
    expect(refs(alice)).toEqual(
      [s.aliceWaiting.ref, s.bobClarifying.ref, directWaiting.key].sort(),
    );
    const aliceHome = await getJson<Home>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    expect(aliceHome.actionRequired.cases).toBe(alice.meta.total);
    expect(aliceHome.actionRequired).toEqual({
      total: 3,
      cases: 3,
      approvals: 0,
    });
    // The project filter narrows the count and the linked list alike.
    const aliceProject = await list(
      s.contoso,
      s.alice,
      `${linked}&project=CONTOSO`,
    );
    const aliceProjectHome = await getJson<Home>(
      s.contoso,
      s.alice,
      "/api/portal/home?project=CONTOSO",
    );
    expect(aliceProjectHome.actionRequired.cases).toBe(aliceProject.meta.total);
    const aliceOther = await list(
      s.contoso,
      s.alice,
      `${linked}&project=FABSECRET`,
    );
    const aliceOtherHome = await getJson<Home>(
      s.contoso,
      s.alice,
      "/api/portal/home?project=FABSECRET",
    );
    expect(aliceOtherHome.actionRequired.cases).toBe(aliceOther.meta.total);
    expect(aliceOtherHome.actionRequired.cases).toBe(0);

    // Counted is not the same as answerable: only the requester may reply (own_submission).
    const refused = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${s.bobClarifying.ref}/messages`,
      { method: "POST", body: { body: "Answering for Bob" } },
    );
    expect(refused.status).toBe(404);

    // Bob reads his own clarifying request but not Alice's private ones.
    const bob = await list(s.contoso, s.bob, linked);
    const bobHome = await getJson<Home>(s.contoso, s.bob, "/api/portal/home");
    expect(bobHome.actionRequired.cases).toBe(bob.meta.total);
    expect(refs(bob)).not.toContain(directWaiting.key);
    expect(refs(bob)).toContain(s.bobClarifying.ref);

    // Another organisation never sees these cases in its count or its list.
    const frank = await list(s.fabrikam, s.frank, linked);
    const frankHome = await getJson<Home>(
      s.fabrikam,
      s.frank,
      "/api/portal/home",
    );
    expect(frankHome.actionRequired.cases).toBe(frank.meta.total);
    expect(refs(frank)).not.toContain(s.aliceWaiting.ref);
    expect(refs(frank)).not.toContain(directWaiting.key);
  });

  it("the detail page agrees with the list on a waiting pause", async () => {
    const s = await seed();
    const detail = await getJson<{ customerStatus: string }>(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${s.aliceWaiting.ref}`,
    );
    expect(detail.customerStatus).toBe("need_more_info");
    const legacy = await getJson<{
      submissions: { ref: string; customerStatus: string }[];
    }>(s.contoso, s.alice, "/api/portal/submissions");
    expect(
      legacy.submissions.find((row) => row.ref === s.aliceWaiting.ref)
        ?.customerStatus,
    ).toBe("need_more_info");
  });

  it("shows a converted item's fields only while it belongs to the requester, like the detail page", async () => {
    const s = await seed();
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.bob.person.id, title: "Reassigned internal title" })
      .where(eq(schema.workItemTable.id, s.waitingItem.id));
    const response = await portalRequest(
      s.contoso,
      s.alice,
      `/api/portal/requests?q=${s.aliceWaiting.ref}`,
    );
    const text = await response.clone().text();
    const page = (await response.json()) as CasePage;
    expect(page.cases).toHaveLength(1);
    expect(page.cases[0]).toMatchObject({
      ref: s.aliceWaiting.ref,
      title: "Need your logs",
      priority: null,
      customerStatus: "in_progress",
    });
    expect(text).not.toContain("Reassigned internal title");
    const detail = await getJson<{ customerStatus: string }>(
      s.contoso,
      s.alice,
      `/api/portal/submissions/${s.aliceWaiting.ref}`,
    );
    expect(detail.customerStatus).toBe(page.cases[0]?.customerStatus);
  });

  it("shows a mapped title and priority only while their form fields are visible (RT-5), in the list and the CSV", async () => {
    const tenant = await buildTenant("cases-hidden-mapped");
    const alice = await addCustomer(tenant);
    await setFlag(tenant.workspaceId, "feature.intake", true);
    // `headline` and `impact` map to the title and priority but show only when `gate` is ticked.
    const formSchema = {
      fields: [
        { key: "gate", type: "checkbox", label: "Hardware involved?" },
        {
          key: "headline",
          type: "text",
          label: "Headline",
          mapsTo: { field: "title" },
          showIf: { field_key: "gate", op: "eq", value: true },
        },
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["low", "medium", "high", "urgent"],
          mapsTo: { field: "priority" },
          showIf: { field_key: "gate", op: "eq", value: true },
        },
      ],
    };
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: tenant.workspaceId,
          key: `case-${randomUUID()}`,
          name: "Hardware",
          group: "General",
          workItemTypeId: tenant.type.id,
          formSchema,
          published: true,
          customerVisible: true,
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: tenant.workspaceId,
          requestTypeId: requestType.id,
          number: 1,
          formSchema,
          workItemTypeId: tenant.type.id,
        })
        .returning(),
      "request type version",
    );
    const submit = async (formData: Record<string, unknown>) =>
      requireRow(
        await db
          .insert(schema.submissionTable)
          .values({
            organisationId: alice.orgId,
            requesterId: alice.person.id,
            requestTypeId: requestType.id,
            requestTypeVersionId: version.id,
            formData,
            submittedAt: new Date(),
          })
          .returning(),
        "submission",
      );
    // An older submission: the form hides both fields, but the stored answers kept them.
    const stale = await submit({
      gate: false,
      headline: "Stale hidden headline",
      impact: "urgent",
    });
    const shown = await submit({
      gate: true,
      headline: "Visible headline",
      impact: "high",
    });
    const rowOf = (page: CasePage, ref: string) =>
      page.cases.find((row) => row.ref === ref);

    const page = await list(tenant, alice);
    expect(rowOf(page, `SUB-${stale.number}`)).toMatchObject({
      title: "",
      priority: null,
    });
    expect(rowOf(page, `SUB-${shown.number}`)).toMatchObject({
      title: "Visible headline",
      priority: "high",
    });
    expect(JSON.stringify(page)).not.toContain("Stale hidden headline");

    const csv = await (
      await portalRequest(
        tenant,
        alice,
        "/api/portal/requests/export.csv?scope=mine",
      )
    ).text();
    expect(csv).not.toContain("Stale hidden headline");
    expect(csv).toContain("Visible headline");
    const staleLine = csv
      .split("\r\n")
      .find((line) => line.startsWith(`SUB-${stale.number},`));
    // Reference, blank title, request type, blank priority.
    expect(staleLine?.startsWith(`SUB-${stale.number},,Hardware,,`)).toBe(true);

    // The hidden stored answers are no search or filter oracle either: matching them finds
    // nothing, and the totals and the CSV agree with the rows.
    const stalePage = await list(tenant, alice, "q=Stale");
    expect(stalePage.cases).toEqual([]);
    expect(stalePage.meta.total).toBe(0);
    const urgentPage = await list(tenant, alice, "priority=urgent");
    expect(urgentPage.cases).toEqual([]);
    expect(urgentPage.meta.total).toBe(0);
    const visibleSearch = await list(tenant, alice, "q=Visible");
    expect(refs(visibleSearch)).toEqual([`SUB-${shown.number}`]);
    expect(visibleSearch.meta.total).toBe(1);
    const highPage = await list(tenant, alice, "priority=high");
    expect(refs(highPage)).toEqual([`SUB-${shown.number}`]);
    expect(highPage.meta.total).toBe(1);
    for (const query of ["q=Stale", "priority=urgent"]) {
      const filtered = await portalRequest(
        tenant,
        alice,
        `/api/portal/requests/export.csv?scope=mine&${query}`,
      );
      expect(filtered.headers.get("x-export-total"), query).toBe("0");
      expect((await filtered.text()).trimEnd().split("\r\n")).toHaveLength(1);
    }

    // Ticking the box (the stored answers now show both fields) shows them again.
    await db
      .update(schema.submissionTable)
      .set({
        formData: {
          gate: true,
          headline: "Stale hidden headline",
          impact: "urgent",
        },
      })
      .where(eq(schema.submissionTable.id, stale.id));
    expect(
      rowOf(await list(tenant, alice), `SUB-${stale.number}`),
    ).toMatchObject({ title: "Stale hidden headline", priority: "urgent" });
    // Visible again: the same search and filter now find it, and the total follows.
    expect(refs(await list(tenant, alice, "q=Stale"))).toEqual([
      `SUB-${stale.number}`,
    ]);
    const urgentAgain = await list(tenant, alice, "priority=urgent");
    expect(refs(urgentAgain)).toEqual([`SUB-${stale.number}`]);
    expect(urgentAgain.meta.total).toBe(1);
  });

  it("keeps a staff-raised case when a colleague's private duplicate is merged into it", async () => {
    const s = await seed();
    const homeBefore = await getJson<Record<string, unknown>>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    // Triage links Bob's private request to Alice's staff-raised case as a duplicate.
    const duplicate = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: s.bob.orgId,
          requesterId: s.bob.person.id,
          requestTypeId: s.bobPrivate.requestTypeId,
          requestTypeVersionId: s.bobPrivate.requestTypeVersionId,
          formData: { summary: "Bob hidden duplicate" },
          state: "duplicate",
          submittedAt: new Date(),
          customerVisibility: "private",
          workItemId: s.directAlice.id,
        })
        .returning(),
      "duplicate submission",
    );
    const duplicateRef = `SUB-${duplicate.number}`;

    for (const scope of ["mine", "all"]) {
      const response = await portalRequest(
        s.contoso,
        s.alice,
        `/api/portal/requests?scope=${scope}&limit=100`,
      );
      const text = await response.clone().text();
      const page = (await response.json()) as CasePage;
      expect(refs(page), scope).toContain(s.directAlice.key);
      expect(text, scope).not.toContain(duplicateRef);
      expect(text, scope).not.toContain("Bob hidden duplicate");
    }
    const all = await list(s.contoso, s.alice, "scope=all&limit=100");
    expect(all.meta.total).toBe(8);
    expect(
      all.cases.find((row) => row.ref === s.directAlice.key),
    ).toMatchObject({ source: "direct", customerStatus: "resolved" });
    // The dashboard reads the same source: no figure moves.
    const homeAfter = await getJson<Record<string, unknown>>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    expect(homeAfter).toEqual(homeBefore);
    const csv = await (
      await portalRequest(
        s.contoso,
        s.alice,
        "/api/portal/requests/export.csv?scope=all",
      )
    ).text();
    expect(csv).toContain(s.directAlice.key);
    expect(csv).not.toContain(duplicateRef);

    // Bob sees his duplicate, never Alice's private case it was merged into.
    const bobAll = await list(s.contoso, s.bob, "scope=all&limit=100");
    expect(refs(bobAll)).toContain(duplicateRef);
    expect(refs(bobAll)).not.toContain(s.directAlice.key);
  });

  it("shows a reassigned item to its new requester", async () => {
    const s = await seed();
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.alice.person.id })
      .where(eq(schema.workItemTable.id, s.bobPrivateItem.id));
    const mine = await list(s.contoso, s.alice, "scope=mine&limit=100");
    expect(
      mine.cases.find((row) => row.ref === s.bobPrivateItem.key),
    ).toMatchObject({
      source: "direct",
      title: "Bob private item",
      createdBy: { isYou: true },
      isRequester: true,
    });
    // Bob's organisation-visible submission stays his row, not Alice's own.
    expect(refs(mine)).not.toContain(s.bobMixed.ref);
    const all = await list(s.contoso, s.alice, "scope=all&limit=100");
    expect(refs(all)).toContain(s.bobPrivateItem.key);
    expect(refs(all)).toContain(s.bobMixed.ref);
    const home = await getJson<{ outstanding: number }>(
      s.contoso,
      s.alice,
      "/api/portal/home",
    );
    const outstanding = await list(
      s.contoso,
      s.alice,
      "status=received,need_more_info,in_progress&limit=1",
    );
    expect(home.outstanding).toBe(outstanding.meta.total);
    expect(home.outstanding).toBe(7);
  });

  it("returns the caller's own profile and refuses staff and the agent host", async () => {
    const s = await seed();
    const me = await getJson<Record<string, unknown>>(
      s.contoso,
      s.alice,
      "/api/portal/me",
    );
    expect(me).toEqual({
      name: "Alice Contoso",
      email: s.alice.user.email,
      image: null,
      jobTitle: null,
      organisation: { name: "Customer org" },
    });
    const staff = await portalRequest(
      s.contoso,
      s.contoso.requester,
      "/api/portal/me",
    );
    expect(staff.status).toBeGreaterThanOrEqual(400);
    mockAuthenticatedSession(s.alice.user, { portal: "customer" });
    const agentHost = await s.contoso.app.request("/api/portal/requests");
    expect(agentHost.status).toBeGreaterThanOrEqual(400);
    expect(PORTAL_HOST).toContain("portal");
  });

  it("answers 404 for cases, export and home when the customer portal is off", async () => {
    const s = await seed();
    await setFlag(s.contoso.workspaceId, "feature.customer_portal", false);
    for (const path of [
      "/api/portal/requests",
      "/api/portal/requests/export.csv",
      "/api/portal/home",
    ]) {
      const response = await portalRequest(s.contoso, s.alice, path);
      expect(response.status, path).toBe(404);
    }
  });
});
