import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Customer announcements (D7, `feature-contracts-p5.md` "Announcements").
 *
 * Staff routes reuse `service:manage` (owner, admin and manager): an announcement is a service
 * communication, and a new capability would change the permission matrix. Workspace routes take
 * the workspace from the request; row routes resolve it from the announcement and answer a
 * foreign or deleted row as 404. Project reach is required: a notice with no project or
 * organisation target in the caller's reach answers as missing on every staff route, and
 * addressing every customer (creating, switching to or publishing a workspace-wide notice)
 * needs reach to every live customer project of the workspace (422 otherwise). Editing,
 * unpublishing or deleting a published notice, like publishing it, needs reach to every
 * customer it addresses (422 otherwise).
 *
 * Portal routes are `own_organisation`: the caller's organisation must be in the published,
 * in-window announcement's audience through a live project of theirs in that workspace.
 */
const manage = {
  capability: "service:manage",
  scope: "workspace",
  scopeSource: "request",
  reach: "required",
} as const;
const manageRow = { ...manage, scopeSource: "row" } as const;

export const announcementPolicies = {
  "GET /api/announcements": manage,
  "GET /api/announcements/audience-options": manage,
  "POST /api/announcements": manage,
  "GET /api/announcements/{id}": manageRow,
  "PATCH /api/announcements/{id}": manageRow,
  "POST /api/announcements/{id}/publish": manageRow,
  "POST /api/announcements/{id}/unpublish": manageRow,
  "DELETE /api/announcements/{id}": manageRow,
  "GET /api/portal/announcements": {
    portal: "customer",
    predicate: "own_organisation",
  },
  "GET /api/portal/announcements/{id}": {
    portal: "customer",
    predicate: "own_organisation",
  },
} as const satisfies PolicyMap;
