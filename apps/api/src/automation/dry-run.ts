import { and, desc, eq, gte } from "drizzle-orm";
import db from "../database";
import { outboxTable } from "../database/schema";
import { guardAutomationTrigger } from "../events/automation-context";
import { parseParentEnvelope } from "../events/outbox-consumer";
import type { InternalEnvelope } from "../webhook/envelope";
import {
  type AutomationAction,
  BUILTIN_ACTION_TYPES,
  parseAction,
  requiredCapability,
} from "./actions";
import { type AutomationCondition, evaluateConditions } from "./conditions";
import {
  DRY_RUN_CANDIDATE_CAP,
  DRY_RUN_DEFAULT_WINDOW_DAYS,
  DRY_RUN_MAX_WINDOW_DAYS,
  DRY_RUN_SAMPLE_SIZE,
  isAutomationEventTrigger,
} from "./constants";
import { type EffectiveRole, roleMayAct } from "./effective-role";
import { eventFacts, loadWorkItemsByKey } from "./facts";
import type { AutomationRow } from "./repository";
import { isVisibleTo, type ReaderVisibility } from "./visibility";

/**
 * `AM-9`: a rule can be dry-run against recent history before it is enabled: "this rule would
 * have fired 47 times in the last 7 days, on these items." Read-only: nothing is written, no
 * action runs, no run row exists.
 *
 * The candidates are the retained `outbox` envelopes of the rule's trigger kind in its workspace,
 * newest first, capped at 1,000. Each is judged with the same guard, scope rule and condition
 * evaluator a live run uses, against the item **as it is now** (history of past field values is
 * not stored), which the response says. The effective role's authority for each action is
 * reported so the validation panel shows what would be refused before the rule is enabled.
 */

const AVAILABLE: ReadonlySet<string> = new Set(BUILTIN_ACTION_TYPES);

export function clampWindowDays(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DRY_RUN_DEFAULT_WINDOW_DAYS;
  return Math.min(DRY_RUN_MAX_WINDOW_DAYS, Math.max(1, Math.floor(value)));
}

/** Does the rule's scope (project, or workspace rule plus filter) include this event? */
export function ruleCoversProject(
  rule: Pick<AutomationRow, "projectId" | "projectFilter">,
  eventProjectId: string | null,
): boolean {
  if (rule.projectId) return rule.projectId === eventProjectId;
  const filter = Array.isArray(rule.projectFilter)
    ? (rule.projectFilter as string[])
    : null;
  if (filter === null) return true;
  return eventProjectId !== null && filter.includes(eventProjectId);
}

export type DryRunResult = {
  windowDays: number;
  since: Date;
  evaluated: number;
  wouldFire: number;
  capped: boolean;
  samples: {
    eventId: string | null;
    occurredAt: string | null;
    workItemKey: string | null;
    workItemTitle: string | null;
  }[];
  actions: {
    index: number;
    type: string;
    allowed: boolean;
    requiredCapability: string;
    reason: string | null;
  }[];
};

export async function dryRunRule(
  rule: AutomationRow,
  role: EffectiveRole | undefined,
  windowDays: number,
  visibility: ReaderVisibility,
  now: Date = new Date(),
): Promise<DryRunResult> {
  const days = clampWindowDays(windowDays);
  const since = new Date(now.getTime() - days * 86_400_000);

  const actions: AutomationAction[] = [];
  for (const [index, raw] of (Array.isArray(rule.actions)
    ? rule.actions
    : []
  ).entries()) {
    const parsed = parseAction(raw, index, AVAILABLE);
    if (parsed.ok) actions.push(parsed.action);
  }

  const result: DryRunResult = {
    windowDays: days,
    since,
    evaluated: 0,
    wouldFire: 0,
    capped: false,
    samples: [],
    actions: [],
  };

  if (isAutomationEventTrigger(rule.trigger)) {
    const rows = await db
      .select({
        eventId: outboxTable.eventId,
        kind: outboxTable.kind,
        payload: outboxTable.payload,
      })
      .from(outboxTable)
      .where(
        and(
          eq(outboxTable.workspaceId, rule.workspaceId),
          eq(outboxTable.kind, rule.trigger),
          gte(outboxTable.createdAt, since),
        ),
      )
      .orderBy(desc(outboxTable.createdAt), desc(outboxTable.eventId))
      .limit(DRY_RUN_CANDIDATE_CAP + 1);
    result.capped = rows.length > DRY_RUN_CANDIDATE_CAP;
    const candidates = rows.slice(0, DRY_RUN_CANDIDATE_CAP);

    const envelopes: (InternalEnvelope & {
      depth: number;
      originAutomationId: string | null;
    })[] = [];
    for (const row of candidates) {
      try {
        const envelope = parseParentEnvelope(
          row,
        ) as unknown as (typeof envelopes)[number];
        // Only events in projects the reader reaches are examined or counted.
        if (isVisibleTo(visibility, envelope.scope.projectId ?? null))
          envelopes.push(envelope);
      } catch {
        // A corrupt envelope is not a candidate.
      }
    }
    result.evaluated = envelopes.length;

    const keys = envelopes.flatMap((envelope) =>
      typeof envelope.payload.key === "string" ? [envelope.payload.key] : [],
    );
    const items = await loadWorkItemsByKey(rule.workspaceId, keys);
    const conditions = (
      Array.isArray(rule.conditions) ? rule.conditions : []
    ) as AutomationCondition[];

    for (const envelope of envelopes) {
      if (!ruleCoversProject(rule, envelope.scope.projectId ?? null)) continue;
      if (
        guardAutomationTrigger({
          automationId: rule.id,
          eventDepth: envelope.depth,
          eventOriginAutomationId: envelope.originAutomationId,
        }) !== "ok"
      )
        continue;
      const key =
        typeof envelope.payload.key === "string" ? envelope.payload.key : null;
      const item = key ? items.get(key) : undefined;
      const evaluation = evaluateConditions(conditions, {
        now,
        ...(item ? { workItem: item.facts } : {}),
        ...eventFacts(envelope.kind, envelope.payload),
      });
      if (!evaluation.matched) continue;
      result.wouldFire++;
      if (result.samples.length < DRY_RUN_SAMPLE_SIZE)
        result.samples.push({
          eventId: envelope.id,
          occurredAt: envelope.occurredAt,
          workItemKey: key,
          workItemTitle: item?.title ?? null,
        });
    }
  }

  // The validation panel: would the effective role be allowed each action at all?
  const probeProjectId =
    rule.projectId ??
    (Array.isArray(rule.projectFilter)
      ? ((rule.projectFilter as string[])[0] ?? null)
      : null);
  for (const [index, action] of actions.entries()) {
    const capability = requiredCapability(action);
    let allowed = false;
    let reason: string | null = null;
    if (!role) reason = "effective role is unavailable";
    else if (probeProjectId === null)
      // A workspace rule spans projects: the role's workspace-level grant is the best answer
      // before an item is known; per-item project overrides are decided at execution.
      allowed =
        role.capabilities.length > 0 &&
        roleMayAct(role, capability, {
          workspaceId: rule.workspaceId,
          projectId: "workspace-probe",
        });
    else
      allowed = roleMayAct(role, capability, {
        workspaceId: rule.workspaceId,
        projectId: probeProjectId,
      });
    if (!allowed && reason === null)
      reason = `the effective role does not hold ${capability}`;
    result.actions.push({
      index,
      type: action.type,
      allowed,
      requiredCapability: capability,
      reason,
    });
  }
  return result;
}
