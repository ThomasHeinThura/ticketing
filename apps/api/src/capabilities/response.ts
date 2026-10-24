import { z } from "../openapi";

export const capabilitiesResponseSchema = z
  .object({
    manageProjects: z.boolean(),
    createProjects: z.boolean(),
    updateProjects: z.boolean(),
    deleteProjects: z.boolean(),
    updateTasks: z.boolean(),
    createTasks: z.boolean(),
    createAttachments: z.boolean().optional().openapi({
      description:
        "Strict attachment:create in the requested scope; absent means denied.",
    }),
    deleteTasks: z.boolean(),
    assignTasks: z.boolean(),
    manageLabels: z.boolean().optional().openapi({
      description:
        "Strict label:manage for project catalogue mutations; absent means denied.",
    }),
    createLabels: z.boolean(),
    updateLabels: z.boolean(),
    deleteLabels: z.boolean(),
    manageWorkspace: z.boolean(),
    deleteWorkspace: z.boolean(),
    inviteUsers: z.boolean(),
    manageTeam: z.boolean(),
    removeMembers: z.boolean(),
    manageServiceCalendars: z.boolean(),
    shareSavedViews: z.boolean(),
    manageWorkspaceSettings: z.boolean(),
    transitionTasks: z.boolean(),
    rankTasks: z.boolean(),
    exportTasks: z.boolean().optional(),
    setPriorityTasks: z.boolean().optional(),
    manageProjectSettings: z.boolean(),
    manageRoles: z.boolean().optional().openapi({
      description:
        "Strict workspace:manage_roles; gates the Roles settings entry. Absent means denied.",
    }),
    manageWebhooks: z.boolean().optional().openapi({
      description:
        "Strict webhook:manage; gates the Webhooks settings entry. Absent means denied.",
    }),
    manageCustomFields: z.boolean().optional().openapi({
      description:
        "Strict custom_field:manage; gates the Custom fields settings entry. Absent means denied.",
    }),
    bindProjectOrganisation: z.boolean().openapi({
      description:
        "Strict project:create (owner/admin/manager): may list customer organisations and bind a new project to one.",
    }),
    createPublicComments: z.boolean().optional(),
    createInternalComments: z.boolean().optional(),
  })
  .openapi("Capabilities");
