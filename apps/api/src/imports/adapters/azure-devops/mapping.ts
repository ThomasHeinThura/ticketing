/**
 * Azure DevOps mapping tables (pure). Proposals only: the engine never executes an unconfirmed
 * entry, and nothing here guesses a value it does not know.
 *
 * State facet values are namespaced by process (`Agile/Resolved`) because mapping entries are keyed
 * by (domain, value) and the contract says each process maps separately.
 */
import type { StateGroup } from "../../engine/adapter";

export const ADO_PROCESSES = ["Agile", "Scrum", "CMMI", "Basic"] as const;
export type AdoProcess = (typeof ADO_PROCESSES)[number];

/**
 * `null` means "requires an explicit human choice, no proposal". `Resolved` is deliberately null:
 * some teams use it for "fixed, awaiting verification" (`started`), others for done (`completed`),
 * and a proposal would be accepted by a one-click confirm-all.
 */
export const ADO_STATE_PROPOSALS: Record<
  AdoProcess,
  Record<string, StateGroup | null>
> = {
  Agile: {
    New: "unstarted",
    Active: "started",
    Resolved: null,
    Closed: "completed",
    Removed: "cancelled",
  },
  Scrum: {
    New: "unstarted",
    "To Do": "unstarted",
    Approved: "started",
    Committed: "started",
    "In Progress": "started",
    Done: "completed",
    Removed: "cancelled",
  },
  CMMI: {
    Proposed: "unstarted",
    Active: "started",
    Resolved: null,
    Closed: "completed",
    Removed: "cancelled",
  },
  Basic: {
    "To Do": "unstarted",
    Doing: "started",
    Done: "completed",
    Removed: "cancelled",
  },
};

/** CSV exports do not carry the process; this is the union of states that mean the same everywhere. */
export const ADO_CSV_STATE_PROPOSALS: Record<string, StateGroup> = {
  New: "unstarted",
  Proposed: "unstarted",
  "To Do": "unstarted",
  Active: "started",
  Approved: "started",
  Committed: "started",
  "In Progress": "started",
  Doing: "started",
  Closed: "completed",
  Done: "completed",
  Removed: "cancelled",
};

export const CSV_PROCESS = "CSV";

export function normaliseProcess(name: string | undefined): AdoProcess | null {
  if (!name) return null;
  const found = ADO_PROCESSES.find(
    (template) => template.toLowerCase() === name.trim().toLowerCase(),
  );
  return found ?? null;
}

export function stateFacetValue(processName: string, state: string): string {
  return `${processName}/${state}`;
}

export function splitStateFacet(
  value: string,
): { process: string; state: string } | null {
  const index = value.indexOf("/");
  if (index <= 0) return null;
  return { process: value.slice(0, index), state: value.slice(index + 1) };
}

export function proposeStateGroup(value: string): StateGroup | null {
  const parts = splitStateFacet(value);
  if (!parts) return null;
  if (parts.process === CSV_PROCESS)
    return ADO_CSV_STATE_PROPOSALS[parts.state] ?? null;
  const processTemplate = normaliseProcess(parts.process);
  if (!processTemplate) return null;
  return ADO_STATE_PROPOSALS[processTemplate][parts.state] ?? null;
}

/** Priority 1..4 to Urgent / High / Medium / Low. */
export const ADO_PRIORITY: Record<
  string,
  "urgent" | "high" | "medium" | "low"
> = { "1": "urgent", "2": "high", "3": "medium", "4": "low" };

export type RelationType =
  | "relates"
  | "blocks"
  | "duplicates"
  | "precedes"
  | "requires";

/**
 * Link `rel` to a TaskDesk relation seen from the item that carries the link. Duplicate-Forward
 * has no inverse type here (the other side carries Duplicate-Reverse) and is skipped.
 */
export const ADO_LINK_RELATIONS: Record<string, RelationType | "skip"> = {
  "System.LinkTypes.Related": "relates",
  "System.LinkTypes.Duplicate-Reverse": "duplicates",
  "System.LinkTypes.Duplicate-Forward": "skip",
  "System.LinkTypes.Dependency-Forward": "precedes",
  "System.LinkTypes.Dependency-Reverse": "requires",
};
export const ADO_PARENT_LINK = "System.LinkTypes.Hierarchy-Reverse";
export const ADO_CHILD_LINK = "System.LinkTypes.Hierarchy-Forward";
export const ADO_ATTACHMENT_LINK = "AttachedFile";

/** Area path: first segment is the project, depth >= 2 becomes a module proposal target. */
export function areaModule(areaPath: string | undefined): string | undefined {
  if (!areaPath) return undefined;
  const parts = areaPath.split("\\").filter((part) => part.length > 0);
  return parts.length >= 2 ? parts.join("\\") : undefined;
}

/** Fields whose revision changes become activity rows; any other changed field is counted. */
export const ADO_HISTORY_FIELDS: Record<string, string> = {
  "System.Title": "title",
  "System.State": "state",
  "System.Reason": "reason",
  "System.AssignedTo": "assignee",
  "System.AreaPath": "area_path",
  "System.IterationPath": "iteration_path",
  "System.Tags": "labels",
  "Microsoft.VSTS.Common.Priority": "priority",
  "Microsoft.VSTS.Common.Severity": "severity",
  "Microsoft.VSTS.Scheduling.StoryPoints": "estimate",
  "Microsoft.VSTS.Scheduling.Effort": "estimate",
  "Microsoft.VSTS.Scheduling.Size": "estimate",
  "Microsoft.VSTS.Scheduling.OriginalEstimate": "original_estimate",
  "Microsoft.VSTS.Scheduling.RemainingWork": "remaining_work",
  "Microsoft.VSTS.Scheduling.CompletedWork": "completed_work",
};
