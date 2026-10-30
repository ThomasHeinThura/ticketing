import { sendNotificationEmail } from "@taskdesk/email";
import { sql } from "drizzle-orm";
import { getConfiguredAgentOrigin } from "../auth";
import db from "../database";
import type { DbTransaction } from "../events/outbox";
import { canonicalEmailDefaultEnabled } from "../notification/canonical-preferences";
import {
  configuredMentionChannels,
  findMostSpecificPreferenceRow,
} from "../notification/fanout.repository";
import { signNotificationPreferenceLink } from "../notification/preference-link";
import { z } from "../openapi";
import { EXPORT_TTL_HOURS } from "./export.logic";

/** The preference key a requester can switch the "export ready" email off with (per channel). */
export const EXPORT_READY_EVENT = "report.export_ready";
const EMAIL_CHANNEL = "notify.email";
/** Agent screens the email links to (P5-R3-01, P5-R3-02). */
export const exportPagePath = (id: string) =>
  `/agent/reports/exports/${encodeURIComponent(id)}`;
const PREFERENCES_PATH = "/dashboard/settings/account/notifications";

/**
 * P5-R3-04: how long one worker's claim on an owed email lasts. The send has a 25 second
 * deadline, so a claim older than this belongs to a worker that crashed or lost its lease, and
 * the next run of the job takes it over. Replaceable by tests.
 */
export const exportNotifyLease = { ms: 10 * 60_000 };

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

/** A claim nobody holds, or one whose lease ran out (the claiming worker crashed). */
const claimFree = () =>
  sql`(notify_claimed_at IS NULL
    OR notify_claimed_at < now() - make_interval(secs => ${exportNotifyLease.ms / 1000}))`;

/** The outcome is decided (sent, or deliberately not sent): the email is never owed again. */
async function markDecided(id: string): Promise<void> {
  await db.execute(sql`UPDATE report_export
    SET notified_at = COALESCE(notified_at, now()), notify_claimed_at = NULL
    WHERE id = ${id}`);
}

/**
 * RP-10 (P5-R2-02, P5-R3-01): when a queued export is ready, its requester is emailed (at least once, P5-R4-01: a crash after the send but before marking repeats it), with
 * a link to the agent page `/agent/reports/exports/{id}`. That page goes through the normal
 * sign-in (with a return to itself) and offers the authenticated download, which re-checks the
 * requester's session, capabilities and reach. The email carries no signed or public file URL,
 * so a forwarded copy is useless to anyone else.
 *
 * Once only (P5-R3-04): a worker claims the email with a lease (`notify_claimed_at`, conditional
 * UPDATE) so two workers or a re-run never send concurrently. `notified_at` is set only when the
 * outcome is decided: sent, refused at send time, no email channel installed, the requester
 * switched the event off, or no deliverable address. A transport failure releases the claim, and
 * a claim whose worker crashed expires after `exportNotifyLease`; either way the next run of the
 * job sends it, with the same idempotency key.
 *
 * Preferences (NO-2, P5-R3-02): `report.export_ready` on `notify.email` is a staff preference the
 * notification settings screen offers. The requester's most specific row decides (project rows do
 * not apply; an export has no project); without a row it is on. Every email carries the signed
 * link to that exact preference. This goes straight to the mailer rather than through the
 * notification outbox: there is no inbox entry, no digest and no quiet-hours deferral (the link
 * is useful only within the 24 hour download window).
 */
export async function notifyExportReady(
  exportId: string,
): Promise<ExportReadyOutcome> {
  const claimed = (
    await db.execute<Claimed>(sql`UPDATE report_export SET notify_claimed_at = now()
      WHERE id = ${exportId} AND status = 'ready' AND notified_at IS NULL
        AND (expires_at IS NULL OR expires_at > now()) AND ${claimFree()}
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
    if (
      !(preference
        ? preference.enabled
        : canonicalEmailDefaultEnabled(EXPORT_READY_EVENT))
    )
      return { kind: "opted_out" as const };
    const to = await destination(tx, claimed.person_id);
    if (!to) return { kind: "no_destination" as const };
    return { kind: "send" as const, to };
  });
  if (plan.kind !== "send") {
    await markDecided(claimed.id);
    return plan.kind;
  }

  const origin = getConfiguredAgentOrigin();
  const rows = claimed.row_count === null ? "" : ` (${claimed.row_count} rows)`;
  try {
    const token = signNotificationPreferenceLink({
      audience: "agent",
      recipientPersonId: claimed.person_id,
      selector: {
        eventKind: EXPORT_READY_EVENT,
        channel: EMAIL_CHANNEL,
        scope: "global",
        scopeId: null,
      },
    });
    const result = await exportReadyMailer.send(
      plan.to.email,
      `Your export is ready: ${claimed.title}`,
      {
        title: `Your export is ready: ${claimed.title}`,
        message: `The CSV export you requested${rows} is ready. Open it in TaskDesk to download it within ${EXPORT_TTL_HOURS} hours. If you are signed out, you will be asked to sign in first.`,
        actionUrl: new URL(exportPagePath(claimed.id), origin).href,
        preferenceUrl: `${origin}${PREFERENCES_PATH}#preference_token=${token}`,
        locale: plan.to.locale,
      },
      {
        deadlineMs: 25_000,
        idempotencyKey: `report-export-ready:${claimed.id}`,
        authorize: () => stillReady(claimed.id),
      },
    );
    await markDecided(claimed.id);
    return result.success ? "sent" : "not_sent";
  } catch (error) {
    // The transport failed before a decided outcome: release the claim for the next run.
    await db.execute(sql`UPDATE report_export SET notify_claimed_at = NULL
      WHERE id = ${claimed.id} AND notified_at IS NULL`);
    console.error("report export email failed", error);
    return "not_sent";
  }
}

/**
 * Ready exports whose email is still owed: a failed send, or a claim whose worker crashed before
 * deciding (its lease has run out).
 */
export async function exportsAwaitingEmail(limit: number): Promise<string[]> {
  const result = await db.execute<{
    id: string;
  }>(sql`SELECT id FROM report_export
    WHERE status = 'ready' AND notified_at IS NULL AND ${claimFree()}
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY finished_at LIMIT ${limit}`);
  return result.rows.map((row) => row.id);
}
