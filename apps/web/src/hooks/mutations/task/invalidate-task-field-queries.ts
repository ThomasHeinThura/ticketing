import {
  notifyManager,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";

type TaskRelation = {
  sourceTask?: { id?: unknown } | null;
  targetTask?: { id?: unknown } | null;
};

function isTaskRelation(value: unknown): value is TaskRelation {
  return typeof value === "object" && value !== null;
}

function relationProjectionContainsTask(data: unknown, taskId: string) {
  return (
    Array.isArray(data) &&
    data.some(
      (relation) =>
        isTaskRelation(relation) &&
        (relation.sourceTask?.id === taskId ||
          relation.targetTask?.id === taskId),
    )
  );
}

function projectQueryContainsProject(query: Query, projectId: string) {
  const thirdKey = query.queryKey[2];
  if (thirdKey === projectId) return true;

  // A workspace project list may still be loading when the status mutation
  // commits; its response could otherwise publish the old completion totals.
  if (query.queryKey.length === 2 && query.state.fetchStatus === "fetching")
    return true;

  const projects = query.state.data;
  return (
    Array.isArray(projects) &&
    projects.some(
      (project) =>
        typeof project === "object" &&
        project !== null &&
        "id" in project &&
        project.id === projectId,
    )
  );
}

function matchesTaskRelations(query: Query, taskId: string) {
  if (query.queryKey[0] !== "task-relations") return false;

  // A relation query is keyed by its subject, but its rows also embed the
  // related task. A cache for task A can therefore contain the changed task B.
  if (query.queryKey[1] === taskId) return true;

  // A request that began before the mutation may be carrying an older embedded
  // projection. Its result is unknown until it completes, so cancel and refetch
  // in-flight relation queries rather than leaving a potentially stale sibling.
  if (query.state.fetchStatus === "fetching") return true;

  return relationProjectionContainsTask(query.state.data, taskId);
}

/**
 * Refresh only the cache projections that can contain the task field just
 * changed. Notifications, activity, task collections and reverse relation
 * projections remain fresh without invalidating every project/relation query.
 */
export function invalidateTaskFieldQueries(
  queryClient: QueryClient,
  input: {
    projectId: string;
    taskId: string;
    projectStatisticsChanged: boolean;
  },
) {
  const relationFilter = {
    predicate: (query: Query) => matchesTaskRelations(query, input.taskId),
  };
  const relationHashes = new Set(
    queryClient
      .getQueryCache()
      .findAll(relationFilter)
      .map((query) => query.queryHash),
  );
  const relatedProjectionFilter = {
    predicate: (query: Query) => relationHashes.has(query.queryHash),
  };
  const projectSelectionFilter = {
    predicate: (query: Query) =>
      query.queryKey[0] === "projects" &&
      (query.queryKey[2] === input.projectId ||
        (input.projectStatisticsChanged &&
          projectQueryContainsProject(query, input.projectId))),
  };
  const projectHashes = new Set(
    queryClient
      .getQueryCache()
      .findAll(projectSelectionFilter)
      .map((query) => query.queryHash),
  );
  const projectProjectionFilter = {
    predicate: (query: Query) => projectHashes.has(query.queryHash),
  };
  const invalidationFilters = [
    { queryKey: ["tasks", input.projectId] },
    { queryKey: ["notifications"] },
    { queryKey: ["activities", input.taskId] },
    relatedProjectionFilter,
    projectProjectionFilter,
  ];

  const matchesAffectedQuery = (query: Query) =>
    invalidationFilters.some((filter) =>
      "predicate" in filter
        ? filter.predicate(query)
        : filter.queryKey.every(
            (keyPart, index) => query.queryKey[index] === keyPart,
          ),
    );
  const inFlightQueryHashes = new Set(
    queryClient
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.state.fetchStatus === "fetching" && matchesAffectedQuery(query),
      )
      .map((query) => query.queryHash),
  );

  const invalidate = () => {
    notifyManager.batch(() => {
      for (const filter of invalidationFilters)
        void queryClient.invalidateQueries(filter);
    });
  };

  if (inFlightQueryHashes.size > 0) {
    // cancelQueries aborts requests synchronously; chaining invalidation after
    // its settled promise ensures active observers start fresh reads.
    void queryClient
      .cancelQueries({
        predicate: (query) => inFlightQueryHashes.has(query.queryHash),
      })
      .then(invalidate);
    return;
  }

  invalidate();
}
