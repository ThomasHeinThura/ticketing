import type { ResolvedIdentity } from "@taskdesk/permissions";
import { describe, expect, it, vi } from "vitest";
import type { Executor } from "../../../apps/api/src/database/executor";
import { projectAncestryFor } from "../../../apps/api/src/utils/project-ancestry";

function fake(ids: string[]) {
  const execute = vi.fn(async () => ({ rows: ids.map((id) => ({ id })) }));
  return { executor: { execute } as unknown as Executor, execute };
}

const base = {
  memberships: [],
  authority: [],
  side: "staff" as const,
} satisfies Pick<ResolvedIdentity, "memberships" | "authority" | "side">;

describe("projectAncestryFor", () => {
  it("does not query for a caller with no project-scope rows", async () => {
    const { executor, execute } = fake(["p"]);
    await expect(
      projectAncestryFor(executor, base, "ws", "c"),
    ).resolves.toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("loads once per executor for a caller holding a row on another project", async () => {
    const { executor, execute } = fake(["p"]);
    const identity = {
      ...base,
      authority: [
        {
          roleKey: "r",
          scope: "project" as const,
          scopeId: "p",
          rank: 1,
          capabilities: [],
        },
      ],
    };
    await projectAncestryFor(executor, identity, "ws", "c");
    await projectAncestryFor(executor, identity, "ws", "c");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never loads for a customer", async () => {
    const { executor, execute } = fake(["p"]);
    await projectAncestryFor(
      executor,
      {
        ...base,
        side: "customer",
        memberships: [{ scope: "project", scopeId: "p", seesAll: false }],
      },
      "ws",
      "c",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
