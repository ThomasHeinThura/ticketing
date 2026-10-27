import { sendNotificationEmail } from "@taskdesk/email";
import { sql } from "drizzle-orm";
import { getConfiguredAgentOrigin } from "../auth";
import db from "../database";
import type { DbTransaction } from "../events/outbox";
import {
  configuredMentionChannels,
  findMostSpecificPreferenceRow,
} from "../notification/fanout.repository";
import { z } from "../openapi";
import { EXPORT_TTL_HOURS } from "./export.logic";

/** The preference key a requester can switch the "export ready" email off with (per channel). */
export const EXPORT_READY_EVENT = "report.export_ready";
const EMAIL_CHANNEL = "notify.email";

/** The sender, replaceable by tests (the integration suite stubs `@taskdesk/email`). */
export const exportReadyMailer: { send: typeof sendNotificationEmail } = {
  send: (...args) => sendNotificationEmail(...args),
};

type Claimed = {
  id: string;
  workspace_id: string;
  person_id: string;
  title: string;
  row_count: number | null;
};

/** The requester, when they are still an active staff person with a deliverable address. */
async function destination(tx: DbTransaction, personId: string) {
  const result = await tx.execute<{
    email: string;
    locale: string | null;
  }>(sql`SELECT u.email, u.locale FROM person p JOIN "user" u ON u.id = p.user_id
    WHERE p.id = ${personId} AND p.active AND p.side = 'staff'`);
  const row = result.rows[0];
  return row && z.email().safeParse(row.email).success ? row : null;
}

/** Ready, unexpired, still the requester's file: the email's link would work when it is sent. */
async function stillReady(id: string): Promise<boolean> {
  const result = await db.execute<{
    ok: boolean;
  }>(sql`SELECT true AS ok FROM report_export
    WHERE id = ${id} AND status = 'ready' AND (expires_at IS NULL OR expires_at > now())`);
  return result.rows.length > 0;
}

export type ExportReadyOutcome =
  | "sent"
  | "already_notified"
  | "no_email_channel"
  | "opted_out"
  | "no_destination"
  | "not_sent";

/**
 * RP-10 (P5-R2-02): when a queued export is ready, its requester is emailed once, with a link to
 * the authenticated download route `GET /api/report-exports/{id}/download`, never a signed or
 * public URL. The download re-checks the requester's session, capabilities and reach, so the
 * email carries nothing a forwarded copy could use.
 *
 * Once only: `notified_at` is claimed with a conditional UPDATE before anything is sent, so two
 * workers, a retry or a re-run never send twice. A transport failure releases the claim so the
 * next run retries with the same idempotency key; a decided outcome (no email channel installed,
 * the requester switched the event off, no deliverable address, refused at send time) keeps it.
 *
 * Preferences: the requester's most specific `report.export_ready` row for `notify.email`
 * (project rows do not apply; an export has no project). Without a row it is on, because the
 * contract promises the emailed link. The preferences API does not offer this event kind yet
 * (`canonical-preferences.ts` accepts three), so the email carries no one-click preference link.
 * This goes straight to the mailer rather than through the
 * notification outbox: there is no inbox entry, no digest and no quiet-hours deferral (the
 * link is useful only within the 24 hour download window).
 */
export async function notifyExportReady(
  exportId: string,
): Promise<ExportReadyOutcome> {
  const claimed = (
    await db.execute<Claimed>(sql`UPDATE report_export SET notified_at = now()
      WHERE id = ${exportId} AND status = 'ready' AND notified_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING id, workspace_id, person_id, title, row_count`)
  ).rows[0];
  if (!claimed) return "already_notified";

  const plan = await db.transaction(async (tx) => {
    if (!(await configuredMentionChannels(tx)).includes(EMAIL_CHANNEL))
      return { kind: "no_email_channel" as const };
    const preference = await findMostSpecificPreferenceRow(tx, {
      personId: claimed.person_id,
      workspaceId: claimed.workspace_id,
      projectId: null,
      eventKind: EXPORT_READY_EVENT,
      channel: EMAIL_CHANNEL,
    });
    if (preference && !preference.enabled)
      return { kind: "opted_out" as const };
    const to = await destination(tx, claimed.person_id);
    if (!to) return { kind: "no_destination" as const };
    return { kind: "send" as const, to };
  });
  if (plan.kind !== "send") return plan.kind;

  const origin = getConfiguredAgentOrigin();
  const rows = claimed.row_count === null ? "" : ` (${claimed.row_count} rows)`;
  try {
    const result = await exportReadyMailer.send(
      plan.to.email,
      `Your export is ready: ${claimed.title}`,
      {
        title: `Your export is ready: ${claimed.title}`,
        message: `The CSV export you requested${rows} is ready. Download it within ${EXPORT_TTL_HOURS} hours; you will be asked to sign in.`,
        actionUrl: new URL(
          `/api/report-exports/${encodeURIComponent(claimed.id)}/download`,
          origin,
        ).href,
        actionLabel: "Download CSV",
        locale: plan.to.locale,
      },
      {
        deadlineMs: 25_000,
        idempotencyKey: `report-export-ready:${claimed.id}`,
        authorize: () => stillReady(claimed.id),
      },
    );
    return result.success ? "sent" : "not_sent";
  } catch (error) {
    // The transport failed before a decided outcome: release the claim for the next run.
    await db.execute(sql`UPDATE report_export SET notified_at = NULL
      WHERE id = ${claimed.id} AND status = 'ready'`);
    console.error("report export email failed", error);
    return "not_sent";
  }
}

/** Ready exports whose email is still owed (a crash between render and send, or a failed send). */
export async function exportsAwaitingEmail(limit: number): Promise<string[]> {
  const result = await db.execute<{
    id: string;
  }>(sql`SELECT id FROM report_export
    WHERE status = 'ready' AND notified_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY finished_at LIMIT ${limit}`);
  return result.rows.map((row) => row.id);
}
