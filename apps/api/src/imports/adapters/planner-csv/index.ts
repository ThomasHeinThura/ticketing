/**
 * Microsoft Planner CSV export profile (`import.planner`).
 *
 * Scope: a CSV exported from one Planner plan (Planner "Export plan to Excel", saved as CSV). The
 * Microsoft Graph path is explicitly NOT built here: it needs an Entra application registration
 * and tenant consent, which is an external prerequisite (see import-and-cutover.md, Planner
 * "Access"). Only the CSV path ships in P6.
 *
 * Mapping (docs "Microsoft Planner"):
 *   Task ID (when present)      -> external id, else a stable row hash
 *   Task Name                   -> title
 *   Bucket Name + Progress      -> state facet "<bucket> | <progress>". The proposal comes from
 *                                  Progress (Completed -> completed, In progress -> started,
 *                                  Not started -> backlog when the bucket says so, else unstarted).
 *   Priority                    -> priority facet (Urgent, Important, Medium, Low)
 *   Assigned To                 -> first e-mail is the assignee; the rest are reported as
 *                                  `additional_assignees_not_imported` (watchers are not
 *                                  supported by the writer); display names are `person_not_email`
 *   Labels                      -> label facets (semicolon separated)
 *   Start/Due/Created Date      -> dates; non-ISO dates read as month/day/year (config.dateOrder
 *                                  "dmy" switches), anything unreadable is `invalid_date`
 *   Description                 -> description
 *   Checklist Items             -> appended to the description, reported as `checklist_flattened`
 * No type column exists: every task gets the configured default type facet (default "task").
 */
import {
  type CsvProfile,
  createCsvFamilyAdapter,
  genericStateGroup,
} from "../csv/core";

function plannerProgress(
  value: string,
): "started" | "completed" | "unstarted" | undefined {
  const v = value.trim().toLowerCase();
  if (v === "completed" || v === "complete") return "completed";
  if (v === "in progress" || v === "inprogress") return "started";
  if (v === "not started") return "unstarted";
  return undefined;
}

export const plannerCsvProfile: CsvProfile = {
  pluginId: "import.planner",
  sourceType: "task",
  aliases: {
    external_id: ["task_id", "id"],
    title: ["task_name", "title", "name"],
    bucket: ["bucket_name", "bucket"],
    progress: ["progress", "status"],
    priority: ["priority"],
    assignee_email: ["assigned_to", "assignee"],
    created_by: ["created_by"],
    created_at: ["created_date", "created_at"],
    start_date: ["start_date"],
    due_date: ["due_date"],
    resolved_at: ["completed_date"],
    labels: ["labels"],
    description: ["description", "notes"],
    checklist: ["checklist_items", "checklist"],
    checklist_done: ["completed_checklist_items"],
  },
  customFieldPrefix: null,
  requiredFields: ["title"],
  defaultType: "task",
  dateOrder: "mdy",
  categoryAsType: false,
  multiAssignee: true,
  stateValue: (fields) => {
    const bucket = fields.bucket?.trim() ?? "";
    const progress = fields.progress?.trim() ?? "";
    if (bucket && progress) return `${bucket} | ${progress}`;
    return bucket || progress || undefined;
  },
  proposeState: (value) => {
    const separator = value.lastIndexOf(" | ");
    const bucket = separator >= 0 ? value.slice(0, separator) : value;
    const progress = separator >= 0 ? value.slice(separator + 3) : value;
    const group = plannerProgress(progress);
    if (group === "completed" || group === "started") return group;
    const byBucket = genericStateGroup(bucket);
    if (group === "unstarted")
      return byBucket === "backlog" ? "backlog" : "unstarted";
    return byBucket;
  },
  proposePriority: (value) => {
    switch (value.trim().toLowerCase()) {
      case "urgent":
        return "urgent";
      case "important":
        return "high";
      case "medium":
        return "medium";
      case "low":
        return "low";
      default:
        return undefined;
    }
  },
};

export const createPlannerCsvAdapter = () =>
  createCsvFamilyAdapter(plannerCsvProfile);
