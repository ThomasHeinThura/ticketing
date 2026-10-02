import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composite,
  contrastRatio,
  observedPairsInSources,
  validatePairManifest,
} from "./check-contrast.mjs";

describe("G3 contrast inventory and math", () => {
  it("fails closed when a source introduces an unlisted foreground/background pair", () => {
    const usage = "text-foreground bg-background";
    const manifest = [
      {
        fg: "--color-foreground",
        bg: "--color-background",
        category: "body",
        minRatio: 4.5,
        themes: ["light", "dark"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-foreground",
        backgroundClass: { light: "bg-background", dark: "bg-background" },
      },
    ];
    const observed = observedPairsInSources(
      [
        'const classes = "text-foreground bg-background"; const added = "text-primary-foreground bg-primary";',
      ],
      new Set(["foreground", "primary-foreground", "background", "primary"]),
    );
    const failures = validatePairManifest(manifest, () => usage, observed);
    assert.ok(
      failures.some((failure) =>
        failure.includes("--color-primary-foreground|--color-primary"),
      ),
    );
  });

  it("fails when a manifest row no longer has an observed source use", () => {
    const usage = 'const classes = "text-foreground bg-background";';
    const manifest = [
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
      },
    ];
    const failures = validatePairManifest(manifest, () => usage, new Set());
    assert.ok(
      failures.some((failure) =>
        failure.includes("has no observed source use"),
      ),
    );
  });

  it("composites translucent surfaces before measuring WCAG contrast", () => {
    const tintedWhite = composite([255, 0, 0, 0.08], [255, 255, 255]);
    assert.deepEqual(tintedWhite, [255, 235, 235]);
    assert.ok(contrastRatio([120, 0, 0], tintedWhite) >= 4.5);
    assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]), 1);
  });
});
