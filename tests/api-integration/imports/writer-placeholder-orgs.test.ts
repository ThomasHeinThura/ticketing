import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { claimVerifiedImportPlaceholder } from "../../../apps/api/src/identity/placeholder-claim";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import { requireRow } from "../helpers/fixtures";
import {
  commitChunk,
  createRun,
  record,
  type WriterFixture,
  writerFixture,
} from "./writer-fixture";

beforeEach(async () => resetTestDatabase());

const EMAIL = "contractor@example.test";

async function authorOf(workItemId: string) {
  const [comment] = await db
    .select()
    .from(schema.commentTable)
    .where(eq(schema.commentTable.workItemId, workItemId));
  return comment?.authorId ?? null;
}

async function importAuthored(f: WriterFixture, sourceRef: string, id: string) {
  const { app } = createApp();
  const run = await createRun(app, f, sourceRef);
  const { commit } = await commitChunk(app, f, run.id, "c1", [
    record(f, id, {
      comments: [
        {
          sourceId: `${id}-c1`,
          authorEmail: EMAIL.toUpperCase(),
          authorName: "Contractor",
          body: `Written by the contractor in ${sourceRef}`,
        },
      ],
    }),
  ]);
  expect(commit.counts).toMatchObject({ created: 1, rejected: 0 });
  return authorOf(commit.rows[0]?.targetId as string);
}

describe("import placeholders are per organisation (P6-R1-08)", () => {
  it("a contractor imported into two organisations keeps authorship in both, without merging identities", async () => {
    const internal = await writerFixture();
    const client = await writerFixture();
    // The second workspace belongs to a client organisation of its own.
    const clientOrg = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `client-${randomUUID()}`,
          name: "Client organisation",
          isInternal: false,
          active: true,
          portalAccess: true,
        })
        .returning(),
      "client organisation",
    );
    await db
      .update(schema.workspaceTable)
      .set({ organisationId: clientOrg.id })
      .where(eq(schema.workspaceTable.id, client.workspace.id));

    const internalAuthor = await importAuthored(internal, "org-a", "A-1");
    const clientAuthor = await importAuthored(client, "org-b", "B-1");
    // Both comments keep an author; they are two placeholders, one per organisation.
    expect(internalAuthor).toBeTruthy();
    expect(clientAuthor).toBeTruthy();
    expect(clientAuthor).not.toBe(internalAuthor);
    const placeholders = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    expect(
      placeholders
        .map((p) => p.organisationId)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(
      [internal.workspace.organisationId, clientOrg.id].sort((a, b) =>
        a.localeCompare(b),
      ),
    );
    const claims = await db.select().from(schema.importPlaceholderClaimTable);
    expect(claims.map((c) => c.normalizedEmail)).toEqual([EMAIL, EMAIL]);

    // A second import into the client organisation reuses its own placeholder.
    expect(await importAuthored(client, "org-b-again", "B-2")).toBe(
      clientAuthor,
    );
    expect(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.isPlaceholder, true)),
    ).toHaveLength(2);

    // The verified owner of the address claims the internal organisation's placeholder only.
    const claimant = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: `claimant-${randomUUID()}`,
          name: "Contractor",
          email: EMAIL,
          emailVerified: true,
        })
        .returning(),
      "claimant",
    );
    const claimed = await db.transaction((tx) =>
      claimVerifiedImportPlaceholder(tx, {
        userId: claimant.id,
        verifiedEmail: EMAIL,
        side: "staff",
        organisationId: internal.workspace.organisationId,
        method: "email_otp",
      }),
    );
    expect(claimed).toMatchObject({
      kind: "claimed",
      personId: internalAuthor,
    });
    const people = await db.select().from(schema.personTable);
    expect(people.find((p) => p.id === internalAuthor)).toMatchObject({
      userId: claimant.id,
      isPlaceholder: false,
    });
    // The client organisation's placeholder is untouched: still unclaimed, still the author.
    expect(people.find((p) => p.id === clientAuthor)).toMatchObject({
      userId: null,
      isPlaceholder: true,
      organisationId: clientOrg.id,
    });
    const after = await db.select().from(schema.importPlaceholderClaimTable);
    expect(
      after.find((c) => c.personId === clientAuthor)?.claimedAt ?? null,
    ).toBeNull();
    expect(
      after.find((c) => c.personId === internalAuthor)?.claimedAt,
    ).toBeTruthy();
  });
});
