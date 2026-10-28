import { describe, expect, it } from "vitest";
import {
  assertNoLiveChildProjects,
  PROJECT_HAS_CHILDREN_MESSAGE,
} from "../../../apps/api/src/project/project-children";

/** Minimal stand-in for the drizzle select chain `listLiveChildProjectIds` uses. */
function executorReturning(rows: Array<{ id: string }>) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy"]) {
    chain[method] = () => chain;
  }
  chain.limit = async () => rows;
  return chain as never;
}

describe("assertNoLiveChildProjects (P1-5)", () => {
  it("refuses with 409 and a clear message while a live child project exists", async () => {
    await expect(
      assertNoLiveChildProjects(
        executorReturning([{ id: "child" }]),
        "ws",
        "parent",
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: PROJECT_HAS_CHILDREN_MESSAGE,
    });
    expect(PROJECT_HAS_CHILDREN_MESSAGE).toContain("project_has_live_children");
  });

  it("passes for a leaf project", async () => {
    await expect(
      assertNoLiveChildProjects(executorReturning([]), "ws", "leaf"),
    ).resolves.toBeUndefined();
  });
});
