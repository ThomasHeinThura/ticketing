/**
 * Webhook Settings History (`entity_type=webhook`, workspace scope): a holder of `webhook:manage`
 * reads the rows of a webhook in their own workspace; a member without it, and a manager of
 * another workspace, get a refusal and never the rows.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function sessionFor(user: { id: string }) {
  const token = `token-${user.id}`;
  await db.insert(schema.sessionTable).values({
    id: `session-${user.id}`,
    token,
    userId: user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return {
    host: "localhost:1337",
    cookie: `__Host-tdk_agent_session=${token}`,
  };
}

async function seedWebhook(role: string) {
  const { user, workspace } = await createWorkspaceMember({ role });
  const identity = await resolveIdentity({
    userId: user.id,
    credential: "session",
  });
  if (!identity) throw new Error("Expected staff identity");
  const webhookId = `webhook-${randomUUID()}`;
  await db.insert(webhookTable).values({
    id: webhookId,
    workspaceId: workspace.id,
    name: "History fixture",
    url: "https://example.com/hook",
    secret: "fixture-secret",
    events: ["work_item.updated"],
    createdBy: identity.personId,
  });
  await appendAuditLog(db, {
    actorId: user.id,
    actorType: "person",
    workspaceId: workspace.id,
    action: "webhook.updated",
    entityType: "webhook",
    entityId: webhookId,
    after: { changedFields: ["name"] },
  });
  const headers = await sessionFor(user);
  mockAuthenticatedSession(user);
  return {
    headers,
    path: (workspaceId = workspace.id) =>
      `/api/audit?entity_type=webhook&entity_id=${webhookId}&scope=workspace&workspace_id=${workspaceId}`,
    workspaceId: workspace.id,
  };
}

describe("webhook History read authorization", () => {
  beforeEach(async () => resetTestDatabase());

  it("lets the webhook manager read the webhook's rows", async () => {
    const { path, headers } = await seedWebhook("owner");
    const { app } = createApp();
    const response = await app.request(path(), { headers });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      rows: Array<{ action: string; changedFields: string[] }>;
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ action: "webhook.updated" });
  });

  it("refuses a member without webhook:manage", async () => {
    const { path, headers } = await seedWebhook("viewer");
    const { app } = createApp();
    const response = await app.request(path(), { headers });
    expect([403, 404]).toContain(response.status);
    expect(await response.text()).not.toContain("webhook.updated");
  });

  it("refuses a manager of another workspace", async () => {
    const { path, workspaceId } = await seedWebhook("owner");
    const intruder = await createWorkspaceMember({ role: "owner" });
    const headers = await sessionFor(intruder.user);
    mockAuthenticatedSession(intruder.user);
    const { app } = createApp();
    for (const target of [workspaceId, intruder.workspace.id]) {
      const response = await app.request(path(target), { headers });
      expect([403, 404]).toContain(response.status);
      expect(await response.text()).not.toContain("webhook.updated");
    }
  });
});
