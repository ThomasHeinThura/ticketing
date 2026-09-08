import { z } from "../openapi";

export const capabilitiesResponseSchema = z
  .object({
    manageProjects: z.boolean(),
    createProjects: z.boolean(),
    updateProjects: z.boolean(),
    deleteProjects: z.boolean(),
    updateTasks: z.boolean(),
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
  })
  .openapi("Capabilities");
