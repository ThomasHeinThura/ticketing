import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveIdentity } from "../permissions/resolve-identity";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  findInvitableOrganisation,
  listCustomerInvitations,
  listInvitableOrganisations,
} from "./repository";
import {
  acceptedCustomerInvitationSchema,
  customerInvitationListSchema,
  customerInvitationSentSchema,
  customerOrganisationListSchema,
} from "./response";
import {
  acceptCustomerInvitationBody,
  createCustomerInvitationBody,
  invitationParam,
  organisationParam,
  portalInvitationParam,
  workspaceParam,
} from "./schema";
import {
  acceptCustomerInvitation,
  assertCreateBodyIsCustomerOnly,
  createCustomerInvitation,
  type InviteActor,
  resendCustomerInvitation,
} from "./service";

/**
 * Customer invitations (CP-20..CP-26). Agent side: workspace-scoped `member:invite` over a browser
 * session (never an API key or MCP key), naming a customer organisation. Revoke is the existing
 * `DELETE /api/invitation/{id}` pending-action route. Portal side: accept, by an admitted customer
 * session that carries the credential from the email link.
 */

type Vars = BaseVariables & {
  workspaceId: string;
  portalPredicateSatisfied: boolean;
};

const manage = [
  requireSessionOnly(),
  workspaceAccess.fromParam("workspaceId"),
  requireWorkspaceCapability("member:invite"),
] as const;

/** The caller's live identity: reach for CP-20 is read at the request, never cached on the session. */
async function callerIdentity(c: Context) {
  const identity = await resolveIdentity({
    userId: c.get("userId") as string,
    credential: "session",
  });
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

function actorOf(c: Context): InviteActor {
  return {
    userId: c.get("userId") as string,
    actorType: "person",
    apiKeyId: null,
  };
}

const listOrganisationsRoute = createRoute({
  method: "get",
  path: "/workspace/{workspaceId}/customer-organisations",
  operationId: "listInvitableCustomerOrganisations",
  tags: ["Customer invitations"],
  summary: "List the customer organisations an invitation may name",
  middleware: [...manage] as const,
  request: { params: workspaceParam },
  responses: {
    200: jsonResponse("Organisations", customerOrganisationListSchema),
    403: errorResponse("Missing member:invite"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/workspace/{workspaceId}/organisations/{organisationId}/invitations",
  operationId: "listCustomerInvitations",
  tags: ["Customer invitations"],
  summary: "List an organisation's customer invitations with status",
  description:
    "Status is pending, accepted, revoked or expired. The accept credential is never returned.",
  middleware: [...manage] as const,
  request: { params: organisationParam },
  responses: {
    200: jsonResponse("Invitations", customerInvitationListSchema),
    403: errorResponse("Missing member:invite"),
    404: errorResponse("Organisation not found"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/workspace/{workspaceId}/organisations/{organisationId}/invitations",
  operationId: "createCustomerInvitation",
  tags: ["Customer invitations"],
  summary: "Invite an address into a customer organisation",
  description:
    "Always the customer role. A body that names any other role, a team or a scope is refused 422. The accept link is emailed; it is never in the response. An address that cannot accept here (a member, staff, another organisation's customer, a deactivated customer) is answered exactly like any other address: a pending row with no credential and no email, the reason audited only. `delivered` reports only whether an email provider is configured on the instance, never the outcome of a particular send.",
  middleware: [...manage] as const,
  request: {
    params: organisationParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: createCustomerInvitationBody },
      },
    },
  },
  responses: {
    201: jsonResponse("The invitation", customerInvitationSentSchema),
    403: errorResponse("Missing member:invite"),
    404: errorResponse("Organisation not found"),
    409: errorResponse("An invitation for this address is already pending"),
    422: errorResponse("A role other than customer was requested"),
    429: errorResponse("Too many invitations were created recently"),
  },
});

const resendRoute = createRoute({
  method: "post",
  path: "/workspace/{workspaceId}/organisations/{organisationId}/invitations/{id}/resend",
  operationId: "resendCustomerInvitation",
  tags: ["Customer invitations"],
  summary: "Resend a pending customer invitation",
  description:
    "Issues a fresh accept credential, invalidates the previous one and extends expiry. An inert row is re-evaluated: if its address can now be invited it gets a credential and is sent normally. `delivered` reports only whether an email provider is configured.",
  middleware: [...manage] as const,
  request: { params: invitationParam },
  responses: {
    200: jsonResponse("The invitation", customerInvitationSentSchema),
    403: errorResponse("Missing member:invite"),
    404: errorResponse("Invitation not found"),
    409: errorResponse("Not pending"),
    429: errorResponse("Sent a moment ago"),
  },
});

/** A customer session of an active customer person; the person's own organisation is the scope. */
async function portalAcceptScope(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const [person] = await db
    .select({ organisationId: schema.personTable.organisationId })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person)
    throw new HTTPException(404, { message: "Invitation not found" });
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", person.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}

const acceptRoute = createRoute({
  method: "post",
  path: "/portal/invitations/{id}/accept",
  operationId: "acceptCustomerInvitation",
  tags: ["Portal invitations"],
  summary: "Accept a customer invitation",
  description:
    "Portal host only. The signed-in customer session's verified address must equal the invitation address and the body must carry the credential from the email link. Every refusal is the same 404.",
  middleware: [portalAcceptScope] as const,
  request: {
    params: portalInvitationParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: acceptCustomerInvitationBody },
      },
    },
  },
  responses: {
    200: jsonResponse("Accepted", acceptedCustomerInvitationSchema),
    404: errorResponse("Invitation not valid"),
  },
});

const customerInvitation = apiRouter<Vars>()
  .openapi(listOrganisationsRoute, async (c) =>
    c.json(
      {
        organisations: await listInvitableOrganisations(
          c.req.valid("param").workspaceId,
          await callerIdentity(c),
        ),
      },
      200,
    ),
  )
  .openapi(listRoute, async (c) => {
    const { workspaceId, organisationId } = c.req.valid("param");
    const identity = await callerIdentity(c);
    if (
      !(await findInvitableOrganisation(
        db,
        workspaceId,
        organisationId,
        identity,
      ))
    )
      throw new HTTPException(404, { message: "Organisation not found" });
    return c.json(
      {
        invitations: await listCustomerInvitations(
          db,
          workspaceId,
          organisationId,
          new Date(),
        ),
      },
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const { workspaceId, organisationId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = actorOf(c);
    const scope = { workspaceId, organisationId };
    await assertCreateBodyIsCustomerOnly(body, actor, scope);
    const created = await createCustomerInvitation({
      actor,
      identity: await callerIdentity(c),
      scope,
      email: body.email,
    });
    return c.json(created, 201);
  })
  .openapi(resendRoute, async (c) => {
    const { workspaceId, organisationId, id } = c.req.valid("param");
    const resent = await resendCustomerInvitation({
      actor: actorOf(c),
      identity: await callerIdentity(c),
      scope: { workspaceId, organisationId },
      invitationId: id,
    });
    return c.json(resent, 200);
  })
  .openapi(acceptRoute, async (c) => {
    await acceptCustomerInvitation({
      userId: c.get("userId") as string,
      invitationId: c.req.valid("param").id,
      credential: c.req.valid("json").credential,
    });
    return c.json({ accepted: true as const }, 200);
  });

export default customerInvitation;
