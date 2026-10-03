import { sendBreakGlassAlertEmail } from "@taskdesk/email";
import { eq, sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type { DatabaseInstance } from "../database";
import { schema } from "../database";

const PROMOTION_LOCK_KEY = 2026;
const CONFIRMATION_PHRASE = "GRANT INSTANCE ADMIN";
const ALERT_TITLE = "An instance administrator recovery command was used";
const ALERT_CONTENT =
  "An instance administrator recovery command was used. Review the instance audit log. If you did not expect this change, contact your instance operator.";

type Outcome = "granted" | "already_admin" | "refused" | "cancelled";
type Reason =
  | "setup_incomplete"
  | "target_unresolved"
  | "target_ineligible"
  | "displayed_state_changed";

type Target = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  anonymous: boolean;
  banned: boolean;
  people: Array<{ id: string; side: string; active: boolean }>;
};

type State = {
  setupCompleted: boolean;
  target: Target | null;
  admins: string[];
};

export type BreakGlassOperator = { uid: number; passwdName: string };
export type BreakGlassIO = {
  isTTY: boolean;
  write(message: string): void;
  ask(prompt: string): Promise<string>;
};

function eligible(target: Target | null): target is Target & {
  people: [{ id: string; side: "staff"; active: true }];
} {
  return Boolean(
    target &&
      !target.anonymous &&
      !target.banned &&
      target.people.length === 1 &&
      target.people[0]?.side === "staff" &&
      target.people[0]?.active === true,
  );
}

async function readState(
  queryable: DatabaseInstance,
  email: string,
): Promise<State> {
  const [setting] = await queryable
    .select({ setupCompletedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  const users = await queryable
    .select({
      id: schema.userTable.id,
      email: schema.userTable.email,
      name: schema.userTable.name,
      role: schema.userTable.role,
      anonymous: schema.userTable.isAnonymous,
      banned: schema.userTable.banned,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(2);
  let target: Target | null = null;
  if (users.length === 1 && users[0]) {
    const user = users[0];
    const people = await queryable
      .select({
        id: schema.personTable.id,
        side: schema.personTable.side,
        active: schema.personTable.active,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    target = {
      ...user,
      anonymous: user.anonymous === true,
      banned: user.banned === true,
      people,
    };
  }
  const adminRows = await queryable
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.role, "admin"));
  return {
    setupCompleted: setting?.setupCompletedAt !== null && setting !== undefined,
    target,
    admins: adminRows.map((row) => row.id).sort(),
  };
}

function snapshotKey(state: State): string {
  const target = state.target;
  return JSON.stringify({
    setupCompleted: state.setupCompleted,
    admins: state.admins,
    target: target
      ? {
          id: target.id,
          role: target.role,
          anonymous: target.anonymous,
          banned: target.banned,
          people: target.people
            .map((person) => ({
              id: person.id,
              side: person.side,
              active: person.active,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }
      : null,
  });
}

async function writeAudit(
  tx: Parameters<Parameters<DatabaseInstance["transaction"]>[0]>[0],
  operator: BreakGlassOperator,
  outcome: Outcome,
  reason: Reason | null,
  target: Target | null,
): Promise<void> {
  await appendAuditLog(tx, {
    action: "auth.break_glass_used",
    actorId: null,
    actorType: "system",
    workspaceId: null,
    entityType: target ? "user" : "instance_setting",
    entityId: target?.id ?? "singleton",
    before: null,
    after: {
      outcome,
      ...(reason ? { reason } : {}),
      effectiveUid: operator.uid,
      passwdName: operator.passwdName,
    },
  });
}

async function recordRefusal(
  db: DatabaseInstance,
  operator: BreakGlassOperator,
  email: string,
  state: State,
  reason: Reason | null,
  outcome: Outcome = "refused",
): Promise<{ outcome: Outcome; reason: Reason | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PROMOTION_LOCK_KEY})`);
    const current = await readState(tx as unknown as DatabaseInstance, email);
    const same = snapshotKey(current) === snapshotKey(state);
    const actualOutcome = same ? outcome : "refused";
    const actualReason = same ? reason : "displayed_state_changed";
    await writeAudit(
      tx as never,
      operator,
      actualOutcome,
      actualReason,
      current.target,
    );
    return { outcome: actualOutcome, reason: actualReason };
  });
}

export async function grantInstanceAdmin(
  db: DatabaseInstance,
  email: string,
  operator: BreakGlassOperator,
  io: BreakGlassIO,
): Promise<{ outcome: Outcome; emailSucceeded: number; emailFailed: number }> {
  if (!io.isTTY)
    throw new Error("This recovery command requires an interactive TTY.");
  const displayed = await readState(db, email);
  if (!displayed.setupCompleted) {
    const refusal = await recordRefusal(
      db,
      operator,
      email,
      displayed,
      "setup_incomplete",
    );
    if (refusal.reason === "displayed_state_changed") {
      throw new Error(
        "The displayed instance or target changed. Restart and verify the target again.",
      );
    }
    throw new Error(
      "Recovery is available only after instance setup is complete.",
    );
  }
  if (!displayed.target) {
    const refusal = await recordRefusal(
      db,
      operator,
      email,
      displayed,
      "target_unresolved",
    );
    if (refusal.reason === "displayed_state_changed") {
      throw new Error(
        "The displayed instance or target changed. Restart and verify the target again.",
      );
    }
    throw new Error("The exact stored email did not resolve to one user.");
  }
  if (!eligible(displayed.target)) {
    const refusal = await recordRefusal(
      db,
      operator,
      email,
      displayed,
      "target_ineligible",
    );
    if (refusal.reason === "displayed_state_changed") {
      throw new Error(
        "The displayed instance or target changed. Restart and verify the target again.",
      );
    }
    throw new Error(
      "The resolved user does not have one eligible active staff identity.",
    );
  }

  const attestation = await io.ask(
    "Confirm all current administrators are unable to recover access and this person's identity was independently verified. Type YES to continue: ",
  );
  if (attestation !== "YES") {
    const refusal = await recordRefusal(
      db,
      operator,
      email,
      displayed,
      null,
      "cancelled",
    );
    if (refusal.outcome !== "cancelled") {
      throw new Error(
        "The displayed instance or target changed. Restart and verify the target again.",
      );
    }
    return { outcome: "cancelled", emailSucceeded: 0, emailFailed: 0 };
  }
  io.write(`Target: ${displayed.target.name} <${displayed.target.email}>`);
  const confirmation = await io.ask(
    `Type ${CONFIRMATION_PHRASE} to commit this recovery: `,
  );
  if (confirmation !== CONFIRMATION_PHRASE) {
    const refusal = await recordRefusal(
      db,
      operator,
      email,
      displayed,
      null,
      "cancelled",
    );
    if (refusal.outcome !== "cancelled") {
      throw new Error(
        "The displayed instance or target changed. Restart and verify the target again.",
      );
    }
    return { outcome: "cancelled", emailSucceeded: 0, emailFailed: 0 };
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PROMOTION_LOCK_KEY})`);
    const queryable = tx as unknown as DatabaseInstance;
    const candidate = await readState(queryable, email);
    if (candidate.target) {
      await tx
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, candidate.target.id))
        .for("update");
      await tx
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, candidate.target.id))
        .for("update");
    }
    const current = await readState(queryable, email);
    if (
      !current.setupCompleted ||
      !eligible(current.target) ||
      snapshotKey(current) !== snapshotKey(displayed)
    ) {
      await writeAudit(
        tx as never,
        operator,
        "refused",
        "displayed_state_changed",
        current.target,
      );
      return {
        outcome: "refused" as const,
        recipients: [] as Array<{ email: string; locale: string | null }>,
      };
    }

    const target = current.target;
    const outcome: Outcome =
      target.role === "admin" ? "already_admin" : "granted";
    if (outcome === "granted") {
      await tx
        .update(schema.userTable)
        .set({ role: "admin" })
        .where(eq(schema.userTable.id, target.id));
    }
    const recipients = await tx
      .selectDistinct({
        id: schema.userTable.id,
        email: schema.userTable.email,
        locale: schema.userTable.locale,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.role, "admin"));
    if (!recipients.some(({ id }) => id === target.id)) {
      recipients.push({
        id: target.id,
        email: target.email,
        locale: null,
      });
    }
    await tx.insert(schema.notificationTable).values(
      recipients.map(({ id }) => ({
        userId: id,
        type: "security_alert",
        title: ALERT_TITLE,
        content: ALERT_CONTENT,
        eventData: { kind: "break_glass_used", outcome },
        resourceId: "singleton",
        resourceType: "instance",
      })),
    );
    await writeAudit(tx as never, operator, outcome, null, target);
    return {
      outcome,
      recipients: recipients.map(({ email, locale }) => ({ email, locale })),
    };
  });

  if (result.outcome === "refused") {
    throw new Error(
      "The displayed instance or target changed. Restart and verify the target again.",
    );
  }
  let emailSucceeded = 0;
  let emailFailed = 0;
  for (const recipient of result.recipients) {
    try {
      const sent = await sendBreakGlassAlertEmail(
        recipient.email,
        recipient.locale,
      );
      if (sent.success) emailSucceeded += 1;
      else emailFailed += 1;
    } catch {
      emailFailed += 1;
    }
  }
  return { outcome: result.outcome, emailSucceeded, emailFailed };
}

export { CONFIRMATION_PHRASE };
