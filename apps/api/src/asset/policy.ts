import type { PolicyMap } from "@taskdesk/permissions";

/**
 * `GET /api/asset/{id}` — issue #8's own H2 section names this route as the canonical
 * example of the failure H2 exists to refuse: it was registered above the app-wide auth
 * guard in `apps/api/src/index.ts`, so `isWithinAuthGuardScope()`
 * (`packages/permissions/src/route-coverage.ts`) correctly refused to let it be declared
 * `capability` -- stamping one anyway would have turned the coverage gate green with zero
 * runtime change, while the route kept serving above the guard. Fixed alongside this
 * classification (issue #8's integration pass): the route's registration was moved below
 * the guard in `index.ts` (see that file's comment at the route), so the declaration below
 * now describes what the runtime actually enforces, not an aspiration.
 *
 * **Not actually public.** `authorizeAssetAccess` (`apps/api/src/utils/
 * authorize-asset-access.ts`) calls `resolveAssetBearerOrCookie`, which throws 401 when the
 * caller presents no credential at all (session, personal API key, or MCP key all count),
 * then `validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId)`
 * (`apps/api/src/utils/validate-workspace-access.ts`), which 403s unless the caller is
 * either a platform admin or a member of the asset's own workspace. There is no
 * project-level or work-item-level check anywhere on this path -- the query that loads the
 * asset joins `projectTable` only to refuse an orphaned asset row (see the comment at that
 * join in `index.ts`), never to check the caller's standing in that project.
 *
 * **`scope: "workspace"`, not `project` or `work_item`.** The asset table
 * (`apps/api/src/database/schema.ts`) carries `workspaceId`, `projectId` and optional
 * `taskId`/`activityId` columns, so a narrower scope was plausible before reading
 * `authorizeAssetAccess` -- but the runtime check only ever evaluates `asset.workspaceId`.
 * Declaring `project` or `work_item` here would assert an authority boundary this route does
 * not actually enforce, exactly the false-precision this registry exists to refuse.
 * `scopeSource: "row"`: the workspace id is read from the same query that loads the asset by
 * its path `{id}`, never from a request parameter -- this route names no `workspaceId` of
 * its own.
 *
 * **`capability: "workspace:read"`, reused for the same reason `label/policy.ts` reuses it
 * for its own workspace-membership-only reads (see that file's own comment).** rbac.md's
 * Attachments group (`docs/01-architecture/rbac.md`) has `attachment:create`,
 * `attachment:delete_own` and `attachment:delete_any` but no `attachment:read` -- there is no
 * capability in the closed list that names "read an attachment" at all. `workspace:read` is
 * not the least-wrong option here so much as an exact match on breadth: it is held by every
 * built-in role from `viewer` up (`docs/01-architecture/rbac.md` § "Built-in roles"),
 * exactly matching `validateWorkspaceAccess`'s own behaviour of granting any workspace
 * member equal read access with no further distinction. Recorded here as a gap for #7 to
 * resolve (a dedicated `attachment:read` capability would be the precise fix), the same way
 * `invitation/policy.ts` and `workspace/policy.ts` already record their own reuse gaps.
 *
 * No `sessionOnly`: unlike the native organization routes the 2026-09-08 decision log entry
 * covers, this is a plain authenticated data read with no accept/reject/cancel-style session
 * semantics, and no sibling GET route in this batch (e.g. `label/policy.ts`'s
 * workspace-scoped reads) declares it either -- a personal API key or MCP key reaching this
 * route is the intended, documented shape (see `docs/01-architecture/rbac.md` § "MCP — the
 * same RBAC, not a second one").
 */
export const assetPolicies = {
  "GET /api/asset/{id}": {
    capability: "workspace:read",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
