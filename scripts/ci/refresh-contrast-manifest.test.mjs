import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contrastManifestChangeSummary,
  refreshContrastManifest,
} from "./refresh-contrast-manifest.mjs";

const baseOccurrence = {
  backdropLayers: [],
  category: "body",
  chain: ["fixture.tsx:Example", "jsx:p[0]>bg-background"],
  id: "fixture.tsx::Example::p[0]::text-foreground#0",
  surfaceContext: "same-element",
  usage: "fixture.tsx",
};

function observedFixture(occurrences = [baseOccurrence]) {
  const key = "--color-foreground|--color-background|bg-background|light";
  const observed = new Set([key]);
  observed.occurrences = new Map([[key, occurrences]]);
  observed.pairDetails = new Map([
    [
      key,
      {
        foregroundClass: "text-foreground",
        backgroundClass: "bg-background",
        usage: "fixture.tsx",
      },
    ],
  ]);
  return observed;
}

function existingFixture() {
  const occurrence = { ...baseOccurrence };
  return [
    {
      fg: "--color-foreground",
      bg: "--color-background",
      category: "body",
      minRatio: 4.5,
      themes: ["light"],
      usage: "fixture.tsx",
      backdrop: "--color-background",
      foregroundClass: "text-foreground",
      backgroundClass: { light: "bg-background" },
      surfaceContext: "same-element",
      occurrenceIds: [occurrence.id],
      occurrences: [occurrence],
    },
  ];
}

describe("source-grounded contrast manifest refresh", () => {
  it("reconciles new source occurrences and emits deterministic provenance", () => {
    const added = {
      ...baseOccurrence,
      id: "fixture.tsx::Example::span[0]::text-foreground#1",
      chain: ["fixture.tsx:Example", "jsx:span[0]>bg-background"],
    };
    const first = refreshContrastManifest(
      existingFixture(),
      observedFixture([baseOccurrence, added]),
    );
    const second = refreshContrastManifest(
      existingFixture(),
      observedFixture([added, baseOccurrence]),
    );
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.deepEqual(first[0].occurrenceIds, [baseOccurrence.id, added.id]);
    assert.equal(first[0].minRatio, 4.5);
    assert.deepEqual(first[0].themes, ["light"]);
    assert.equal(first[0].foregroundClass, "text-foreground");
    assert.deepEqual(first[0].occurrences[1].chain, added.chain);
  });

  it("adds observed pairs while preserving their category-derived threshold", () => {
    const key = "--color-primary-foreground|--color-primary|bg-primary|dark";
    const occurrence = {
      ...baseOccurrence,
      category: "non-text",
      id: "fixture.tsx::Example::icon[0]::text-primary-foreground#0",
      chain: ["fixture.tsx:Example", "jsx:icon[0]>bg-primary"],
    };
    const observed = observedFixture();
    observed.add(key);
    observed.occurrences.set(key, [occurrence]);
    observed.pairDetails.set(key, {
      foregroundClass: "text-primary-foreground",
      backgroundClass: "bg-primary",
    });

    const refreshed = refreshContrastManifest(existingFixture(), observed);
    const added = refreshed.find(
      (pair) => pair.fg === "--color-primary-foreground",
    );
    assert.equal(added.category, "non-text");
    assert.equal(added.minRatio, 3);
    assert.deepEqual(added.themes, ["dark"]);
  });

  it("refuses to silently remove a manifest key with no live source use", () => {
    const observed = new Set();
    observed.occurrences = new Map();
    assert.throws(
      () => refreshContrastManifest(existingFixture(), observed),
      /Unacknowledged stale keys:[\s\S]*--color-foreground\|--color-background/,
    );
  });

  it("removes stale keys only when the exact keys are acknowledged", () => {
    const observed = new Set();
    observed.occurrences = new Map();
    const oldKey = "--color-foreground|--color-background|bg-background|light";
    assert.deepEqual(
      refreshContrastManifest(existingFixture(), observed, {
        acknowledgedRemovals: [oldKey],
      }),
      [],
    );
    assert.throws(
      () =>
        refreshContrastManifest(existingFixture(), observed, {
          acknowledgedRemovals: [`${oldKey}|unexpected`],
        }),
      /Unacknowledged stale keys:[\s\S]*Acknowledged keys that are not stale/,
    );
  });

  it("reports added and removed pair keys in a stable reviewable summary", () => {
    const previous = existingFixture();
    const next = refreshContrastManifest(previous, observedFixture());
    const changed = refreshContrastManifest([], observedFixture());
    assert.deepEqual(contrastManifestChangeSummary(previous, next), {
      added: [],
      removed: [],
      retained: ["--color-foreground|--color-background|bg-background|light"],
    });
    assert.deepEqual(contrastManifestChangeSummary([], changed), {
      added: ["--color-foreground|--color-background|bg-background|light"],
      removed: [],
      retained: [],
    });
  });

  it("fails when observed paint lacks source occurrence provenance", () => {
    const observed = new Set([
      "--color-foreground|--color-background|bg-background|light",
    ]);
    observed.occurrences = new Map();
    assert.throws(
      () => refreshContrastManifest([], observed),
      /no source occurrence records; refusing to invent provenance/,
    );
  });

  it("fails when occurrence backdrop records disagree with the observed pair", () => {
    const occurrence = { ...baseOccurrence, backdropLayers: ["bg-card"] };
    assert.throws(
      () => refreshContrastManifest([], observedFixture([occurrence])),
      /backdrop records that disagree with its key/,
    );
  });
});
