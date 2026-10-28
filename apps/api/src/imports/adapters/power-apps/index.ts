/**
 * Power Apps ticketing CSV profile (`import.power-apps`).
 *
 * Power Apps apps are bespoke, so there is no canonical export. This is a saved mapping profile for
 * the common Dataverse / SharePoint list ticket export. The operator's own column names go in
 * `config.columnMap` ({ field: "Header" }), which overrides the built-in aliases, i.e. the saved
 * profile travels with the source connection.
 *
 *   Ticket number / ID          -> external reference (sourceId)
 *   Title / Subject / Summary   -> title
 *   Description / Details       -> description
 *   Status                      -> state
 *   Category                    -> type (config.categoryAs "label" makes it a label instead)
 *   Priority / Severity         -> priority
 *   Assigned to / Owner         -> assignee e-mail
 *   Requester e-mail            -> reported `requester_not_carried` (no requester slot in the engine)
 *   Resolution notes            -> appended to the description, reported
 *                                  `resolution_notes_in_description` (a public comment is not
 *                                  supported by the writer)
 *   Created / Created on, Due   -> dates (ISO 8601; config.dateOrder for other formats)
 *   cf_<key> columns            -> custom field facets
 */
import {
  type CsvProfile,
  createCsvFamilyAdapter,
  genericPriority,
  genericStateGroup,
} from "../csv/core";

export const powerAppsProfile: CsvProfile = {
  pluginId: "import.power-apps",
  sourceType: "ticket",
  aliases: {
    external_id: ["ticket_number", "ticket_id", "ticketnumber", "id"],
    title: ["title", "subject", "summary", "ticket_title"],
    description: ["description", "details"],
    state: ["status", "state", "ticket_status"],
    category: ["category", "ticket_category", "request_type"],
    priority: ["priority", "severity"],
    assignee_email: ["assigned_to_email", "assigned_to", "assignee", "owner"],
    requester_email: [
      "requester_email",
      "requester",
      "requested_by",
      "created_by_email",
    ],
    created_at: ["created", "created_on", "created_at", "submitted_on"],
    due_date: ["due_date", "due", "due_on"],
    resolved_at: ["resolved_on", "resolved_at", "closed_on"],
    resolution_notes: ["resolution_notes", "resolution", "resolution_note"],
    labels: ["labels", "tags"],
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

export const createPowerAppsAdapter = () =>
  createCsvFamilyAdapter(powerAppsProfile);
