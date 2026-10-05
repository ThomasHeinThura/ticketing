import type { QueryClient } from "@tanstack/react-query";
import type Task from "@/types/task";

const versionsByClient = new WeakMap<QueryClient, Map<string, number>>();
type FieldUpdateState = {
  confirmedValue: unknown;
  confirmedVersion: number;
  pendingValues: Map<number, unknown>;
  readValue: (task: Task | undefined) => unknown;
  valuesEqual: (current: unknown, next: unknown) => boolean;
};

const fieldUpdatesByClient = new WeakMap<
  QueryClient,
  Map<string, FieldUpdateState>
>();

function fieldUpdateKey(taskId: string, field: string) {
  return `${taskId}:${field}`;
}

export function nextTaskFieldMutationVersion(
  queryClient: QueryClient,
  taskId: string,
  field: string,
) {
  let versions = versionsByClient.get(queryClient);
  if (!versions) {
    versions = new Map();
    versionsByClient.set(queryClient, versions);
  }
  const key = fieldUpdateKey(taskId, field);
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  return version;
}

export function beginOptimisticTaskFieldMutation(
  queryClient: QueryClient,
  taskId: string,
  field: string,
  value: unknown,
  readValue: (task: Task | undefined) => unknown,
  writeValue: (task: Task, value: unknown) => Task,
  valuesEqual: (current: unknown, next: unknown) => boolean = Object.is,
) {
  const version = nextTaskFieldMutationVersion(queryClient, taskId, field);
  let fieldUpdates = fieldUpdatesByClient.get(queryClient);
  if (!fieldUpdates) {
    fieldUpdates = new Map();
    fieldUpdatesByClient.set(queryClient, fieldUpdates);
  }

  const key = fieldUpdateKey(taskId, field);
  let state = fieldUpdates.get(key);
  if (!state) {
    state = {
      confirmedValue: readValue(
        queryClient.getQueryData<Task>(["task", taskId]),
      ),
      // Versions continue across settled batches. A new ledger starts after
      // the last completed write while retaining the currently cached baseline.
      confirmedVersion: version - 1,
      pendingValues: new Map(),
      readValue,
      valuesEqual,
    };
    fieldUpdates.set(key, state);
  }

  state.pendingValues.set(version, value);
  writeCurrentField(queryClient, taskId, state, writeValue);
  return version;
}

export function settleOptimisticTaskFieldMutation(
  queryClient: QueryClient,
  taskId: string,
  field: string,
  version: number,
  succeeded: boolean,
  writeValue: (task: Task, value: unknown) => Task,
) {
  const fieldUpdates = fieldUpdatesByClient.get(queryClient);
  const key = fieldUpdateKey(taskId, field);
  const state = fieldUpdates?.get(key);
  if (!state?.pendingValues.has(version)) return;

  const value = state.pendingValues.get(version);
  state.pendingValues.delete(version);
  if (succeeded && version > state.confirmedVersion) {
    state.confirmedValue = value;
    state.confirmedVersion = version;
  }

  writeCurrentField(queryClient, taskId, state, writeValue);
  if (state.pendingValues.size === 0) fieldUpdates?.delete(key);
}

function writeCurrentField(
  queryClient: QueryClient,
  taskId: string,
  state: FieldUpdateState,
  writeValue: (task: Task, value: unknown) => Task,
) {
  let value = state.confirmedValue;
  let newestVersion = state.confirmedVersion;
  for (const [version, pendingValue] of state.pendingValues) {
    if (version > newestVersion) {
      value = pendingValue;
      newestVersion = version;
    }
  }

  const queryKey = ["task", taskId];
  const current = queryClient.getQueryData<Task>(queryKey);
  if (!current || state.valuesEqual(state.readValue(current), value)) return;

  queryClient.setQueryData<Task>(queryKey, (latest) =>
    latest && !state.valuesEqual(state.readValue(latest), value)
      ? writeValue(latest, value)
      : latest,
  );
}
