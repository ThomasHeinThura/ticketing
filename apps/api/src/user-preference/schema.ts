import { z } from "../openapi";

// Semantic validation (key whitelist, per-key value schema) is done in the service and
// answered `422` per settings-hierarchy.md ST-15. The body schema only rejects a body that is
// not a JSON object (`400`).
export const patchSettingsBody = z.record(z.string(), z.unknown()).openapi({
  description:
    "A partial object of whitelisted settings keys (`density`, `layout.<projectId>`). A `null` value clears that key.",
});
