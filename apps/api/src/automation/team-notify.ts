import { createId } from "@paralleldrive/cuid2";
import type { JsonValue } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { teamTable, workItemTable } from "../database/schema";
import { runAsAutomation } from "../events/automation-context";
import { eventScope } from "../events/outbox";
import { resolveAutomationTeamRecipients } from "../notification/automation-team-recipients";
import { enqueueNotificationEvent } from "../notification/fanout";
import { recordWorkItemActivity } from "../work-item/activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../work-item/assert-work-item-live";
import type { AutomationAction } from "./actions";
import type { ActionContext } from "./actions-executor";
import type { LoadedWorkItem } from "./facts";
import { expandPlaceholders } from "./placeholders";

// Control characters other than newline and tab never belong in a notification.
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const MAX_TITLE_LENGTH = 160;

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** `notify` (TM-9): materialize one staff-only, team-targeted event transactionally. */
export async function notifyTeam(
  ctx: ActionContext,
  item: LoadedWorkItem,
  action: Extract<AutomationAction, { type: "notify" }>,
  values: Record<string, string | null>,
): Promise<
  { ok: true; detail?: Record<string, unknown> } | { ok: false; error: string }
> {
  const title = expandPlaceholders(action.title, values, "staff")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, " ")
    .trim();
  const body = expandPlaceholders(action.body, values, "staff")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!title) return failure("empty_notification_title");
  if (title.length > MAX_TITLE_LENGTH)
    return failure("notification_title_too_long");
  if (!body) return failure("empty_notification_body");
  if (body.length > 5000) return failure("notification_body_too_long");

  return runAsAutomation(
    {
      automationId: ctx.automation.id,
      automationName: ctx.automation.name,
      depth: ctx.envelope.depth + 1,
      causationId: ctx.envelope.id,
    },
    () =>
      db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            id: workItemTable.id,
            key: workItemTable.key,
            projectId: workItemTable.projectId,
            workspaceId: workItemTable.workspaceId,
            deletedAt: workItemTable.deletedAt,
            archivedAt: workItemTable.archivedAt,
          })
          .from(workItemTable)
          .where(eq(workItemTable.id, item.id))
          .for("update");
        assertWorkItemStillLive(locked);
        await assertProjectStillLive(tx, locked.projectId);
        if (locked.workspaceId !== ctx.automation.workspaceId)
          return failure("reference_unavailable");

        const [team] = await tx
          .select({ id: teamTable.id })
          .from(teamTable)
          .where(
            and(
              eq(teamTable.id, action.teamId),
              eq(teamTable.workspaceId, locked.workspaceId),
            ),
          )
          .for("share");
        if (!team) return failure("reference_unavailable");

        const event = {
          id: `evt_${createId()}`,
          kind: "automation.notification_sent",
          occurredAt: new Date().toISOString(),
          actor: {
            type: "automation" as const,
            id: ctx.automation.id,
            name: ctx.automation.name,
          },
          scope: eventScope({
            workspaceId: locked.workspaceId,
            organisationId: item.organisationId,
            projectId: locked.projectId,
          }),
          payload: {
            key: locked.key,
            workItemId: locked.id,
            teamId: team.id,
            title,
            body,
          },
          causationId: ctx.envelope.id,
          depth: ctx.envelope.depth + 1,
          originAutomationId: ctx.automation.id,
        };

        await recordWorkItemActivity(tx, [
          {
            workspaceId: locked.workspaceId,
            workItemId: locked.id,
            actorId: ctx.automation.id,
            actorType: "automation",
            verb: "updated",
            field: "notification",
            oldValue: null,
            newValue: { teamId: team.id, title, body } as JsonValue,
          },
        ]);
        await appendAuditLog(tx, {
          actorId: ctx.automation.id,
          actorType: "automation",
          workspaceId: locked.workspaceId,
          projectId: locked.projectId,
          organisationId: item.organisationId,
          action: "automation.notification_sent",
          entityType: "work_item",
          entityId: locked.id,
          before: null,
          after: { teamId: team.id, title, body },
        });
        await enqueueNotificationEvent(tx, event, {
          resolveRecipients: resolveAutomationTeamRecipients,
        });
        return { ok: true, detail: { teamId: team.id, eventId: event.id } };
      }),
  );
}
