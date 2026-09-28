import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Attachment route policies (issue #28, `attachments.md`).
 *
 * Scope for this slice: WORK-ITEM attachments only. `attachments.md` AT-1 also names
 * attaching to a comment or to a submission, but neither the new-model `comment` table
 * (`data-model.md` §4) nor `submission` exist in `apps/api/src/database/schema.ts` yet
 * -- see `attachmentTable`'s own comment there. Those two parents are therefore out of
 * this slice entirely, not merely unimplemented at the route level.
 *
 * Every route below runs the SAME transitional shape `comment/policy.ts`/
 * `work-item/policy.ts` already document: the declared capability is the TARGET
 * vocabulary (`attachment:create`/`attachment:delete_own`, `docs/01-architecture/rbac.md`
 * § Attachments), and the RUNTIME gate is `requireWorkspacePermission({ work_item:
 * ["update"|"read"] })` against the caller's legacy workspace role -- the declarative
 * `packages/permissions` evaluator is still not wired into the live request path
 * anywhere in this codebase (issue #8's remaining runtime-integration work).
 *
 * `scopeSource: "row"` throughout: every route resolves its work item (directly, or via
 * the attachment's own `work_item_id`) with a genuine DB lookup before the handler runs
 * -- `require-work-item-reach.ts`/`require-attachment-reach.ts`, both local to this
 * feature and `work-item/`, per this project's "partition by file" guidance rather than
 * editing the shared `workspace-access-middleware.ts`.
 *
 * **Delete ownership is enforced structurally, not by a declared `orOwner` branch** --
 * same reasoning `comment/policy.ts`'s file comment gives for `comment:update_own`/
 * `comment:delete_own`. `delete-attachment.ts`'s `WHERE uploaded_by = caller` is
 * unconditional, so declaring the broader `attachment:delete_any` here (rbac.md's
 * `manager`/`lead` capability) would overclaim what this ONE route can actually do --
 * the "any" variant is a different, not-yet-built route, a product question this policy
 * entry does not decide.
 */
export const attachmentPolicies = {
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

  // AT-7: soft delete. See this file's own comment for why `attachment:delete_own`, not
  // `attachment:delete_any`, is the declared capability.
  "DELETE /api/attachments/{id}": {
    capability: "attachment:delete_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
