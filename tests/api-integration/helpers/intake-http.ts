/** Shared HTTP fixtures for the intake integration tests: one tenant with a published,
 * customer-visible request type, customers admitted to its organisation, and staff and
 * portal request helpers that go through the real router. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { auth, portalAuth } from "../../../apps/api/src/auth";
import db, { schema } from "../../../apps/api/src/database";
import {
  addCustomer,
  buildTenant,
  json,
  type Member,
  PORTAL_HOST,
  portalRequest,
  type Tenant,
} from "./approval-fixtures";
import { mockAuthenticatedSession } from "./auth";
import { requireRow } from "./fixtures";

export type Customer = Awaited<ReturnType<typeof addCustomer>>;

export const TITLE_FORM = {
  fields: [
    {
      key: "summary",
      type: "text",
      label: "Summary",
      required: true,
      mapsTo: { field: "title" },
    },
  ],
};

export async function seedIntake(
  label: string,
  options: { assignToOrganisation?: boolean } = {},
) {
  const t = await buildTenant(label);
  const customer = await addCustomer(t);
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: t.workspaceId,
    featureKey: "feature.intake",
    enabled: true,
  });
  // The tenant project must serve the customer's organisation for acceptance.
  await db
    .update(schema.projectTable)
    .set({ organisationId: customer.orgId })
    .where(eq(schema.projectTable.id, t.project.id));
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: t.workspaceId,
        key: `req-${randomUUID()}`,
        name: "Help",
        group: "General",
        workItemTypeId: t.type.id,
        defaultProjectId: t.project.id,
        formSchema: TITLE_FORM,
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
        workspaceId: t.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: TITLE_FORM,
        workItemTypeId: t.type.id,
        defaultProjectId: t.project.id,
      })
      .returning(),
    "request type version",
  );
  if (options.assignToOrganisation !== false)
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: customer.orgId,
      requestTypeId: requestType.id,
    });
  return { t, customer, requestType, version };
}
export type IntakeSeed = Awaited<ReturnType<typeof seedIntake>>;

/** A customer submits through the portal route; returns the SUB-n reference. */
export async function submitAs(
  s: Pick<IntakeSeed, "t" | "requestType">,
  customer: Customer,
  summary = "Cannot sign in",
) {
  const response = await portalRequest(
    s.t,
    customer,
    "/api/portal/submissions",
    {
      method: "POST",
      body: { key: s.requestType.key, formData: { summary } },
    },
  );
  if (response.status !== 200)
    throw new Error(
      `submit failed: ${response.status} ${await response.text()}`,
    );
  return ((await response.json()) as { ref: string }).ref;
}

/** A staff request through the real router as the given workspace member. */
export function staffRequest(
  t: Tenant,
  as: { user: Member["user"] },
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  mockAuthenticatedSession(as.user);
  return t.app.request(path, {
    method: init.method ?? "GET",
    headers: json,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

export async function submissionRow(ref: string) {
  const number = Number(ref.replace("SUB-", ""));
  return requireRow(
    await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.number, number))
      .limit(1),
    "submission row",
  );
}

export const sortedKeys = (value: unknown) =>
  Object.keys(value as Record<string, unknown>).sort();

type SessionUser = Member["user"];

/**
 * Concurrent requests as different people. `mockAuthenticatedSession` replaces one global
 * session, so two in-flight requests would share it. This resolves the session per request
 * from the `x-test-user` header, which `portalAs` and `staffAs` set.
 */
export function mockSessionsByHeader(
  people: Array<{ user: SessionUser; portal?: "agent" | "customer" }>,
) {
  const byId = new Map(people.map((person) => [person.user.id, person]));
  const resolve = async ({ headers }: { headers: Headers }) => {
    const person = byId.get(headers.get("x-test-user") ?? "");
    if (!person) return null;
    const now = new Date();
    return {
      session: {
        id: `session-${person.user.id}`,
        token: `token-${person.user.id}`,
        userId: person.user.id,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
        portal: person.portal ?? "agent",
      },
      user: { ...person.user, twoFactorEnabled: false },
    };
  };
  vi.spyOn(auth.api, "getSession").mockImplementation(resolve as never);
  vi.spyOn(portalAuth.api, "getSession").mockImplementation(resolve as never);
}

export function staffAs(
  t: Tenant,
  user: SessionUser,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  return t.app.request(path, {
    method: init.method ?? "GET",
    headers: { ...json, "x-test-user": user.id },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

export function portalAs(
  t: Tenant,
  user: SessionUser,
  path: string,
  init: { method?: string; body?: unknown } = {},
) {
  return t.app.request(`http://${PORTAL_HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { host: PORTAL_HOST, ...json, "x-test-user": user.id },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
