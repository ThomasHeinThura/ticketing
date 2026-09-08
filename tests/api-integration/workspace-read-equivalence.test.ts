import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  type SignedUpUser,
  signUpUser,
} from "./helpers/organization-http";

/**
 * Equivalence, not a smoke test: for the SAME fixture and the SAME session cookie, the three
 * native S2 read routes must reach the SAME authorization decision (allow/deny, never just
 * "both happen to return 200") as the still-mounted better-auth `organization()` plugin
 * routes they replace:
 *
 * - `GET /api/workspace`               vs `GET /auth/organization/list`
 * - `GET /api/workspace/{id}`          vs `GET /auth/organization/get-full-organization`
 * - `GET /api/workspace/{id}/invitations` vs `GET /auth/organization/list-invitations`
 *
 * Covers exactly the three cases named for this batch: **invitation** (the third route pair),
 * **viewer** and **member** (the two non-owner roles exercised against all three route pairs).
 * Driven over real HTTP with real sessions, the same pattern as
 * `capabilities-equivalence.test.ts` and the S1 characterization suite
 * (`organization-plugin-characterization.test.ts`) -- never a mocked session.
 */

type App = ReturnType<typeof createApp>["app"];

async function pluginList(app: App, cookie: string): Promise<Response> {
  return app.request("/api/auth/organization/list", { headers: { cookie } });
}

async function nativeList(app: App, cookie: string): Promise<Response> {
  return app.request("/api/workspace", { headers: { cookie } });
}

async function pluginDetail(
  app: App,
  cookie: string,
  organizationId: string,
): Promise<Response> {
  return app.request(
    `/api/auth/organization/get-full-organization?organizationId=${organizationId}`,
    { headers: { cookie } },
  );
}

async function nativeDetail(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}`, { headers: { cookie } });
}

async function pluginInvitations(
  app: App,
  cookie: string,
  organizationId: string,
): Promise<Response> {
  return app.request(
    `/api/auth/organization/list-invitations?organizationId=${organizationId}`,
    { headers: { cookie } },
  );
}

async function nativeInvitations(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/invitations`, {
    headers: { cookie },
  });
}

/** allow/deny, collapsing every 2xx to "allow" -- the decision, not the exact body shape. */
function decisionOf(response: Response): "allow" | number {
  return response.status >= 200 && response.status < 300
    ? "allow"
    : response.status;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("native reads agree with the plugin's authorization decision", () => {
  async function setupWorkspaceWithRole(role: string): Promise<{
    app: App;
    owner: SignedUpUser;
    caller: SignedUpUser;
    workspaceId: string;
  }> {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    const caller = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      role,
    );
    return { app, owner, caller, workspaceId: workspace.id };
  }

  for (const role of ["viewer", "member"] as const) {
    describe(`role: ${role}`, () => {
      it("GET /api/workspace agrees with organization/list", async () => {
        const { app, caller } = await setupWorkspaceWithRole(role);

        const pluginResponse = await pluginList(app, caller.cookie);
        const nativeResponse = await nativeList(app, caller.cookie);

        expect(decisionOf(nativeResponse)).toBe(decisionOf(pluginResponse));
        expect(nativeResponse.status).toBe(200);

        // Same set of organization/workspace ids, not just "both 200".
        const pluginIds = (
          (await pluginResponse.json()) as Array<{
            id: string;
          }>
        )
          .map((o) => o.id)
          .sort();
        const nativeIds = (
          (await nativeResponse.json()) as Array<{
            id: string;
          }>
        )
          .map((w) => w.id)
          .sort();
        expect(nativeIds).toEqual(pluginIds);
      });

      it("GET /api/workspace/{id} agrees with organization/get-full-organization (member)", async () => {
        const { app, caller, workspaceId } = await setupWorkspaceWithRole(role);

        const pluginResponse = await pluginDetail(
          app,
          caller.cookie,
          workspaceId,
        );
        const nativeResponse = await nativeDetail(
          app,
          caller.cookie,
          workspaceId,
        );

        expect(pluginResponse.status).toBe(200);
        expect(decisionOf(nativeResponse)).toBe(decisionOf(pluginResponse));
      });

      it("GET /api/workspace/{id} agrees with organization/get-full-organization (non-member refused by both)", async () => {
        const { app, workspaceId } = await setupWorkspaceWithRole(role);
        const outsider = await signUpUser(app);

        const pluginResponse = await pluginDetail(
          app,
          outsider.cookie,
          workspaceId,
        );
        const nativeResponse = await nativeDetail(
          app,
          outsider.cookie,
          workspaceId,
        );

        expect(pluginResponse.status).toBe(403);
        expect(nativeResponse.status).toBe(403);
      });

      it("GET /api/workspace/{id}/invitations agrees with organization/list-invitations", async () => {
        const { app, caller, workspaceId } = await setupWorkspaceWithRole(role);

        const pluginResponse = await pluginInvitations(
          app,
          caller.cookie,
          workspaceId,
        );
        const nativeResponse = await nativeInvitations(
          app,
          caller.cookie,
          workspaceId,
        );

        expect(pluginResponse.status).toBe(200);
        expect(decisionOf(nativeResponse)).toBe(decisionOf(pluginResponse));
      });

      it("GET /api/workspace/{id}/invitations agrees with organization/list-invitations (non-member refused by both)", async () => {
        const { app, workspaceId } = await setupWorkspaceWithRole(role);
        const outsider = await signUpUser(app);

        const pluginResponse = await pluginInvitations(
          app,
          outsider.cookie,
          workspaceId,
        );
        const nativeResponse = await nativeInvitations(
          app,
          outsider.cookie,
          workspaceId,
        );

        expect(pluginResponse.status).toBe(403);
        expect(nativeResponse.status).toBe(403);
      });
    });
  }
});
