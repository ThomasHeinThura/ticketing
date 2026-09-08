import { z } from "../openapi";

export const workspaceIdQuery = z.object({ workspaceId: z.string() });
