import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Legacy Kaneo time-entry routes remain mounted for old clients. The persisted row uses
 * `task_time_entry.user_id`; admission and strict policy enforcement join that user to
 * `person.id` before evaluating the retained own/any predicate. The create route requires
 * `time_entry:create`; update requires `time_entry:update_any` or the owner plus
 * `time_entry:update_own`. Both keep project reach and are gated by `feature.time_tracking`
 * at project scope. The controllers repeat capability, owner and feature checks in their
 * write transactions. API keys remain allowed only within their stored capability subset;
 * service keys cannot own a person's time entry. The GET routes retain read-any semantics.
 */
export const timeEntryPolicies = {
  // List every time entry logged against one task; requires `time_entry:read_any`.
  "GET /api/time-entry/task/{taskId}": {
    capability: "time_entry:read_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Read a single time entry by id; requires `time_entry:read_any`.
  "GET /api/time-entry/{id}": {
    capability: "time_entry:read_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // The task already exists, so the create route still requires project reach.
  "POST /api/time-entry": {
    capability: "time_entry:create",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // A persisted legacy user_id is resolved to person.id before the own branch is tested.
  "PUT /api/time-entry/{id}": {
    capability: "time_entry:update_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "time_entry:update_own",
    },
  },
} as const satisfies PolicyMap;
