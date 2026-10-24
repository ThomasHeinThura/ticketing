/**
 * What a reader may see of a workspace rule's activity. A workspace rule spans projects and is
 * readable by anyone holding `workspace:manage_settings`, which is not reach: run history and the
 * dry-run's examples name work items, so each row is shown only for a project the reader reaches
 * (the same rule `WH-6` applies to webhook payloads). An event with no project is shown only to a
 * reader who sees everything.
 */
export type ReaderVisibility = {
  projectIds: ReadonlySet<string>;
  everything: boolean;
};

export function isVisibleTo(
  visibility: ReaderVisibility,
  projectId: string | null,
): boolean {
  if (visibility.everything) return true;
  return projectId !== null && visibility.projectIds.has(projectId);
}
