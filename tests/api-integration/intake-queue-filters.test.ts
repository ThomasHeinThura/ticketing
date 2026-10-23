/**
 * IQ-21: server-side queue filters on GET /api/submissions (requestTypeKey, assignee,
 * olderThanDays), composed with state and cursor paging. WRITTEN, NOT YET RUN: needs the
 * integration database (coordinator runs it).
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

type Queue = {
  submissions: Array<{ ref: string }>;
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { total: number };
};

async function list(s: Awaited<ReturnType<typeof seedIntake>>, query = "") {
  const response = await staffRequest(
    s.t,
    s.t.requester,
    `/api/submissions?workspaceId=${s.t.workspaceId}${query}`,
  );
  return {
    response,
    body: (response.status === 200
      ? await response.clone().json()
      : null) as Queue,
  };
}

describe("staff queue server-side filters (IQ-21)", () => {
  beforeEach(async () => resetTestDatabase());

  it("filters by requestTypeKey, unclaimed/claimer and olderThanDays, composing with state", async () => {
    const s = await seedIntake("iq21-filters");
    const old = await submitAs(s, s.customer, "Old one");
    const claimed = await submitAs(s, s.customer, "Claimed one");
    const fresh = await submitAs(s, s.customer, "Fresh one");
    const oldRow = await submissionRow(old);
    await db
      .update(schema.submissionTable)
      .set({ createdAt: new Date(Date.now() - 10 * 86_400_000) })
      .where(eq(schema.submissionTable.id, oldRow.id));
    const claimedRow = await submissionRow(claimed);
    const requesterPerson = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, s.t.requester.user.id))
      .limit(1)
      .then((rows) => rows[0]);
    await db
      .update(schema.submissionTable)
      .set({ claimedBy: requesterPerson?.id ?? null, claimedAt: new Date() })
      .where(eq(schema.submissionTable.id, claimedRow.id));

    const byType = await list(s, `&requestTypeKey=${s.requestType.key}`);
    expect(byType.body.submissions).toHaveLength(3);
    expect(byType.body.meta.total).toBe(3);
    const noType = await list(s, "&requestTypeKey=does-not-exist");
    expect(noType.body.submissions).toHaveLength(0);
    expect(noType.body.meta.total).toBe(0);

    const unclaimed = await list(s, "&assignee=unclaimed");
    expect(unclaimed.body.submissions.map((row) => row.ref).sort()).toEqual(
      [old, fresh].sort(),
    );
    const mine = await list(s, `&assignee=${requesterPerson?.id}`);
    expect(mine.body.submissions.map((row) => row.ref)).toEqual([claimed]);

    const older = await list(s, "&olderThanDays=7");
    expect(older.body.submissions.map((row) => row.ref)).toEqual([old]);

    const composed = await list(
      s,
      "&state=new&assignee=unclaimed&olderThanDays=7",
    );
    expect(composed.body.submissions.map((row) => row.ref)).toEqual([old]);
    const none = await list(s, "&state=accepted&olderThanDays=7");
    expect(none.body.submissions).toHaveLength(0);
  });

  it("pages a filtered queue cursor-safely and rejects a cursor under different filters", async () => {
    const s = await seedIntake("iq21-cursor");
    for (const title of ["a", "b", "c"]) await submitAs(s, s.customer, title);
    const first = await list(s, "&assignee=unclaimed&limit=2");
    expect(first.body.submissions).toHaveLength(2);
    expect(first.body.page.hasMore).toBe(true);
    const cursor = first.body.page.nextCursor ?? "";
    const second = await list(
      s,
      `&assignee=unclaimed&limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.body.submissions).toHaveLength(1);
    const seen = [...first.body.submissions, ...second.body.submissions].map(
      (row) => row.ref,
    );
    expect(new Set(seen).size).toBe(3);

    const mismatched = await list(
      s,
      `&limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(mismatched.response.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a malformed olderThanDays", async () => {
    const s = await seedIntake("iq21-bad");
    const bad = await list(s, "&olderThanDays=abc");
    expect(bad.response.status).toBe(400);
    expect(await bad.response.text()).toContain("olderThanDays");
  });
});
