import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import type { ResolveIdentityInput } from "../permissions/resolve-identity";
import { resolveRequestIdentity } from "../permissions/resolve-request-identity";
import { apiKeyCapabilitySubset } from "../utils/require-api-key-permission-scope";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createWorkflow, {
  WorkflowKeyTakenError,
} from "./controllers/create-workflow";
import createWorkflowVersion from "./controllers/create-workflow-version";
import getWorkflow from "./controllers/get-workflow";
import listWorkflows from "./controllers/list-workflows";
import publishWorkflowVersion from "./controllers/publish-workflow-version";
import validateWorkflowVersion from "./controllers/validate-workflow-version";
import {
  workflowListSchema,
  workflowVersionSchema,
  workflowVersionValidationSchema,
  workflowWithVersionsSchema,
} from "./response";
import {
  createWorkflowBody,
  createWorkflowVersionBody,
  workflowIdParam,
  workflowVersionParam,
  workspaceIdQuery,
} from "./schema";

async function requestIdentity(
  c: Context<{ Variables: BaseVariables & { workspaceId: string } }>,
): Promise<ResolvedIdentity> {
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const identity = await resolveRequestIdentity({
    userId: c.get("userId"),
    apiKey: c.get("apiKey"),
    impersonatedBy: session?.impersonatedBy,
  });
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  return identity;
}

function requestIdentityInput(
  c: Context<{ Variables: BaseVariables & { workspaceId: string } }>,
): ResolveIdentityInput {
  const session = c.get("session") as { impersonatedBy?: string | null } | null;
  const apiKey = c.get("apiKey");
  return {
    userId: c.get("userId"),
    credential: apiKey
      ? "api_key"
      : session?.impersonatedBy
        ? "impersonation"
        : "session",
    ...(apiKey
      ? {
          apiKey: {
            enabled: apiKey.enabled,
            ownerUserId: apiKey.userId,
            capabilities: apiKeyCapabilitySubset(apiKey),
          },
        }
      : {}),
  };
}

const listWorkflowsRoute = createRoute({
  method: "get",
  operationId: "listWorkflows",
  path: "/",
  tags: ["Workflows"],
  summary: "List workflows",
  description: "List a workspace's workflows.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("workflow:read"),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("List of workflows", workflowListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace, or missing workflow:read"),
  },
});

const createWorkflowRoute = createRoute({
  method: "post",
  operationId: "createWorkflow",
  path: "/",
  tags: ["Workflows"],
  summary: "Create workflow",
  description: "Create a new workflow in a workspace.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspaceCapability("workflow:manage"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createWorkflowBody } },
    },
  },
  responses: {
    200: jsonResponse("The created workflow", workflowWithVersionsSchema),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workflow:manage permission",
    ),
    409: errorResponse("That workflow key is already taken in this workspace"),
  },
});

const getWorkflowRoute = createRoute({
  method: "get",
  operationId: "getWorkflow",
  path: "/{id}",
  tags: ["Workflows"],
  summary: "Get workflow",
  description:
    "Get a single workflow by id, with every version and its transitions.",
  middleware: [
    workspaceAccess.fromWorkflow(),
    requireWorkspaceCapability("workflow:read"),
  ] as const,
  request: { params: workflowIdParam },
  responses: {
    200: jsonResponse("Workflow details", workflowWithVersionsSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse("No access to the workspace, or missing workflow:read"),
    404: errorResponse("Workflow not found"),
  },
});

const createWorkflowVersionRoute = createRoute({
  method: "post",
  operationId: "createWorkflowVersion",
  path: "/{id}/versions",
  tags: ["Workflows"],
  summary: "Create workflow version",
  description:
    "Create a new draft version under an existing workflow. Validated structurally " +
    "(packages/domain's validateWorkflowVersion) against this workspace's state " +
    "templates before it is persisted. The legacy set_field effect shape remains " +
    "documented for compatibility, but any request containing it is refused with HTTP 400 while held.",
  middleware: [
    workspaceAccess.fromWorkflow(),
    requireWorkspaceCapability("workflow:manage"),
  ] as const,
  request: {
    params: workflowIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createWorkflowVersionBody } },
    },
  },
  responses: {
    200: jsonResponse("The created draft version", workflowVersionSchema),
    400: errorResponse(
      "Invalid body, structurally invalid workflow version, or workspace ID could not be determined",
    ),
    403: errorResponse(
      "No workspace access, or missing workflow:manage permission",
    ),
    404: errorResponse("Workflow not found"),
  },
});

const publishWorkflowVersionRoute = createRoute({
  method: "post",
  operationId: "publishWorkflowVersion",
  path: "/{id}/versions/{number}/publish",
  tags: ["Workflows"],
  summary: "Publish workflow version",
  description:
    "Publish a draft version: it becomes active for new transitions (WF-7). " +
    "In-flight work items are not migrated.",
  middleware: [
    workspaceAccess.fromWorkflow(),
    requireWorkspaceCapability("workflow:manage"),
  ] as const,
  request: { params: workflowVersionParam },
  responses: {
    200: jsonResponse("The published version", workflowVersionSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse(
      "No workspace access, or missing workflow:manage permission",
    ),
    404: errorResponse("Workflow or version not found"),
  },
});

// Issue #442's validation-panel route -- the thin wrapper the create-version route's own
// comment promised as a follow-up: `packages/domain`'s already-tested structural checks
// (`noOutboundStateIds`/`unreachableStates`/`rolesWithNoLegalTransition`/
// `validateProjectStateSelection`), reported rather than enforced (this route never
// mutates anything -- see `validate-workflow-version.ts`'s own doc comment).
const validateWorkflowVersionRoute = createRoute({
  method: "post",
  operationId: "validateWorkflowVersion",
  path: "/{id}/versions/{number}/validate",
  tags: ["Workflows"],
  summary: "Validate workflow version",
  description:
    "Reports unreachable state templates, templates with no outbound transition, work " +
    "items in any adopting project that would become stuck (WF-9), a project with no " +
    "concrete state for a required template, and roles with no legal transition at " +
    "all. Read-only -- never mutates the version or anything it references.",
  middleware: [
    workspaceAccess.fromWorkflow(),
    requireWorkspaceCapability("workflow:manage"),
  ] as const,
  request: { params: workflowVersionParam },
  responses: {
    200: jsonResponse("The validation report", workflowVersionValidationSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    403: errorResponse(
      "No workspace access, or missing workflow:manage permission",
    ),
    404: errorResponse("Workflow or version not found"),
  },
});

const workflow = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listWorkflowsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const rows = await listWorkflows(await requestIdentity(c), workspaceId);
    return c.json(workflowListSchema.parse(rows), 200);
  })
  .openapi(createWorkflowRoute, async (c) => {
    const { workspaceId, key, name } = c.req.valid("json");
    try {
      const created = await createWorkflow(workspaceId, key, name);
      return c.json(
        workflowWithVersionsSchema.parse({ ...created, versions: [] }),
        200,
      );
    } catch (error) {
      if (error instanceof WorkflowKeyTakenError) {
        throw new HTTPException(409, {
          message: "That workflow key is already taken in this workspace",
        });
      }
      throw error;
    }
  })
  .openapi(getWorkflowRoute, async (c) => {
    const { id } = c.req.valid("param");
    const row = await getWorkflow(await requestIdentity(c), id);
    return c.json(workflowWithVersionsSchema.parse(row), 200);
  })
  .openapi(createWorkflowVersionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { transitions } = c.req.valid("json");
    const created = await createWorkflowVersion(
      await requestIdentity(c),
      id,
      transitions,
    );
    return c.json(workflowVersionSchema.parse(created), 200);
  })
  .openapi(publishWorkflowVersionRoute, async (c) => {
    const { id, number } = c.req.valid("param");
    const published = await publishWorkflowVersion(
      requestIdentityInput(c),
      id,
      number,
    );
    return c.json(workflowVersionSchema.parse(published), 200);
  })
  .openapi(validateWorkflowVersionRoute, async (c) => {
    const { id, number } = c.req.valid("param");
    const result = await validateWorkflowVersion(
      requestIdentityInput(c),
      id,
      number,
    );
    return c.json(workflowVersionValidationSchema.parse(result), 200);
  });

export default workflow;
