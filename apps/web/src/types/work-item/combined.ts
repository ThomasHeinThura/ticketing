import type { WorkItemRow } from ".";

/** Explicit presentation column; its template ID is not a concrete project state ID. */
export type CombinedWorkItemColumn = {
  templateId: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  /** Minimum configured concrete-state position across visible scoped projects. */
  position: number;
};

/** Persisted work item plus the project and canonical template used by the combined board. */
export type CombinedWorkItemRow = WorkItemRow & {
  stateTemplateId: string;
  sourceProject: { id: string; key: string; name: string };
};
