import type { $ZodConfig } from "zod/v4/core";

// Zod supports pre-populating this shared config before import; avoid loading it at startup.
const runtime = globalThis as typeof globalThis & {
  __zod_globalConfig?: $ZodConfig;
};
runtime.__zod_globalConfig ??= {};
runtime.__zod_globalConfig.jitless = true;
