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
