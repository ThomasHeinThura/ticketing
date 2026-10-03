import type { QueryClient } from "@tanstack/react-query";

const versionsByClient = new WeakMap<QueryClient, Map<string, number>>();

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
  const key = `${taskId}:${field}`;
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);
  return version;
}

export function isCurrentTaskFieldMutationVersion(
  queryClient: QueryClient,
  taskId: string,
  field: string,
  version: number,
) {
  return (
    versionsByClient.get(queryClient)?.get(`${taskId}:${field}`) === version
  );
}
