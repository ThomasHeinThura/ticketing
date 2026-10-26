import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { getConfiguredCustomerOrigin, portalForHost } from "../auth";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireAnonymousInvitationRateLimit } from "../utils/invitation-anonymous-rate-limit";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  CUSTOMER_INVITATION_CONTINUATION_TTL_SECONDS,
  customerInvitationContinuationCookieName,
} from "./continuation-context";
import { portalAcceptScope } from "./portal-scope";
import {
  acceptCustomerInvitationFromContinuation,
  beginCustomerInvitationContinuation,
  getCustomerInvitationContinuationResult,
} from "./service";

export {
  CUSTOMER_INVITATION_CONTINUATION_TTL_SECONDS,
  customerInvitationContinuationCookieName,
};

async function customerHostOnly(c: Context, next: Next) {
  if (portalForHost(c.req.header("host")) !== "customer")
    throw new HTTPException(404, { message: "Not found" });
  await next();
}

async function rateLimitAnonymousInvite(c: Context, next: Next) {
  await requireAnonymousInvitationRateLimit(c);
  await next();
}

async function exactCustomerOrigin(c: Context, next: Next) {
  if (
    c.req.header("origin") !== getConfiguredCustomerOrigin() ||
    portalForHost(c.req.header("host")) !== "customer"
  )
    throw new HTTPException(403, { message: "csrf_origin_invalid" });
  await next();
}

const invitationParam = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
});

const continuationBody = z
  .object({ credential: z.string().min(16).max(256) })
  .strict();

const acceptedSchema = z
  .object({ accepted: z.literal(true) })
  .openapi("AcceptedCustomerInvitation");
const continuationResultSchema = z
  .object({ accepted: z.boolean() })
  .openapi("CustomerInvitationContinuationResult");

const beginRoute = createRoute({
  method: "post",
  path: "/portal/invitations/{id}/continuation",
  operationId: "beginCustomerInvitationContinuation",
  tags: ["Portal invitations"],
  summary: "Begin a short-lived customer invitation sign-in continuation",
  description:
    "Customer-host-only. Verifies the fragment credential once, stores only hash-bound continuation context, and sets a short-lived HttpOnly cookie.",
  middleware: [
    customerHostOnly,
    exactCustomerOrigin,
    rateLimitAnonymousInvite,
  ] as const,
  request: {
    params: invitationParam,
    body: {
      required: true,
      content: { "application/json": { schema: continuationBody } },
    },
  },
  responses: {
    204: { description: "Continuation created" },
    403: errorResponse("Customer portal origin required"),
    404: errorResponse("Invitation not found"),
  },
});

const acceptContinuationRoute = createRoute({
  method: "post",
  path: "/portal/invitations/{id}/accept-continuation",
  operationId: "acceptCustomerInvitationFromContinuation",
  tags: ["Portal invitations"],
  summary: "Accept a customer invitation from its provider continuation",
  description:
    "Customer-host-only. Requires an admitted customer session and the short-lived one-use HttpOnly continuation cookie. Every refusal is the same 404.",
  middleware: [
    customerHostOnly,
    requireSessionOnly(),
    portalAcceptScope,
  ] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Accepted", acceptedSchema),
    401: errorResponse("Customer session required"),
    404: errorResponse("Invitation not found"),
  },
});

const continuationResultRoute = createRoute({
  method: "get",
  path: "/portal/invitations/{id}/continuation-result",
  operationId: "getCustomerInvitationContinuationResult",
  tags: ["Portal invitations"],
  summary: "Check whether this provider flow already accepted its invitation",
  description:
    "Customer-host-only read acknowledgement bound to the exact continuation cookie and current customer session. It never accepts an invitation.",
  middleware: [
    customerHostOnly,
    requireSessionOnly(),
    portalAcceptScope,
  ] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("Continuation result", continuationResultSchema),
    401: errorResponse("Customer session required"),
    404: errorResponse("Invitation not found"),
  },
});

export const publicContinuation = apiRouter().openapi(beginRoute, async (c) => {
  c.header("Cache-Control", "no-store");
  const { id } = c.req.valid("param");
  const nonce = await beginCustomerInvitationContinuation({
    invitationId: id,
    credential: c.req.valid("json").credential,
  });
  setCookie(c, customerInvitationContinuationCookieName(id), nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: CUSTOMER_INVITATION_CONTINUATION_TTL_SECONDS,
  });
  return c.body(null, 204);
});

export const acceptContinuation = apiRouter()
  .openapi(acceptContinuationRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const name = customerInvitationContinuationCookieName(id);
    const nonce = getCookie(c, name);
    if (!nonce || !/^[A-Za-z0-9_-]{43}$/u.test(nonce))
      throw new HTTPException(404, { message: "Invitation not found" });
    await acceptCustomerInvitationFromContinuation({
      userId: c.get("userId") as string,
      invitationId: id,
      nonce,
    });
    setCookie(c, name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
    });
    return c.json({ accepted: true as const }, 200);
  })
  .openapi(continuationResultRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const { id } = c.req.valid("param");
    const name = customerInvitationContinuationCookieName(id);
    const nonce = getCookie(c, name);
    if (!nonce || !/^[A-Za-z0-9_-]{43}$/u.test(nonce))
      throw new HTTPException(404, { message: "Invitation not found" });
    const accepted = await getCustomerInvitationContinuationResult({
      userId: c.get("userId") as string,
      invitationId: id,
      nonce,
    });
    if (accepted)
      setCookie(c, name, "", {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 0,
      });
    return c.json({ accepted }, 200);
  });

const continuation = apiRouter()
  .route("/", publicContinuation)
  .route("/", acceptContinuation);

export default continuation;
