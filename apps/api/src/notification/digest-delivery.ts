import { createHash } from "node:crypto";
import { sendNotificationEmail } from "@taskdesk/email";
import { sql } from "drizzle-orm";
import { getConfiguredAgentOrigin, getConfiguredCustomerOrigin } from "../auth";
import db from "../database";
import {
  releaseNotificationReservation,
  renewNotificationReservation,
} from "../database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../events/outbox";
import { logTaskDesk } from "../instance/observability/runtime";
import {
  requireTerminologyLocale,
  resolveTermForm,
} from "../terminology/service";
import { evaluateCurrentNotificationReachAndPreference } from "./current-eligibility";
import {
  callNotificationProvider,
  NOTIFICATION_PROVIDER_DEADLINE_MS,
  NOTIFICATION_RENEWAL_INTERVAL_MS,
  NotificationProviderDeadlineExceeded,
} from "./delivery-primitives";
import {
  acquireDigestReservations,
  authorizeDigestProviderAttempt,
  claimNextDigestGroup,
  type DigestGroupLease,
  type DigestMember,
  type DigestReservation,
  dedupeDigestMembers,
  deferDigestGroup,
  digestHasRecentSuccess,
  finishDigestGroup,
  listDigestMembers,
  renewDigestGroupLease,
  validateDigestProviderLease,
} from "./digest-delivery.repository";
import {
  buildCustomerDigestSummary,
  buildDigestSummary,
} from "./digest-summary";
import { signNotificationPreferenceLink } from "./preference-link";
import { resolveNotificationPreference } from "./preferences";

type DigestEligibility = Awaited<
  ReturnType<typeof evaluateCurrentNotificationReachAndPreference>
>;
type DigestProjection = Extract<
  DigestEligibility,
  { kind: "eligible" }
>["projection"];
type DigestEmail = Parameters<typeof sendNotificationEmail>[2];
type DigestEmailSend = typeof sendNotificationEmail;

export type DigestDeliveryResult =
  | { kind: "idle" }
  | {
      kind: "claimed";
      outcome: "delivered" | "suppressed" | "deferred" | "retry";
      ambiguous?: boolean;
    };

type MemberState = { member: DigestMember; eligibility: DigestEligibility };

function parseEnvelope(member: DigestMember): Record<string, unknown> | null {
  let value: unknown = member.payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function evaluateMembers(
  tx: DbTransaction,
  members: readonly DigestMember[],
): Promise<MemberState[]> {
  const result: MemberState[] = [];
  for (const member of members) {
    result.push({
      member,
      eligibility: await evaluateCurrentNotificationReachAndPreference(
        tx,
        member,
      ),
    });
  }
  return result;
}

async function groupEmailDestination(group: DigestGroupLease) {
  return db.execute(sql`
    SELECT u.email, u.locale, p.side
      FROM person p JOIN "user" u ON u.id = p.user_id
     WHERE p.id = ${group.recipientPersonId} AND p.active
  `);
}

async function emailProviderEnabled(tx: DbTransaction): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT 1 FROM instance_plugin_config
     WHERE plugin_id = 'notify.email' AND instance_key = 'default'
       AND scope = 'instance' AND workspace_id IS NULL
       AND portal_scope IS NULL AND enabled
     LIMIT 1
  `);
  return result.rows.length > 0;
}

async function preferenceUrl(
  tx: DbTransaction,
  member: DigestMember,
  audience: "agent" | "customer",
): Promise<string> {
  const envelope = parseEnvelope(member);
  const scope = envelope?.scope;
  const projectId =
    scope &&
    typeof scope === "object" &&
    !Array.isArray(scope) &&
    typeof (scope as Record<string, unknown>).projectId === "string"
      ? ((scope as Record<string, unknown>).projectId as string)
      : null;
  const preference = await resolveNotificationPreference(tx, {
    personId: member.recipientPersonId,
    workspaceId: member.workspaceId,
    projectId,
    eventKind: member.eventKind,
    channel: member.channel,
  });
  const selectedScope =
    preference.source === "project"
      ? "project"
      : preference.source === "workspace"
        ? "workspace"
        : "global";
  const selector = {
    eventKind: member.eventKind,
    channel: member.channel,
    scope: selectedScope,
    scopeId:
      selectedScope === "project"
        ? projectId
        : selectedScope === "workspace"
          ? member.workspaceId
          : null,
  } as const;
  const token = signNotificationPreferenceLink(
    {
      audience,
      recipientPersonId: member.recipientPersonId,
      selector,
    },
    member.createdAt.getTime(),
  );
  const origin =
    audience === "agent"
      ? getConfiguredAgentOrigin()
      : getConfiguredCustomerOrigin();
  const path =
    audience === "agent" ? "/agent/settings/profile/notifications" : "/account";
  return `${origin}${path}#preference_token=${token}`;
}

async function renewLeases(
  group: DigestGroupLease,
  reservations: readonly DigestReservation[],
  controller: AbortController,
): Promise<void> {
  while (!controller.signal.aborted) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, NOTIFICATION_RENEWAL_INTERVAL_MS);
      function done() {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", done);
        resolve();
      }
      controller.signal.addEventListener("abort", done, { once: true });
    });
    if (controller.signal.aborted) return;
    const renewed = await db.transaction(async (tx) => {
      if (!(await renewDigestGroupLease(tx, group)))
        throw new Error("Notification digest group lease lost");
      for (const item of reservations) {
        const lease = await renewNotificationReservation(tx, item.reservation);
        if (!lease)
          throw new Error("Notification digest member reservation lost");
        item.reservation.leaseExpiresAt = lease.leaseExpiresAt;
      }
      return true;
    });
    if (!renewed) {
      controller.abort(new Error("Notification digest lease fence lost"));
      return;
    }
  }
}

function notifyLogFailure() {
  logTaskDesk({
    module: "jobs",
    message: "jobs.failure",
    level: "error",
    result: "failed",
  });
}

async function releaseNoAttempt(
  group: DigestGroupLease,
  reservations: readonly DigestReservation[],
  until: Date,
  reason: string,
): Promise<void> {
  await db.transaction((tx) =>
    deferDigestGroup(tx, group, until, reason, reservations),
  );
}

async function terminalizeSuppressed(
  group: DigestGroupLease,
  reason: string,
): Promise<void> {
  await db.transaction((tx) =>
    finishDigestGroup(tx, group, { kind: "suppressed", reason }, []),
  );
}

/** Deliver one sealed group using a group fence plus all member dedupe reservations. */
export async function processNextNotificationDigest(
  send: DigestEmailSend = sendNotificationEmail,
): Promise<DigestDeliveryResult> {
  const claim = await db.transaction((tx) => claimNextDigestGroup(tx));
  if (claim.kind === "idle") return { kind: "idle" };
  if (claim.kind === "dead") return { kind: "claimed", outcome: "suppressed" };
  const group = claim.group;

  let members: DigestMember[];
  try {
    members = await db.transaction((tx) => listDigestMembers(tx, group.id));
  } catch {
    await releaseNoAttempt(
      group,
      [],
      new Date(Date.now() + 30_000),
      "membership_unresolved",
    );
    return { kind: "claimed", outcome: "deferred" };
  }
  if (members.length === 0) {
    await terminalizeSuppressed(group, "empty_digest");
    return { kind: "claimed", outcome: "suppressed" };
  }

  let states: MemberState[];
  try {
    states = await db.transaction((tx) => evaluateMembers(tx, members));
  } catch {
    notifyLogFailure();
    await releaseNoAttempt(
      group,
      [],
      new Date(Date.now() + 30_000),
      "evaluator_error",
    );
    return { kind: "claimed", outcome: "deferred" };
  }
  const deferred = states
    .filter((state) => state.eligibility.kind === "defer")
    .map(
      (state) =>
        (state.eligibility as Extract<DigestEligibility, { kind: "defer" }>)
          .until,
    )
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (deferred) {
    await releaseNoAttempt(group, [], deferred, "quiet_hours");
    return { kind: "claimed", outcome: "deferred" };
  }
  if (
    states.some(
      (state) =>
        state.eligibility.kind === "quiet_hours_unresolved" ||
        state.eligibility.kind === "destination_unresolved",
    )
  ) {
    await releaseNoAttempt(
      group,
      [],
      new Date(Date.now() + 30_000),
      "eligibility_unresolved",
    );
    return { kind: "claimed", outcome: "deferred" };
  }

  const suppressed = states
    .filter((state) => state.eligibility.kind === "suppress")
    .map(({ member }) => member);
  const eligible = states.filter(
    (
      state,
    ): state is MemberState & {
      eligibility: Extract<DigestEligibility, { kind: "eligible" }>;
    } => state.eligibility.kind === "eligible",
  );
  const deduped = dedupeDigestMembers(eligible.map(({ member }) => member));
  suppressed.push(...deduped.suppressed);
  let included = deduped.included;
  if (included.length === 0) {
    await terminalizeSuppressed(group, "no_eligible_members");
    return { kind: "claimed", outcome: "suppressed" };
  }

  const destinationResult = await groupEmailDestination(group);
  const destination = destinationResult.rows[0] as
    | { email: string; locale: string | null; side: "staff" | "customer" }
    | undefined;
  if (!destination || group.channel !== "notify.email") {
    await releaseNoAttempt(
      group,
      [],
      new Date(Date.now() + 30_000),
      "destination_unresolved",
    );
    return { kind: "claimed", outcome: "deferred" };
  }
  const configured = await db.transaction((tx) => emailProviderEnabled(tx));
  if (!configured) {
    await releaseNoAttempt(
      group,
      [],
      new Date(Date.now() + 60_000),
      "provider_unavailable",
    );
    return { kind: "claimed", outcome: "deferred" };
  }

  const reservationResult = await db.transaction((tx) =>
    acquireDigestReservations(tx, group, included),
  );
  if (reservationResult.kind === "deferred")
    return { kind: "claimed", outcome: "deferred" };
  if (reservationResult.kind === "collision")
    return { kind: "claimed", outcome: "suppressed" };
  let reservations = reservationResult.reservations;

  // Reservation first, then a separate DB-clock recent-success check, per NO-11.
  try {
    const recentKeys = new Set<string>();
    for (const member of included) {
      if (await db.transaction((tx) => digestHasRecentSuccess(tx, member)))
        recentKeys.add(member.dedupeKey);
    }
    if (recentKeys.size) {
      suppressed.push(
        ...included.filter((member) => recentKeys.has(member.dedupeKey)),
      );
      included = included.filter((member) => !recentKeys.has(member.dedupeKey));
      const released = reservations.filter((item) =>
        recentKeys.has(
          included.find((member) => member.id === item.ownerDeliveryId)
            ?.dedupeKey ??
            members.find((member) => member.id === item.ownerDeliveryId)
              ?.dedupeKey ??
            "",
        ),
      );
      for (const item of released)
        await db.transaction((tx) =>
          releaseNotificationReservation(
            tx,
            item.ownerDeliveryId,
            item.reservation,
          ),
        );
      reservations = reservations.filter((item) => !released.includes(item));
    }
  } catch {
    notifyLogFailure();
    await releaseNoAttempt(
      group,
      reservations,
      new Date(Date.now() + 30_000),
      "dedupe_unresolved",
    );
    return { kind: "claimed", outcome: "deferred" };
  }
  if (included.length === 0) {
    await db.transaction((tx) =>
      finishDigestGroup(
        tx,
        group,
        {
          kind: "delivered",
          includedIds: [],
          suppressedIds: members.map(({ id }) => id),
        },
        reservations,
      ),
    );
    return { kind: "claimed", outcome: "suppressed" };
  }

  const projections = new Map(
    eligible.map(({ member, eligibility }) => [
      member.id,
      eligibility.projection,
    ]),
  );
  const representative = included.at(0);
  if (!representative) {
    await terminalizeSuppressed(group, "no_eligible_members");
    return { kind: "claimed", outcome: "suppressed" };
  }
  const audience = projections.get(representative.id)?.audience ?? "agent";
  const expectedSide = audience === "agent" ? "staff" : "customer";
  if (destination.side !== expectedSide) {
    await releaseNoAttempt(
      group,
      reservations,
      new Date(Date.now() + 30_000),
      "recipient_side_mismatch",
    );
    return { kind: "claimed", outcome: "deferred" };
  }
  const origin =
    audience === "agent"
      ? getConfiguredAgentOrigin()
      : getConfiguredCustomerOrigin();
  let requestTerms = { singular: "request", plural: "requests" };
  if (audience === "customer") {
    let locale = "en-US";
    try {
      locale = requireTerminologyLocale(destination.locale ?? "en-US");
    } catch {
      // Unknown legacy locale uses the shipped English request terms.
    }
    const [singular, plural] = await db.transaction(async (tx) =>
      Promise.all([
        resolveTermForm({
          locale,
          audience: "customer",
          termKey: "request",
          count: 1,
          workspaceId: group.workspaceId,
          executor: tx,
        }),
        resolveTermForm({
          locale,
          audience: "customer",
          termKey: "request",
          count: 2,
          workspaceId: group.workspaceId,
          executor: tx,
        }),
      ]),
    );
    requestTerms = { singular, plural };
  }
  const summary =
    audience === "agent"
      ? buildDigestSummary(
          group.cadence,
          included.map(({ eventKind }) => eventKind),
        )
      : buildCustomerDigestSummary(
          group.cadence,
          included.map(({ eventKind }) => eventKind),
          requestTerms,
        );
  const projection: DigestProjection = {
    title: summary.title,
    body: summary.body,
    url: summary.url,
    audience,
  };
  const emailData: DigestEmail = {
    title: projection.title,
    message: projection.body,
    actionUrl: new URL(projection.url, origin).href,
    preferenceUrl: await db.transaction((tx) =>
      preferenceUrl(tx, representative, audience),
    ),
    locale: destination.locale,
  };
  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify({
        to: destination.email,
        subject: projection.title,
        data: emailData,
      }),
    )
    .digest("hex");
  const authorized = await db
    .transaction(async (tx) => {
      const freshStates = await evaluateMembers(tx, included);
      if (freshStates.some((state) => state.eligibility.kind !== "eligible"))
        return null;
      const freshProjections = freshStates.map((state) =>
        state.eligibility.kind === "eligible"
          ? state.eligibility.projection
          : null,
      );
      if (freshProjections.some((current) => current?.audience !== audience))
        return null;
      return authorizeDigestProviderAttempt(
        tx,
        group,
        reservations,
        payloadHash,
      );
    })
    .catch(() => null);
  if (authorized === null) {
    await releaseNoAttempt(
      group,
      reservations,
      new Date(Date.now() + 30_000),
      "eligibility_changed",
    );
    return { kind: "claimed", outcome: "deferred" };
  }

  const controller = new AbortController();
  const renewal = renewLeases(group, reservations, controller).catch(
    (error) => {
      controller.abort(
        error instanceof Error
          ? error
          : new Error("Digest lease renewal failed"),
      );
    },
  );
  let result: "delivered" | "failed" | "ambiguous" = "failed";
  try {
    const sent = await callNotificationProvider(
      (signal) =>
        send(destination.email, projection.title, emailData, {
          signal,
          deadlineMs: NOTIFICATION_PROVIDER_DEADLINE_MS,
          idempotencyKey: `${group.id}:${payloadHash}`,
          authorize: async () =>
            db.transaction(async (tx) => {
              if (!(await validateDigestProviderLease(tx, group, reservations)))
                return false;
              const live = await evaluateMembers(tx, included);
              return live.every(
                (state) => state.eligibility.kind === "eligible",
              );
            }),
        }),
      {
        signal: controller.signal,
        deadlineMs: NOTIFICATION_PROVIDER_DEADLINE_MS,
      },
    );
    result = sent.success ? "delivered" : "failed";
  } catch (error) {
    const explicitAmbiguous =
      error !== null &&
      typeof error === "object" &&
      "ambiguous" in error &&
      error.ambiguous === true;
    result =
      error instanceof NotificationProviderDeadlineExceeded ||
      controller.signal.aborted ||
      explicitAmbiguous
        ? "ambiguous"
        : "failed";
  } finally {
    controller.abort();
  }
  await renewal;

  if (result === "ambiguous") {
    await db.transaction((tx) =>
      finishDigestGroup(
        tx,
        group,
        { kind: "ambiguous", reservations },
        reservations,
      ),
    );
    return { kind: "claimed", outcome: "retry", ambiguous: true };
  }
  if (result === "delivered") {
    const completed = await db.transaction((tx) =>
      finishDigestGroup(
        tx,
        group,
        {
          kind: "delivered",
          includedIds: included.map(({ id }) => id),
          suppressedIds: suppressed.map(({ id }) => id),
        },
        reservations,
      ),
    );
    return { kind: "claimed", outcome: completed ? "delivered" : "retry" };
  }
  const completed = await db.transaction((tx) =>
    finishDigestGroup(
      tx,
      group,
      { kind: "failed", suppressedIds: suppressed.map(({ id }) => id) },
      reservations,
    ),
  );
  return { kind: "claimed", outcome: completed ? "retry" : "retry" };
}
