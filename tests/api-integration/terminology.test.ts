import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const requestForms = (singular: string, plural: string) => ({
  one: singular,
  other: plural,
});

beforeEach(resetTestDatabase);

async function instanceAdministrator() {
  const member = await createWorkspaceMember({ role: "admin" });
  const user = requireRow(
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id))
      .returning(),
    "terminology instance administrator",
  );
  const cookie = await createAgentSession(user);
  const { app } = createApp();
  return { app, user, member, cookie };
}

async function createAgentSession(user: typeof schema.userTable.$inferSelect) {
  const now = new Date();
  await db.insert(schema.sessionTable).values({
    id: `session-${user.id}`,
    token: `token-${user.id}`,
    userId: user.id,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  });
  mockAuthenticatedSession(user);
  return `__Host-tdk_agent_session=token-${user.id}`;
}

async function agentMutation(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  method: "PUT" | "POST",
  path: string,
  body: unknown,
) {
  return csrfRequest(
    app,
    path,
    {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

describe("runtime terminology APIs", () => {
  it("previews large and fractional CLDR categories without widening the admin boundary", async () => {
    const admin = await instanceAdministrator();
    const previewPath = "/api/instance/terminology/preview";

    for (const locale of ["fr-FR", "ru-RU"] as const) {
      const categories = new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories;
      const forms = Object.fromEntries(
        categories.map((category) => [category, `${locale} ${category}`]),
      );
      const response = await agentMutation(
        admin.app,
        admin.cookie,
        "POST",
        previewPath,
        { audience: "agent", termKey: "request", locale, forms },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as {
        examples: Array<{ category: string; count: number; label: string }>;
      };
      expect(body.examples.map(({ category }) => category)).toEqual(categories);
      for (const example of body.examples) {
        expect(new Intl.PluralRules(locale).select(example.count)).toBe(
          example.category,
        );
        expect(example.label).toBe(forms[example.category]);
      }
    }

    const workspaceAdmin = await createWorkspaceMember({ role: "admin" });
    const workspaceAdminCookie = await createAgentSession(workspaceAdmin.user);
    const denied = await agentMutation(
      createApp().app,
      workspaceAdminCookie,
      "POST",
      previewPath,
      {
        audience: "agent",
        termKey: "request",
        locale: "fr-FR",
        forms: {
          one: "Cas",
          other: "Cas",
          many: "Un très grand nombre de cas",
        },
      },
    );
    expect(denied.status).toBe(403);
  });

  it("serves host-scoped instance overrides with ETag and strict public queries", async () => {
    const workspace = await createWorkspaceMember({ role: "admin" });
    const instanceForms = requestForms("Case", "Cases");
    await db.insert(schema.terminologyOverrideTable).values({
      scope: "instance",
      workspaceId: null,
      audience: "customer",
      termKey: "request",
      locale: "en-US",
      forms: instanceForms,
    });
    await db.insert(schema.terminologyOverrideTable).values({
      scope: "workspace",
      workspaceId: workspace.workspace.id,
      audience: "customer",
      termKey: "request",
      locale: "en-US",
      forms: requestForms("Incident", "Incidents"),
    });
    const { app } = createApp();
    const agentUrl = new URL(
      "/api/public/terminology?locale=en-US",
      getConfiguredAgentOrigin(),
    );
    const customerUrl = new URL(
      "/api/public/terminology?locale=en-US",
      getConfiguredCustomerOrigin(),
    );
    const agent = await app.request(agentUrl, {
      headers: { host: agentUrl.host },
    });
    const customer = await app.request(customerUrl, {
      headers: { host: customerUrl.host },
    });
    expect(agent.status, await agent.clone().text()).toBe(200);
    expect(customer.status, await customer.clone().text()).toBe(200);
    expect(await agent.json()).toMatchObject({
      audience: "agent",
      terms: {},
    });
    const body = (await customer.json()) as {
      audience: string;
      terms: Record<string, Record<string, string>>;
      etag: string;
    };
    expect(body).toMatchObject({
      audience: "customer",
      terms: { request: instanceForms },
    });
    expect(body.terms.request).not.toEqual(
      requestForms("Incident", "Incidents"),
    );
    expect(body.etag).toBe(customer.headers.get("etag"));
    const unchanged = await app.request(customerUrl, {
      headers: { host: customerUrl.host, "if-none-match": body.etag },
    });
    expect(unchanged.status).toBe(304);
    const broadening = await app.request(
      new URL(
        "/api/public/terminology?locale=en-US&workspaceId=arbitrary",
        getConfiguredCustomerOrigin(),
      ),
      { headers: { host: new URL(getConfiguredCustomerOrigin()).host } },
    );
    expect(broadening.status).toBe(400);
  });

  it("enforces admin/workspace reach, compare-and-swap, CLDR forms and audit history", async () => {
    const admin = await instanceAdministrator();
    const instancePath = "/api/instance/terminology";
    const initial = await admin.app.request(
      new URL(instancePath, getConfiguredAgentOrigin()),
      {
        headers: {
          cookie: admin.cookie,
          host: new URL(getConfiguredAgentOrigin()).host,
        },
      },
    );
    expect(initial.status).toBe(200);
    const before = (await initial.json()) as {
      overrides: unknown[];
      etag: string;
    };
    const saved = await agentMutation(
      admin.app,
      admin.cookie,
      "PUT",
      instancePath,
      {
        expectedEtag: before.etag,
        override: {
          audience: "customer",
          termKey: "request",
          locale: "en-US",
          forms: requestForms("Case", "Cases"),
        },
      },
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    const current = (await saved.json()) as {
      overrides: unknown[];
      etag: string;
    };
    expect(current.etag).not.toBe(before.etag);
    const stale = await agentMutation(
      admin.app,
      admin.cookie,
      "PUT",
      instancePath,
      {
        expectedEtag: before.etag,
        override: {
          audience: "customer",
          termKey: "request",
          locale: "en-US",
          forms: requestForms("Ticket", "Tickets"),
        },
      },
    );
    expect(stale.status).toBe(409);
    const invalidClDR = await agentMutation(
      admin.app,
      admin.cookie,
      "PUT",
      instancePath,
      {
        expectedEtag: current.etag,
        override: {
          audience: "customer",
          termKey: "request",
          locale: "en-US",
          forms: { one: "Case", few: "Cases" },
        },
      },
    );
    expect(invalidClDR.status).toBe(400);

    const workspacePath = `/api/workspaces/${admin.member.workspace.id}/terminology`;
    const workspaceGet = await admin.app.request(
      new URL(workspacePath, getConfiguredAgentOrigin()),
      {
        headers: {
          cookie: admin.cookie,
          host: new URL(getConfiguredAgentOrigin()).host,
        },
      },
    );
    expect(workspaceGet.status).toBe(200);
    const workspaceBefore = (await workspaceGet.json()) as {
      overrides: unknown[];
      etag: string;
    };
    const workspacePut = await agentMutation(
      admin.app,
      admin.cookie,
      "PUT",
      workspacePath,
      {
        expectedEtag: workspaceBefore.etag,
        override: {
          audience: "customer",
          termKey: "request",
          locale: "en-US",
          forms: requestForms("Incident", "Incidents"),
        },
      },
    );
    expect(workspacePut.status).toBe(200);
    const audited = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "terminology.changed"));
    expect(audited).toHaveLength(2);
    expect(audited.map((row) => row.after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "instance", audience: "customer" }),
        expect.objectContaining({
          scope: "workspace",
          workspaceId: admin.member.workspace.id,
          forms: requestForms("Incident", "Incidents"),
        }),
      ]),
    );

    const stranger = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(stranger.user);
    const denied = await createApp().app.request(
      new URL(workspacePath, getConfiguredAgentOrigin()),
      {
        headers: {
          cookie: `__Host-tdk_agent_session=token-${stranger.user.id}`,
          host: new URL(getConfiguredAgentOrigin()).host,
        },
      },
    );
    expect([403, 404]).toContain(denied.status);
  });

  it("resolves customer overrides only through a currently reachable request type", async () => {
    const staff = await createWorkspaceMember({ role: "admin" });
    const customer = await createCustomerPrincipal();
    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.intake",
      enabled: true,
      locked: false,
    });
    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: staff.workspace.id,
          key: `term-type-${randomUUID()}`,
          name: "Request",
          category: "delivery",
        })
        .returning(),
      "terminology request type work item type",
    );
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: staff.workspace.id,
          key: `term-request-${randomUUID()}`,
          name: "Help",
          group: "General",
          workItemTypeId: workItemType.id,
          formSchema: { fields: [] },
          published: true,
          customerVisible: true,
        })
        .returning(),
      "terminology request type",
    );
    await db.insert(schema.requestTypeVersionTable).values({
      workspaceId: staff.workspace.id,
      requestTypeId: requestType.id,
      number: 1,
      formSchema: { fields: [] },
      workItemTypeId: workItemType.id,
    });
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: customer.orgId,
      requestTypeId: requestType.id,
    });
    await db.insert(schema.terminologyOverrideTable).values({
      scope: "instance",
      workspaceId: null,
      audience: "both",
      termKey: "request",
      locale: "en-US",
      forms: requestForms("Request", "Requests"),
    });
    await db.insert(schema.terminologyOverrideTable).values({
      scope: "workspace",
      workspaceId: staff.workspace.id,
      audience: "customer",
      termKey: "request",
      locale: "en-US",
      forms: requestForms("Case", "Cases"),
    });
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const { app } = createApp();
    const host = getConfiguredCustomerOrigin();
    const reachable = await app.request(
      new URL(
        `/api/portal/terminology?locale=en-US&requestTypeKey=${requestType.key}`,
        host,
      ),
      {
        headers: {
          cookie: `__Host-tdk_portal_session=token-${customer.user.id}`,
          host: new URL(host).host,
        },
      },
    );
    expect(reachable.status, await reachable.clone().text()).toBe(200);
    expect(await reachable.json()).toMatchObject({
      terms: { request: requestForms("Case", "Cases") },
    });
    const concealed = await app.request(
      new URL(
        "/api/portal/terminology?locale=en-US&requestTypeKey=other-org",
        host,
      ),
      {
        headers: {
          cookie: `__Host-tdk_portal_session=token-${customer.user.id}`,
          host: new URL(host).host,
        },
      },
    );
    expect(concealed.status).toBe(404);
    const ambiguous = await app.request(
      new URL(
        `/api/portal/terminology?locale=en-US&requestTypeKey=${requestType.key}&workItemKey=REQ-1`,
        host,
      ),
      {
        headers: {
          cookie: `__Host-tdk_portal_session=token-${customer.user.id}`,
          host: new URL(host).host,
        },
      },
    );
    expect(ambiguous.status).toBe(400);

    const outsideCustomer = await createCustomerPrincipal();
    mockAuthenticatedSession(outsideCustomer.user, { portal: "customer" });
    const denied = await createApp().app.request(
      new URL(
        `/api/portal/terminology?locale=en-US&requestTypeKey=${requestType.key}`,
        host,
      ),
      {
        headers: {
          cookie: `__Host-tdk_portal_session=token-${outsideCustomer.user.id}`,
          host: new URL(host).host,
        },
      },
    );
    expect(denied.status).toBe(404);
  });
});
