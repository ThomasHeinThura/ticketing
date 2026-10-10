import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "./auth";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./fixtures";

/** Shared fixtures for the approvals integration tests (S3). */
export type Member = Awaited<ReturnType<typeof createWorkspaceMember>>;

export const json = { "content-type": "application/json" };

export async function personOf(userId: string) {
  return requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "approval tenant person",
  );
}

/** One self-contained tenant: workspace, gated workflow, change-type work item, CAB approver. */
export async function buildTenant(
  label: string,
  options: { executable?: boolean } = {},
) {
  const requester = await createWorkspaceMember({ role: "owner" });
  const requesterPerson = await personOf(requester.user.id);
  const { project } = await createProjectFixture({
    workspaceId: requester.workspace.id,
  });
  await grantProjectRole(requester.user.id, project.id, [
    "project:read",
    "work_item:read",
    "work_item:create",
    "work_item:transition",
    "approval:request",
    "approval:request_cab",
  ]);
  const now = new Date();
  const wsId = requester.workspace.id;
  const tpl = async (group: string, name: string) =>
    requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: wsId,
          key: `${name}-${randomUUID()}`,
          name,
          group,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "tenant state template",
    );
  const backlog = await tpl("backlog", "Backlog");
  const done = await tpl("completed", "Done");
  const review = await tpl("started", "Review");
  await db.insert(schema.stateTable).values([
    {
      projectId: project.id,
      stateTemplateId: review.id,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId: project.id,
      stateTemplateId: backlog.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId: project.id,
      stateTemplateId: done.id,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: wsId,
        key: `wf-${label}-${randomUUID()}`,
        name: `Workflow ${label}`,
      })
      .returning(),
    "tenant workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: now })
      .returning(),
    "tenant version",
  );
  const edge = (
    gated: boolean,
    versionId = version.id,
    shape: {
      from?: string;
      to?: string;
      requiresCab?: boolean;
      policy?: "any" | "all" | null;
    } = {},
  ) =>
    db
      .insert(schema.workflowTransitionTable)
      .values({
        versionId,
        fromStateTemplateId: shape.from ?? backlog.id,
        toStateTemplateId: shape.to ?? done.id,
        requiresApproval: gated,
        requiresCab: shape.requiresCab ?? false,
        approvalPolicy:
          gated || shape.requiresCab ? (shape.policy ?? "any") : null,
        notePolicy: "none",
        noteVisibility: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  const gated = requireRow(await edge(true), "gated transition");
  const ungated = requireRow(await edge(false), "ungated transition");
  // A `requires_cab`-only edge (no `requires_approval`) to a different state.
  const cabOnly = requireRow(
    await edge(false, version.id, { to: review.id, requiresCab: true }),
    "cab-only transition",
  );
  // An ungated way back, so a gated edge can be repeated.
  const backToBacklog = requireRow(
    await edge(false, version.id, { from: done.id, to: backlog.id }),
    "return transition",
  );
  const reviewBack = requireRow(
    await edge(false, version.id, { from: review.id, to: backlog.id }),
    "review return transition",
  );
  if (options.executable) {
    // Two edges between the same states would make an executed transition ambiguous.
    await db
      .delete(schema.workflowTransitionTable)
      .where(eq(schema.workflowTransitionTable.id, ungated.id));
  }
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  // A published-but-inactive second version of the same workflow with its own gated edge.
  const staleVersion = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 2, publishedAt: now })
      .returning(),
    "tenant stale version",
  );
  const staleGated = requireRow(
    await edge(true, staleVersion.id),
    "stale gated transition",
  );
  // A second workflow of the SAME workspace, with its own active gated edge.
  const siblingWorkflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: wsId,
        key: `wf-sibling-${label}-${randomUUID()}`,
        name: `Sibling workflow ${label}`,
      })
      .returning(),
    "sibling workflow",
  );
  const siblingVersion = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: siblingWorkflow.id, number: 1, publishedAt: now })
      .returning(),
    "sibling version",
  );
  const siblingGated = requireRow(
    await edge(true, siblingVersion.id),
    "sibling gated transition",
  );
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: siblingVersion.id })
    .where(eq(schema.workflowTable.id, siblingWorkflow.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: wsId,
        key: `type-${label}-${randomUUID()}`,
        name: "Approval ticket",
        category: "service",
        workflowId: workflow.id,
        isChange: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "tenant type",
  );

  const approver = await createWorkspaceMember({ role: "owner" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: wsId,
    userId: approver.user.id,
    role: "owner",
    joinedAt: now,
  });
  await grantProjectRole(approver.user.id, project.id, [
    "project:read",
    "work_item:read",
    "approval:decide",
    "approval:decide_cab",
  ]);
  const approverPerson = await personOf(approver.user.id);
  const cabTeam = requireRow(
    await db
      .insert(schema.teamTable)
      .values({
        id: `cab-${randomUUID()}`,
        name: "CAB",
        workspaceId: wsId,
        isCab: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "tenant cab",
  );
  await db.insert(schema.teamMemberTable).values({
    id: `cabm-${randomUUID()}`,
    teamId: cabTeam.id,
    userId: approver.user.id,
    createdAt: now,
  });

  const { app } = createApp();
  mockAuthenticatedSession(requester.user);
  const created = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ typeId: type.id, title: `Item ${label}` }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const { key } = (await created.json()) as { key: string };
  await db
    .update(schema.workItemTable)
    .set({ customerVisibility: "organisation" })
    .where(eq(schema.workItemTable.key, key));
  const workItem = requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key))
      .limit(1),
    "tenant work item",
  );
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: wsId,
    featureKey: "feature.approvals",
    enabled: true,
  });
  return {
    app,
    requester,
    requesterPerson,
    approver,
    approverPerson,
    workspaceId: wsId,
    project,
    workflow,
    version,
    gated,
    ungated,
    cabOnly,
    backToBacklog,
    reviewBack,
    siblingGated,
    staleGated,
    backlog,
    done,
    review,
    type,
    workItem,
    key,
    cabTeam,
    url: `/api/work-items/${key}/approvals`,
  };
}
export type Tenant = Awaited<ReturnType<typeof buildTenant>>;

export function request(
  t: Tenant,
  as: { user: Member["user"] },
  overrides: Record<string, unknown> = {},
) {
  mockAuthenticatedSession(as.user);
  return t.app.request(t.url, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      transitionId: t.gated.id,
      kind: "cab",
      approverId: t.approverPerson.id,
      ...overrides,
    }),
  });
}

export async function createApproval(t: Tenant) {
  const response = await request(t, t.requester);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string };
}

export async function approvalRows(workItemId: string) {
  return db
    .select()
    .from(schema.approvalTable)
    .where(eq(schema.approvalTable.workItemId, workItemId));
}

export async function decide(
  t: Tenant,
  as: { user: Member["user"] },
  id: string,
  body: Record<string, unknown> = { action: "approve" },
) {
  mockAuthenticatedSession(as.user);
  return t.app.request(`/api/approvals/${id}/decide`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
  });
}

export const PORTAL_HOST = "portal.localhost:5174";

/**
 * Re-home the tenant's workspace to a customer organisation and create an organisation-scope
 * `customer` role (once per tenant), as the portal does for admitted customers.
 */
export async function ensureCustomerOrg(
  t: Tenant,
  capabilities: string[] = ["approval:decide", "work_item:read"],
) {
  const orgId = `cust-org-${t.workspaceId}`;
  await db
    .insert(schema.organisationTable)
    .values({
      id: orgId,
      key: orgId,
      name: "Customer org",
      isInternal: false,
      portalAccess: true,
    })
    .onConflictDoNothing();
  await db
    .update(schema.workspaceTable)
    .set({ organisationId: orgId })
    .where(eq(schema.workspaceTable.id, t.workspaceId));
  const roleId = `cust-role-${t.workspaceId}`;
  await db
    .insert(schema.roleTable)
    .values({
      id: roleId,
      scope: "organisation",
      workspaceId: null,
      key: "customer",
      name: "Customer",
      rank: 0,
      capabilities,
    })
    .onConflictDoNothing();
  // The organisation-scope `customer` role is global; reuse it when another tenant made it.
  const role = requireRow(
    await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "organisation"),
          eq(schema.roleTable.key, "customer"),
        ),
      )
      .limit(1),
    "customer role",
  );
  return { orgId, roleId: role.id };
}

/** An admitted customer (user, customer-side person, organisation-scope membership). */
export async function addCustomer(
  t: Tenant,
  options: { capabilities?: string[] } = {},
) {
  const { orgId, roleId } = await ensureCustomerOrg(t, options.capabilities);
  const id = `cust-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId: id,
      organisationId: orgId,
      side: "customer",
      active: true,
      isPlaceholder: false,
    })
    .returning();
  if (!user || !person) throw new Error("customer fixture missing");
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "organisation",
    scopeId: orgId,
    roleId,
    seesAll: false,
  });
  return { user, person, orgId };
}

export function portalRequest(
  t: Tenant,
  as: { user: Member["user"] },
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  mockAuthenticatedSession(as.user, { portal: "customer" });
  return t.app.request(`http://${PORTAL_HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { host: PORTAL_HOST, ...json },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** Run a workflow transition on the tenant's work item as the requester. */
export async function runTransition(t: Tenant, toStateTemplateId: string) {
  mockAuthenticatedSession(t.requester.user);
  return t.app.request(`/api/work-items/${t.key}/transition`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ toStateTemplateId }),
  });
}

export async function setApproval(
  t: Tenant,
  id: string,
  action: "approve" | "reject" = "approve",
) {
  const response = await decide(t, t.approver, id, { action, note: "ok" });
  expect(response.status, await response.clone().text()).toBe(200);
}

export async function withdrawAs(
  t: Tenant,
  who: { user: Member["user"] },
  id: string,
) {
  mockAuthenticatedSession(who.user);
  return t.app.request(`/api/approvals/${id}/withdraw`, { method: "POST" });
}
