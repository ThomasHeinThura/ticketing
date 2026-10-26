import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { customerLocalAuthMethods, portalForHost } from "../auth";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";

async function customerHostOnly(c: Context, next: Next) {
  if (portalForHost(c.req.header("host")) !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  await next();
}

const methodsSchema = z
  .object({
    password: z.boolean(),
    magicLink: z.boolean(),
    emailOtp: z.boolean(),
  })
  .openapi("PortalAuthMethods");

const methodsRoute = createRoute({
  method: "get",
  path: "/portal/auth-methods",
  operationId: "getPortalAuthMethods",
  tags: ["Portal authentication"],
  summary: "List enabled local sign-in methods on the customer portal",
  description:
    "Customer-host-only. Returns only the configured local provider flags and does not reveal invitation or organisation state.",
  middleware: [customerHostOnly] as const,
  responses: {
    200: jsonResponse("Enabled local provider methods", methodsSchema),
  },
});

const authMethods = apiRouter().openapi(methodsRoute, (c) =>
  c.json(customerLocalAuthMethods(), 200),
);

export default authMethods;
