import { z } from "../openapi";

export const pendingActionListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const pendingActionParamSchema = z.object({
  id: z.string().min(1).max(64),
});
