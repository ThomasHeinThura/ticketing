import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../apps/api/src/database/executor";
import {
  loadVisibleProjectSubtreeIds,
  loadVisibleProjectSubtrees,
} from "../../../apps/api/src/project/descendants.repository";

function executorReturning(ids: string[]) {
  const execute = vi.fn(async () => ({ rows: ids.map((id) => ({ id })) }));
  return { executor: { execute } as unknown as Executor, execute };
}

describe("loadVisibleProjectSubtreeIds", () => {
  it("uses one bounded query and returns root before descendants", async () => {
    const { executor, execute } = executorReturning([
      "root",
      "child-a",
      "child-b",
      "grandchild",
    ]);

    await expect(
      loadVisibleProjectSubtreeIds(executor, "workspace", "root"),
    ).resolves.toEqual(["root", "child-a", "child-b", "grandchild"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repeated ids in the returned rows", async () => {
    const { executor } = executorReturning(["root", "child", "root", "child"]);

    await expect(
      loadVisibleProjectSubtreeIds(executor, "workspace", "root"),
    ).resolves.toEqual(["root", "child"]);
  });

  it("returns an empty set when the root is absent or lifecycle-hidden", async () => {
    const { executor, execute } = executorReturning([]);

    await expect(
      loadVisibleProjectSubtreeIds(executor, "workspace", "hidden-root"),
    ).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("loads multiple requested roots in one statement and keeps each closure separate", async () => {
    const execute = vi.fn(async () => ({
      rows: [
        { root_id: "root-a", id: "root-a" },
        { root_id: "root-a", id: "child" },
        { root_id: "root-b", id: "root-b" },
        { root_id: "root-b", id: "child" },
      ],
    }));
    const executor = { execute } as unknown as Executor;

    await expect(
      loadVisibleProjectSubtrees(executor, "workspace", ["root-a", "root-b"]),
    ).resolves.toEqual(
      new Map([
        ["root-a", ["root-a", "child"]],
        ["root-b", ["root-b", "child"]],
      ]),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("short-circuits a batched request with no roots", async () => {
    const { executor, execute } = executorReturning([]);
    await expect(
      loadVisibleProjectSubtrees(executor, "workspace", []),
    ).resolves.toEqual(new Map());
    expect(execute).not.toHaveBeenCalled();
  });
});
