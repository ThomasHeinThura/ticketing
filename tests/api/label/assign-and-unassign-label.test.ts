import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirst = vi.fn();
const mockSelect = vi.fn();
const mockTxSelect = vi.fn();
const mockTxExecute = vi.fn(async (..._args: unknown[]) => ({ rows: [] }));
const mockDelete = vi.fn();
const mockInsert = vi.fn();
const mockPublishEvent = vi.fn();

function createMockTxContext() {
  return {
    execute: (...args: unknown[]) => mockTxExecute(...args),
    select: (...args: unknown[]) => mockTxSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    query: {
      labelTable: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  };
}

const mockTransaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb(createMockTxContext()),
);

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    query: {
      labelTable: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    transaction: (cb: (tx: unknown) => unknown) => mockTransaction(cb),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import assignLabelToTask from "../../../apps/api/src/label/controllers/assign-label-to-task";
import unassignLabelFromTask from "../../../apps/api/src/label/controllers/unassign-label-from-task";

const WORKSPACE_LABEL = {
  id: "label-ws-1",
  name: "bug",
  color: "EF4444",
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: null,
  workspaceId: "ws-1",
};

const TASK_LABEL = {
  id: "label-task-1",
  name: "bug",
  color: "EF4444",
  createdAt: new Date(),
  updatedAt: new Date(),
  taskId: "task-1",
  workspaceId: "ws-1",
};

const TASK = {
  id: "task-1",
  projectId: "proj-1",
  workspaceId: "ws-1",
};

const LIVE_PROJECT = {
  id: "proj-1",
  workspaceId: "ws-1",
  deletedAt: null,
  archivedAt: null,
};

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

function makeDeleteMock(deletedRow: unknown) {
  const whereResult = Object.assign(Promise.resolve(undefined), {
    returning: vi.fn(() => Promise.resolve([deletedRow])),
  });
  return {
    where: vi.fn(() => whereResult),
  };
}

function makeInsertMock(insertedRow: unknown) {
  const onConflictResult = Object.assign(Promise.resolve(undefined), {
    returning: vi.fn(() => Promise.resolve([insertedRow])),
  });
  const onConflict = vi.fn(() => onConflictResult);
  const values = vi.fn(() => ({ onConflictDoNothing: onConflict }));
  return { values, onConflict };
}

describe("unassignLabelFromTask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTxExecute.mockImplementation(async (..._args: unknown[]) => ({
      rows: [],
    }));
    mockTxSelect.mockImplementation(() => makeSelectMock([]));
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(createMockTxContext()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the task assignment instead of nulling taskId", async () => {
    mockFindFirst.mockResolvedValue(TASK_LABEL);
    queueTxSelectRows([TASK_LABEL], [TASK], [LIVE_PROJECT], [TASK_LABEL]);
    mockDelete.mockReturnValue(makeDeleteMock(TASK_LABEL));

    await unassignLabelFromTask("label-task-1", "user-1");

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledWith("task.label_unassigned", {
      label: TASK_LABEL,
      task: { id: TASK.id, projectId: TASK.projectId },
      projectId: TASK.projectId,
      taskId: TASK_LABEL.taskId,
      userId: "user-1",
      type: "label_unassigned",
    });
  });

  it("rejects when the label is a workspace definition (taskId is null)", async () => {
    mockFindFirst.mockResolvedValue(WORKSPACE_LABEL);
    queueTxSelectRows([WORKSPACE_LABEL]);

    await expect(
      unassignLabelFromTask("label-ws-1", "user-1"),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });
});

describe("assignLabelToTask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTxExecute.mockImplementation(async (..._args: unknown[]) => ({
      rows: [],
    }));
    mockTxSelect.mockImplementation(() => makeSelectMock([]));
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(createMockTxContext()),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a task-level copy without mutating the workspace definition", async () => {
    mockFindFirst.mockResolvedValue(WORKSPACE_LABEL);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows(
      [WORKSPACE_LABEL],
      [TASK],
      [LIVE_PROJECT],
      [LIVE_PROJECT],
    );
    const insertedCopy = { ...TASK_LABEL, id: "label-task-2" };
    const insertChain = makeInsertMock(insertedCopy);
    mockInsert.mockReturnValue(insertChain);

    const result = await assignLabelToTask("label-ws-1", "task-1", "user-1");

    expect(result).toEqual(insertedCopy);
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(insertChain.onConflict).toHaveBeenCalledWith({
      target: [expect.anything(), expect.anything()],
    });
    expect(mockPublishEvent).toHaveBeenCalledWith("task.label_assigned", {
      label: insertedCopy,
      task: TASK,
      projectId: TASK.projectId,
      taskId: TASK.id,
      userId: "user-1",
      type: "label_assigned",
    });
  });

  it("is idempotent when the same label is already attached to the same task", async () => {
    mockFindFirst.mockResolvedValueOnce({ ...TASK_LABEL, taskId: "task-1" });
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows(
      [TASK],
      [TASK],
      [TASK_LABEL],
      [LIVE_PROJECT],
      [LIVE_PROJECT],
    );

    const result = await assignLabelToTask("label-task-1", "task-1", "user-1");

    expect(result).toEqual({ ...TASK_LABEL, taskId: "task-1" });
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("removes the stale task copy when moving the label to a different task", async () => {
    const stale = { ...TASK_LABEL, taskId: "task-old" };
    mockFindFirst.mockResolvedValue(stale);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    const oldTask = { ...TASK, id: "task-old", projectId: "proj-old" };
    const oldProject = { ...LIVE_PROJECT, id: "proj-old" };
    queueTxSelectRows(
      [TASK],
      [oldTask],
      [stale],
      [LIVE_PROJECT],
      [oldProject],
      [LIVE_PROJECT, oldProject],
    );
    mockDelete.mockReturnValue(makeDeleteMock(stale));
    const insertedCopy = { ...TASK_LABEL, id: "label-task-2" };
    const insertChain = makeInsertMock(insertedCopy);
    mockInsert.mockReturnValue(insertChain);

    await assignLabelToTask("label-task-1", "task-1", "user-1");
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledWith(
      "task.label_assigned",
      expect.objectContaining({
        taskId: "task-1",
      }),
    );
  });

  it("is idempotent when the workspace label is re-attached to the same task", async () => {
    mockFindFirst.mockResolvedValueOnce(WORKSPACE_LABEL);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows(
      [WORKSPACE_LABEL],
      [TASK],
      [LIVE_PROJECT],
      [LIVE_PROJECT],
    );
    const insertChain = makeInsertMock(undefined);
    mockInsert.mockReturnValue(insertChain);
    mockFindFirst.mockResolvedValueOnce(TASK_LABEL);

    const result = await assignLabelToTask("label-ws-1", "task-1", "user-1");

    expect(result).toEqual(TASK_LABEL);
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("falls back to the existing task label when the workspace insert returns no row", async () => {
    mockFindFirst.mockResolvedValueOnce(WORKSPACE_LABEL);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows(
      [WORKSPACE_LABEL],
      [TASK],
      [LIVE_PROJECT],
      [LIVE_PROJECT],
    );
    const insertChain = makeInsertMock(undefined);
    mockInsert.mockReturnValue(insertChain);
    mockFindFirst.mockResolvedValueOnce(WORKSPACE_LABEL);

    await assignLabelToTask("label-ws-1", "task-1", "user-1");

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockFindFirst).toHaveBeenCalledTimes(2);
  });

  it("throws HTTP 500 when the insert and fallback lookup both return no row", async () => {
    mockFindFirst.mockResolvedValueOnce(WORKSPACE_LABEL);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows(
      [WORKSPACE_LABEL],
      [TASK],
      [LIVE_PROJECT],
      [LIVE_PROJECT],
    );
    const insertChain = makeInsertMock(undefined);
    mockInsert.mockReturnValue(insertChain);
    mockFindFirst.mockResolvedValueOnce(undefined);

    await expect(
      assignLabelToTask("label-ws-1", "task-1", "user-1"),
    ).rejects.toMatchObject({
      status: 500,
    });
    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("throws HTTP 404 when the label is removed before the transaction begins", async () => {
    mockFindFirst.mockResolvedValueOnce(WORKSPACE_LABEL);
    mockSelect.mockReturnValue(makeSelectMock([TASK]));
    queueTxSelectRows([undefined]);

    await expect(
      assignLabelToTask("label-ws-1", "task-1", "user-1"),
    ).rejects.toMatchObject({
      status: 404,
    });

    expect(mockTxExecute).toHaveBeenCalledTimes(1);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
