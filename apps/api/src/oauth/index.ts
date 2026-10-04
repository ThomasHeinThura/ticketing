import { apiRouter, createRoute, jsonResponse } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import getIdToken from "./controllers/get-id-token";
import { idTokenSchema } from "./response";

const getIdTokenRoute = createRoute({
  method: "get",
  operationId: "getOAuthIdToken",
  path: "/id-token",
  tags: ["Authentication"],
  summary: "Get OAuth id token",
  description:
    "Get the id_token for the current user's custom OAuth account. Returns null when the user signed in another way.",
  responses: {
    200: jsonResponse("The id_token if available", idTokenSchema),
  },
});

const oauth = apiRouter().openapi(getIdTokenRoute, async (c) => {
  const result = await getIdToken(c.get("userId"));
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(result, 200);
});

export default oauth;
