import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Attachment route policies (issue #28, `attachments.md`).
 *
 * Work-item routes retain their attachment policies. IQ-9 adds submission parent routes
 * under the existing `intake:triage` and `own_submission` policies.
 *
 * Upload/complete retain their existing workspace gates. Deletion creates a durable
 * pending action; request and approval resolve current canonical identity, scoped
 * authority, uploader ownership and the originating credential ceiling.
 *
 * `scopeSource: "row"` throughout: every route resolves its work item (directly, or via
 * the attachment's own `work_item_id`) with a genuine DB lookup before the handler runs
 * -- `require-work-item-reach.ts`/`require-attachment-reach.ts`, both local to this
 * feature and `work-item/`, per this project's "partition by file" guidance rather than
 * editing the shared `workspace-access-middleware.ts`.
 *
 * Delete uses the retained delete-any capability or canonical uploader ownership with
 * delete-own. Request and approval both enforce these same facts with current credentials.
 */
export const attachmentPolicies = {
  "POST /api/portal/submissions/{ref}/attachments/presign": {
    portal: "customer",
    predicate: "own_submission",
  },
  "POST /api/portal/submissions/{ref}/attachments/{id}/complete": {
    portal: "customer",
    predicate: "own_submission",
  },
  "GET /api/portal/submissions/{ref}/attachments": {
    portal: "customer",
    predicate: "own_submission",
  },
  "GET /api/portal/submissions/{ref}/attachments/{id}": {
    portal: "customer",
    predicate: "own_submission",
  },
  "GET /api/portal/submissions/{ref}/attachments/{id}/preview": {
    portal: "customer",
    predicate: "own_submission",
  },
  "GET /api/submissions/{ref}/attachments": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/submissions/{ref}/attachments/{id}": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/submissions/{ref}/attachments/{id}/preview": {
    capability: "intake:triage",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
  // AT-2: mints a presigned direct-PUT for a new attachment on this work item.
  "POST /api/work-items/{key}/attachments/presign": {
    capability: "attachment:create",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // AT-1: the work item's attachment list.
  "GET /api/work-items/{key}/attachments": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // AT-2's edge case: MIME-vs-magic-bytes rejection happens here, after the bytes
  // actually landed in storage.
  "POST /api/attachments/{id}/complete": {
    capability: "attachment:create",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // AT-5/AT-6: presigned download, five-minute lifetime, writes `attachment.downloaded`
  // to the audit log.
  "GET /api/attachments/{id}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "GET /api/attachments/{id}/preview": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // AT-7: explicit requester-confirmed soft deletion.
  "DELETE /api/attachments/{id}": {
    capability: "attachment:delete_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "attachment:delete_own",
    },
  },
  // AT-7: restore an attachment during its one-day soft-delete window. Reuses the
  // same delete-any or uploader+delete-own authority as the original action.
  "POST /api/attachments/{id}/restore": {
    capability: "attachment:delete_any",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
    orOwner: {
      predicate: "row.person_id === identity.personId",
      capability: "attachment:delete_own",
    },
  },
} as const satisfies PolicyMap;
