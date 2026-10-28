import { z } from "../openapi";

export const workspaceIdParam = z.object({ workspaceId: z.string() });

// S4 — native workspace write routes (issue #6, retrofit plan §3, S4 row).
//
// `name` is validated a second time by `checkWorkspaceName` in the handler:
// the length bound below is a cheap request-shape guard, while the validator
// is the security control (it rejects embedded URLs — the 2026-05-28 phishing
// pattern — and HTML/template characters) and must stay the single authority.
export const createWorkspaceBody = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug may contain only lowercase letters, digits and single hyphens",
    )
    .optional()
    .openapi({
      description:
        "Optional URL slug. Generated from the name, and deduplicated, when omitted.",
    }),
  logo: z.string().max(2048).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});

export const updateWorkspaceBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug may contain only lowercase letters, digits and single hyphens",
      )
      .optional(),
    logo: z.string().max(2048).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

// S5 -- native membership write routes (issue #6, retrofit plan §3, S5 row).

export const workspaceMemberIdParam = z.object({
  workspaceId: z.string(),
  userId: z.string(),
});

// `role` is a plain string, not an enum: it is validated against this
// workspace's OWN `workspace_role` rows in the controller (ROLE_NOT_FOUND
// semantics), not against a fixed list -- custom roles are workspace data,
// not a compile-time constant. `"owner"` is a legal STRING here (the schema
// cannot see which workspace this is); the controller is what refuses it.
export const addWorkspaceMemberBody = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
});

export const updateWorkspaceMemberRoleBody = z.object({
  role: z.string().min(1),
});

export const transferWorkspaceOwnershipBody = z.object({
  newOwnerUserId: z.string().min(1),
});

// S6a -- native invitation write route (issue #6, retrofit plan §3, S6a row).

// `role` is a plain string for the same reason as `addWorkspaceMemberBody`:
// validated against this workspace's OWN `workspace_role` rows in the
// controller, not a fixed enum.
export const inviteWorkspaceMemberBody = z.object({
  email: z.string().email(),
  role: z.string().min(1),
  resend: z.boolean().optional(),
});

// S7 -- native role list/write routes (issue #6, retrofit plan §3, S7 row).

// Update/delete key on the role's opaque `id`, not its name -- a role name may
// legitimately contain a `/` (better-auth's own `normalizeRoleName` only
// lower-cases it), which would be unaddressable as a path segment. See the S7
// blueprint's Ambiguity Q1.
export const workspaceRoleParam = z.object({
  workspaceId: z.string(),
  roleId: z.string(),
});

// `role`'s reserved-name and uniqueness checks run in the controller, against
// this workspace's own rows -- not expressible in the request shape alone.
// Every value in `permission` is validated against the known resource keys in
// the controller too (`checkForInvalidResources` parity).
export const createWorkspaceRoleBody = z.object({
  // `.trim()` runs before `.min(1)` re-checks length, so a whitespace-only
  // name ("   ") is rejected at the boundary with a clear 400. The immutable key is derived
  // from the name in the service (`roleKeyFromName`).
  role: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  rank: z.number().int().optional(),
  /** Canonical capability names. Send this, `permission` or `cloneFromRoleId`. */
  capabilities: z.array(z.string()).optional(),
  /** Deprecated: the inherited `{resource: action[]}` statement shape. */
  permission: z.record(z.string(), z.array(z.string())).optional(),
  /** Start from another role's capabilities (RL clone). */
  cloneFromRoleId: z.string().optional(),
});

// PATCH replaces the role's ENTIRE capability set -- it does not merge. See
// `role-service.ts`. Every field is optional but at least one must be present.
export const updateWorkspaceRoleBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  rank: z.number().int().optional(),
  capabilities: z.array(z.string()).optional(),
  permission: z.record(z.string(), z.array(z.string())).optional(),
  expectedVersion: z.string().optional(),
  confirmSelfEdit: z.boolean().optional(),
});

export const reassignWorkspaceRoleBody = z.object({
  toRoleId: z.string().min(1),
  userIds: z.array(z.string()).max(1000).optional(),
});

export const previewWorkspaceRoleBody = z.object({
  capabilities: z.array(z.string()).max(200),
});
