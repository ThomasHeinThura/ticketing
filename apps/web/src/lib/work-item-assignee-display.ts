import { resolveAssigneeDisplayStatus } from "@taskdesk/domain";

type AssigneeDisplayInput = {
  assigneeId: string | null;
  assigneeName: string | null;
  /** `person.active` from the work-item response (`AS-8`); absent from older producers. */
  assigneeActive?: boolean | null;
  /** Whether the assignee is still on the project's roster; absent from older producers. */
  assigneeOnProject?: boolean | null;
};

export type AssigneeDisplay =
  | { kind: "unassigned" }
  /** Assigned, but no display name can be resolved (placeholder or foreign person). */
  | { kind: "unresolved" }
  | {
      kind: "person";
      name: string;
      status: "active" | "inactive" | "not_on_project";
    };

/**
 * `AS-8`: an assignment is retained when its holder is deactivated or leaves the project,
 * and is shown as "Jane Smith (inactive)" or "Jane Smith (no longer on this project)". The
 * decision is the domain's `resolveAssigneeDisplayStatus`, not a second copy of the rule.
 * A response that carries neither fact (search, saved views) is rendered as active rather
 * than guessed inactive.
 */
export function resolveAssigneeDisplay(
  item: AssigneeDisplayInput,
): AssigneeDisplay {
  if (item.assigneeId === null) return { kind: "unassigned" };
  if (!item.assigneeName) return { kind: "unresolved" };
  const known =
    item.assigneeActive !== undefined &&
    item.assigneeActive !== null &&
    item.assigneeOnProject !== undefined &&
    item.assigneeOnProject !== null;
  const status = known
    ? resolveAssigneeDisplayStatus(item.assigneeId, {
        active: item.assigneeActive === true,
        onProject: item.assigneeOnProject === true,
      })
    : "active";
  return {
    kind: "person",
    name: item.assigneeName,
    status: status ?? "active",
  };
}

/** The visible text for an assignee: the name plus its status suffix, if any. */
export function assigneeDisplayText(
  display: AssigneeDisplay,
  labels: {
    unassigned: string;
    inactive: string;
    notOnProject: string;
  },
): string {
  switch (display.kind) {
    case "unassigned":
      return labels.unassigned;
    case "unresolved":
      return labels.inactive;
    case "person":
      return display.status === "inactive"
        ? `${display.name} ${labels.inactive}`
        : display.status === "not_on_project"
          ? `${display.name} ${labels.notOnProject}`
          : display.name;
  }
}
