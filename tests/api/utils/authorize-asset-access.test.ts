import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    resolveCalls: 0,
    queryCalls: 0,
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

// #317 S1/S4: `loadReachableAsset` folds the existence lookup and the
// workspace-reach check into a single query via `reachableWorkspacePredicate`
// (`workspace-access-middleware.ts`), rather than a separate row fetch
// followed by a separate `validateWorkspaceAccess` call. This mock stands in
// for that one query: it returns a row only for the workspace-1 asset AND a
// caller who reaches it ("member"), and it counts calls so the tests below
// can assert exactly one round trip for both a foreign and a missing asset.
vi.mock("../../../apps/api/src/database", async () => {
  // Real schema objects, not stubs: `reachableWorkspacePredicate`
  // (`workspace-access-middleware.ts`, exercised through `loadReachableAsset`)
  // builds a real drizzle `sql` fragment out of `schema.userTable` etc., and
  // that construction needs real `Table` metadata even though the mocked
  // chain below never executes it against a database. Same approach as
  // `tests/api/utils/workspace-access-middleware.test.ts`.
  const schema = await import("../../../apps/api/src/database/schema");
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => {
      state.queryCalls += 1;
      if (state.caller !== "member") return [];
      return [
        {
          id: "asset-1",
          objectKey: "workspace/workspace-1/file.png",
          mimeType: "image/png",
          filename: "file.png",
          workspaceId: "workspace-1",
        },
      ];
    },
  };
  return { default: chain, schema };
});

const { loadReachableAsset } = await import(
  "../../../apps/api/src/utils/authorize-asset-access"
);

const context = {} as Context;

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return error instanceof HTTPException ? error.status : 500;
  }
}

describe("loadReachableAsset", () => {
  beforeEach(() => {
    state.resolveCalls = 0;
    state.queryCalls = 0;
    state.caller = "anonymous";
  });

  it("rejects an anonymous caller before any row is read", async () => {
    const status = await statusOf(loadReachableAsset(context, "asset-1"));

    expect(status).toBe(401);
    // The credential check must actually run — it is no longer skippable.
    expect(state.resolveCalls).toBe(1);
    expect(state.queryCalls).toBe(0);
  });

  it("masks a foreign asset as missing for an authenticated non-member, in one query", async () => {
    state.caller = "outsider";

    const status = await statusOf(loadReachableAsset(context, "asset-1"));

    expect(status).toBe(404);
    expect(state.queryCalls).toBe(1);
  });

  it("answers a nonexistent asset with the same status and query count as a foreign one", async () => {
    state.caller = "outsider";
    const foreignQueries = (async () => {
      const before = state.queryCalls;
      const status = await statusOf(loadReachableAsset(context, "asset-1"));
      return { status, queries: state.queryCalls - before };
    })();
    const missingQueries = (async () => {
      const before = state.queryCalls;
      const status = await statusOf(
        loadReachableAsset(context, "asset-does-not-exist"),
      );
      return { status, queries: state.queryCalls - before };
    })();

    expect(await foreignQueries).toEqual(await missingQueries);
  });

  it("allows a workspace member to read a private asset, in one query", async () => {
    state.caller = "member";

    const asset = await loadReachableAsset(context, "asset-1");

    expect(asset.workspaceId).toBe("workspace-1");
    expect(state.queryCalls).toBe(1);
  });
});
