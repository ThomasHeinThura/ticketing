import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../../auth";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import { listSupportedPlugins } from "./catalog";

const path = "/plugins";
const errorSchema = z.object({ message: z.string() });
const settingsFormFieldSchema = z
  .object({
    key: z.string().min(1).max(128),
    labelKey: z.string().min(1).max(128),
    control: z.enum([
      "text",
      "email",
      "number",
      "checkbox",
      "switch",
      "password",
    ]),
    group: z.enum(["provider", "config", "secret"]),
    required: z.boolean(),
    nullable: z.boolean(),
    secret: z.boolean(),
    format: z.string().max(64).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().max(256).optional(),
  })
  .strict();
const settingsFormSchema = z.union([
  z
    .object({
      version: z.literal(1),
      available: z.literal(true),
      fields: z.array(settingsFormFieldSchema).max(64),
    })
    .strict(),
  z.object({ version: z.literal(1), available: z.literal(false) }).strict(),
]);
const pluginSchema = z.object({
  id: z.literal("notify.email"),
  name: z.literal("Email"),
  kind: z.literal("notification"),
  state: z.enum(["unconfigured", "enabled", "disabled", "invalid"]),
  source: z.enum(["runtime", "bootstrap", "unconfigured"]),
  configVersion: z.number().int().nonnegative(),
  credentialConfigured: z.boolean(),
  settingsForm: settingsFormSchema,
});
const responseSchema = z.object({
  checkedAt: z.string().datetime(),
  plugins: z.array(pluginSchema),
});

const getRoute = createRoute({
  method: "get",
  path,
  operationId: "listSupportedInstancePlugins",
  tags: ["Instance"],
  summary: "List supported instance plugin configuration",
  description:
    "Lists only plugins with a real supported instance configuration runtime. Secret values and plugin configuration are omitted.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Supported instance plugins", responseSchema),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

const router = apiRouter().openapi(getRoute, async (c) => {
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  await requireCurrentInstanceAdmin(c, "GET", "/api/instance/plugins");
  c.header("Cache-Control", "no-store");
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(
    {
      checkedAt: new Date().toISOString(),
      plugins: await listSupportedPlugins(),
    },
    200,
  );
});

export default router;
