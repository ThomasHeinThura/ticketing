/**
 * The `EVENT_KEYS` registry (`apps/api/src/events/event-keys.ts`) is
 * `docs/01-architecture/events.md`'s Catalogue, transcribed. AGENTS.md do-not 11 makes
 * the doc the single authority and, like `tests/permissions/rbac-doc.ts` does for
 * capabilities, this test makes "add it there first, in the same change" a build
 * failure rather than a sentence.
 *
 * Both directions are asserted: a key added to the registry without the doc fails, and
 * a key deleted from the doc but left in the registry fails too — the second is the
 * one a one-way check would miss, and it is the shape a rename half-finished at 2am
 * actually produces.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_KEYS } from "../../../apps/api/src/events/event-keys";

const EVENTS_MD_PATH = fileURLToPath(
  new URL("../../../docs/01-architecture/events.md", import.meta.url),
);

/**
 * The Catalogue's Key column — every `| \`key.name\`` row between "## Catalogue" and
 * the next level-2 heading. Section headings inside the catalogue are level 3
 * ("### Work items"), so they do not terminate it.
 */
function catalogueKeys(): string[] {
  const doc = readFileSync(EVENTS_MD_PATH, "utf8");
  const start = doc.indexOf("## Catalogue");
  if (start === -1) {
    throw new Error("events.md no longer contains: ## Catalogue");
  }
  const keys: string[] = [];
  for (const line of doc.slice(start).split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const match = /^\| `([a-z_]+\.[a-z_]+)`/.exec(line);
    if (match?.[1] !== undefined) {
      keys.push(match[1]);
    }
  }
  return keys;
}

describe("EVENT_KEYS", () => {
  it("matches events.md's Catalogue exactly, in both directions", () => {
    const documented = catalogueKeys();
    expect(documented.length).toBeGreaterThan(30);

    const documentedSet = new Set(documented);
    expect(documentedSet.size).toBe(documented.length);

    const inDocNotRegistry = documented.filter((key) => !EVENT_KEYS.has(key));
    const inRegistryNotDoc = [...EVENT_KEYS].filter(
      (key) => !documentedSet.has(key),
    );
    expect(inDocNotRegistry).toEqual([]);
    expect(inRegistryNotDoc).toEqual([]);
  });

  it("holds only dotted, lowercase keys", () => {
    for (const key of EVENT_KEYS) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
