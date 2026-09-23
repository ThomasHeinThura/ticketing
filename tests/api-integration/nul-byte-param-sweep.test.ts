import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Issue #281 (follow-up to #277's Opus review): raw `c.req.param()`/`c.req.query()`
// reads outside `workspace-access-middleware.ts` (and `require-work-item-reach.ts`,
// which already carries this same check) still reached Postgres unvalidated -- a NUL
// (`\u0000`) byte made `pg` throw, surfacing as an unhandled 500 instead of a clean
// 400. `apps/api/src/utils/reject-nul-byte.ts` is the shared fix; these are the real
// routes the review's "not audited by #277" list named as unaudited, each proven here
// through the actual route, not the helper in isolation.
describe("API integration: #281 NUL-byte sweep on raw param/query reads", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("DELETE /api/task-relation/{id}: a NUL byte in the id is a clean 400, not a 500 (scopeToRelation reads the raw param with no preceding workspaceAccess.* guard)", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/task-relation/${encodeURIComponent("\u0000x")}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/invitation/public/{id}: a NUL byte in the id is a clean 400, not a 500 (this route is public -- no session required)", async () => {
    const { app } = createApp();

    const response = await app.request(
      `/api/invitation/public/${encodeURIComponent("\u0000x")}`,
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/asset/{id}: a NUL byte in the id is a clean 400, not a 500", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/asset/${encodeURIComponent("\u0000x")}`,
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/ws/{projectId}: a NUL byte in the optional projectId is a clean 400, not a 500", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/ws/${encodeURIComponent("\u0000x")}`,
      { headers: { Upgrade: "websocket", Connection: "Upgrade" } },
    );

    expect(response.status).toBe(400);
  });
});
