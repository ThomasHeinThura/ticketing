import { scanApprovalRemindersUnleased } from "../approval/reminder-scan";
import { logTaskDesk } from "../instance/observability/runtime";
import { autoDeclineStaleClarifications } from "../intake/auto-decline";
import { withJobLease } from "./leader-lock";
import { advanceDueEscalations } from "./sla-escalation";

/**
 * The composite `reminder-scan` job (background-jobs.md, every 15 minutes, one 5-minute lease).
 * Steps implemented here: approval expiry/reminders, the NO-22 escalation walk (SLA-17) and the
 * IQ-15 clarification auto-decline. Each step is fail-soft so one error never skips the rest;
 * any failing step marks the run degraded. Steps listed in the contract but not built yet
 * (`work_item.due_soon`/`overdue`, `prerequisite.overdue`, `sla_pause` > 30 days, KB review)
 * belong to other requirements. Scheduled transitions run in their own one-minute job.
 */
export type ReminderScanOutcome = {
  degraded: boolean;
  approvals?: Awaited<ReturnType<typeof scanApprovalRemindersUnleased>>;
  escalations?: Awaited<ReturnType<typeof advanceDueEscalations>>;
  clarifications?: Awaited<ReturnType<typeof autoDeclineStaleClarifications>>;
};

export async function runReminderScanSteps(): Promise<ReminderScanOutcome> {
  const outcome: ReminderScanOutcome = { degraded: false };
  const step = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch {
      outcome.degraded = true;
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "error",
        result: "degraded",
      });
      return undefined;
    }
  };
  outcome.approvals = await step(scanApprovalRemindersUnleased);
  outcome.escalations = await step(advanceDueEscalations);
  outcome.clarifications = await step(autoDeclineStaleClarifications);
  if (outcome.escalations?.degraded || outcome.clarifications?.degraded)
    outcome.degraded = true;
  return outcome;
}

export async function runReminderScan(): Promise<ReminderScanOutcome> {
  return withJobLease(
    "reminder-scan",
    runReminderScanSteps,
    () => ({ degraded: false }),
    5 * 60_000,
  );
}
