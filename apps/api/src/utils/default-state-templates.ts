/**
 * The default workspace-level `state_template` rows every workspace is seeded with
 * (issue #309, PR-17). `work-items.md` § "Default types" names the default work item
 * types verbatim but is silent on template names -- `data-model.md` §3 and
 * [ADR 0011](../../../../docs/01-architecture/adr/0011-ticket-lifecycle-engine.md) are
 * explicit that the five `group` values are "the only fixed lifecycle vocabulary" and
 * that template *names* are an ordinary, editable, workspace-settings choice ("a
 * customer relabels 'Resolved' to 'Fixed' ... entirely in the UI"). One template per
 * group, in ADR 0011's own listed order, is the smallest set that lets a freshly
 * created workspace's projects reach every group without inventing a name the spec
 * does not give -- ADR 0011 itself cites kaneo's "To Do / In Progress / Done" as the
 * illustrative simple case this generalises.
 *
 * Pure data, no I/O.
 */

/** `state_template.group` -- `state_template_group_allowed`'s CHECK constraint, in
 * ADR 0011's own listed order. The only fixed lifecycle vocabulary in the system. */
export type StateTemplateGroup =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

export type DefaultStateTemplate = {
  /** Unique per workspace (`state_template_workspace_key_unique`). */
  key: string;
  name: string;
  group: StateTemplateGroup;
};

export const DEFAULT_STATE_TEMPLATES: readonly DefaultStateTemplate[] = [
  { key: "backlog", name: "Backlog", group: "backlog" },
  { key: "to-do", name: "To Do", group: "unstarted" },
  { key: "in-progress", name: "In Progress", group: "started" },
  { key: "done", name: "Done", group: "completed" },
  { key: "cancelled", name: "Cancelled", group: "cancelled" },
] as const;

/**
 * The group a freshly created project's DEFAULT concrete `state` is mapped to
 * (`state.is_default`, `WI-4`). `unstarted` -- "To Do" above -- is the least surprising
 * landing spot for a newly created work item, mirroring the position-0 entry column
 * `DEFAULT_PROJECT_COLUMNS` (`project/controllers/create-project.ts`) already uses for
 * the legacy kaneo board.
 */
export const DEFAULT_STATE_GROUP = "unstarted" satisfies StateTemplateGroup;
