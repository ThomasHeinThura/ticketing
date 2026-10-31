import { z } from "../openapi";

/**
 * Local (non-OIDC) sign-in methods per portal, configured from God Mode. Each method is one
 * `instance_plugin_config` row per plugin and portal (`instance_key` = `agent` | `customer`).
 */
export const LOCAL_AUTH_METHOD_PLUGINS = [
  ["auth.password", "password"],
  ["auth.magic-link", "magicLink"],
  ["auth.email-otp", "emailOtp"],
] as const;

export const LOCAL_AUTH_PORTALS = ["agent", "customer"] as const;

export const localAuthMethodSetSchema = z
  .object({
    password: z.boolean(),
    magicLink: z.boolean(),
    emailOtp: z.boolean(),
  })
  .strict()
  .openapi("LocalAuthMethodSet");

/** Opaque revision of the stored rows; a write names the revision it was made against. */
export const localAuthMethodsRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .openapi({ description: "Opaque revision of the stored method rows" });

/** The PUT body, also the PA-15 binding of `auth_local_methods_update`. */
export const localAuthMethodsBody = z
  .object({
    agent: localAuthMethodSetSchema,
    customer: localAuthMethodSetSchema,
    expectedRevision: localAuthMethodsRevisionSchema,
  })
  .strict()
  .openapi("LocalAuthMethodsUpdate");

export type LocalAuthMethodsRequest = z.infer<typeof localAuthMethodsBody>;
