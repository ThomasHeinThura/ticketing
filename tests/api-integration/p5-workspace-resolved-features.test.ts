/**
 * `GET /api/workspaces/{id}/features/resolved` (P5-R4-04): the effective on/off values for
 * navigation, open to any workspace reader, with none of the admin metadata. The admin list at
 * `/features` stays manage_settings only.
 */
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { addMember } from "./helpers/reach-world";

type User = Parameters<typeof mockAuthenticatedSession>[0];
type Body = { features: Array<Record<string, unknown>> };

let workspaceId: string;
let owner: User;
const { app } = createApp();

function get(user: User, path: string) {
  mockAuthenticatedSession(user);
  return app.request(path);
}

beforeEach(async () => {
  await resetTestDatabase();
  const member = await createWorkspaceMember({ role: "owner" });
  workspaceId = member.workspace.id;
  owner = member.user;
  await db.insert(schema.workspaceFeatureFlagTable).values([
    { workspaceId, featureKey: "feature.knowledge_base", enabled: true },
    { workspaceId, featureKey: "feature.reports", enabled: true },
  ]);
});

describe("workspace resolved features", () => {
  for (const role of ["member", "lead", "viewer"]) {
    it(`serves ${role} the values only, while the admin list stays closed`, async () => {
      const { user } = await addMember(workspaceId, role);
      const response = await get(
        user,
        `/api/workspaces/${workspaceId}/features/resolved`,
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as Body;
      const byKey = new Map(body.features.map((f) => [f.key, f]));
      expect(byKey.get("feature.knowledge_base")?.enabled).toBe(true);
      expect(byKey.get("feature.reports")?.enabled).toBe(true);
      expect(byKey.get("feature.time_tracking")?.enabled).toBe(false);
      for (const feature of body.features)
        expect(Object.keys(feature).sort()).toEqual(["enabled", "key"]);
      expect(
        (await get(user, `/api/workspaces/${workspaceId}/features`)).status,
      ).toBe(403);
    });
  }

  it("serves the owner too", async () => {
    const response = await get(
      owner,
      `/api/workspaces/${workspaceId}/features/resolved`,
    );
    expect(response.status).toBe(200);
  });

  it("refuses a customer principal", async () => {
    const customer = await createCustomerPrincipal();
    const response = await get(
      customer.user,
      `/api/workspaces/${workspaceId}/features/resolved`,
    );
    expect([403, 404]).toContain(response.status);
    expect(response.status).not.toBe(200);
  });

  it("answers a non-member exactly like a missing workspace", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    const response = await get(
      stranger.user,
      `/api/workspaces/${workspaceId}/features/resolved`,
    );
    const missing = await get(
      stranger.user,
      "/api/workspaces/does-not-exist/features/resolved",
    );
    // The shared workspace middleware answers a non-member and a missing workspace identically
    // (403, as on every workspace-scoped route): nothing tells them apart.
    expect(response.status).toBe(missing.status);
    expect(response.status).toBe(403);
  });
});
