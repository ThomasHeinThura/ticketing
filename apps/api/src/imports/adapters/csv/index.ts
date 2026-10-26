/**
 * Generic CSV adapter (`import.csv`). Columns follow docs/technical/import-and-cutover.md
 * "Generic CSV": external_id, title, description, type, state, priority, assignee_email,
 * requester_email, created_at, resolved_at, labels (semicolon separated), parent_external_id,
 * project_key and any number of cf_<key> custom field columns. `config.columnMap` renames columns.
 * Anything else is reported per record as `column_ignored`, never dropped silently.
 */
import {
  type CsvProfile,
  createCsvFamilyAdapter,
  genericPriority,
  genericStateGroup,
} from "./core";

export const genericCsvProfile: CsvProfile = {
  pluginId: "import.csv",
  sourceType: "issue",
  aliases: {
    external_id: ["external_id"],
    title: ["title"],
    description: ["description"],
    type: ["type"],
    state: ["state"],
    priority: ["priority"],
    assignee_email: ["assignee_email"],
    requester_email: ["requester_email"],
    created_at: ["created_at"],
    resolved_at: ["resolved_at"],
    start_date: ["start_date"],
    due_date: ["due_date"],
    labels: ["labels"],
    parent_external_id: ["parent_external_id"],
    project_key: ["project_key"],
  },
  customFieldPrefix: "cf_",
  requiredFields: ["title"],
  defaultType: "task",
  dateOrder: "iso",
  categoryAsType: true,
  multiAssignee: false,
  stateValue: (fields) => fields.state || undefined,
  proposeState: genericStateGroup,
  proposePriority: genericPriority,
};

export const createCsvAdapter = () => createCsvFamilyAdapter(genericCsvProfile);
export { inspectCsvConnection } from "./core";
export { CSV_LIMITS, parseCsv } from "./parse";
