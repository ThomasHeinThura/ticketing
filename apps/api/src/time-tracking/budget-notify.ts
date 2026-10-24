import { createId } from "@paralleldrive/cuid2";
import { can, reaches } from "@taskdesk/permissions";
import { and, asc, eq, sql } from "drizzle-orm";
import { projectTable } from "../database/schema";
import {
  budgetTable,
  budgetThresholdNoticeTable,
} from "../database/schema-p5-time";
import type { DbTransaction } from "../events/outbox";
import {
  enqueueNotificationEvent,
  type NotificationRecipientCandidate,
} from "../notification/fanout";
import { configuredMentionChannels } from "../notification/fanout.repository";
import { findNotificationPerson } from "../notification/repository";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import { newlyReachedThresholds } from "./cost-logic";
import { COST_TRACKING_FEATURE_KEY, trackingFeatureEnabled } from "./feature";

export const BUDGET_THRESHOLD_EVENT = "budget.threshold_reached";

/**
 * A budget's actual in its own currency inside its period, for the threshold check: time entries
 * valued at the rate captured on each entry (per-entry rounding, the same expression as the
 * budget view and the reports) plus cost entries. The system check is not scoped to a caller's
 * reach; the project is the only fence.
 */
async function systemActualMinor(
  tx: DbTransaction,
  budget: typeof budgetTable.$inferSelect,
): Promise<number> {
  const result = await tx.execute<{ actual: string }>(sql`
    SELECT (
      COALESCE((SELECT sum((te."minutes"::bigint * te."rate_minor" + 30) / 60) FROM "time_entry" te
        WHERE te."project_id" = ${budget.projectId} AND te."currency" = ${budget.currency}
          AND te."rate_minor" IS NOT NULL
          AND te."date" >= ${budget.periodStart}::date AND te."date" <= ${budget.periodEnd}::date), 0)
      + COALESCE((SELECT sum(ce."amount_minor") FROM "cost_entry" ce
        WHERE ce."project_id" = ${budget.projectId} AND ce."currency" = ${budget.currency}
          AND ce."date" >= ${budget.periodStart}::date AND ce."date" <= ${budget.periodEnd}::date), 0)
    )::text AS actual`);
  return Number(result.rows[0]?.actual ?? 0);
}

/**
 * TC-18: after a write that can raise a project's actuals (time entry, timer stop, cost entry,
 * budget create), announce each budget that has newly crossed 75% or 90% to the project manager.
 *
 * Idempotent once per threshold per budget: the project's budget rows are locked FOR UPDATE
 * first (two concurrent writers cannot both miss or both announce a crossing), and the
 * `budget_threshold_notice` insert is the gate. A jump from below 75% past 90% records both
 * thresholds and notifies once, for 90%. Runs in the caller's transaction; the outbox row and the
 * inbox fan-out commit with the write that crossed the line. The actor is `system`, so a manager
 * whose own entry crossed the line is still told.
 */
export async function evaluateBudgetThresholds(
  tx: DbTransaction,
  workspaceId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<void> {
  const budgets = await tx
    .select()
    .from(budgetTable)
    .where(
      and(
        eq(budgetTable.workspaceId, workspaceId),
        eq(budgetTable.projectId, projectId),
      ),
    )
    .orderBy(asc(budgetTable.id))
    .for("update");
  for (const budget of budgets) {
    if (budget.plannedAmountMinor <= 0) continue;
    const announced = new Set(
      (
        await tx
          .select({ threshold: budgetThresholdNoticeTable.threshold })
          .from(budgetThresholdNoticeTable)
          .where(eq(budgetThresholdNoticeTable.budgetId, budget.id))
      ).map((row) => row.threshold),
    );
    if (announced.size >= 2) continue;
    const reached = newlyReachedThresholds(
      budget.plannedAmountMinor,
      await systemActualMinor(tx, budget),
      announced,
    );
    if (reached.length === 0) continue;
    // R7-02: a threshold counts as announced only when somebody is actually told. With no
    // eligible recipient (no manager, inactive, lacking budget:read/manage_rates, cost tracking
    // off) nothing is recorded, so a later evaluation after a manager is assigned or cost
    // tracking is switched on still fires. The budget rows are locked, so the check and the
    // gate insert below are serialised per project.
    const probe = await budgetThresholdRecipients(tx, {
      kind: BUDGET_THRESHOLD_EVENT,
      scope: { workspaceId, projectId },
      payload: {
        budgetId: budget.id,
        budgetName: budget.name,
        threshold: Math.max(...reached),
        currency: budget.currency,
      },
    });
    if (probe.length === 0) continue;
    const inserted = await tx
      .insert(budgetThresholdNoticeTable)
      .values(reached.map((threshold) => ({ budgetId: budget.id, threshold })))
      .onConflictDoNothing()
      .returning({ threshold: budgetThresholdNoticeTable.threshold });
    if (inserted.length === 0) continue;
    const threshold = Math.max(...inserted.map((row) => row.threshold));
    const [project] = await tx
      .select({ organisationId: projectTable.organisationId })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1);
    await enqueueNotificationEvent(
      tx,
      {
        id: createId(),
        kind: BUDGET_THRESHOLD_EVENT,
        occurredAt: now.toISOString(),
        actor: { type: "system", id: null, name: "Budget monitor" },
        scope: {
          workspaceId,
          projectId,
          ...(project?.organisationId
            ? { organisationId: project.organisationId }
            : {}),
        },
        payload: {
          budgetId: budget.id,
          budgetName: budget.name,
          threshold,
          currency: budget.currency,
          url: `/agent/settings/projects/${encodeURIComponent(projectId)}/budget`,
        },
        causationId: null,
        depth: 0,
        originAutomationId: null,
      },
      { resolveRecipients: budgetThresholdRecipients },
    );
  }
}

/**
 * The project manager, and only when they may currently see the figure: the threshold moves with
 * priced time, so the same visibility rule as the budget view applies (`time_entry:manage_rates`
 * with cost tracking on, plus reach and `budget:read` at the project). A project without a
 * manager, or a manager who fails the test, notifies no one: never an error.
 */
export async function budgetThresholdRecipients(
  tx: DbTransaction,
  event: {
    kind: string;
    scope: { workspaceId?: string; projectId?: string };
    payload: Record<string, unknown>;
  },
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== BUDGET_THRESHOLD_EVENT) return [];
  const { workspaceId, projectId } = event.scope;
  if (!workspaceId || !projectId) return [];
  const [project] = await tx
    .select({
      managerId: projectTable.managerId,
      organisationId: projectTable.organisationId,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!project?.managerId || project.deletedAt) return [];
  const person = await findNotificationPerson(tx, project.managerId);
  if (!person?.active || !person.userId || person.side !== "staff") return [];
  const identity = await resolveIdentity(
    { userId: person.userId, credential: "session" },
    tx,
  );
  if (!identity || identity.personId !== project.managerId) return [];
  const ancestorProjectIds = await projectAncestryFor(
    tx,
    identity,
    workspaceId,
    projectId,
  );
  const ownerTeamId = await projectOwnerTeamFor(
    tx,
    identity,
    workspaceId,
    projectId,
  );
  if (
    !reaches(identity, {
      projectId,
      workspaceId,
      organisationId: project.organisationId,
      visibleToPersonIds: null,
      ancestorProjectIds,
      ownerTeamId: ownerTeamId ?? null,
    }) ||
    !can(identity, "budget:read", "project", {
      projectId,
      workspaceId,
      ancestorProjectIds,
    }) ||
    !can(identity, "time_entry:manage_rates", "workspace", { workspaceId }) ||
    !(await trackingFeatureEnabled(
      COST_TRACKING_FEATURE_KEY,
      workspaceId,
      projectId,
    ))
  )
    return [];
  const threshold = Number(event.payload.threshold);
  const name =
    typeof event.payload.budgetName === "string"
      ? event.payload.budgetName
      : "A budget";
  return [
    {
      personId: project.managerId,
      resourceType: "project",
      resourceId: projectId,
      title: `Budget at ${threshold}%`,
      body: `${name} has reached ${threshold}% of its planned amount.`,
      channels: await configuredMentionChannels(tx),
    },
  ];
}
