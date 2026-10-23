import { z } from "../openapi";

const header = z
  .string()
  .max(320)
  .refine((value) => !/[\r\n\0]/u.test(value), "Invalid header characters");
export const smtpConfigurationSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]-]+$/u, "Expected a hostname or IP address"),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    requireTLS: z.boolean(),
    username: header.min(1).nullable(),
    fromAddress: header.email(),
    replyTo: header.email().nullable(),
  })
  .strict();
export type SmtpConfig = z.infer<typeof smtpConfigurationSchema>;
export const writeProviderSchema = z
  .object({
    version: z.number().int().min(0).safe(),
    enabled: z.boolean(),
    config: smtpConfigurationSchema.optional(),
    password: z.string().min(1).max(16_384).nullable().optional(),
  })
  .strict();
export const testProviderSchema = z
  .object({
    version: z.number().int().min(0).safe(),
    config: smtpConfigurationSchema.optional(),
    password: z.string().min(1).max(16_384).nullable().optional(),
  })
  .strict();
export const providerResponseSchema = z.object({
  version: z.number().int().min(0).safe(),
  source: z.enum(["runtime", "bootstrap", "unconfigured"]),
  enabled: z.boolean(),
  config: smtpConfigurationSchema.nullable(),
  passwordConfigured: z.boolean(),
  passwordPreview: z.literal("••••••••").nullable(),
});
