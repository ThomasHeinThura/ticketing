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
      description: "This workspace's pending, unexpired invitations.",
    }),
  })
  .openapi("WorkspaceDetail");
