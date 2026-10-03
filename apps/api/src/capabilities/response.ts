import { z } from "../openapi";

export const capabilitiesResponseSchema = z
  .object({
    manageProjects: z.boolean(),
    manageProjectSettings: z.boolean(),
    createProjects: z.boolean(),
    updateProjects: z.boolean(),
    deleteProjects: z.boolean(),
    updateTasks: z.boolean(),
    transitionTasks: z.boolean(),
    createTasks: z.boolean(),
    deleteTasks: z.boolean(),
    assignTasks: z.boolean(),
    createLabels: z.boolean(),
    updateLabels: z.boolean(),
    deleteLabels: z.boolean(),
    manageWorkspace: z.boolean(),
    deleteWorkspace: z.boolean(),
    inviteUsers: z.boolean(),
    manageTeam: z.boolean(),
    removeMembers: z.boolean(),
    createPublicComments: z.boolean(),
    createInternalComments: z.boolean(),
    manageServiceCalendars: z.boolean(),
  })
  .openapi("Capabilities");

/** The response distinguishes a malformed membership role from an ordinary denial. */
export const malformedMembershipResponseSchema = z
  .object({
    error: z.literal("MALFORMED_MEMBERSHIP_ROLE"),
    message: z.string(),
    problem: z.enum(["empty", "multi-valued", "untrimmed"]),
  })
  .openapi("MalformedMembershipRole");
