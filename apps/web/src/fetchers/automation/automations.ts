import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** Automation rules (`AM-1`..`AM-13`): a workspace scope or a project scope, one shape. */

export type AutomationScope =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; projectKey: string };

export type AutomationCondition = {
  field: string;
  op: string;
  value?: unknown;
  basis?: "created_at" | "updated_at";
};

export type AutomationAction = { type: string } & Record<string, unknown>;

export type Automation = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectFilter: string[] | null;
  name: string;
  enabled: boolean;
  trigger: string;
  scheduleCron: string | null;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  effectiveRoleId: string;
  effectiveRoleName: string | null;
  position: number;
  stopProcessing: boolean;
  flaggedReason: string | null;
  fireCount: number;
  lastRunAt: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type AssignableRole = {
  id: string;
  key: string;
  name: string;
  rank: number;
};

export type AutomationList = {
  data: Automation[];
  meta: {
    total: number;
    assignableRoles: AssignableRole[];
    featureEnabled: boolean;
  };
};

export type AutomationInput = {
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  effectiveRoleId: string;
  stopProcessing: boolean;
};

export type AutomationRun = {
  id: string;
  automationId: string;
  workItemId: string | null;
  workItemKey: string | null;
  eventId: string | null;
  origin: string;
  depth: number;
  triggeredAt: string;
  finishedAt: string | null;
  state: string;
  matched: boolean | null;
  results: Array<{
    index?: number;
    type?: string;
    ok?: boolean;
    error?: string;
    field?: string;
    op?: string;
    matched?: boolean;
  }>;
  error: string | null;
};

export type AutomationRunPage = {
  data: AutomationRun[];
  page: { hasMore: boolean; nextBefore: string | null };
};

export type DryRunResult = {
  automationId: string;
  windowDays: number;
  since: string;
  evaluated: number;
  wouldFire: number;
  capped: boolean;
  samples: Array<{
    eventId: string | null;
    occurredAt: string | null;
    workItemKey: string | null;
    workItemTitle: string | null;
  }>;
  actions: Array<{
    index: number;
    type: string;
    allowed: boolean;
    requiredCapability: string;
    reason: string | null;
  }>;
  placeholders: Array<{
    actionIndex: number;
    path: string;
    visibility: "public" | "staff" | "unknown";
  }>;
  note: string;
};

/** A rule problem the API names by path (`400`/`422`). */
export class AutomationRuleError extends HttpError {
  problems: Array<{ code: string; path: string; message: string }>;
  constructor(
    status: number,
    message: string,
    problems: Array<{ code: string; path: string; message: string }>,
  ) {
    super(status, message);
    this.name = "AutomationRuleError";
    this.problems = problems;
  }
}

async function ensureOk(response: Response, message: string) {
  if (response.ok) return;
  if (response.status === 400 || response.status === 422) {
    const text = await response.clone().text();
    try {
      const body = JSON.parse(text) as {
        message?: string;
        problems?: AutomationRuleError["problems"];
      };
      if (Array.isArray(body.problems))
        throw new AutomationRuleError(
          response.status,
          body.message ?? message,
          body.problems,
        );
    } catch (error) {
      if (error instanceof AutomationRuleError) throw error;
    }
  }
  throw new HttpError(
    response.status,
    await readErrorDetail(response, message),
  );
}

function listPath(scope: AutomationScope) {
  return scope.kind === "workspace"
    ? `/workspaces/${encodeURIComponent(scope.workspaceId)}/automations`
    : `/projects/${encodeURIComponent(scope.projectKey)}/automations`;
}

const jsonHeaders = { "Content-Type": "application/json" };

export async function listAutomations(
  scope: AutomationScope,
): Promise<AutomationList> {
  const response = await apiFetch(getApiUrl(listPath(scope)), {
    credentials: "include",
    cache: "no-store",
  });
  await ensureOk(response, "Unable to load automation rules");
  return (await response.json()) as AutomationList;
}

export async function createAutomation(
  scope: AutomationScope,
  input: AutomationInput,
): Promise<Automation> {
  const response = await apiFetch(getApiUrl(listPath(scope)), {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
  await ensureOk(response, "Failed to create the rule");
  return (await response.json()) as Automation;
}

export async function updateAutomation(
  id: string,
  input: Partial<AutomationInput> & { version?: number },
): Promise<Automation> {
  const response = await apiFetch(
    getApiUrl(`/automations/${encodeURIComponent(id)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    },
  );
  await ensureOk(response, "Failed to update the rule");
  return (await response.json()) as Automation;
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
  version?: number,
): Promise<Automation> {
  const response = await apiFetch(
    getApiUrl(
      `/automations/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`,
    ),
    {
      method: "POST",
      credentials: "include",
      headers: jsonHeaders,
      body: JSON.stringify(version === undefined ? {} : { version }),
    },
  );
  await ensureOk(
    response,
    enabled ? "Failed to enable the rule" : "Failed to disable the rule",
  );
  return (await response.json()) as Automation;
}

export async function dryRunAutomation(
  id: string,
  windowDays: number,
): Promise<DryRunResult> {
  const response = await apiFetch(
    getApiUrl(
      `/automations/${encodeURIComponent(id)}/dry-run?windowDays=${windowDays}`,
    ),
    { method: "POST", credentials: "include" },
  );
  await ensureOk(response, "Failed to run the dry-run");
  return (await response.json()) as DryRunResult;
}

export async function listAutomationRuns(
  id: string,
  options: { before?: string; limit?: number } = {},
): Promise<AutomationRunPage> {
  const query = new URLSearchParams();
  if (options.before) query.set("before", options.before);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.toString();
  const response = await apiFetch(
    getApiUrl(
      `/automations/${encodeURIComponent(id)}/runs${suffix ? `?${suffix}` : ""}`,
    ),
    { credentials: "include", cache: "no-store" },
  );
  await ensureOk(response, "Unable to load the run history");
  return (await response.json()) as AutomationRunPage;
}
