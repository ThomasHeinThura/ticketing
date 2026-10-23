import type { ResolvedIdentity } from "@taskdesk/permissions";
import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../apps/api/src/database/executor";
import {
  invalidateProjectAncestry,
  loadProjectAncestorIds,
  loadProjectAncestorIdsFor,
  loadProjectAncestorIdsForRequest,
  mayInheritProjectAccess,
} from "../../../apps/api/src/project/hierarchy.repository";

function executorReturning(ids: string[]) {
  const execute = vi.fn(async () => ({ rows: ids.map((id) => ({ id })) }));
  return { executor: { execute } as unknown as Executor, execute };
}

function who(
  overrides: Partial<
    Pick<ResolvedIdentity, "memberships" | "authority" | "side">
  >,
) {
  return {
    side: "staff" as const,
    memberships: [],
    authority: [],
    ...overrides,
  };
}

describe("loadProjectAncestorIds (single bounded CTE, P1-8)", () => {
  it("issues exactly one statement and returns nearest-first ids", async () => {
    const { executor, execute } = executorReturning(["b", "a"]);
    await expect(loadProjectAncestorIds(executor, "ws", "c")).resolves.toEqual([
      "b",
      "a",
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never returns the project itself or a repeated id (stored cycle)", async () => {
    const { executor } = executorReturning(["b", "c", "b"]);
    await expect(loadProjectAncestorIds(executor, "ws", "c")).resolves.toEqual([
      "b",
    ]);
  });

  it("returns [] for a root project", async () => {
    const { executor } = executorReturning([]);
    await expect(loadProjectAncestorIds(executor, "ws", "a")).resolves.toEqual(
      [],
    );
  });
});

describe("request memoisation", () => {
  it("shares one query per (workspace, project) within a request", async () => {
    const { executor, execute } = executorReturning(["a"]);
    const request = {};
    await Promise.all([
      loadProjectAncestorIdsForRequest(request, executor, "ws", "b"),
      loadProjectAncestorIdsForRequest(request, executor, "ws", "b"),
    ]);
    await loadProjectAncestorIdsForRequest(request, executor, "ws", "b");
    expect(execute).toHaveBeenCalledTimes(1);
    await loadProjectAncestorIdsForRequest(request, executor, "ws", "c");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not share across requests and does not cache a failure", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ rows: [{ id: "a" }] });
    const executor = { execute } as unknown as Executor;
    const request = {};
    await expect(
      loadProjectAncestorIdsForRequest(request, executor, "ws", "b"),
    ).rejects.toThrow("boom");
    await expect(
      loadProjectAncestorIdsForRequest(request, executor, "ws", "b"),
    ).resolves.toEqual(["a"]);
    await loadProjectAncestorIdsForRequest({}, executor, "ws", "b");
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

describe("short-circuit when nothing can be inherited", () => {
  const projectRow = (scopeId: string) => ({
    scope: "project" as const,
    scopeId,
    seesAll: false,
  });

  it("skips the query for a workspace-role-only staff caller", async () => {
    const { executor, execute } = executorReturning(["a"]);
    await expect(
      loadProjectAncestorIdsFor({}, executor, who({}), "ws", "b"),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips the query when the only project row is on the target itself", () => {
    expect(
      mayInheritProjectAccess(who({ memberships: [projectRow("b")] }), "b"),
    ).toBe(false);
  });

  it("never loads for a customer", () => {
    expect(
      mayInheritProjectAccess(
        who({ side: "customer", memberships: [projectRow("a")] }),
        "b",
      ),
    ).toBe(false);
  });

  it("loads when the caller holds a project row on another project", async () => {
    const { executor, execute } = executorReturning(["a"]);
    await expect(
      loadProjectAncestorIdsFor(
        {},
        executor,
        who({ memberships: [projectRow("a")] }),
        "ws",
        "b",
      ),
    ).resolves.toEqual(["a"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("long-lived executors are never memoised (review Q1)", () => {
  /** Shaped like the shared `db`: executes and selects, has no `rollback`. */
  function sharedDb(chains: string[][]) {
    const execute = vi.fn(async () => ({
      rows: (chains.shift() ?? []).map((id) => ({ id })),
    }));
    return {
      handle: { execute, select: vi.fn() } as unknown as Executor,
      execute,
    };
  }

  it("a call keyed on the global db re-reads after the parent changes", async () => {
    const { handle, execute } = sharedDb([["old-parent"], ["new-parent"]]);
    await expect(
      loadProjectAncestorIdsForRequest(handle, handle, "ws", "child"),
    ).resolves.toEqual(["old-parent"]);
    // re-parent happens here
    await expect(
      loadProjectAncestorIdsForRequest(handle, handle, "ws", "child"),
    ).resolves.toEqual(["new-parent"]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("loadProjectAncestorIdsFor with the db as request key never serves a stale chain", async () => {
    const { handle } = sharedDb([["old-parent"], []]);
    const identity = who({
      memberships: [
        { scope: "project", scopeId: "elsewhere" },
      ] as unknown as ResolvedIdentity["memberships"],
    });
    await expect(
      loadProjectAncestorIdsFor(handle, handle, identity, "ws", "child"),
    ).resolves.toEqual(["old-parent"]);
    await expect(
      loadProjectAncestorIdsFor(handle, handle, identity, "ws", "child"),
    ).resolves.toEqual([]);
  });

  it("a transaction object still dedupes within itself and is invalidated by a re-parent", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "old-parent" }] })
      .mockResolvedValueOnce({ rows: [{ id: "new-parent" }] });
    const tx = {
      execute,
      select: vi.fn(),
      rollback: vi.fn(),
    } as unknown as Executor;
    await loadProjectAncestorIdsForRequest(tx, tx, "ws", "child");
    await expect(
      loadProjectAncestorIdsForRequest(tx, tx, "ws", "child"),
    ).resolves.toEqual(["old-parent"]);
    expect(execute).toHaveBeenCalledTimes(1);
    invalidateProjectAncestry(tx);
    await expect(
      loadProjectAncestorIdsForRequest(tx, tx, "ws", "child"),
    ).resolves.toEqual(["new-parent"]);
  });

  it("a request context keyed memo is per request even when the executor is the db", async () => {
    const { handle, execute } = sharedDb([["a"], ["b"]]);
    const request = {};
    await loadProjectAncestorIdsForRequest(request, handle, "ws", "c");
    await loadProjectAncestorIdsForRequest(request, handle, "ws", "c");
    expect(execute).toHaveBeenCalledTimes(1);
    await loadProjectAncestorIdsForRequest({}, handle, "ws", "c");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
