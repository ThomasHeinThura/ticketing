import { z } from "../../openapi";

const id = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("\u0000"), {
    message: "must not contain a NUL (\\u0000) byte",
  });

export const projectMemberParam = z.object({
  projectId: z.string(),
  personId: id,
});

export const addProjectMemberBody = z.object({
  personId: id.openapi({
    description: "An active staff person who is a member of the workspace.",
  }),
  roleKey: id.openapi({
    description:
      "A project-scope role key: project-lead, project-member, project-viewer, or another project-scope role of the workspace.",
  }),
});

export const updateProjectMemberBody = z.object({
  roleKey: id.openapi({
    description:
      "PR-3: the new role. On an inherited member this writes the explicit child row that overrides it.",
  }),
});

export const reparentPreviewQuery = z.object({
  parentId: z.string().max(128).optional().openapi({
    description:
      "The prospective parent project; omitted (or empty) previews making the project a root.",
  }),
});

const rosterRoleFields = {
  roleId: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  roleRank: z.number().int(),
};

const personFields = {
  personId: z.string(),
  displayName: z.string().nullable(),
  active: z.boolean(),
  jobTitle: z.string().nullable(),
};

const projectRef = z.object({ projectId: z.string(), projectName: z.string() });

export const projectMemberSchema = z.object({
  ...personFields,
  ...rosterRoleFields,
  source: z.string().openapi({ enum: ["direct", "inherited"] }),
  inheritedFrom: projectRef.nullable().openapi({
    description:
      "PR-2: the nearest ancestor project holding this person (inherited rows, and direct rows that override it).",
  }),
  overridesInherited: z
    .object({ roleKey: z.string(), roleName: z.string() })
    .nullable()
    .openapi({
      description: "PR-3: the inherited role this explicit row replaces.",
    }),
  managedExternally: z.boolean().openapi({
    description: "Held by an identity-provider mapping, so not removable here.",
  }),
  removable: z.boolean().openapi({
    description:
      "PR-4: false for an inherited row, which is removed at the parent.",
  }),
});

export const projectRosterRoleSchema = z.object({
  roleKey: z.string(),
  roleName: z.string(),
  roleRank: z.number().int(),
  roleId: z.string().nullable().openapi({
    description:
      "Null for a canonical role not yet created in this workspace (created on first use).",
  }),
});

export const projectMembersResponseSchema = z.object({
  members: z.array(projectMemberSchema),
  roles: z.array(projectRosterRoleSchema),
  callerRank: z.number().int().openapi({
    description:
      "The caller's rank in this project (the ceiling the roster writes enforce: only roles at or below it can be granted, changed or removed).",
  }),
});

export const projectMemberCandidateSchema = z.object({
  personId: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  workspaceRole: z.string(),
});

const accessChangeSchema = z.object({
  ...personFields,
  via: projectRef,
  roleKey: z.string(),
  roleName: z.string(),
});

export const reparentPreviewSchema = z.object({
  projectId: z.string(),
  currentParentId: z.string().nullable(),
  newParentId: z.string().nullable(),
  descendantProjectCount: z.number().int().openapi({
    description:
      "Descendant projects that move with it and are affected the same way.",
  }),
  refusal: z.string().nullable().openapi({
    description:
      "Set when the move would be refused (PR-1); gains and losses then describe no change.",
  }),
  gains: z.array(accessChangeSchema),
  losses: z.array(accessChangeSchema),
  roleChanges: z.array(
    z.object({
      ...personFields,
      from: z.object({
        roleKey: z.string(),
        roleName: z.string(),
        projectName: z.string(),
      }),
      to: z.object({
        roleKey: z.string(),
        roleName: z.string(),
        projectName: z.string(),
      }),
    }),
  ),
});
