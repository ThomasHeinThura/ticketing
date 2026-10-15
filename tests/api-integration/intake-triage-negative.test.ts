/** Negative and race tests for triage over HTTP: IQ-16a withdrawal rules and races,
 * IQ-16 decline rules, accept rollback, destination refusal, and two triagers accepting. */
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { addCustomer, portalRequest } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { createProjectFixture } from "./helpers/fixtures";
import {
  type IntakeSeed,
  mockSessionsByHeader,
  portalAs,
  seedIntake,
  staffAs,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

const accept = (s: IntakeSeed) => ({
  method: "POST",
  body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
});

const workItemCount = async () =>
  Number((await db.select({ n: count() }).from(schema.workItemTable))[0]?.n);

describe("IQ-16a: withdrawal paths", () => {
  beforeEach(async () => resetTestDatabase());

  it("withdraws an unclaimed submission and keeps it as a record", async () => {
    const s = await seedIntake("wd-ok");
    const ref = await submitAs(s, s.customer);
    const response = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/withdraw`,
      { method: "POST" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ ref, state: "withdrawn" });
    expect((await submissionRow(ref)).state).toBe("withdrawn");
    // Withdrawing twice, and replying afterwards, are refused.
    const again = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/withdraw`,
      { method: "POST" },
    );
    expect(again.status).toBe(409);
    const reply = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/messages`,
      { method: "POST", body: { body: "still there?" } },
    );
    expect(reply.status).toBe(409);
  });

  it("refuses withdrawal after a claim, after a staff message, and after a successful accept", async () => {
    const s = await seedIntake("wd-refused");
    const claimed = await submitAs(s, s.customer, "Claimed");
    const messaged = await submitAs(s, s.customer, "Messaged");
    const attempted = await submitAs(s, s.customer, "Attempted");

    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${claimed}/claim`,
      { method: "POST" },
    );
    expect(claim.status).toBe(200);
    const message = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${messaged}/messages`,
      { method: "POST", body: { body: "Which browser?" } },
    );
    expect(message.status).toBe(200);
    // #743: only an accept that commits counts as triage action; a failed attempt is rolled
    // back with its claim (see "accept refusals and rollback").
    const attempt = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${attempted}/accept`,
      accept(s),
    );
    expect(attempt.status, await attempt.clone().text()).toBe(200);

    for (const ref of [claimed, messaged, attempted]) {
      const withdraw = await portalRequest(
        s.t,
        s.customer,
        `/api/portal/submissions/${ref}/withdraw`,
        { method: "POST" },
      );
      expect(withdraw.status, ref).toBe(409);
      const row = await submissionRow(ref);
      expect(row.state, ref).not.toBe("withdrawn");
      expect(row.claimedBy, ref).not.toBeNull();
    }
  });

  it("refuses withdrawal of someone else's submission and of a finished one", async () => {
    const s = await seedIntake("wd-foreign");
    const ref = await submitAs(s, s.customer);
    const decline = await submitAs(s, s.customer, "Declined");
    const other = await addCustomer(s.t);
    const foreign = await portalRequest(
      s.t,
      other,
      `/api/portal/submissions/${ref}/withdraw`,
      { method: "POST" },
    );
    expect(foreign.status).toBe(404);
    expect((await submissionRow(ref)).state).toBe("new");

    const declined = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${decline}/decline`,
      { method: "POST", body: { reason: "No" } },
    );
    expect(declined.status).toBe(200);
    const late = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${decline}/withdraw`,
      { method: "POST" },
    );
    expect(late.status).toBe(409);
    expect((await submissionRow(decline)).state).toBe("declined");
  });
});

describe("IQ-16a: withdrawal races resolve to exactly one winner", () => {
  beforeEach(async () => resetTestDatabase());

  const ROUNDS = 6;

  async function race(
    label: string,
    triage: (s: IntakeSeed, ref: string) => Promise<Response> | Response,
    triageWon: (ref: string) => Promise<boolean>,
  ) {
    const s = await seedIntake(label);
    mockSessionsByHeader([
      { user: s.t.requester.user },
      { user: s.customer.user, portal: "customer" },
    ]);
    let withdrawWins = 0;
    let triageWins = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const ref = await submitAs(s, s.customer, `${label} ${round}`);
      mockSessionsByHeader([
        { user: s.t.requester.user },
        { user: s.customer.user, portal: "customer" },
      ]);
      const [withdraw, other] = await Promise.all([
        portalAs(
          s.t,
          s.customer.user,
          `/api/portal/submissions/${ref}/withdraw`,
          {
            method: "POST",
          },
        ),
        triage(s, ref),
      ]);
      const row = await submissionRow(ref);
      const withdrawOk = withdraw.status === 200;
      const otherOk = other.status === 200;
      // Exactly one winner, the loser is refused (never silently accepted).
      expect(
        withdrawOk !== otherOk,
        `${label} #${round}: ${withdraw.status}/${other.status}`,
      ).toBe(true);
      if (withdrawOk) {
        withdrawWins += 1;
        expect(withdraw.status).toBe(200);
        expect(other.status).toBe(409);
        expect(row.state).toBe("withdrawn");
        expect(row.claimedBy).toBeNull();
        expect(await triageWon(ref)).toBe(false);
      } else {
        triageWins += 1;
        expect(withdraw.status).toBe(409);
        expect(row.state).not.toBe("withdrawn");
        expect(row.claimedBy).not.toBeNull();
        expect(await triageWon(ref)).toBe(true);
      }
    }
    expect(withdrawWins + triageWins).toBe(ROUNDS);
  }

  it("withdraw vs claim", async () => {
    await race(
      "race-claim",
      (s, ref) =>
        staffAs(s.t, s.t.requester.user, `/api/submissions/${ref}/claim`, {
          method: "POST",
        }),
      async (ref) => (await submissionRow(ref)).claimedBy !== null,
    );
  });

  it("withdraw vs staff message", async () => {
    await race(
      "race-message",
      (s, ref) =>
        staffAs(s.t, s.t.requester.user, `/api/submissions/${ref}/messages`, {
          method: "POST",
          body: { body: "Which browser?" },
        }),
      async (ref) => {
        const messages = await db
          .select()
          .from(schema.submissionMessageTable)
          .where(
            eq(
              schema.submissionMessageTable.submissionId,
              (await submissionRow(ref)).id,
            ),
          );
        return messages.length > 0;
      },
    );
  });

  it("withdraw vs accept", async () => {
    await race(
      "race-accept",
      (s, ref) =>
        staffAs(s.t, s.t.requester.user, `/api/submissions/${ref}/accept`, {
          method: "POST",
          body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
        }),
      async (ref) => (await submissionRow(ref)).state === "accepted",
    );
  });
});

describe("IQ-16: decline", () => {
  beforeEach(async () => resetTestDatabase());

  it("refuses an empty or whitespace reason and leaves the submission open", async () => {
    const s = await seedIntake("decline-empty");
    const ref = await submitAs(s, s.customer);
    for (const reason of ["", "   ", "\n\t "]) {
      const response = await staffRequest(
        s.t,
        s.t.requester,
        `/api/submissions/${ref}/decline`,
        { method: "POST", body: { reason } },
      );
      expect(response.status, JSON.stringify(reason)).toBe(400);
    }
    const missing = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: {} },
    );
    expect(missing.status).toBe(400);
    const row = await submissionRow(ref);
    expect(row.state).toBe("new");
    expect(
      await db
        .select()
        .from(schema.submissionMessageTable)
        .where(eq(schema.submissionMessageTable.submissionId, row.id)),
    ).toHaveLength(0);
  });

  it("is final for the customer: no reply, no withdrawal, no reopen", async () => {
    const s = await seedIntake("decline-final");
    const ref = await submitAs(s, s.customer);
    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Not something we do" } },
    );
    expect(decline.status).toBe(200);
    // Shown verbatim on the durable page.
    const page = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}`,
    );
    expect(page.status).toBe(200);
    const body = (await page.json()) as {
      submission: { state: string };
      canWithdraw: boolean;
      messages: Array<{ body: string }>;
    };
    expect(body.submission.state).toBe("declined");
    expect(body.canWithdraw).toBe(false);
    expect(body.messages.map((message) => message.body)).toContain(
      "Not something we do",
    );
    for (const [suffix, payload] of [
      ["messages", { body: "Please reconsider" }],
      ["withdraw", undefined],
    ] as const) {
      const response = await portalRequest(
        s.t,
        s.customer,
        `/api/portal/submissions/${ref}/${suffix}`,
        { method: "POST", ...(payload ? { body: payload } : {}) },
      );
      expect(response.status, suffix).toBe(409);
    }
    // Staff cannot decline or accept it again either.
    const again = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/decline`,
      { method: "POST", body: { reason: "Again" } },
    );
    expect(again.status).toBe(409);
    expect((await submissionRow(ref)).state).toBe("declined");
  });
});

describe("customer replies by submission state", () => {
  beforeEach(async () => resetTestDatabase());

  it("is refused in new, declined and duplicate", async () => {
    const s = await seedIntake("reply-states");
    const fresh = await submitAs(s, s.customer, "Fresh");
    const declined = await submitAs(s, s.customer, "Declined");
    const duplicated = await submitAs(s, s.customer, "Duplicated");
    await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${declined}/decline`,
      { method: "POST", body: { reason: "No" } },
    );
    await db
      .update(schema.submissionTable)
      .set({ state: "duplicate", workItemId: s.t.workItem.id })
      .where(
        eq(
          schema.submissionTable.number,
          Number(duplicated.replace("SUB-", "")),
        ),
      );
    for (const ref of [fresh, declined, duplicated]) {
      const response = await portalRequest(
        s.t,
        s.customer,
        `/api/portal/submissions/${ref}/messages`,
        { method: "POST", body: { body: "Hello" } },
      );
      expect(response.status, ref).toBe(409);
    }
  });

  it("lands as a public comment on the work item after acceptance", async () => {
    const s = await seedIntake("reply-accepted");
    const ref = await submitAs(s, s.customer);
    const accepted = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      accept(s),
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const { workItem } = (await accepted.json()) as {
      workItem: { id: string };
    };
    const reply = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${ref}/messages`,
      { method: "POST", body: { body: "One more detail" } },
    );
    expect(reply.status, await reply.clone().text()).toBe(200);
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, workItem.id));
    const last = comments.at(-1);
    expect(last?.visibility).toBe("public");
    expect(JSON.stringify(last?.body)).toContain("One more detail");
  });
});

describe("accept refusals and rollback", () => {
  beforeEach(async () => resetTestDatabase());

  it("refuses a destination project that does not serve the customer's organisation (422)", async () => {
    const s = await seedIntake("accept-org");
    const ref = await submitAs(s, s.customer);
    const { project: elsewhere } = await createProjectFixture({
      workspaceId: s.t.workspaceId,
    });
    const before = await workItemCount();
    const response = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      {
        method: "POST",
        body: { projectId: elsewhere.id, workItemTypeId: s.t.type.id },
      },
    );
    expect(response.status, await response.clone().text()).toBe(422);
    expect(await workItemCount()).toBe(before);
    const row = await submissionRow(ref);
    expect(row.state).toBe("new");
    expect(row.workItemId).toBeNull();
  });

  it("rolls back acceptance when the attachment transfer fails, and succeeds on retry", async () => {
    const s = await seedIntake("accept-rollback");
    const ref = await submitAs(s, s.customer);
    const submission = await submissionRow(ref);
    await db.insert(schema.attachmentTable).values({
      workspaceId: s.t.workspaceId,
      organisationId: s.customer.orgId,
      submissionId: submission.id,
      objectKey: `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/a1/evidence.png`,
      filename: "evidence.png",
      mimeType: "image/png",
      size: 12,
      state: "ready",
      customerVisible: true,
      uploadedBy: s.customer.person.id,
    });
    const items = await workItemCount();
    const comments = Number(
      (await db.select({ n: count() }).from(schema.commentTable))[0]?.n,
    );
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION fail_attachment_transfer() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'attachment transfer failed'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`
      CREATE TRIGGER fail_attachment_transfer BEFORE UPDATE ON attachment
      FOR EACH ROW EXECUTE FUNCTION fail_attachment_transfer()`);
    try {
      const failed = await staffRequest(
        s.t,
        s.t.requester,
        `/api/submissions/${ref}/accept`,
        accept(s),
      );
      expect(failed.status).toBe(500);
      // No partial work item, thread copy, audit row, or accepted event.
      expect(await workItemCount()).toBe(items);
      expect(
        Number(
          (await db.select({ n: count() }).from(schema.commentTable))[0]?.n,
        ),
      ).toBe(comments);
      const row = await submissionRow(ref);
      expect(row.state).toBe("new");
      expect(row.workItemId).toBeNull();
      const [attachment] = await db.select().from(schema.attachmentTable);
      expect(attachment?.submissionId).toBe(submission.id);
      expect(attachment?.workItemId).toBeNull();
      const accepted = await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "submission.accepted"));
      expect(accepted).toHaveLength(0);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS fail_attachment_transfer ON attachment`,
      );
      await db.execute(sql`DROP FUNCTION IF EXISTS fail_attachment_transfer()`);
    }
    // Retry succeeds, and the work-item number was not consumed by the rolled-back attempt.
    const retry = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      accept(s),
    );
    expect(retry.status, await retry.clone().text()).toBe(200);
    const { workItem } = (await retry.json()) as {
      workItem: { id: string; key: string };
    };
    const [moved] = await db.select().from(schema.attachmentTable);
    expect(moved?.workItemId).toBe(workItem.id);
    expect(moved?.submissionId).toBeNull();
    const numbers = (
      await db
        .select({ number: schema.workItemTable.number })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.projectId, s.t.project.id))
    )
      .map((row) => row.number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2]);
  });

  it("#743: a missing destination leaves no claim, audit or outbox row, so another triager can accept", async () => {
    const s = await seedIntake("accept-release-missing");
    const ref = await submitAs(s, s.customer);
    const auditBefore = (await db.select().from(schema.auditLogTable)).length;
    const outboxBefore = (await db.select().from(schema.outboxTable)).length;
    const failed = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      {
        method: "POST",
        body: { projectId: "no-such-project", workItemTypeId: s.t.type.id },
      },
    );
    expect(failed.status, await failed.clone().text()).toBe(422);
    const row = await submissionRow(ref);
    expect(row.claimedBy).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.state).toBe("new");
    expect((await db.select().from(schema.auditLogTable)).length).toBe(
      auditBefore,
    );
    expect((await db.select().from(schema.outboxTable)).length).toBe(
      outboxBefore,
    );
    // A different triager is not blocked by the failed attempt.
    mockSessionsByHeader([{ user: s.t.approver.user }]);
    const other = await staffAs(
      s.t,
      s.t.approver.user,
      `/api/submissions/${ref}/accept`,
      {
        method: "POST",
        body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
      },
    );
    expect(other.status, await other.clone().text()).toBe(200);
    const accepted = await submissionRow(ref);
    expect(accepted.state).toBe("accepted");
    expect(accepted.claimedBy).not.toBeNull();
  });

  it("#743: a successful accept still records the claim, the claimed and accepted audit rows and the outbox event", async () => {
    const s = await seedIntake("accept-release-success");
    const ref = await submitAs(s, s.customer);
    const response = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}/accept`,
      accept(s),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await submissionRow(ref);
    expect(row.state).toBe("accepted");
    expect(row.claimedBy).not.toBeNull();
    expect(row.claimedAt).not.toBeNull();
    const actions = (await db.select().from(schema.auditLogTable)).map(
      (entry) => entry.action,
    );
    expect(actions).toContain("submission.claimed");
    expect(actions).toContain("submission.accepted");
    expect(
      (await db.select().from(schema.outboxTable)).filter(
        (event) => event.kind === "submission.accepted",
      ),
    ).toHaveLength(1);
  });

  it("two different triagers accepting concurrently create one work item; the loser gets 409", async () => {
    const s = await seedIntake("accept-two-triagers");
    const ref = await submitAs(s, s.customer);
    mockSessionsByHeader([
      { user: s.t.requester.user },
      { user: s.t.approver.user },
    ]);
    const before = await workItemCount();
    const [first, second] = await Promise.all([
      staffAs(s.t, s.t.requester.user, `/api/submissions/${ref}/accept`, {
        method: "POST",
        body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
      }),
      staffAs(s.t, s.t.approver.user, `/api/submissions/${ref}/accept`, {
        method: "POST",
        body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await workItemCount()).toBe(before + 1);
    const row = await submissionRow(ref);
    expect(row.state).toBe("accepted");
    const winner = first.status === 200 ? first : second;
    const { workItem } = (await winner.json()) as { workItem: { id: string } };
    expect(row.workItemId).toBe(workItem.id);
  });
});
