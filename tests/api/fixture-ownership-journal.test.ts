import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixtureOwnershipJournal } from "../e2e/helpers/mfa-csrf-app-fixture";

it("persists fixture intent and container IDs in a private journal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fixture-journal-test-"));
  try {
    const path = join(directory, "ownership.jsonl");
    const journal = fixtureOwnershipJournal(path);
    await journal.onContainerIntent("test-label");
    await journal.onContainerCreated("test-container-id");
    expect(
      (await readFile(path, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([{ label: "test-label" }, { id: "test-container-id" }]);
    expect((await stat(path)).mode & 0o077).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
