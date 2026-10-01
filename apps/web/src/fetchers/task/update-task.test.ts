import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskUpdateError } from "@/lib/task-update-error";
import updateTask from "./update-task";

const mocks = vi.hoisted(() => ({ put: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { v2: { task: { ":id": { $put: mocks.put } } } },
}));

const staleTask = {
  id: "task-1",
  number: 1,
  projectId: "project-1",
  title: "Original title",
  description: "Original description",
  status: "to-do",
  priority: "medium",
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
};

describe("updateTask optimistic concurrency", () => {
  beforeEach(() => {
    mocks.put.mockReset();
  });

  it("sends the snapshot version and surfaces a concurrent-write conflict without replay", async () => {
    mocks.put
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: 2 }) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () =>
          '{"message":"Version mismatch","assertedVersion":1,"currentVersion":2}',
      });

    const firstWrite = updateTask(staleTask.id, staleTask);
    const concurrentWrite = updateTask(staleTask.id, staleTask);

    await expect(firstWrite).resolves.toMatchObject({ version: 2 });
    await expect(concurrentWrite).rejects.toMatchObject({
      status: 409,
      message: "Failed to update task",
    });
    expect(mocks.put).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.put.mock.calls) {
      expect(request).toMatchObject({
        header: { "if-match": '"1"' },
      });
    }
  });

  it("classifies transport failures for single-owner mutation feedback", async () => {
    mocks.put.mockRejectedValue(new TypeError("Network request failed"));

    const request = updateTask(staleTask.id, staleTask);
    await expect(request).rejects.toBeInstanceOf(TaskUpdateError);
    await expect(request).rejects.toMatchObject({
      name: "TaskUpdateError",
      status: 0,
      cause: expect.any(TypeError),
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });
});
