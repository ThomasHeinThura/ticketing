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

  it("inventories foreground and background classes split across cn arguments", () => {
    const source = 'const classes = cn("text-white", "bg-white");';
    const observed = observedPairsInSources([source], new Set(["white"]));
    assert.ok(observed.has("--color-white|--color-white|bg-white|light"));
    assert.ok(observed.has("--color-white|--color-white|bg-white|dark"));
  });

  it("does not invent color pairs across mutually exclusive cn branches", () => {
    const observed = observedPairsInSources(
      [
        'const classes = cn(variant === "a" && "text-foreground bg-background", variant === "b" && "text-primary-foreground bg-primary");',
      ],
      new Set(["foreground", "primary-foreground", "background", "primary"]),
    );
    assert.ok(
      observed.has("--color-foreground|--color-background|bg-background|light"),
    );
    assert.ok(
      observed.has(
        "--color-primary-foreground|--color-primary|bg-primary|light",
      ),
    );
    assert.equal(
      observed.has("--color-foreground|--color-primary|bg-primary|light"),
      false,
    );
  });

  it("pairs a conditional cn class with its unconditional class arguments", () => {
    const observed = observedPairsInSources(
      ['const classes = cn(condition && "text-white", "bg-white");'],
      new Set(["white"]),
    );
    assert.ok(observed.has("--color-white|--color-white|bg-white|light"));
  });

  it("inventories nested arbitrary state variants as real surface classes", () => {
    const activeSurface = "[:active,[data-pressed]]:bg-secondary/80";
    const usage = `const classes = "text-secondary-foreground ${activeSurface}";`;
    const manifest = [
      {
        fg: "--color-secondary-foreground",
        bg: "--color-secondary",
        category: "body",
        minRatio: 4.5,
        themes: ["light", "dark"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-secondary-foreground",
        backgroundClass: { light: activeSurface, dark: activeSurface },
      },
    ];
    const observed = observedPairsInSources(
      [usage],
      new Set(["secondary", "secondary-foreground"]),
    );
    assert.ok(
      observed.has(
        `--color-secondary-foreground|--color-secondary|${activeSurface}|light`,
      ),
    );
    assert.ok(
      observed.has(
        `--color-secondary-foreground|--color-secondary|${activeSurface}|dark`,
      ),
    );
    assert.deepEqual(
      validatePairManifest(manifest, () => usage, observed),
      [],
    );
  });

  it("retains dark theme modifiers on measured surface classes", () => {
    const darkSurface = "dark:has-autofill:bg-foreground/8";
    const usage = `const classes = "text-foreground has-autofill:bg-foreground/4 ${darkSurface}";`;
    const manifest = [
      {
        fg: "--color-foreground",
        bg: "--color-foreground",
        category: "body",
        minRatio: 4.5,
        themes: ["light", "dark"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-foreground",
        backgroundClass: {
          light: "has-autofill:bg-foreground/4",
          dark: darkSurface,
        },
      },
    ];
    const observed = observedPairsInSources([usage], new Set(["foreground"]));
    assert.ok(
      observed.has(`--color-foreground|--color-foreground|${darkSurface}|dark`),
    );
    assert.deepEqual(
      validatePairManifest(manifest, () => usage, observed),
      [],
    );
  });

  it("does not inventory dark-only foregrounds in light theme", () => {
    const observed = observedPairsInSources(
      ['const classes = "text-foreground bg-background dark:text-white";'],
      new Set(["foreground", "white", "background"]),
    );
    assert.equal(
      observed.has("--color-white|--color-background|bg-background|light"),
      false,
    );
    assert.equal(
      observed.has("--color-foreground|--color-background|bg-background|dark"),
      false,
    );
    assert.ok(
      observed.has("--color-white|--color-background|bg-background|dark"),
    );
  });

  it("composites translucent surfaces before measuring WCAG contrast", () => {
    const tintedWhite = composite([255, 0, 0, 0.08], [255, 255, 255]);
    assert.deepEqual(tintedWhite, [255, 235, 235]);
    assert.ok(contrastRatio([120, 0, 0], tintedWhite) >= 4.5);
    assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]), 1);
  });
});
