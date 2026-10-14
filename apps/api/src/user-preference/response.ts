import { z } from "../openapi";

export const settingsSchema = z
  .object({
    settings: z.record(z.string(), z.unknown()).openapi({
      description:
        "The caller's stored settings keyed by settings key, e.g. `density` and `layout.<projectId>`.",
    }),
  })
  .openapi("MeSettings");
