import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import {
  InactiveFactorIdentityError,
  loadLocalFactorState,
} from "./local-factor-service";

const factorStatusResponse = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
  policyMode: z.enum([
    "off",
    "optional",
    "required_staff",
    "required_role",
    "required_everyone",
  ]),
});

const statusRoute = createRoute({
  method: "get",
  operationId: "getLocalFactorStatus",
  path: "/security/factors",
  tags: ["Authentication"],
  summary: "Get local factor status",
  description:
    "Returns the current user's local factor enrollment state and whether instance policy requires a factor. Never returns factor secrets or recovery codes.",
  responses: {
    200: jsonResponse("Current local factor state", factorStatusResponse),
    403: jsonResponse(
      "The caller's identity is inactive",
      z.object({ message: z.string() }),
    ),
    503: jsonResponse(
      "Factor policy could not be validated",
      z.object({ message: z.string() }),
    ),
  },
});

const factorStatus = apiRouter().openapi(statusRoute, async (c) => {
  setShadowLegacyAuthorization(c, "allowed");
  try {
    const state = await loadLocalFactorState(c.get("userId"));
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        enabled: state.enabled,
        required: state.required,
        policyMode: state.policy.mode,
      },
      200,
    );
  } catch (error) {
    if (error instanceof InactiveFactorIdentityError) {
      setShadowLegacyAuthorization(c, "denied");
      return c.json({ message: "Forbidden" }, 403);
    }
    return c.json({ message: "Factor policy is unavailable" }, 503);
  }
});

export default factorStatus;
