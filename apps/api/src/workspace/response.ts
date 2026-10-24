import { responseTimestamp, z } from "../openapi";

export const workspaceMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().openapi({
      description:
        "The member's workspace role: a built-in role (owner, admin, member, guest) or a custom role name.",
    }),
  })
  .openapi("WorkspaceMember");

export const workspaceMemberListSchema = z.array(workspaceMemberSchema);

export const workspaceSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    role: z.string().openapi({
      description: "The calling user's own role in this workspace.",
    }),
  })
  .openapi("WorkspaceSummary");

export const workspaceSummaryListSchema = z.array(workspaceSummarySchema);

export const workspaceInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string().nullable(),
    status: z.string(),
    expiresAt: responseTimestamp,
    createdAt: responseTimestamp,
    inviterId: z.string(),
  })
  .openapi("WorkspaceInvitation");

export const workspaceInvitationListSchema = z.array(workspaceInvitationSchema);

export const workspaceDetailSchema = z
  .object({
    workspace: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      logo: z.string().nullable(),
      description: z.string().nullable(),
      createdAt: responseTimestamp,
    }),
    members: workspaceMemberListSchema,
    pendingInvitations: workspaceInvitationListSchema.openapi({
      description:
        "This workspace's invitations that are still pending -- expired or not (issue #160).",
    }),
  })
  .openapi("WorkspaceDetail");

// S4 — the shape returned by the native write routes. Deliberately the
// workspace's own columns and nothing derived: `workspaceSummarySchema`
// carries the CALLER's role, which is a read concern belonging to #65's
// list route, and repeating it here would make two places responsible for
// the same field.
export const workspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("Workspace");

export const deletedWorkspaceSchema = z
  .object({ id: z.string() })
  .openapi("DeletedWorkspace");

// S8a -- native set-active route (issue #6, retrofit plan §3, S8a row).

export const activatedWorkspaceSchema = z
  .object({ workspaceId: z.string() })
  .openapi("ActivatedWorkspace");

// S5 -- native membership write routes (issue #6, retrofit plan §3, S5 row).

export const removedWorkspaceMemberSchema = z
  .object({ userId: z.string() })
  .openapi("RemovedWorkspaceMember");

export const leftWorkspaceSchema = z
  .object({ workspaceId: z.string() })
  .openapi("LeftWorkspace");

export const workspaceMemberRoleSchema = z
  .object({ userId: z.string(), role: z.string() })
  .openapi("WorkspaceMemberRole");

export const transferredWorkspaceOwnershipSchema = z
  .object({
    workspaceId: z.string(),
    previousOwnerUserId: z.string(),
    previousOwnerNewRole: z.string(),
    newOwnerUserId: z.string(),
  })
  .openapi("TransferredWorkspaceOwnership");

// S7 -- native role list/write routes (issue #6, retrofit plan §3, S7 row).

export const workspaceRoleSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    role: z.string().openapi({
      description:
        "The role's stable key (what `workspace_member.role` holds). Never 'owner' for an editable role.",
    }),
    name: z.string().openapi({ description: "The display name." }),
    description: z.string().nullable(),
    rank: z.number().int().openapi({
      description:
        "Higher wins. You cannot edit or mint a role at or above your own rank (RL-4, RL-14).",
    }),
    capabilities: z.array(z.string()).openapi({
      description:
        "The stored canonical capability set, full implication closure (RL-5). The source of truth.",
    }),
    permission: z.record(z.string(), z.array(z.string())).openapi({
      description:
        "Deprecated statement view derived from `capabilities`, kept for pre-canonical clients.",
    }),
    isSystem: z.boolean(),
    isEditable: z.boolean(),
    holderCount: z.number().int(),
    version: z.string().openapi({
      description:
        "Optimistic-concurrency token; echo it as `expectedVersion` on PATCH.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("WorkspaceRole");

export const workspaceRoleHolderSchema = z
  .object({
    userId: z.string(),
    personId: z.string().nullable(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    active: z.boolean(),
    suspended: z.boolean(),
    joinedAt: responseTimestamp,
  })
  .openapi("WorkspaceRoleHolder");

export const workspaceRoleHoldersSchema = z
  .object({
    role: workspaceRoleSchema,
    holders: z.array(workspaceRoleHolderSchema),
  })
  .openapi("WorkspaceRoleHolders");

export const workspaceRoleReassignResultSchema = z
  .object({
    fromRoleId: z.string(),
    toRoleId: z.string(),
    moved: z.number().int(),
  })
  .openapi("WorkspaceRoleReassignResult");

export const workspaceRoleHistorySchema = z
  .array(
    z.object({
      id: z.string(),
      action: z.string(),
      actorName: z.string().nullable(),
      actorType: z.string(),
      added: z.array(z.string()),
      removed: z.array(z.string()),
      rank: z
        .object({
          before: z.number().nullable(),
          after: z.number().nullable(),
        })
        .nullable(),
      createdAt: responseTimestamp,
    }),
  )
  .openapi("WorkspaceRoleHistory");

const previewEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  requires: z.string(),
  allowed: z.boolean(),
});

export const workspaceRolePreviewSchema = z
  .object({
    navigation: z.array(previewEntrySchema),
    workItemActions: z.array(previewEntrySchema),
    capabilityCount: z.number().int(),
  })
  .openapi("WorkspaceRolePreview");

export const workspaceRoleListSchema = z.array(workspaceRoleSchema);

export const deletedWorkspaceRoleSchema = z
  .object({ id: z.string(), role: z.string() })
  .openapi("DeletedWorkspaceRole");
