import { z } from "../openapi";
import { MAX_TEAM_NAME_LENGTH } from "./logic";

export const workspaceIdQuery = z.object({
  workspaceId: z.string().min(1),
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export const teamIdParam = z.object({ id: z.string().min(1) });
export const teamMemberParam = z.object({
  id: z.string().min(1),
  personId: z.string().min(1),
});

const capacity = z.number().min(0).max(7).nullable();

export const createTeamBody = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(MAX_TEAM_NAME_LENGTH),
  capacityDaysPerWeek: capacity.optional(),
  isCab: z.boolean().optional(),
});

export const updateTeamBody = z
  .object({
    name: z.string().trim().min(1).max(MAX_TEAM_NAME_LENGTH).optional(),
    capacityDaysPerWeek: capacity.optional(),
    isCab: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const addTeamMemberBody = z.object({
  personId: z.string().min(1),
  isLead: z.boolean().optional(),
  allocationPct: z.number().int().min(0).max(100).nullable().optional(),
});

export const updateTeamMemberBody = z
  .object({
    isLead: z.boolean().optional(),
    allocationPct: z.number().int().min(0).max(100).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });
