import { z } from "../openapi";
import { CATALOGUE_KEY_PATTERN } from "./catalogue-key";

export const labelParam = z.object({ id: z.string() });

export const taskIdParam = z.object({ taskId: z.string() });

export const workspaceIdParam = z.object({ workspaceId: z.string() });

export const createLabelBody = z
  .object({
    name: z.string(),
    color: z.string(),
    workspaceId: z.string(),
    taskId: z.string().optional(),
    key: z.string().regex(CATALOGUE_KEY_PATTERN).optional(),
  })
  .refine((value) => !value.taskId || value.key === undefined, {
    message: "Task labels do not have catalogue keys",
    path: ["key"],
  });

export const updateLabelBody = z
  .object({
    name: z.string(),
    color: z.string(),
  })
  .strict();

export const attachLabelBody = z.object({ taskId: z.string() });
