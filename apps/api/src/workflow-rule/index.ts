import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { resolveCallerIdentity } from "../utils/has-project-reach";
import { requireSessionOnly } from "../utils/require-session-only";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import deleteWorkflowRule from "./controllers/delete-workflow-rule";
import getWorkflowRules from "./controllers/get-workflow-rules";
import upsertWorkflowRule from "./controllers/upsert-workflow-rule";
import { workflowRuleListSchema, workflowRuleRowSchema } from "./response";
import {
  projectIdParam,
  upsertWorkflowRuleBody,
  workflowRuleParam,
} from "./schema";

const getWorkflowRulesRoute = createRoute({
  method: "get",
  operationId: "getWorkflowRules",
  path: "/{projectId}",
  tags: ["Workflow Rules"],
  summary: "Get workflow rules",
  description:
    "Get every workflow rule for a project. A rule moves a task to a column when an integration event fires.",
  middleware: [
    workspaceAccess.fromProject("projectId", { requireProjectReach: true }),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("List of workflow rules", workflowRuleListSchema),
    400: errorResponse("Malformed project ID (including a NUL byte)"),
    404: errorResponse("Project not found or out of reach"),
  },
});

const upsertWorkflowRuleRoute = createRoute({
  method: "put",
  operationId: "upsertWorkflowRule",
  path: "/{projectId}",
  tags: ["Workflow Rules"],
  summary: "Upsert workflow rule",
  description:
    "Create a workflow rule, or update the target column of the existing rule for the same integration and event.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: upsertWorkflowRuleBody } },
    },
  },
  responses: {
    200: jsonResponse("The created or updated rule", workflowRuleRowSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse("Missing project:update permission"),
    // #202: newly reachable -- a soft-deleted project's automation is frozen. As on
    // the list route above, a nonexistent project still answers 400, not 404.
    404: errorResponse("Project not found"),
  },
});

const deleteWorkflowRuleRoute = createRoute({
  method: "delete",
  operationId: "deleteWorkflowRule",
  path: "/{id}",
  tags: ["Workflow Rules"],
  summary: "Delete workflow rule",
  description:
    "Delete a workflow rule. Returns the rule that was removed. Browser session only; API and MCP keys are refused (403 session_required). A rule is a column-routing setting with no history of its own, so it is not a pending-action target.",
  middleware: [
    requireSessionOnly(),
    workspaceAccess.fromWorkflowRule("id", {
      requireProjectReach: true,
      deferApiKeyCapability: true,
    }),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: workflowRuleParam },
  responses: {
    200: jsonResponse("The deleted rule", workflowRuleRowSchema),
    400: errorResponse("id must not contain a NUL (\\u0000) byte"),
    401: errorResponse("Not authenticated"),
    403: errorResponse(
      "A browser session is required, or missing project:update permission",
    ),
    404: errorResponse("Workflow rule not found"),
  },
});

const workflowRule = apiRouter()
  .openapi(getWorkflowRulesRoute, async (c) => {
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity)
      throw new HTTPException(404, { message: "Project not found" });
    return c.json(
      await getWorkflowRules(identity, c.req.valid("param").projectId),
      200,
    );
  })
  .openapi(upsertWorkflowRuleRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { integrationType, eventType, columnId } = c.req.valid("json");
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity)
      throw new HTTPException(404, { message: "Project not found" });
    return c.json(
      await upsertWorkflowRule({
        identity,
        projectId,
        integrationType,
        eventType,
        columnId,
      }),
      200,
    );
  })
  .openapi(deleteWorkflowRuleRoute, async (c) => {
    const identity = await resolveCallerIdentity(c, c.get("userId"));
    if (!identity)
      throw new HTTPException(404, { message: "Workflow rule not found" });
    return c.json(
      await deleteWorkflowRule(identity, c.req.valid("param").id),
      200,
    );
  });

export default workflowRule;
