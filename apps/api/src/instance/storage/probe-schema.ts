import { z } from "../../openapi";

export const storageProbeResponseSchema = z.object({
  status: z.enum([
    "verified",
    "write_failed",
    "read_failed",
    "content_mismatch",
    "timed_out",
    "cleanup_failed",
    "cleanup_indeterminate",
  ]),
  cleanup: z.enum(["confirmed", "failed", "indeterminate", "not_attempted"]),
  diagnosticObjectMayRemain: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
