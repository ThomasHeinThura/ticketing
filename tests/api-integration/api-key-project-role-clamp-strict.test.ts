/**
 * #724 with strict policy enforcement OFF and ON: a full-scope key owned by a workspace lead
 * whose project role is read-only is refused every item write exactly like the owner's session,
 * and a key owned by a capable project member keeps working. Strict enforcement already clamped
 * the key (identity carries the stored scope since #750); this proves the two layers agree.
 *
 * Keys only: modules are re-imported per enforcement mode, which drops session mocks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { resetTestDatabase } from "./helpers/database";

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

const FULL_SCOPE = {
  project: ["read", "update", "delete"],
  work_item: ["read", "create", "update", "delete", "assign", "rank"],
  workspace: ["read"],
};

beforeEach(async () => {
  await resetTestDatabase();
});
afterEach(() => {
  delete process.env.TASKDESK_POLICY_ENFORCE;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe.each(["off", "on"] as const)(
  "API key clamped by the owner's project role, strict enforcement %s",
  (enforcement) => {
    it("refuses a read-only project lead's key every item write and keeps a member's key working", async () => {
      const { setupWorld, makeApiKey } = await import("./helpers/reach-world");
      const world = await setupWorld();
      const app = await freshApp(enforcement);
      const call = async (
        key: string,
        method: string,
        url: string,
        body?: unknown,
        headers = {},
      ) => {
        const response = await app.request(url, {
          method,
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return response;
      };
      const memberKey = await makeApiKey(
        world.projectMember.user.id,
        FULL_SCOPE,
      );
      const leadKey = await makeApiKey(world.readerLead.user.id, FULL_SCOPE);

      const created = await call(
        memberKey,
        "POST",
        `/api/projects/${world.project.id}/work-items`,
        {
          typeId: world.type.id,
          title: "Strict probe",
        },
      );
      expect(created.status, await created.clone().text()).toBe(200);
      const item = (await created.json()) as { key: string };

      for (const [method, url, body, headers] of [
        [
          "PATCH",
          `/api/work-items/${item.key}`,
          { title: "x" },
          { "if-match": '"1"' },
        ],
        ["DELETE", `/api/work-items/${item.key}`, undefined, {}],
      ] as const) {
        const refused = await call(leadKey, method, url, body, { ...headers });
        expect(
          refused.status,
          `${enforcement} ${method}: ${await refused.text()}`,
        ).toBe(403);
      }
      const bulk = await call(leadKey, "POST", "/api/work-items/bulk", {
        workspaceId: world.workspaceId,
        workItemKeys: [item.key],
        operation: "delete",
      });
      expect(await bulk.text()).not.toContain('"ok"');

      const allowed = await call(
        memberKey,
        "PATCH",
        `/api/work-items/${item.key}`,
        { title: "Renamed by member" },
        { "if-match": '"1"' },
      );
      expect(allowed.status, await allowed.text()).toBe(200);
    });
  },
);
