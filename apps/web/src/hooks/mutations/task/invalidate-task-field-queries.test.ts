import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { invalidateTaskFieldQueries } from "./invalidate-task-field-queries";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
}

describe("invalidateTaskFieldQueries", () => {
  it("refreshes only affected project and relation projections while preserving notifications and activity", () => {
    const queryClient = makeQueryClient();
    const changedTask = { id: "task-1", status: "done", userId: "user-2" };
    queryClient.setQueryData(["tasks", "project-1"], []);
    queryClient.setQueryData(["notifications"], []);
    queryClient.setQueryData(["activities", "task-1"], []);
    queryClient.setQueryData(["activities", "task-2"], []);
    queryClient.setQueryData(
      ["task-relations", "task-1"],
      [{ sourceTask: changedTask, targetTask: { id: "task-3" } }],
    );
    queryClient.setQueryData(
      ["task-relations", "task-2"],
      [{ sourceTask: { id: "task-2" }, targetTask: changedTask }],
    );
    queryClient.setQueryData(
      ["task-relations", "task-3"],
      [{ sourceTask: { id: "task-3" }, targetTask: { id: "task-4" } }],
    );
    queryClient.setQueryData(
      ["projects", "workspace-1"],
      [
        { id: "project-1", statistics: { completionPercentage: 20 } },
        { id: "project-2", statistics: { completionPercentage: 50 } },
      ],
    );
    queryClient.setQueryData(
      ["projects", "workspace-2"],
      [{ id: "project-2", statistics: { completionPercentage: 50 } }],
    );
    queryClient.setQueryData(["projects", "workspace-1", "project-1"], {
      id: "project-1",
      tasks: [changedTask],
    });
    queryClient.setQueryData(["projects", "workspace-1", "project-2"], {
      id: "project-2",
      tasks: [],
    });

    invalidateTaskFieldQueries(queryClient, {
      projectId: "project-1",
      taskId: "task-1",
      projectStatisticsChanged: true,
    });

    expect(
      queryClient.getQueryState(["tasks", "project-1"])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["notifications"])?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(["activities", "task-1"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["activities", "task-2"])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["task-relations", "task-1"])?.isInvalidated,
    ).toBe(true);
    // The related-task projection is refreshed even though its query key names
    // the other endpoint of the relation.
    expect(
      queryClient.getQueryState(["task-relations", "task-2"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["task-relations", "task-3"])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["projects", "workspace-1"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["projects", "workspace-2"])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["projects", "workspace-1", "project-1"])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["projects", "workspace-1", "project-2"])
        ?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });

  it("does not invalidate project statistics for an assignee-only change", () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(
      ["projects", "workspace-1"],
      [{ id: "project-1", statistics: { completionPercentage: 20 } }],
    );
    queryClient.setQueryData(["projects", "workspace-1", "project-1"], {
      id: "project-1",
      tasks: [{ id: "task-1", userId: "user-1" }],
    });

    invalidateTaskFieldQueries(queryClient, {
      projectId: "project-1",
      taskId: "task-1",
      projectStatisticsChanged: false,
    });

    expect(
      queryClient.getQueryState(["projects", "workspace-1"])?.isInvalidated,
    ).toBe(false);
    expect(
      queryClient.getQueryState(["projects", "workspace-1", "project-1"])
        ?.isInvalidated,
    ).toBe(true);

    queryClient.clear();
  });

  it("cancels unknown in-flight reverse relations and project totals before invalidating", async () => {
    const queryClient = makeQueryClient();
    const startPendingQuery = (queryKey: string[]) => {
      let signal: AbortSignal | undefined;
      let resolve!: (value: unknown) => void;
      const promise = queryClient.fetchQuery({
        queryKey,
        queryFn: ({ signal: requestSignal }) => {
          signal = requestSignal;
          return new Promise<unknown>((complete) => {
            resolve = complete;
          });
        },
      });
      void promise.catch(() => undefined);
      return { signal: () => signal, resolve };
    };
    const relationKey = ["task-relations", "not-yet-loaded"];
    const projectsKey = ["projects", "workspace-not-yet-loaded"];
    const tasksKey = ["tasks", "project-1"];
    const notificationsKey = ["notifications"];
    const activityKey = ["activities", "task-1"];
    const relationRequest = startPendingQuery(relationKey);
    const projectRequest = startPendingQuery(projectsKey);
    const tasksRequest = startPendingQuery(tasksKey);
    const notificationsRequest = startPendingQuery(notificationsKey);
    const activityRequest = startPendingQuery(activityKey);

    invalidateTaskFieldQueries(queryClient, {
      projectId: "project-1",
      taskId: "task-1",
      projectStatisticsChanged: true,
    });

    await waitFor(() => {
      expect(relationRequest.signal()?.aborted).toBe(true);
      expect(projectRequest.signal()?.aborted).toBe(true);
      expect(tasksRequest.signal()?.aborted).toBe(true);
      expect(notificationsRequest.signal()?.aborted).toBe(true);
      expect(activityRequest.signal()?.aborted).toBe(true);
      expect(queryClient.getQueryState(relationKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(projectsKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(tasksKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(notificationsKey)?.isInvalidated).toBe(
        true,
      );
      expect(queryClient.getQueryState(activityKey)?.isInvalidated).toBe(true);
    });
    // A response already in flight before the mutation cannot restore stale
    // embedded task fields after the cancellation.
    relationRequest.resolve([
      { sourceTask: { id: "task-1", status: "backlog" } },
    ]);
    await Promise.resolve();
    expect(queryClient.getQueryData(relationKey)).toBeUndefined();

    queryClient.clear();
  });
});
