import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The drizzle pg migrator applies a journal entry only when its `when` is greater than the newest
 * `created_at` already recorded in `drizzle.__drizzle_migrations`. A migration journaled with a
 * smaller `when` than one already applied is skipped without an error. Migration numbers are
 * therefore not reserved ahead of merge: the slice that merges first takes the next free number,
 * and later slices rebase, renumber and re-chain their snapshot. This guard fails a branch whose
 * entry is out of order, leaves a numbering gap (a reserved slot that a later merge could fill
 * with a smaller `when`) or breaks the snapshot chain, instead of letting a deploy skip it.
 *
 * Entries up to and including `BASELINE_TAG` predate the guard and are not checked; there are
 * historical out-of-order `when` values and snapshot chain breaks before it. The guard sees file
 * order and the snapshot chain only, not which migrations a deployed database already applied.
 */
const DRIZZLE_DIR = resolve(import.meta.dirname, "../../../apps/api/drizzle");
const BASELINE_TAG = "0158_step_up_workspace_operations";
/** Entries after this one must ship a meta snapshot, so the chain check cannot skip them. */
const SNAPSHOT_REQUIRED_AFTER = "0209_feature_flag_upgrade_seeded_rows";

type JournalEntry = { idx: number; when: number; tag: string };

const entries = (
  JSON.parse(
    readFileSync(resolve(DRIZZLE_DIR, "meta/_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] }
).entries;
// The baseline tag is journaled twice (positions 147 and 158); the guard starts after the last.
const baseline = entries.map((entry) => entry.tag).lastIndexOf(BASELINE_TAG);
const guarded = entries.slice(baseline + 1);

function snapshotOf(entry: JournalEntry) {
  const path = resolve(
    DRIZZLE_DIR,
    `meta/${entry.tag.slice(0, 4)}_snapshot.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as {
    id: string;
    prevId: string;
  };
}

describe("drizzle migration journal order", () => {
  it("has the baseline entry and guarded entries after it", () => {
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(guarded.length).toBeGreaterThan(0);
  });

  it("gives every guarded entry a `when` above every earlier entry", () => {
    const late: string[] = [];
    let newest = Math.max(...entries.slice(0, baseline + 1).map((e) => e.when));
    for (const entry of guarded) {
      if (entry.when <= newest) late.push(entry.tag);
      newest = Math.max(newest, entry.when);
    }
    expect(late).toEqual([]);
  });

  it("numbers guarded entries consecutively with no gaps, matching their tag and SQL file", () => {
    const wrong: string[] = [];
    let previous = entries[baseline]?.idx ?? -1;
    for (const entry of guarded) {
      if (entry.idx !== previous + 1)
        wrong.push(
          `${entry.tag}: idx ${entry.idx} does not follow ${previous}`,
        );
      if (Number(entry.tag.slice(0, 4)) !== entry.idx)
        wrong.push(`${entry.tag}: tag number differs from idx ${entry.idx}`);
      if (!existsSync(resolve(DRIZZLE_DIR, `${entry.tag}.sql`)))
        wrong.push(`${entry.tag}: missing SQL file`);
      previous = entry.idx;
    }
    expect(wrong).toEqual([]);
  });

  it("gives every entry after the snapshot cut-off a meta snapshot", () => {
    const cutoff = entries
      .map((entry) => entry.tag)
      .lastIndexOf(SNAPSHOT_REQUIRED_AFTER);
    expect(cutoff).toBeGreaterThanOrEqual(0);
    const missing = entries
      .slice(cutoff + 1)
      .filter((entry) => snapshotOf(entry) === null)
      .map((entry) => entry.tag);
    expect(missing).toEqual([]);
  });

  it("chains each guarded snapshot to the latest earlier snapshot", () => {
    let latest: { id: string } | null = null;
    for (const entry of entries.slice(0, baseline + 1))
      latest = snapshotOf(entry) ?? latest;
    const broken: string[] = [];
    for (const entry of guarded) {
      const snapshot = snapshotOf(entry);
      if (!snapshot) continue;
      if (latest && snapshot.prevId !== latest.id) broken.push(entry.tag);
      latest = snapshot;
    }
    expect(broken).toEqual([]);
  });
});
