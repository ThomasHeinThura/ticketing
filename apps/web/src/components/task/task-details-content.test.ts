import { describe, expect, it } from "vitest";
import type Task from "@/types/task";
import { selectTaskDetailsSummary } from "./task-details-content";

const task: Task = {
  id: "task-1",
  title: "Visible title",
  number: 1,
  description: "Visible description",
  status: "backlog",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
};

describe("task detail query selection", () => {
  it("subscribes only to fields rendered by the content header", () => {
    expect(selectTaskDetailsSummary(task)).toEqual({
      number: 1,
      title: "Visible title",
      description: "Visible description",
    });
  });
});
