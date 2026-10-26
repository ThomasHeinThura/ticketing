import { z } from "../openapi";

type FormControl =
  | "text"
  | "email"
  | "number"
  | "checkbox"
  | "switch"
  | "password";
type FormFieldMetadata = {
  labelKey: string;
  control: FormControl;
  group: "provider" | "config" | "secret";
};

function withFormMetadata<T extends z.ZodType>(
  schema: T,
  metadata: FormFieldMetadata,
): T {
  return schema.meta({ "x-taskdesk-form": metadata });
}

const header = z
  .string()
  .max(320)
  .refine((value) => !/[\r\n\0]/u.test(value), "Invalid header characters");
export const smtpConfigurationSchema = z
  .object({
    captureToMailpit: withFormMetadata(z.boolean().optional(), {
      labelKey: "captureToMailpit",
      control: "checkbox",
      group: "config",
    }),
    host: withFormMetadata(
      z
        .string()
        .min(1)
        .max(253)
        .regex(/^[a-zA-Z0-9.:[\]-]+$/u, "Expected a hostname or IP address"),
      { labelKey: "host", control: "text", group: "config" },
    ),
    port: withFormMetadata(z.number().int().min(1).max(65535), {
      labelKey: "port",
      control: "number",
      group: "config",
    }),
    secure: withFormMetadata(z.boolean(), {
      labelKey: "secure",
      control: "checkbox",
      group: "config",
    }),
    requireTLS: withFormMetadata(z.boolean(), {
      labelKey: "requireTLS",
      control: "checkbox",
      group: "config",
    }),
    username: withFormMetadata(header.min(1).nullable(), {
      labelKey: "username",
      control: "text",
      group: "config",
    }),
    fromAddress: withFormMetadata(header.email(), {
      labelKey: "fromAddress",
      control: "email",
      group: "config",
    }),
    replyTo: withFormMetadata(header.email().nullable(), {
      labelKey: "replyTo",
      control: "email",
      group: "config",
    }),
  })
  .strict();
export type SmtpConfig = z.infer<typeof smtpConfigurationSchema>;

/** The persisted capture mode is a single fixed local Compose destination. */
export function isValidMailpitCaptureConfig(config: SmtpConfig): boolean {
  return (
    config.captureToMailpit !== true ||
    (config.host === "mailpit" &&
      config.port === 1025 &&
      config.secure === false &&
      config.requireTLS === false &&
      config.username === null)
  );
}

export function isLocalMailpitCaptureEnabled(): boolean {
  const hasExactOrigin = (value: string | undefined, expected: string) => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return (
        url.origin === expected &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  };
  return (
    process.env.TASKDESK_LOCAL_MAILPIT_CAPTURE === "true" &&
    hasExactOrigin(
      process.env.TASKDESK_AGENT_URL,
      "https://ticketing.localhost",
    ) &&
    hasExactOrigin(process.env.TASKDESK_PORTAL_URL, "https://portal.localhost")
  );
}
export const writeProviderSchema = z
  .object({
    version: z.number().int().min(0).safe(),
    enabled: withFormMetadata(z.boolean(), {
      labelKey: "enabled",
      control: "switch",
      group: "provider",
    }),
    config: smtpConfigurationSchema.optional(),
    password: withFormMetadata(
      z.string().min(1).max(16_384).nullable().optional(),
      { labelKey: "password", control: "password", group: "secret" },
    ),
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
  localMailpitCaptureAvailable: z.boolean(),
});

const supportedFormControls = new Set<FormControl>([
  "text",
  "email",
  "number",
  "checkbox",
  "switch",
  "password",
]);

export type PluginSettingsFormField = {
  key: string;
  labelKey: string;
  control: FormControl;
  group: FormFieldMetadata["group"];
  required: boolean;
  nullable: boolean;
  secret: boolean;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type PluginSettingsFormManifest = {
  version: 1;
  available: true;
  fields: PluginSettingsFormField[];
};

type JsonSchemaNode = {
  type?: string | string[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

function metadataFor(schema: z.ZodType): FormFieldMetadata | null {
  const meta = schema.meta();
  if (typeof meta !== "object" || meta === null) return null;
  const form = (meta as { "x-taskdesk-form"?: unknown })["x-taskdesk-form"];
  if (typeof form !== "object" || form === null) return null;
  const candidate = form as Partial<FormFieldMetadata>;
  if (
    typeof candidate.labelKey !== "string" ||
    !/^[A-Za-z][A-Za-z0-9_.]*$/u.test(candidate.labelKey) ||
    typeof candidate.control !== "string" ||
    !supportedFormControls.has(candidate.control as FormControl) ||
    (candidate.group !== "provider" &&
      candidate.group !== "config" &&
      candidate.group !== "secret")
  )
    return null;
  return candidate as FormFieldMetadata;
}

function jsonSchemaFor(schema: z.ZodType): JsonSchemaNode | null {
  try {
    return z.toJSONSchema(schema, { io: "input" }) as JsonSchemaNode;
  } catch {
    return null;
  }
}

function fieldFromSchema(
  key: string,
  schema: z.ZodType,
  required: boolean,
): PluginSettingsFormField | null {
  const metadata = metadataFor(schema);
  const jsonSchema = jsonSchemaFor(schema);
  if (!metadata || !jsonSchema) return null;
  const variants = jsonSchema.anyOf ?? jsonSchema.oneOf ?? [jsonSchema];
  const valueSchema = variants.find((variant) => variant.type !== "null");
  if (!valueSchema) return null;
  const types = Array.isArray(valueSchema.type)
    ? valueSchema.type
    : valueSchema.type
      ? [valueSchema.type]
      : [];
  const validType =
    metadata.control === "number"
      ? types.includes("number") || types.includes("integer")
      : metadata.control === "checkbox" || metadata.control === "switch"
        ? types.includes("boolean")
        : types.includes("string");
  if (!validType) return null;
  return {
    key,
    labelKey: metadata.labelKey,
    control: metadata.control,
    group: metadata.group,
    required,
    nullable: variants.some((variant) => variant.type === "null"),
    secret: metadata.group === "secret",
    ...(valueSchema.format ? { format: valueSchema.format } : {}),
    ...(typeof valueSchema.minimum === "number"
      ? { minimum: valueSchema.minimum }
      : {}),
    ...(typeof valueSchema.maximum === "number"
      ? { maximum: valueSchema.maximum }
      : {}),
    ...(typeof valueSchema.minLength === "number"
      ? { minLength: valueSchema.minLength }
      : {}),
    ...(typeof valueSchema.maxLength === "number"
      ? { maxLength: valueSchema.maxLength }
      : {}),
    ...(typeof valueSchema.pattern === "string"
      ? { pattern: valueSchema.pattern }
      : {}),
  };
}

/** Safe client-side form shape derived from the same Zod schemas used by writes. */
export function smtpSettingsFormManifest():
  | PluginSettingsFormManifest
  | { version: 1; available: false } {
  const configRequired =
    (
      z.toJSONSchema(smtpConfigurationSchema, { io: "input" }) as {
        required?: string[];
      }
    ).required ?? [];
  const writeRequired =
    (
      z.toJSONSchema(writeProviderSchema, { io: "input" }) as {
        required?: string[];
      }
    ).required ?? [];
  const fields: PluginSettingsFormField[] = [];
  const enabled = fieldFromSchema(
    "enabled",
    writeProviderSchema.shape.enabled,
    writeRequired.includes("enabled"),
  );
  if (!enabled) return { version: 1, available: false };
  fields.push(enabled);
  for (const key of Object.keys(smtpConfigurationSchema.shape) as Array<
    keyof typeof smtpConfigurationSchema.shape
  >) {
    const field = fieldFromSchema(
      `config.${key}`,
      smtpConfigurationSchema.shape[key],
      configRequired.includes(key),
    );
    if (!field) return { version: 1, available: false };
    fields.push(field);
  }
  const password = fieldFromSchema(
    "password",
    writeProviderSchema.shape.password,
    writeRequired.includes("password"),
  );
  if (!password) return { version: 1, available: false };
  fields.push(password);
  return { version: 1, available: true, fields };
}
