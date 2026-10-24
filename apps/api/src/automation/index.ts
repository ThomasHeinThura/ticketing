import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  type z,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import {
  authoriseRuleScope,
  projectFromKeyParam,
  type RuleScope,
  readerVisibility,
  ruleAncestryFor,
  workspaceFromIdParam,
} from "./access";
import { DRY_RUN_MAX_WINDOW_DAYS } from "./constants";
import { AUTOMATION_DELETION_ROUTE } from "./deletion-target";
import { clampWindowDays, dryRunRule } from "./dry-run";
import {
  type EffectiveRole,
  listAssignableRoles,
  loadRole,
  roleIsUsableForWorkspace,
  roleWithinCallerAuthority,
} from "./effective-role";
import { automationsEnabled } from "./feature";
import { extractPlaceholders } from "./placeholders";
import {
  type AutomationActor,
  type AutomationRow,
  AutomationVersionConflictError,
  assertActionReferencesValid,
  assertProjectFilterValid,
  createAutomation,
  findAutomationScope,
  getAutomation,
  listAutomations,
  listRuns,
  roleNameFor,
  setAutomationEnabled,
  updateAutomation,
} from "./repository";
import {
  assignableRoleSchema,
  automationListSchema,
  automationRunListSchema,
  automationRunSchema,
  automationSchema,
  automationVersionConflictSchema,
  dryRunSchema,
  ruleProblemsSchema,
} from "./response";
import {
  automationIdParam,
  createAutomationBody,
  dryRunQuery,
  projectKeyParam,
  runsQuery,
  toggleBody,
  updateAutomationBody,
  workspaceIdParam,
} from "./schema";
import {
  type RuleProblem,
  type ValidRuleDefinition,
  validateRuleDefinition,
} from "./validation";
import { isVisibleTo } from "./visibility";

/**
 * Automation routes. Mounted at `/` of the API router (`api.route("/", automation)`), like the
 * other feature routers whose paths span several prefixes: `/workspaces/{id}/automations`,
 * `/projects/{key}/automations` and `/automations/{id}...`.
 */

async function actorFor(
  c: Context,
  identity: { personId: string },
): Promise<AutomationActor> {
  const apiKey = c.get("apiKey");
  return {
    userId: c.get("userId"),
    personId: identity.personId,
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
    actorIp: c.req.header("x-forwarded-for") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  };
}

async function automationRowReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing automation id" });
  rejectNulByte(id, "Automation id");
  const scope = await findAutomationScope(id);
  if (!scope) throw new HTTPException(404, { message: "Automation not found" });
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      scope.workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message: "Automation not found" });
    throw error;
  }
  c.set("workspaceId", scope.workspaceId);
  c.set("workspaceIdSource", "row");
  await next();
}

function problemsResponse(problems: RuleProblem[]) {
  const onlyUnavailable = problems.every(
    (problem) => problem.code === "unavailable",
  );
  return {
    status: (onlyUnavailable ? 422 : 400) as 400 | 422,
    body: ruleProblemsSchema.parse({
      message: problems[0]?.message ?? "Invalid automation",
      problems,
    }),
  };
}

function toAutomationResponse(row: AutomationRow, roleName: string | null) {
  return automationSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    projectFilter: Array.isArray(row.projectFilter)
      ? (row.projectFilter as string[])
      : null,
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    scheduleCron: row.scheduleCron,
    conditions: row.conditions,
    actions: row.actions,
    effectiveRoleId: row.effectiveRoleId,
    effectiveRoleName: roleName,
    position: row.position,
    stopProcessing: row.stopProcessing,
    flaggedReason: row.flaggedReason,
    fireCount: row.fireCount,
    lastRunAt: row.lastRunAt,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Rank AND capability-subset ceiling (`AM-3`, `RL-3`); the same refusal on every path. */
function assertRoleWithinAuthority(
  role: EffectiveRole,
  identity: Parameters<typeof roleWithinCallerAuthority>[1],
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[],
) {
  const verdict = roleWithinCallerAuthority(
    role,
    identity,
    workspaceId,
    projectId,
    ancestorProjectIds,
  );
  if (verdict.ok) return;
  throw new HTTPException(403, {
    message:
      verdict.reason === "rank"
        ? "effective_role_above_your_rank"
        : "effective_role_exceeds_your_capabilities",
  });
}

/** Save-time role rules (`AM-3`): usable in this workspace and at or below the author's rank. */
async function resolveEffectiveRole(
  roleId: string,
  scope: RuleScope,
  identity: ResolvedIdentity,
): Promise<EffectiveRole> {
  const role = await loadRole(roleId);
  if (!role || !roleIsUsableForWorkspace(role, scope.workspaceId))
    throw new HTTPException(422, { message: "effective_role_unavailable" });
  assertRoleWithinAuthority(
    role,
    identity,
    scope.workspaceId,
    scope.projectId,
    await ruleAncestryFor(identity, scope),
  );
  return role;
}

async function requireFeature(scope: RuleScope) {
  if (!(await automationsEnabled(scope.workspaceId, scope.projectId)))
    throw new HTTPException(409, { message: "feature_disabled" });
}

const listWorkspaceRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/automations",
  operationId: "listWorkspaceAutomations",
  tags: ["Automations"],
  summary: "List workspace automation rules",
  middleware: [workspaceFromIdParam] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Workspace rules in run order", automationListSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
  },
});

const createWorkspaceRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/automations",
  operationId: "createWorkspaceAutomation",
  tags: ["Automations"],
  summary: "Create a workspace automation rule (disabled)",
  middleware: [workspaceFromIdParam] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createAutomationBody } },
    },
  },
  responses: {
    201: jsonResponse("Created, disabled rule", automationSchema),
    400: jsonResponse("Invalid rule", ruleProblemsSchema),
    403: errorResponse("Insufficient permission or role rank"),
    409: errorResponse("feature.automations is off"),
    422: jsonResponse(
      "Unavailable trigger, condition or action",
      ruleProblemsSchema,
    ),
  },
});

const listProjectRoute = createRoute({
  method: "get",
  path: "/projects/{key}/automations",
  operationId: "listProjectAutomations",
  tags: ["Automations"],
  summary: "List a project's automation rules",
  middleware: [projectFromKeyParam] as const,
  request: { params: projectKeyParam },
  responses: {
    200: jsonResponse("Project rules in run order", automationListSchema),
    403: errorResponse("Missing project:read permission"),
    404: errorResponse("Project not found"),
  },
});

const createProjectRoute = createRoute({
  method: "post",
  path: "/projects/{key}/automations",
  operationId: "createProjectAutomation",
  tags: ["Automations"],
  summary: "Create a project automation rule (disabled)",
  middleware: [projectFromKeyParam] as const,
  request: {
    params: projectKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: createAutomationBody } },
    },
  },
  responses: {
    201: jsonResponse("Created, disabled rule", automationSchema),
    400: jsonResponse("Invalid rule", ruleProblemsSchema),
    403: errorResponse("Insufficient permission or role rank"),
    404: errorResponse("Project not found"),
    409: errorResponse("feature.automations is off"),
    422: jsonResponse(
      "Unavailable trigger, condition or action",
      ruleProblemsSchema,
    ),
  },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/automations/{id}",
  operationId: "updateAutomation",
  tags: ["Automations"],
  summary: "Update an automation rule",
  description:
    "A change to trigger, conditions, actions, role or project filter disables an enabled rule: enabling is a deliberate act (AM-10).",
  middleware: [automationRowReach] as const,
  request: {
    params: automationIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAutomationBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated rule", automationSchema),
    400: jsonResponse("Invalid rule", ruleProblemsSchema),
    403: errorResponse("Insufficient permission or role rank"),
    404: errorResponse("Automation not found"),
    409: jsonResponse("Version conflict", automationVersionConflictSchema),
    422: jsonResponse(
      "Unavailable trigger, condition or action",
      ruleProblemsSchema,
    ),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/automations/{id}",
  operationId: "requestAutomationDeletion",
  tags: ["Automations"],
  summary: "Request deletion of an automation rule",
  description:
    "Opens a pending action (202, click approval); nothing is deleted until the requester approves it. Needs workspace:manage_settings for workspace and project rules alike. Run history goes with the rule.",
  middleware: [automationRowReach] as const,
  request: { params: automationIdParam },
  responses: {
    202: jsonResponse("Pending deletion", registeredDeletionRequestSchema),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Automation not found"),
  },
});

const enableRoute = createRoute({
  method: "post",
  path: "/automations/{id}/enable",
  operationId: "enableAutomation",
  tags: ["Automations"],
  summary: "Enable a rule",
  middleware: [automationRowReach] as const,
  request: {
    params: automationIdParam,
    body: { content: { "application/json": { schema: toggleBody } } },
  },
  responses: {
    200: jsonResponse("Enabled rule", automationSchema),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Automation not found"),
    409: jsonResponse("Version conflict", automationVersionConflictSchema),
    422: jsonResponse("The rule is no longer valid", ruleProblemsSchema),
  },
});

const disableRoute = createRoute({
  method: "post",
  path: "/automations/{id}/disable",
  operationId: "disableAutomation",
  tags: ["Automations"],
  summary: "Disable a rule",
  middleware: [automationRowReach] as const,
  request: {
    params: automationIdParam,
    body: { content: { "application/json": { schema: toggleBody } } },
  },
  responses: {
    200: jsonResponse("Disabled rule", automationSchema),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Automation not found"),
    409: jsonResponse("Version conflict", automationVersionConflictSchema),
  },
});

const dryRunRoute = createRoute({
  method: "post",
  path: "/automations/{id}/dry-run",
  operationId: "dryRunAutomation",
  tags: ["Automations"],
  summary: "Dry-run a rule against recent history",
  description: `Read-only. windowDays defaults to 7 and is at most ${DRY_RUN_MAX_WINDOW_DAYS}; at most 1,000 candidate events are examined.`,
  middleware: [automationRowReach] as const,
  request: { params: automationIdParam, query: dryRunQuery },
  responses: {
    200: jsonResponse("What the rule would have done", dryRunSchema),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Automation not found"),
  },
});

const runsRoute = createRoute({
  method: "get",
  path: "/automations/{id}/runs",
  operationId: "listAutomationRuns",
  tags: ["Automations"],
  summary: "Run history with per-action outcomes",
  middleware: [automationRowReach, requireReachFilteredList] as const,
  request: { params: automationIdParam, query: runsQuery },
  responses: {
    200: jsonResponse(
      "Runs, newest first (30-day retention)",
      automationRunListSchema,
    ),
    403: errorResponse("Insufficient permission"),
    404: errorResponse("Automation not found"),
  },
});

type ListResponse = z.infer<typeof automationListSchema>;

async function buildList(
  c: Context,
  scope: RuleScope,
  identity: ResolvedIdentity,
): Promise<ListResponse> {
  const rows = await listAutomations(scope);
  const roles = await listAssignableRoles(
    scope.workspaceId,
    identity,
    scope.projectId,
    await ruleAncestryFor(identity, scope),
  );
  void c;
  return automationListSchema.parse({
    data: rows.map(({ row, roleName }) => toAutomationResponse(row, roleName)),
    meta: {
      total: rows.length,
      assignableRoles: roles.map((role) => assignableRoleSchema.parse(role)),
      featureEnabled: await automationsEnabled(
        scope.workspaceId,
        scope.projectId,
      ),
    },
  });
}

/** Shared create path for the workspace and project routes. */
async function createRule(
  c: Context,
  scope: RuleScope,
  body: z.infer<typeof createAutomationBody>,
) {
  const identity = await authoriseRuleScope(c, scope, "manage");
  await requireFeature(scope);
  if (scope.projectId !== null && body.projectFilter)
    return {
      error: problemsResponse([
        {
          code: "invalid",
          path: "projectFilter",
          message: "projectFilter applies to workspace rules only",
        },
      ]),
    };
  const validated = validateRuleDefinition({
    trigger: body.trigger,
    scheduleCron: body.scheduleCron ?? null,
    conditions: body.conditions,
    actions: body.actions,
    projectFilter: body.projectFilter ?? null,
  });
  if (!validated.ok) return { error: problemsResponse(validated.problems) };
  if (validated.value.projectFilter)
    await assertProjectFilterValid(
      scope.workspaceId,
      validated.value.projectFilter,
    );
  await assertActionReferencesValid(scope.workspaceId, validated.value.actions);
  await resolveEffectiveRole(body.effectiveRoleId, scope, identity);
  const row = await createAutomation({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    name: body.name,
    effectiveRoleId: body.effectiveRoleId,
    stopProcessing: body.stopProcessing,
    definition: validated.value,
    actor: await actorFor(c, identity),
  });
  return { row, roleName: await roleNameFor(row.effectiveRoleId) };
}

const router = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listWorkspaceRoute, async (c) => {
    const scope = { workspaceId: c.req.valid("param").id, projectId: null };
    const identity = await authoriseRuleScope(c, scope, "read");
    return c.json(await buildList(c, scope, identity), 200);
  })
  .openapi(createWorkspaceRoute, async (c) => {
    const scope = { workspaceId: c.req.valid("param").id, projectId: null };
    const result = await createRule(c, scope, c.req.valid("json"));
    if ("error" in result && result.error)
      return c.json(result.error.body, result.error.status);
    if (!("row" in result)) throw new Error("unreachable");
    return c.json(toAutomationResponse(result.row, result.roleName), 201);
  })
  .openapi(listProjectRoute, async (c) => {
    const scope = {
      workspaceId: c.get("workspaceId"),
      projectId: c.get("projectId") as string,
    };
    const identity = await authoriseRuleScope(c, scope, "read");
    return c.json(await buildList(c, scope, identity), 200);
  })
  .openapi(createProjectRoute, async (c) => {
    const scope = {
      workspaceId: c.get("workspaceId"),
      projectId: c.get("projectId") as string,
    };
    const result = await createRule(c, scope, c.req.valid("json"));
    if ("error" in result && result.error)
      return c.json(result.error.body, result.error.status);
    if (!("row" in result)) throw new Error("unreachable");
    return c.json(toAutomationResponse(result.row, result.roleName), 201);
  })
  .openapi(updateRoute, async (c) => {
    const id = c.req.valid("param").id;
    const body = c.req.valid("json");
    const existing = await getAutomation(id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    const scope = {
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
    };
    const identity = await authoriseRuleScope(c, scope, "manage");
    await requireFeature(scope);

    let definition: ValidRuleDefinition | undefined;
    const definitionTouched =
      body.trigger !== undefined ||
      body.scheduleCron !== undefined ||
      body.conditions !== undefined ||
      body.actions !== undefined ||
      body.projectFilter !== undefined;
    if (definitionTouched) {
      if (existing.projectId !== null && body.projectFilter)
        return c.json(
          problemsResponse([
            {
              code: "invalid",
              path: "projectFilter",
              message: "projectFilter applies to workspace rules only",
            },
          ]).body,
          400,
        );
      const trigger = body.trigger ?? existing.trigger;
      const validated = validateRuleDefinition({
        trigger,
        scheduleCron:
          body.scheduleCron !== undefined
            ? body.scheduleCron
            : trigger === existing.trigger
              ? existing.scheduleCron
              : null,
        conditions: body.conditions ?? existing.conditions,
        actions: body.actions ?? existing.actions,
        projectFilter:
          body.projectFilter !== undefined
            ? body.projectFilter
            : existing.projectFilter,
      });
      if (!validated.ok) {
        const problems = problemsResponse(validated.problems);
        return c.json(problems.body, problems.status);
      }
      definition = validated.value;
      await assertActionReferencesValid(scope.workspaceId, definition.actions);
      if (definition.projectFilter)
        await assertProjectFilterValid(
          scope.workspaceId,
          definition.projectFilter,
        );
    }
    if (body.effectiveRoleId !== undefined)
      await resolveEffectiveRole(body.effectiveRoleId, scope, identity);
    else if (definitionTouched || body.stopProcessing !== undefined)
      // AM-3: rewriting what the rule does is the same act as choosing its role. An editor may
      // not make a rule they could not have saved run with a role above their own rank.
      await resolveEffectiveRole(existing.effectiveRoleId, scope, identity);

    try {
      const updated = await updateAutomation(
        id,
        {
          name: body.name,
          effectiveRoleId: body.effectiveRoleId,
          stopProcessing: body.stopProcessing,
          position: body.position,
          definition,
          expectedVersion: body.version,
        },
        await actorFor(c, identity),
      );
      if (!updated)
        throw new HTTPException(404, { message: "Automation not found" });
      return c.json(
        toAutomationResponse(
          updated.row,
          await roleNameFor(updated.row.effectiveRoleId),
        ),
        200,
      );
    } catch (error) {
      if (error instanceof AutomationVersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
  })
  .openapi(enableRoute, async (c) => {
    const id = c.req.valid("param").id;
    const existing = await getAutomation(id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    const scope = {
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
    };
    const identity = await authoriseRuleScope(c, scope, "manage");
    await requireFeature(scope);
    // Re-validate the stored rule: vocabulary and role may have changed since it was saved.
    const validated = validateRuleDefinition({
      trigger: existing.trigger,
      scheduleCron: existing.scheduleCron,
      conditions: existing.conditions,
      actions: existing.actions,
      projectFilter: existing.projectFilter,
    });
    if (!validated.ok) {
      const problems = problemsResponse(validated.problems);
      return c.json(problems.body, 422);
    }
    const role = await loadRole(existing.effectiveRoleId);
    if (!role || !roleIsUsableForWorkspace(role, scope.workspaceId))
      return c.json(
        problemsResponse([
          {
            code: "unavailable",
            path: "effectiveRoleId",
            message: "the effective role no longer exists in this workspace",
          },
        ]).body,
        422,
      );
    const ancestry = await ruleAncestryFor(identity, scope);
    assertRoleWithinAuthority(
      role,
      identity,
      scope.workspaceId,
      scope.projectId,
      ancestry,
    );
    try {
      const row = await setAutomationEnabled(
        id,
        true,
        await actorFor(c, identity),
        c.req.valid("json")?.version,
        async (locked, tx) => {
          // Re-check against the locked row: a role change that raced the checks above
          // must not be enabled under an authority the caller never held.
          const lockedRole =
            locked.effectiveRoleId === role.id
              ? role
              : await loadRole(locked.effectiveRoleId, tx);
          if (
            !lockedRole ||
            !roleIsUsableForWorkspace(lockedRole, scope.workspaceId)
          )
            throw new HTTPException(422, {
              message: "effective_role_unavailable",
            });
          assertRoleWithinAuthority(
            lockedRole,
            identity,
            scope.workspaceId,
            scope.projectId,
            ancestry,
          );
        },
      );
      if (!row)
        throw new HTTPException(404, { message: "Automation not found" });
      return c.json(
        toAutomationResponse(row, await roleNameFor(row.effectiveRoleId)),
        200,
      );
    } catch (error) {
      if (error instanceof AutomationVersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
  })
  .openapi(disableRoute, async (c) => {
    const id = c.req.valid("param").id;
    const existing = await getAutomation(id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    const identity = await authoriseRuleScope(
      c,
      { workspaceId: existing.workspaceId, projectId: existing.projectId },
      "manage",
    );
    try {
      const row = await setAutomationEnabled(
        id,
        false,
        await actorFor(c, identity),
        c.req.valid("json")?.version,
      );
      if (!row)
        throw new HTTPException(404, { message: "Automation not found" });
      return c.json(
        toAutomationResponse(row, await roleNameFor(row.effectiveRoleId)),
        200,
      );
    } catch (error) {
      if (error instanceof AutomationVersionConflictError)
        return c.json(
          { message: error.message, currentVersion: error.currentVersion },
          409,
        );
      throw error;
    }
  })
  .openapi(deleteRoute, async (c) => {
    const existing = await findAutomationScope(c.req.valid("param").id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    await authoriseRuleScope(
      c,
      { workspaceId: existing.workspaceId, projectId: existing.projectId },
      "manage",
    );
    const pending = await requestRegisteredDeletion(c, {
      routeKey: AUTOMATION_DELETION_ROUTE,
      targetType: "automation",
      id: existing.id,
      workspaceId: existing.workspaceId,
    });
    return c.json(pending, 202);
  })
  .openapi(dryRunRoute, async (c) => {
    const existing = await getAutomation(c.req.valid("param").id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    const identity = await authoriseRuleScope(
      c,
      { workspaceId: existing.workspaceId, projectId: existing.projectId },
      "manage",
    );
    const role = await loadRole(existing.effectiveRoleId);
    if (role)
      assertRoleWithinAuthority(
        role,
        identity,
        existing.workspaceId,
        existing.projectId,
        await ruleAncestryFor(identity, {
          workspaceId: existing.workspaceId,
          projectId: existing.projectId,
        }),
      );
    const result = await dryRunRule(
      existing,
      role,
      clampWindowDays(c.req.valid("query").windowDays),
      await readerVisibility(c, identity, existing.workspaceId),
    );
    const placeholders: z.infer<typeof dryRunSchema>["placeholders"] = [];
    for (const [actionIndex, raw] of (Array.isArray(existing.actions)
      ? existing.actions
      : []
    ).entries()) {
      for (const value of Object.values(
        (raw ?? {}) as Record<string, unknown>,
      )) {
        if (typeof value !== "string") continue;
        for (const ref of extractPlaceholders(value))
          placeholders.push({ actionIndex, ...ref });
      }
    }
    return c.json(
      dryRunSchema.parse({
        automationId: existing.id,
        windowDays: result.windowDays,
        since: result.since.toISOString(),
        evaluated: result.evaluated,
        wouldFire: result.wouldFire,
        capped: result.capped,
        samples: result.samples,
        actions: result.actions,
        placeholders,
        note: "Judged against each item as it is now; past field values are not stored. Nothing was changed.",
      }),
      200,
    );
  })
  .openapi(runsRoute, async (c) => {
    const existing = await findAutomationScope(c.req.valid("param").id);
    if (!existing)
      throw new HTTPException(404, { message: "Automation not found" });
    const identity = await authoriseRuleScope(
      c,
      { workspaceId: existing.workspaceId, projectId: existing.projectId },
      "read",
    );
    const query = c.req.valid("query");
    const rows = await listRuns(existing.id, {
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
    });
    const slice = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    // A workspace rule's history names work items across projects: show only what the reader
    // reaches. A project rule's reader already reaches its project.
    const visibility =
      existing.projectId === null
        ? await readerVisibility(
            c,
            identity,
            existing.workspaceId,
            listReachOf(c),
          )
        : null;
    const page = visibility
      ? slice.filter((row) => isVisibleTo(visibility, row.projectId))
      : slice;
    return c.json(
      {
        data: page.map((row) =>
          automationRunSchema.parse({
            id: row.id,
            automationId: row.automationId,
            workItemId: row.workItemId,
            workItemKey: row.workItemKey,
            eventId: row.eventId,
            origin: row.origin,
            depth: row.depth,
            triggeredAt: row.triggeredAt,
            finishedAt: row.finishedAt,
            state: row.state,
            matched: row.matched,
            results: Array.isArray(row.results) ? row.results : [],
            error: row.error,
          }),
        ),
        page: {
          hasMore,
          nextBefore: hasMore
            ? (slice[slice.length - 1]?.triggeredAt.toISOString() ?? null)
            : null,
        },
      },
      200,
    );
  });

export default router;
