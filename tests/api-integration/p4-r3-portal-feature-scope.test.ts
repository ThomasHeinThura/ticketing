import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { portalRealtimeAdmitted } from "../../apps/api/src/notification/portal-inbox-repository";
import {
  addCustomer,
  buildTenant,
  portalRequest,
  request as requestApproval,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { seedIntake, submitAs, TITLE_FORM } from "./helpers/intake-http";

/**
 * P4R2-M2 (round 3): a customer organisation served by workspaces and projects with the portal
 * on and others with it off sees only the "on" rows in every portal list, its notification inbox
 * and its realtime channel; the portal app learns the organisation's state from the API.
 */

async function setWorkspaceFlag(
  workspaceId: string,
  featureKey: string,
  enabled: boolean,
) {
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey, enabled })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
  invalidateFeatureFlagCache();
}

async function setProjectFlag(
  projectId: string,
  featureKey: string,
  enabled: boolean | null,
) {
  await db
    .delete(schema.projectFeatureFlagTable)
    .where(
      and(
        eq(schema.projectFeatureFlagTable.projectId, projectId),
        eq(schema.projectFeatureFlagTable.featureKey, featureKey),
      ),
    );
  if (enabled !== null)
    await db
      .insert(schema.projectFeatureFlagTable)
      .values({ projectId, featureKey, enabled });
  invalidateFeatureFlagCache();
}

type Seed = Awaited<ReturnType<typeof seedIntake>>;

/** A second workspace that also serves the seed's customer organisation, with its own request type. */
async function secondWorkspace(seed: Seed) {
  const other = await buildTenant(`p4r3-other-${randomUUID()}`);
  await db
    .update(schema.projectTable)
    .set({ organisationId: seed.customer.orgId })
    .where(eq(schema.projectTable.id, other.project.id));
  // Mirrors `ensureCustomerOrg` for the seed's own workspace.
  await db
    .update(schema.workspaceTable)
    .set({ organisationId: seed.customer.orgId })
    .where(eq(schema.workspaceTable.id, other.workspaceId));
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: other.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: other.workspaceId,
        key: `req-${randomUUID()}`,
        name: "Other workspace help",
        group: "General",
        workItemTypeId: other.type.id,
        defaultProjectId: other.project.id,
        formSchema: TITLE_FORM,
        published: true,
        customerVisible: true,
      })
      .returning(),
    "request type",
  );
  await db.insert(schema.requestTypeVersionTable).values({
    workspaceId: other.workspaceId,
    requestTypeId: requestType.id,
    number: 1,
    formSchema: TITLE_FORM,
    workItemTypeId: other.type.id,
    defaultProjectId: other.project.id,
  });
  await db.insert(schema.organisationRequestTypeTable).values({
    organisationId: seed.customer.orgId,
    requestTypeId: requestType.id,
  });
  invalidateFeatureFlagCache();
  return { other, requestType };
}

async function submissionId(ref: string) {
  const [row] = await db
    .select({ id: schema.submissionTable.id })
    .from(schema.submissionTable)
    .where(eq(schema.submissionTable.number, Number(ref.slice(4))));
  if (!row) throw new Error("submission missing");
  return row.id;
}

async function notify(seed: Seed, ref: string) {
  await db.insert(schema.notificationTable).values({
    userId: seed.customer.user.id,
    personId: seed.customer.person.id,
    type: "task_comment",
    kind: "submission.replied",
    title: "Reply",
    content: "Reply",
    resourceType: "submission",
    resourceId: await submissionId(ref),
    isRead: false,
  });
}

async function json<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as T;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("portal lists, inbox and realtime per workspace (P4R2-M2 round 3)", () => {
  it("hides an off workspace's submissions, request types and notifications while the on workspace's stay", async () => {
    const seed = await seedIntake("p4r3-mixed");
    const { customer } = seed;
    const { other, requestType } = await secondWorkspace(seed);
    const refA = await submitAs(seed, customer, "From workspace A");
    const refB = await submitAs(
      { t: seed.t, requestType },
      customer,
      "From workspace B",
    );
    await notify(seed, refA);
    await notify(seed, refB);

    const submissions = async () =>
      json<{ submissions: { ref: string }[]; meta: { total: number } }>(
        await portalRequest(seed.t, customer, "/api/portal/submissions"),
      );
    const catalogue = async () =>
      JSON.stringify(
        await json(
          await portalRequest(seed.t, customer, "/api/portal/catalogue"),
        ),
      );
    const inbox = async () =>
      json<{ data: { requestRef: string | null }[]; unreadCount: number }>(
        await portalRequest(seed.t, customer, "/api/portal/notification/inbox"),
      );

    expect((await submissions()).submissions.map((s) => s.ref).sort()).toEqual(
      [refA, refB].sort(),
    );
    expect(await catalogue()).toContain("Other workspace help");
    expect((await inbox()).unreadCount).toBe(2);

    await setWorkspaceFlag(other.workspaceId, "feature.customer_portal", false);

    const listed = await submissions();
    expect(listed.submissions.map((s) => s.ref)).toEqual([refA]);
    expect(listed.meta.total).toBe(1);
    expect(await catalogue()).not.toContain("Other workspace help");
    expect(await catalogue()).toContain('"Help"');
    const page = await inbox();
    expect(page.data.map((row) => row.requestRef)).toEqual([refA]);
    expect(page.unreadCount).toBe(1);
    expect(
      (await portalRequest(seed.t, customer, `/api/portal/submissions/${refB}`))
        .status,
    ).toBe(404);
    // Submitting to the off workspace's request type is refused like an unknown type.
    const refused = await portalRequest(
      seed.t,
      customer,
      "/api/portal/submissions",
      {
        method: "POST",
        body: { key: requestType.key, formData: { summary: "Again" } },
      },
    );
    expect(refused.status).not.toBe(200);
    // The organisation still has an "on" workspace: realtime pushes continue (A's notification).
    expect(await portalRealtimeAdmitted(customer.user.id)).toBe(true);

    // Both off: the organisation's portal is off, the API says so, and no push is admitted.
    await setWorkspaceFlag(
      seed.t.workspaceId,
      "feature.customer_portal",
      false,
    );
    const state = await json<{ state: string }>(
      await portalRequest(seed.t, customer, "/api/portal/feature-state"),
    );
    expect(state.state).toBe("off");
    expect(await portalRealtimeAdmitted(customer.user.id)).toBe(false);
  });

  it("a project override decides for its own backlog items and approvals", async () => {
    const seed = await seedIntake("p4r3-project");
    const { customer, t } = seed;
    // A customer approval on the tenant's work item.
    const approval = await requestApproval(t, t.requester, {
      kind: "customer",
      approverId: customer.person.id,
    });
    expect(approval.status, await approval.clone().text()).toBe(200);
    const approvals = async () =>
      (
        await json<{ approvals: { id: string }[] }>(
          await portalRequest(t, customer, "/api/portal/approvals"),
        )
      ).approvals;
    const listed = await approvals();
    expect(listed).toHaveLength(1);
    const approvalId = listed[0]?.id as string;

    // A backlog row: an accepted submission linked to the tenant's work item in a backlog state.
    const [item] = await db
      .select({ id: schema.workItemTable.id })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, t.key));
    if (!item) throw new Error("work item missing");
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.id, item.id));
    await db.insert(schema.submissionTable).values({
      organisationId: customer.orgId,
      requesterId: customer.person.id,
      requestTypeId: seed.requestType.id,
      requestTypeVersionId: seed.version.id,
      formData: {},
      state: "accepted",
      submittedAt: new Date(),
      customerVisibility: "organisation",
      workItemId: item.id,
    });
    const backlog = async () =>
      (
        await json<{ items: { id: string }[] }>(
          await portalRequest(t, customer, "/api/portal/requests/backlog"),
        )
      ).items.map((row) => row.id);
    const before = await backlog();

    // A second project of the same workspace keeps the portal; this one switches it off.
    await setProjectFlag(t.project.id, "feature.customer_portal", false);
    expect(await approvals()).toEqual([]);
    expect(await backlog()).toEqual([]);
    const decide = await portalRequest(
      t,
      customer,
      `/api/portal/approvals/${approvalId}/decide`,
      { method: "POST", body: { action: "approve" } },
    );
    expect(decide.status).toBe(404);

    await setProjectFlag(t.project.id, "feature.customer_portal", null);
    expect(await approvals()).toHaveLength(1);
    expect(await backlog()).toEqual(before);
  });

  it("feature-state answers on for an organisation with the portal on, and only to a customer portal session", async () => {
    const seed = await seedIntake("p4r3-state");
    const on = await json<{ state: string }>(
      await portalRequest(seed.t, seed.customer, "/api/portal/feature-state"),
    );
    expect(on.state).toBe("on");
    mockAuthenticatedSession(seed.t.requester.user);
    const agent = await seed.t.app.request("/api/portal/feature-state");
    expect(agent.status).toBe(404);
    const other = await addCustomer(seed.t);
    await setWorkspaceFlag(
      seed.t.workspaceId,
      "feature.customer_portal",
      false,
    );
    const off = await json<{ state: string }>(
      await portalRequest(seed.t, other, "/api/portal/feature-state"),
    );
    expect(off.state).toBe("off");
  });
});
