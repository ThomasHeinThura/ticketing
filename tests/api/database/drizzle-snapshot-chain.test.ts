import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const metadata = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/api/drizzle/meta",
);

describe("Drizzle snapshot ancestry", () => {
  it("links every tracked snapshot to the immediately preceding snapshot", () => {
    const snapshots = readdirSync(metadata)
      .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
      .sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)))
      .map((name) => ({
        name,
        value: JSON.parse(readFileSync(join(metadata, name), "utf8")) as {
          id: string;
          prevId: string;
        },
      }));
    expect(snapshots.length).toBeGreaterThan(80);
    expect(snapshots[0]?.value.prevId).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(snapshots[index]?.value.prevId, snapshots[index]?.name).toBe(
        snapshots[index - 1]?.value.id,
      );
    }
    expect(new Set(snapshots.map(({ value }) => value.id)).size).toBe(
      snapshots.length,
    );
  });
});
