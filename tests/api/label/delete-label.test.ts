import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

const mockFindFirst = vi.fn();
const mockTxSelect = vi.fn();
const mockDelete = vi.fn();
const mockPublishEvent = vi.fn();
const mockTransaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb(createMockTxContext()),
);

function createMockTxContext() {
  return {
    select: (...args: unknown[]) => mockTxSelect(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  };
}

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    query: {
      labelTable: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import deleteLabel from "../../../apps/api/src/label/controllers/delete-label";

const WORKSPACE_LABEL = {
  id: "label-ws-1",
  name: "bug",
  color: "EF4444",
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: null,
  workspaceId: "ws-1",
};

const DELETED_WORKSPACE_LABEL = { ...WORKSPACE_LABEL };

const TASK_LABEL_1 = {
  id: "label-task-1",
  name: "bug",
  color: "EF4444",
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: "task-1",
  workspaceId: "ws-1",
};

const TASK_LABEL_2 = {
  id: "label-task-2",
  name: "bug",
  color: "EF4444",
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: "task-2",
  workspaceId: "ws-1",
};

const TASK_1 = { id: "task-1", projectId: "proj-1" };
const TASK_2 = { id: "task-2", projectId: "proj-2" };
const LIVE_PROJECT_1 = {
  id: "proj-1",
  deletedAt: null,
  archivedAt: null,
};
const LIVE_PROJECT_2 = {
  id: "proj-2",
  deletedAt: null,
  archivedAt: null,
};

/**
 * Build a thenable mock chain for transaction-scoped select queries.
 * `.for()` and awaiting `.where()` both resolve to `rows`.
 */
function makeSelectMock(rows: unknown[]) {
  const result = Promise.resolve(rows);
  const chain = Object.assign(result, {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => result),
    for: vi.fn(() => result),
  });
  return chain;
}

function queueTxSelectRows(...rows: unknown[][]) {
  for (const result of rows) {
    mockTxSelect.mockReturnValueOnce(makeSelectMock(result));
  }
}

/**
 * Build a mock chain for `db.delete().where().returning()` and
 * `db.delete().where()` (no returning).
 *
 * - `.where()` returns a sub-chain that supports `.returning()` and is thenable.
 */
function makeDeleteMock(deletedRow: unknown) {
  const chain: Record<string, Mock> = {};

  // Sub-chain returned by .where():
  // - Native Promise.then so `await db.delete().where(...)` works
  // - .returning() attached for the returning-delete path
  const whereResult = Object.assign(Promise.resolve(undefined), {
    returning: vi.fn(() => Promise.resolve([deletedRow])),
  });

  chain.where = vi.fn(() => whereResult);

  return chain;
}

describe("deleteLabel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTxSelect.mockImplementation(() => makeSelectMock([]));
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(createMockTxContext()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("workspace-level label deletion (taskId is null)", () => {
    it("emits task.label_deleted events for each affected task-level label", async () => {
      mockFindFirst.mockResolvedValue(WORKSPACE_LABEL);
      queueTxSelectRows(
        [WORKSPACE_LABEL],
        [
          {
            label: TASK_LABEL_1,
            taskId: "task-1",
            projectId: "proj-1",
            workspaceId: "ws-1",
          },
          {
            label: TASK_LABEL_2,
            taskId: "task-2",
            projectId: "proj-2",
            workspaceId: "ws-1",
          },
        ],
        [TASK_1],
        [TASK_2],
        [LIVE_PROJECT_1],
        [LIVE_PROJECT_2],
      );
      mockDelete.mockReturnValue(makeDeleteMock(DELETED_WORKSPACE_LABEL));

      await deleteLabel("label-ws-1", "user-1");

      expect(mockPublishEvent).toHaveBeenCalledTimes(2);
      expect(mockPublishEvent).toHaveBeenCalledWith("task.label_deleted", {
        label: TASK_LABEL_1,
        task: { id: "task-1", projectId: "proj-1" },
        projectId: "proj-1",
        taskId: "task-1",
        userId: "user-1",
        type: "label_deleted",
      });
      expect(mockPublishEvent).toHaveBeenCalledWith("task.label_deleted", {
        label: TASK_LABEL_2,
        task: { id: "task-2", projectId: "proj-2" },
        projectId: "proj-2",
        taskId: "task-2",
        userId: "user-1",
        type: "label_deleted",
      });
    });

    it("fires no events when no task-level labels are affected", async () => {
      mockFindFirst.mockResolvedValue(WORKSPACE_LABEL);
      queueTxSelectRows([WORKSPACE_LABEL], []);
      mockDelete.mockReturnValue(makeDeleteMock(DELETED_WORKSPACE_LABEL));

      await deleteLabel("label-ws-1", "user-1");

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });
  });
});
