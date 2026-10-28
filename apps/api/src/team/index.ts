import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import {
  assertCallerHasCapability,
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import type { GovernanceActor } from "./audit";
import { TEAM_DELETION_ROUTE } from "./deletion-target";
import { rosterEditAllowed } from "./logic";
import {
  addMember,
  createTeam,
  deletionBlockers,
  getTeam,
  getTeamWorkspace,
  isLeadOfTeam,
  listCandidates,
  listMembers,
  listTeams,
  removeMember,
  updateMember,
  updateTeam,
} from "./repository";
import {
  okSchema,
  teamDetailSchema,
  teamListSchema,
  teamSchema,
} from "./response";
import {
  addTeamMemberBody,
  createTeamBody,
  teamIdParam,
  teamMemberParam,
  updateTeamBody,
  updateTeamMemberBody,
  workspaceIdQuery,
} from "./schema";

function actorOf(c: Context): GovernanceActor {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  return {
    userId: c.get("userId") as string,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

async function holdsManageSettings(c: Context): Promise<boolean> {
  try {
    await assertCallerHasCapability(
      c.get("workspaceId") as string,
      c.get("userId") as string,
      "workspace:manage_settings",
      capabilityCredential(c.get("apiKey")),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

/** Resolve the team's workspace from the row and require access; a foreign row is a 404. */
async function teamReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing team id" });
  rejectNulByte(id, "Team id");
  const team = await getTeamWorkspace(id);
  if (!team) throw new HTTPException(404, { message: "Team not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      team.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Team not found" });
    throw error;
  }
  c.set("workspaceId", team.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

/** TM-3: manage_settings, or a lead of this very team (browser sessions only). */
async function requireRosterEdit(c: Context, next: Next) {
  const apiKey = c.get("apiKey");
  const allowed = rosterEditAllowed({
    canManageSettings: await holdsManageSettings(c),
    isLeadOfTeam: await isLeadOfTeam(
      c.req.param("id") ?? "",
      c.get("userId") as string,
    ),
    credential: apiKey ? "api_key" : "session",
  });
  if (!allowed)
    throw new HTTPException(403, { message: "Insufficient permissions" });
  await next();
}

const manageSettings = [
  requireApiKeyPermissionScope({ workspace: ["manage_settings"] }),
  requireWorkspaceCapability("workspace:manage_settings"),
] as const;
const read = [
  requireApiKeyPermissionScope({ workspace: ["read"] }),
  requireWorkspaceCapability("workspace:read"),
] as const;

const listRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "listTeams",
  tags: ["Teams"],
  summary: "List teams",
  middleware: [workspaceAccess.fromQuery(), ...read] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Teams in the workspace", teamListSchema),
    403: errorResponse("Missing workspace:read permission"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/",
  operationId: "createTeam",
  tags: ["Teams"],
  summary: "Create a team",
  middleware: [workspaceAccess.fromBody(), ...manageSettings] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTeamBody } },
    },
  },
  responses: {
    200: jsonResponse("Created team", teamSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
    409: errorResponse("Another team is already the CAB team"),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getTeam",
  tags: ["Teams"],
  summary: "Get a team with its roster",
  middleware: [teamReach, ...read] as const,
  request: {
    params: teamIdParam,
    query: workspaceIdQuery.omit({ workspaceId: true }),
  },
  responses: {
    200: jsonResponse("The team", teamDetailSchema),
    403: errorResponse("Missing workspace:read permission"),
    404: errorResponse("Team not found"),
  },
});
const updateRouteDef = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "updateTeam",
  tags: ["Teams"],
  summary: "Rename a team, set capacity or the CAB flag",
  description:
    "At most one team per workspace may be the CAB team (TM-5); a second designation is a 409.",
  middleware: [teamReach, ...manageSettings] as const,
  request: {
    params: teamIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTeamBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated team", teamSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
    404: errorResponse("Team not found"),
    409: errorResponse("Another team is already the CAB team"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteTeam",
  tags: ["Teams"],
  summary: "Delete a team",
  description:
    "Request deletion (202 pending action, click approval). Refused while the team is the CAB or has saved views shared with it (TM-7).",
  middleware: [teamReach, ...manageSettings] as const,
  request: { params: teamIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Missing workspace:manage_settings permission"),
    404: errorResponse("Team not found"),
    409: errorResponse("The team still has dependents"),
  },
});
const addMemberRoute = createRoute({
  method: "post",
  path: "/{id}/members",
  operationId: "addTeamMember",
  tags: ["Teams"],
  summary: "Add a staff member to a team",
  description:
    "workspace:manage_settings, or a lead of this team. Customer-side people are refused (TM-2).",
  middleware: [teamReach, requireRosterEdit] as const,
  request: {
    params: teamIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: addTeamMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("Added", okSchema),
    400: errorResponse("The person cannot be a team member"),
    403: errorResponse("Not permitted to edit this roster"),
    404: errorResponse("Team or person not found"),
    409: errorResponse("Already a member"),
  },
});
const updateMemberRoute = createRoute({
  method: "patch",
  path: "/{id}/members/{personId}",
  operationId: "updateTeamMember",
  tags: ["Teams"],
  summary: "Set a member's lead flag or allocation",
  middleware: [teamReach, requireRosterEdit] as const,
  request: {
    params: teamMemberParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTeamMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated", okSchema),
    403: errorResponse("Not permitted to edit this roster"),
    404: errorResponse("Team or member not found"),
  },
});
const removeMemberRoute = createRoute({
  method: "delete",
  path: "/{id}/members/{personId}",
  operationId: "removeTeamMember",
  tags: ["Teams"],
  summary: "Remove a member from a team",
  description:
    "Past decisions are kept; pending CAB approvals of a removed CAB member become undecidable by them (TM-6). The last lead may be removed.",
  middleware: [teamReach, requireRosterEdit] as const,
  request: { params: teamMemberParam },
  responses: {
    200: jsonResponse("Removed", okSchema),
    403: errorResponse("Not permitted to edit this roster"),
    404: errorResponse("Team or member not found"),
  },
});

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json({ data: await listTeams(c.req.valid("query").workspaceId) }, 200),
  )
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    return c.json(await createTeam({ ...body, actor: actorOf(c) }), 200);
  })
  .openapi(detailRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const team = await getTeam(c.req.valid("param").id, workspaceId);
    if (!team) throw new HTTPException(404, { message: "Team not found" });
    const canManageTeam = await holdsManageSettings(c);
    const lead = await isLeadOfTeam(team.id, c.get("userId"));
    const canEditRoster = rosterEditAllowed({
      canManageSettings: canManageTeam,
      isLeadOfTeam: lead,
      credential: c.get("apiKey") ? "api_key" : "session",
    });
    return c.json(
      {
        ...team,
        candidates: canEditRoster ? await listCandidates(db, team) : [],
        members: await listMembers(
          db,
          team.id,
          c.req.valid("query").includeInactive,
        ),
        canManageTeam,
        canEditRoster,
        deletionBlockers: await deletionBlockers(db, team),
      },
      200,
    );
  })
  .openapi(updateRouteDef, async (c) => {
    const updated = await updateTeam(
      c.req.valid("param").id,
      c.get("workspaceId"),
      c.req.valid("json"),
      actorOf(c),
    );
    if (!updated) throw new HTTPException(404, { message: "Team not found" });
    return c.json(updated, 200);
  })
  .openapi(deleteRoute, async (c) => {
    const id = c.req.valid("param").id;
    const team = await getTeam(id, c.get("workspaceId"));
    if (!team) throw new HTTPException(404, { message: "Team not found" });
    const blockers = await deletionBlockers(db, team);
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: TEAM_DELETION_ROUTE,
      targetType: "team",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  })
  .openapi(addMemberRoute, async (c) => {
    const added = await addMember(
      c.req.valid("param").id,
      c.get("workspaceId"),
      c.req.valid("json"),
      actorOf(c),
    );
    if (!added) throw new HTTPException(404, { message: "Team not found" });
    return c.json({ ok: true as const }, 200);
  })
  .openapi(updateMemberRoute, async (c) => {
    const { id, personId } = c.req.valid("param");
    const updated = await updateMember(
      id,
      c.get("workspaceId"),
      personId,
      c.req.valid("json"),
      actorOf(c),
    );
    if (!updated)
      throw new HTTPException(404, { message: "Team member not found" });
    return c.json({ ok: true as const }, 200);
  })
  .openapi(removeMemberRoute, async (c) => {
    const { id, personId } = c.req.valid("param");
    const removed = await removeMember(
      id,
      c.get("workspaceId"),
      personId,
      actorOf(c),
    );
    if (!removed)
      throw new HTTPException(404, { message: "Team member not found" });
    return c.json({ ok: true as const }, 200);
  });

export default router;
