import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  listProjects: vi.fn(),
  listItems: vi.fn(),
  lockItem: vi.fn(),
  lockProject: vi.fn(),
  release: vi.fn(),
  deleteItem: vi.fn(),
  deleteTree: vi.fn(),
  retained: vi.fn(),
  detach: vi.fn(),
  readProject: vi.fn(),
  lockHierarchy: vi.fn(),
}));
const LOCKED = { id: "wi", projectId: "p-0" };

/** Behaves like the repository: pages past ids the run already attempted. */
function paged(ids: string[]) {
  return async (_executor: unknown, limit: number, exclude: string[] = []) =>
    ids.filter((id) => !exclude.includes(id)).slice(0, limit);
}
vi.mock("../../../apps/api/src/database", () => ({
  default: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ tx: true }),
    ),
  },
}));
vi.mock("../../../apps/api/src/scheduler/soft-delete-purge.repository", () => ({
  fenceLegalHolds: vi.fn(async () => {
    m.calls.push("fence");
  }),
  listProjectPurgeCandidates: m.listProjects,
  listWorkItemPurgeCandidates: m.listItems,
  lockEligibleWorkItem: m.lockItem,
  lockEligibleProject: m.lockProject,
  readWorkItemProjectId: m.readProject,
  releaseAttachmentsForPurge: m.release,
  deleteWorkItemRow: m.deleteItem,
  deleteProjectTree: m.deleteTree,
  countRowsRetainedBySharedObject: m.retained,
}));

vi.mock("../../../apps/api/src/scheduler/soft-delete-purge-detach", () => ({
  detachChildrenForPurge: m.detach,
  lockWorkItemHierarchyForProject: m.lockHierarchy,
}));

import {
  purgeSoftDeletedProject,
  purgeSoftDeletedRows,
  purgeSoftDeletedWorkItem,
} from "../../../apps/api/src/scheduler/soft-delete-purge";

beforeEach(() => {
  m.calls.length = 0;
  for (const fn of [
    m.listProjects,
    m.listItems,
    m.lockItem,
    m.lockProject,
    m.release,
    m.deleteItem,
    m.deleteTree,
    m.retained,
    m.detach,
    m.readProject,
    m.lockHierarchy,
  ])
    fn.mockReset();
  m.readProject.mockResolvedValue(LOCKED.projectId);
  m.lockHierarchy.mockImplementation(async () => {
    m.calls.push("hierarchy-lock");
  });
  m.detach.mockImplementation(async () => {
    m.calls.push("detach");
    return 0;
  });
  m.retained.mockResolvedValue({ workItems: 0, projects: 0 });
  m.listProjects.mockImplementation(paged([]));
  m.listItems.mockImplementation(paged([]));
  m.lockItem.mockImplementation(async () => {
    m.calls.push("lock");
    return LOCKED;
  });
  m.lockProject.mockResolvedValue(true);
  m.release.mockResolvedValue(0);
  m.deleteItem.mockImplementation(async () => {
    m.calls.push("delete");
    return 1;
  });
  m.deleteTree.mockResolvedValue({ workItemsDeleted: 4, projectsDeleted: 1 });
});

describe("work item purge eligibility under lock", () => {
  it("fences legal holds before re-checking eligibility and only then deletes", async () => {
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe("purged");
    expect(m.calls).toEqual([
      "fence",
      "hierarchy-lock",
      "lock",
      "detach",
      "delete",
    ]);
  });

  it("detaches children (P1-23) after the row lock and before deleting the parent, in the same transaction", async () => {
    m.detach.mockImplementation(async () => {
      m.calls.push("detach");
      return 2;
    });
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe("purged");
    expect(m.detach).toHaveBeenCalledWith({ tx: true }, LOCKED);
    expect(m.calls.indexOf("detach")).toBeGreaterThan(m.calls.indexOf("lock"));
    expect(m.calls.indexOf("detach")).toBeLessThan(m.calls.indexOf("delete"));
  });

  it("takes the hierarchy advisory lock before the row lock (Q10 lock order)", async () => {
    await purgeSoftDeletedWorkItem("wi-1");
    expect(m.calls.indexOf("hierarchy-lock")).toBeLessThan(
      m.calls.indexOf("lock"),
    );
    expect(m.lockHierarchy).toHaveBeenCalledWith({ tx: true }, "p-0");
  });

  it("leaves a row that moved project between the unlocked read and the row lock", async () => {
    m.readProject.mockResolvedValue("p-other");
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe(
      "no_longer_eligible",
    );
    expect(m.deleteItem).not.toHaveBeenCalled();
  });

  it("does not detach children of a row that is still waiting for attachments", async () => {
    m.release.mockResolvedValue(1);
    await purgeSoftDeletedWorkItem("wi-1");
    expect(m.detach).not.toHaveBeenCalled();
  });

  it("leaves a row that became held, restored since the scan", async () => {
    m.lockItem.mockResolvedValue(null);
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe(
      "no_longer_eligible",
    );
    expect(m.release).not.toHaveBeenCalled();
    expect(m.deleteItem).not.toHaveBeenCalled();
  });

  it("hands attachments to attachment-gc and waits for them before deleting the row", async () => {
    m.release.mockResolvedValue(2);
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe(
      "awaiting_attachments",
    );
    expect(m.release).toHaveBeenCalledWith(expect.anything(), {
      workItemId: "wi-1",
    });
    expect(m.deleteItem).not.toHaveBeenCalled();
  });

  it("is idempotent: a row already gone reports no_longer_eligible", async () => {
    m.deleteItem.mockResolvedValue(0);
    await expect(purgeSoftDeletedWorkItem("wi-1")).resolves.toBe(
      "no_longer_eligible",
    );
  });
});

describe("project purge", () => {
  it("purges the project tree once its attachments are gone", async () => {
    await expect(purgeSoftDeletedProject("p-1")).resolves.toEqual({
      result: "purged",
      workItemsDeleted: 4,
    });
    expect(m.release).toHaveBeenCalledWith(expect.anything(), {
      projectId: "p-1",
    });
  });

  it("waits for attachments and skips held/restored projects", async () => {
    m.release.mockResolvedValueOnce(1);
    await expect(purgeSoftDeletedProject("p-1")).resolves.toMatchObject({
      result: "awaiting_attachments",
    });
    m.lockProject.mockResolvedValueOnce(false);
    await expect(purgeSoftDeletedProject("p-1")).resolves.toMatchObject({
      result: "no_longer_eligible",
    });
    expect(m.deleteTree).not.toHaveBeenCalled();
  });
});

describe("batch run", () => {
  it("purges projects before work items and tallies every outcome", async () => {
    m.listProjects.mockImplementation(paged(["p-1"]));
    m.listItems.mockImplementation(paged(["wi-1", "wi-2", "wi-3"]));
    m.lockItem
      .mockResolvedValueOnce(LOCKED)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LOCKED);
    m.release
      .mockResolvedValueOnce(0) // project
      .mockResolvedValueOnce(0) // wi-1
      .mockResolvedValueOnce(5); // wi-3
    await expect(purgeSoftDeletedRows()).resolves.toEqual({
      projectsPurged: 1,
      workItemsPurged: 5,
      awaitingAttachments: 1,
      skipped: 1,
      failed: 0,
      permanentlyRetained: 0,
      budgetExhausted: false,
      degraded: false,
    });
  });

  it("continues past a failing row and marks the run degraded", async () => {
    m.listItems.mockImplementation(paged(["wi-1", "wi-2"]));
    m.deleteItem
      .mockRejectedValueOnce(new Error("23503 restrict"))
      .mockResolvedValueOnce(1);
    await expect(purgeSoftDeletedRows()).resolves.toMatchObject({
      workItemsPurged: 1,
      failed: 1,
      degraded: true,
    });
  });
});

describe("budgeted drain (F9)", () => {
  it("purges more than one page per run", async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `wi-${i}`);
    m.listItems.mockImplementation(paged(ids));
    const outcome = await purgeSoftDeletedRows();
    expect(outcome.workItemsPurged).toBe(130);
    expect(outcome.budgetExhausted).toBe(false);
  });

  it("pages past rows still awaiting attachments instead of stalling on them", async () => {
    const stuck = Array.from({ length: 60 }, (_, i) => `stuck-${i}`);
    const clean = ["ok-1", "ok-2"];
    m.listItems.mockImplementation(paged([...stuck, ...clean]));
    m.release.mockImplementation(
      async (_tx: unknown, scope: { workItemId: string }) =>
        scope.workItemId.startsWith("stuck") ? 1 : 0,
    );
    const outcome = await purgeSoftDeletedRows();
    expect(outcome.awaitingAttachments).toBe(60);
    expect(outcome.workItemsPurged).toBe(2);
  });

  it("stops at the row budget and reports it while candidates remain", async () => {
    m.listItems.mockImplementation(paged(["a", "b", "c", "d"]));
    const outcome = await purgeSoftDeletedRows({ batch: 2, maxRows: 3 });
    expect(outcome.workItemsPurged).toBe(3);
    expect(outcome.budgetExhausted).toBe(true);
    expect(outcome.degraded).toBe(false);
  });

  it("stops at the time budget", async () => {
    let clock = 0;
    m.listItems.mockImplementation(paged(["a", "b", "c"]));
    m.deleteItem.mockImplementation(async () => {
      clock += 100;
      return 1;
    });
    const outcome = await purgeSoftDeletedRows({
      batch: 1,
      timeBudgetMs: 150,
      now: () => clock,
    });
    expect(outcome.workItemsPurged).toBe(2);
    expect(outcome.budgetExhausted).toBe(true);
  });

  it("reports rows pinned by a shared stored object as a degraded run", async () => {
    m.retained.mockResolvedValue({ workItems: 2, projects: 1 });
    const outcome = await purgeSoftDeletedRows();
    expect(outcome.permanentlyRetained).toBe(3);
    expect(outcome.degraded).toBe(true);
  });
});
