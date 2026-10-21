import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";

let credentialsDirectory: string;
let credentialsFile: string;

const execute = promisify(execFile);
const apiRoot = fileURLToPath(new URL("../../apps/api/", import.meta.url));

function runSeed(args: string[]) {
  return execute(
    "pnpm",
    ["exec", "tsx", "../../scripts/seed-sit-users.mjs", ...args],
    {
      cwd: apiRoot,
      env: { ...process.env },
      timeout: 60_000,
    },
  );
}

async function submissions() {
  return db
    .select()
    .from(schema.submissionTable)
    .orderBy(asc(schema.submissionTable.number));
}

describe("local SIT seed uses real intake and preserves walkthrough progress", () => {
  beforeAll(async () => {
    await resetTestDatabase();
    credentialsDirectory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-seed-credentials-"),
    );
    credentialsFile = path.join(credentialsDirectory, "accounts.json");
  });
  afterAll(async () => {
    await resetTestDatabase();
    await rm(credentialsDirectory, { recursive: true, force: true });
  });

  it("requires explicit SIT opt-in before writing accounts or submissions", async () => {
    await expect(runSeed([])).rejects.toThrow();
    expect(await submissions()).toEqual([]);
    const users = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable);
    expect(users).toEqual([]);
  });

  it("seeds two published forms and real submissions, then preserves their identity and state", async () => {
    await runSeed(["--sit", "--credentials-file", credentialsFile]);
    expect((await stat(credentialsFile)).mode & 0o077).toBe(0);
    const firstCredentials = await readFile(credentialsFile, "utf8");
    expect(JSON.parse(firstCredentials).accounts).toHaveLength(4);
    const first = await submissions();
    expect(first).toHaveLength(2);
    const firstSubmission = first[0];
    if (!firstSubmission) throw new Error("SIT submission was not seeded");
    expect(first.map((row) => row.customerVisibility).sort()).toEqual([
      "organisation",
      "private",
    ]);
    expect(
      first.every((row) => row.state === "new" && row.submittedAt !== null),
    ).toBe(true);
    const types = await db.select().from(schema.requestTypeTable);
    expect(types).toHaveLength(2);
    expect(types.every((row) => row.published && row.customerVisible)).toBe(
      true,
    );
    const versions = await db
      .select({ id: schema.requestTypeVersionTable.id })
      .from(schema.requestTypeVersionTable);
    expect(
      first.every((row) =>
        versions.some((version) => version.id === row.requestTypeVersionId),
      ),
    ).toBe(true);

    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying" })
      .where(eq(schema.submissionTable.id, firstSubmission.id));
    await runSeed(["--sit", "--credentials-file", credentialsFile]);
    expect(await readFile(credentialsFile, "utf8")).toBe(firstCredentials);
    const second = await submissions();
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second[0]?.state).toBe("clarifying");
    expect(await db.select().from(schema.requestTypeVersionTable)).toHaveLength(
      2,
    );
    const users = await db
      .select({ email: schema.userTable.email })
      .from(schema.userTable);
    expect(users.map((user) => user.email).sort()).toEqual([
      "admin@taskdesk.local",
      "agent@taskdesk.local",
      "customer@acme.example",
      "lead@taskdesk.local",
    ]);
  });
});
