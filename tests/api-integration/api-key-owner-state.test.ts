/**
 * A banned or deactivated owner's still-enabled API key must be refused at the shared
 * key-verification point, with strict policy enforcement both OFF (the default, legacy layer
 * only) and ON, and across several route families. The refusal is a 401, matching what the
 * strict identity resolver already did.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

vi.unmock("../../apps/api/src/index");

type App = ReturnType<typeof createApp>["app"];

async function freshApp(enforcement: "off" | "on"): Promise<App> {
  delete process.env.TASKDESK_POLICY_ENFORCE;
  vi.resetModules();
  if (enforcement === "on") {
    const { policyRegistry } = await import(
      "../../apps/api/src/policy-registry"
    );
    const sources = [...new Set(policyRegistry.entries.map((e) => e.source))];
    const task = sources.find((source) => source.endsWith("/task/policy.ts"));
    process.env.TASKDESK_POLICY_ENFORCE = [
      ...sources.filter((source) => source !== task),
      ...(task ? [task] : []),
    ].join(",");
    vi.resetModules();
  }
  const app = (await import("../../apps/api/src/index")).createApp().app;
  const request = app.request.bind(app);
  app.request = (input, init, env, executionCtx) => {
    if (typeof input === "string") {
      const normalized = withConfiguredAgentAuthority(input, init);
      return request(normalized.input, normalized.init, env, executionCtx);
    }
    return request(input, init, env, executionCtx);
  };
  return app;
}

function hashKey(rawKey: string) {
  return createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

async function issueKey(userId: string) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashKey(rawKey),
    name: "owner state key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify({
      project: ["read"],
      instance: ["admin"],
    }),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

beforeEach(async () => {
  await resetTestDatabase();
});

afterEach(() => {
  delete process.env.TASKDESK_POLICY_ENFORCE;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe.each(["off", "on"] as const)(
  "API key owner state with strict enforcement %s",
  (enforcement) => {
    const routes = (workspaceId: string) =>
      [
        ["agent", `/api/project?workspaceId=${workspaceId}`],
        ["instance admin", "/api/instance/identity-connections"],
        ["pending action", "/api/me/pending-actions"],
        ["asset bearer", `/api/asset/${randomUUID()}`],
      ] as const;

    it.each([
      [
        "banned",
        (userId: string) =>
          db
            .update(schema.userTable)
            .set({ banned: true })
            .where(eq(schema.userTable.id, userId)),
      ],
      [
        "inactive",
        (userId: string) =>
          db
            .update(schema.personTable)
            .set({ active: false })
            .where(eq(schema.personTable.userId, userId)),
      ],
    ] as const)(
      "refuses a %s owner's still-enabled key with 401 on every route family",
      async (_state, disableOwner) => {
        const owner = await createWorkspaceMember({ role: "owner" });
        await db
          .update(schema.userTable)
          .set({ role: "admin" })
          .where(eq(schema.userTable.id, owner.user.id));
        const rawKey = await issueKey(owner.user.id);
        const app = await freshApp(enforcement);
        const headers = { authorization: `Bearer ${rawKey}` };

        // Control: the same key is accepted while its owner is active.
        const control = await app.request(
          `/api/project?workspaceId=${owner.workspace.id}`,
          { headers },
        );
        expect(control.status, await control.clone().text()).toBe(200);

        await disableOwner(owner.user.id);

        for (const [family, path] of routes(owner.workspace.id)) {
          const response = await app.request(path, { headers });
          expect(
            response.status,
            `${family} ${path}: ${await response.clone().text()}`,
          ).toBe(401);
        }
        // The state, not a stale cache, is what changed: a mutating route is refused too.
        const write = await app.request("/api/project", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            name: "Banned owner write",
            workspaceId: owner.workspace.id,
            slug: "owner-state-write",
            icon: "Folder",
          }),
        });
        expect(write.status).toBe(401);
        const projects = await db.select().from(schema.projectTable);
        expect(projects).toHaveLength(0);
      },
    );
  },
);
