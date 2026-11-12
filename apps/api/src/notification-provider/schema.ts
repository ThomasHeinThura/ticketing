import { z } from "../openapi";
import { SES_SMTP_REGIONS, type SesSmtpRegion, sesSmtpSettings } from "./ses";

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
export const EMAIL_PROVIDER_KINDS = ["smtp", "ses"] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];

const smtpConfigurationObject = z
  .object({
    captureToMailpit: withFormMetadata(z.boolean().optional(), {
      labelKey: "captureToMailpit",
      control: "checkbox",
      group: "config",
    }),
    /** Absent on rows saved before Amazon SES support; it reads as `smtp`. */
    provider: withFormMetadata(z.enum(EMAIL_PROVIDER_KINDS).optional(), {
      labelKey: "provider",
      control: "text",
      group: "config",
    }),
    /** Only for `ses`: it fixes host, port and TLS. */
    region: withFormMetadata(z.enum(SES_SMTP_REGIONS).nullable().optional(), {
      labelKey: "region",
      control: "text",
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
type SmtpConfigFields = z.infer<typeof smtpConfigurationObject>;
type IssueContext = {
  addIssue(issue: { code: "custom"; message: string; path: string[] }): void;
};

/**
 * Amazon SES fixes the connection: the region decides the host and the port, TLS is always
 * STARTTLS, and the SMTP user name is required. Whatever a client sends for those fields must be
 * exactly what the region derives, so the editor's read-only values cannot drift from the server.
 */
function enforceProviderChoice(config: SmtpConfigFields, ctx: IssueContext) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", message, path: [path] });
  if ((config.provider ?? "smtp") !== "ses") {
    if (config.region != null)
      issue("region", "A region is only valid for Amazon SES");
    return;
  }
  if (config.captureToMailpit === true)
    issue(
      "captureToMailpit",
      "Local capture cannot be combined with Amazon SES",
    );
  if (!config.region) {
    issue("region", "Choose an Amazon SES region");
    return;
  }
  const fixed = sesSmtpSettings(config.region);
  if (config.host !== fixed.host) issue("host", "Host is fixed by the region");
  if (config.port !== fixed.port) issue("port", "Port is fixed to 587");
  if (config.secure !== fixed.secure)
    issue("secure", "Amazon SES uses STARTTLS, not implicit TLS");
  if (config.requireTLS !== fixed.requireTLS)
    issue("requireTLS", "Amazon SES requires STARTTLS");
  if (config.username === null)
    issue("username", "The SES SMTP user name is required");
}

export const smtpConfigurationSchema = smtpConfigurationObject.superRefine(
  enforceProviderChoice,
);
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

/** Failure categories a test send reports; the editor maps each to its own message. */
export const SMTP_TEST_FAILURE_CATEGORIES = [
  "authentication",
  "starttls_required",
  "message_rejected",
  "throttled",
  "temporary",
  "rejected",
  "connection",
  "tls",
  "timeout",
  "failed",
] as const;
export type SmtpTestFailureCategory =
  (typeof SMTP_TEST_FAILURE_CATEGORIES)[number];

const testTimestamp = z.string().datetime({ offset: true });
/** What the editor shows under the title. `never`: no result exists for the saved settings. */
export const emailTestStatusSchema = z.object({
  state: z.enum(["never", "verified", "failed", "stale"]),
  testedAt: testTimestamp.nullable(),
  smtpCode: z.number().int().min(200).max(599).nullable(),
  category: z.enum(SMTP_TEST_FAILURE_CATEGORIES).nullable(),
});
export type EmailTestStatus = z.infer<typeof emailTestStatusSchema>;
/** The persisted form: `never` is the absence of the key, so it is never stored. */
const storedTestStatusSchema = z
  .object({
    state: z.enum(["verified", "failed", "stale"]),
    testedAt: testTimestamp.nullable(),
    smtpCode: z.number().int().min(200).max(599).nullable(),
    category: z.enum(SMTP_TEST_FAILURE_CATEGORIES).nullable(),
  })
  .strict();
export type StoredTestStatus = z.infer<typeof storedTestStatusSchema>;

/**
 * The stored `config` document: the administrator-written settings plus the server-written
 * `lastTest`. Clients can never write `lastTest` (the write schemas are the plain settings), and
 * every reader of the stored document goes through `parseStoredEmailConfig`, because the strict
 * settings schema rejects the extra key.
 */
const storedSmtpConfigurationSchema = z
  .object({
    ...smtpConfigurationObject.shape,
    lastTest: storedTestStatusSchema.optional(),
  })
  .strict()
  .superRefine(enforceProviderChoice);

export function parseStoredEmailConfig(
  value: unknown,
): { config: SmtpConfig; lastTest: StoredTestStatus | null } | null {
  const parsed = storedSmtpConfigurationSchema.safeParse(value);
  if (!parsed.success) return null;
  const { lastTest, ...config } = parsed.data;
  return { config, lastTest: lastTest ?? null };
}

/** The document written to the row: settings plus, when there is one, the test status. */
export function storedEmailConfig(
  config: SmtpConfig,
  lastTest: StoredTestStatus | null,
): Record<string, unknown> {
  return lastTest ? { ...config, lastTest } : { ...config };
}

export function emailTestStatus(
  lastTest: StoredTestStatus | null,
): EmailTestStatus {
  return (
    lastTest ?? {
      state: "never",
      testedAt: null,
      smtpCode: null,
      category: null,
    }
  );
}

export function emailProviderKind(config: SmtpConfig): EmailProviderKind {
  return config.provider ?? "smtp";
}

/** Defaults filled in, so two spellings of the same settings compare equal. */
export function normaliseSmtpConfig(config: SmtpConfig) {
  return {
    provider: emailProviderKind(config),
    region: (config.region ?? null) as SesSmtpRegion | null,
    captureToMailpit: config.captureToMailpit === true,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    username: config.username,
    fromAddress: config.fromAddress,
    replyTo: config.replyTo,
  };
}

export function sameSmtpConfig(left: SmtpConfig, right: SmtpConfig): boolean {
  return (
    JSON.stringify(normaliseSmtpConfig(left)) ===
    JSON.stringify(normaliseSmtpConfig(right))
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
export type EmailProviderWrite = z.infer<typeof writeProviderSchema>;
export const testProviderSchema = z
  .object({
    version: z.number().int().min(0).safe(),
    config: smtpConfigurationSchema.optional(),
    password: z.string().min(1).max(16_384).nullable().optional(),
    /** Where the test message is sent; the editor defaults it to the signed-in administrator. */
    recipient: header.email(),
  })
  .strict();
export const testResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    testedAt: testTimestamp,
    /** Only the domain of the recipient is ever recorded or echoed. */
    recipientDomain: z.string().min(1).max(253),
    /** Whether the result was stored as the saved settings' status. */
    persisted: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    testedAt: testTimestamp,
    category: z.enum(SMTP_TEST_FAILURE_CATEGORIES),
    smtpCode: z.number().int().min(200).max(599).nullable(),
    /** Sanitised provider reply for unauthenticated attempts; null for authenticated attempts. */
    providerText: z.string().max(240).nullable(),
    persisted: z.boolean(),
  }),
]);
export type TestResult = z.infer<typeof testResultSchema>;
export const providerResponseSchema = z.object({
  version: z.number().int().min(0).safe(),
  source: z.enum(["runtime", "bootstrap", "unconfigured"]),
  enabled: z.boolean(),
  config: smtpConfigurationSchema.nullable(),
  passwordConfigured: z.boolean(),
  passwordPreview: z.literal("••••••••").nullable(),
  localMailpitCaptureAvailable: z.boolean(),
  testStatus: emailTestStatusSchema,
  /** Amazon SES regions the editor offers, each with the SMTP host the server derives. */
  sesRegions: z.array(
    z.object({ region: z.enum(SES_SMTP_REGIONS), host: z.string() }),
  ),
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
