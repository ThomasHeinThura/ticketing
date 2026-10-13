import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useTaskFiltersWithLabelsSupport } from "./use-task-filters-with-labels-support";

describe("useTaskFiltersWithLabelsSupport", () => {
  const noFilters = {
    status: null,
    priority: null,
    assignee: null,
    dueDate: null,
    labels: null,
  };

  it("reuses the complete project when no filter or search is active", () => {
    const task = {
      id: "task-1",
      title: "Visible task",
    } as Task;
    const project = {
      id: "project-1",
      name: "Project",
      slug: "PROJ",
      icon: null,
      description: null,
      workspaceId: "workspace-1",
      columns: [
        {
          id: "todo",
          slug: "todo",
          name: "Todo",
          icon: null,
          isFinal: false,
          tasks: [task],
        },
      ],
      plannedTasks: [],
      archivedTasks: [],
    } as ProjectWithTasks;

    const { result } = renderHook(() =>
      useTaskFiltersWithLabelsSupport(project, noFilters, "  ", vi.fn()),
    );

    expect(result.current.filteredProject).toBe(project);
    expect(result.current.filteredProject?.columns[0]?.tasks).toBe(
      project.columns[0]?.tasks,
    );
  });

  it("applies URL-derived label filters to project tasks", () => {
    const project = {
      id: "project-1",
      name: "Project",
      slug: "PROJ",
      icon: null,
      description: null,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z",
      workspaceId: "workspace-1",
      columns: [
        {
          id: "todo",
          slug: "todo",
          name: "Todo",
          icon: null,
          isFinal: false,
          tasks: [
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
          ],
        },
      ],
      plannedTasks: [],
      archivedTasks: [],
    };

    const filters = { ...noFilters, labels: ["label-bug"] };
    const { result } = renderHook(() =>
      useTaskFiltersWithLabelsSupport(project, filters, undefined, vi.fn()),
    );

    expect(result.current.filters.labels).toEqual(["label-bug"]);

    expect(result.current.filteredProject?.columns[0]?.tasks).toHaveLength(1);
    expect(result.current.filteredProject?.columns[0]?.tasks[0]?.id).toBe(
      "task-1",
    );
  });

  it.each(["#123", "proj-123", "proj-"])(
    "matches a task by its issue identifier when searching for %s",
    (textQuery) => {
      const project = {
        id: "project-1",
        name: "Project",
        slug: "PROJ",
        icon: null,
        description: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z",
        workspaceId: "workspace-1",
        columns: [
          {
            id: "todo",
            slug: "todo",
            name: "Todo",
            icon: null,
            isFinal: false,
            tasks: [
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
            ],
          },
        ],
        plannedTasks: [],
        archivedTasks: [],
      };

      const { result } = renderHook(() =>
        useTaskFiltersWithLabelsSupport(project, noFilters, textQuery, vi.fn()),
      );

      expect(result.current.filteredProject?.columns[0]?.tasks).toEqual([
        expect.objectContaining({ id: "task-123" }),
      ]);
    },
  );
});
