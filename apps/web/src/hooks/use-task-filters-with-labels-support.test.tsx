import { describe, expect, it } from "vitest";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import type Task from "@/types/task";

describe("filterProjectTasks", () => {
  const noFilters = {
    status: null,
    priority: null,
    assignee: null,
    dueDate: null,
    labels: null,
  };

  it("keeps all tasks when no filter or search is active", () => {
    const task = {
      id: "task-1",
      title: "Visible task",
      status: "todo",
    } as Task;

    const filtered = filterProjectTasks([task], {
      filters: noFilters,
      query: "  ",
      projectSlug: "PROJ",
      weekStartsOn: 1,
    });

    expect(filtered).toEqual([task]);
  });

  it("applies URL-derived label filters to project tasks", () => {
    const tasks: Task[] = [
      {
        id: "task-1",
        title: "Bug task",
        number: 1,
        description: null,
        status: "todo",
        priority: null,
        startDate: null,
        dueDate: null,
        position: 0,
        version: 1,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        userId: null,
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: "project-1",
        labels: [
          {
            id: "label-bug",
            name: "bug",
            color: "red",
          },
        ],
        externalLinks: [],
      },
      {
        id: "task-2",
        title: "Other task",
        number: 2,
        description: null,
        status: "todo",
        priority: null,
        startDate: null,
        dueDate: null,
        position: 1,
        version: 1,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        userId: null,
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: "project-1",
        labels: [],
        externalLinks: [],
      },
    ];

    const filtered = filterProjectTasks(tasks, {
      filters: { ...noFilters, labels: ["label-bug"] },
      projectSlug: "PROJ",
      weekStartsOn: 1,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("task-1");
  });

  it.each(["#123", "proj-123", "proj-"])(
    "matches a task by its issue identifier when searching for %s",
    (textQuery) => {
      const tasks: Task[] = [
        {
          id: "task-123",
          title: "Unrelated title",
          number: 123,
          description: null,
          status: "todo",
          priority: null,
          startDate: null,
          dueDate: null,
          position: 0,
          version: 1,
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          userId: null,
          assigneeId: null,
          assigneeName: null,
          assigneeImage: null,
          projectId: "project-1",
          labels: [],
          externalLinks: [],
        },
        {
          id: "task-without-number",
          title: "Another unrelated title",
          number: null,
          description: null,
          status: "todo",
          priority: null,
          startDate: null,
          dueDate: null,
          position: 1,
          version: 1,
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:00:00.000Z",
          userId: null,
          assigneeId: null,
          assigneeName: null,
          assigneeImage: null,
          projectId: "project-1",
          labels: [],
          externalLinks: [],
        },
      ];

      const filtered = filterProjectTasks(tasks, {
        filters: noFilters,
        query: textQuery,
        projectSlug: "PROJ",
        weekStartsOn: 1,
      });

      expect(filtered).toEqual([expect.objectContaining({ id: "task-123" })]);
    },
  );
});
