import { z } from "../openapi";

export const workspaceIdQuery = z.object({
  workspaceId: z.string(),
  projectId: z.string().min(1).optional(),
});
