import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    resolveCalls: 0,
    validateCalls: [] as { userId: string; workspaceId: string }[],
    caller: "anonymous" as "anonymous" | "member" | "outsider",
  },
}));

vi.mock("../../../apps/api/src/utils/authenticate-api-request", () => ({
  // Mirrors the real helper: every unauthenticated path throws, so it never
  // returns a falsy userId.
  resolveAssetBearerOrCookie: async () => {
    state.resolveCalls += 1;
    if (state.caller === "anonymous") {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    return { userId: `user-${state.caller}` };
  },
}));

vi.mock("../../../apps/api/src/utils/validate-workspace-access", () => ({
  validateWorkspaceAccess: async (userId: string, workspaceId: string) => {
    state.validateCalls.push({ userId, workspaceId });
    if (userId !== "user-member") {
      throw new HTTPException(403, {
        message: "You don't have access to this workspace",
      });
    }
  },
}));

const { authorizeAssetAccess } = await import(
  "../../../apps/api/src/utils/authorize-asset-access"
);

const context = {} as Context;

async function statusOf(promise: Promise<void>) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof HTTPException ? error.status : 500;
  }
}

describe("authorizeAssetAccess", () => {
  beforeEach(() => {
    state.resolveCalls = 0;
    state.validateCalls = [];
    state.caller = "anonymous";
  });

  // Negative guard for issue #6. kaneo returned early — with NO credential
  // check — for any asset whose project carried `is_public`. That branch and
  // the column are gone. This test deliberately passes a legacy `isPublic:
  // true` target through a cast, so that if anyone ever reintroduces the
  // field or the early return, this fails instead of silently reopening
  // anonymous asset reads.
  it("refuses an anonymous caller even for a target carrying a legacy isPublic flag", async () => {
    const status = await statusOf(
      authorizeAssetAccess(context, {
        workspaceId: "workspace-1",
        isPublic: true,
      } as unknown as { workspaceId: string }),
    );

    expect(status).toBe(401);
    // The credential check must actually run — it is no longer skippable.
    expect(state.resolveCalls).toBe(1);
  });

  it("rejects an anonymous caller for a private asset", async () => {
    const status = await statusOf(
      authorizeAssetAccess(context, { workspaceId: "workspace-1" }),
    );

    expect(status).toBe(401);
  });

  it("rejects an authenticated non-member for a private asset", async () => {
    state.caller = "outsider";

    const status = await statusOf(
      authorizeAssetAccess(context, { workspaceId: "workspace-1" }),
    );

    expect(status).toBe(403);
  });

  it("allows a workspace member to read a private asset", async () => {
    state.caller = "member";

    const status = await statusOf(
      authorizeAssetAccess(context, { workspaceId: "workspace-1" }),
    );

    expect(status).toBe(200);
    expect(state.validateCalls).toEqual([
      { userId: "user-member", workspaceId: "workspace-1" },
    ]);
  });
});
