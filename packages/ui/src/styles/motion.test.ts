import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "motion.css"), "utf8");
const theme = readFileSync(resolve(here, "theme.css"), "utf8");
const componentsDir = resolve(here, "../components");

/** Body of the `@media (prefers-reduced-motion: reduce)` block (brace matched). */
function reducedMotionBlock(source: string): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced reduced-motion block");
}

function declarationsFor(block: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`).exec(
    block,
  );
  if (!match) throw new Error(`no reduced-motion rule for ${selector}`);
  return match[1];
}

const block = reducedMotionBlock(css);

/** The value of a custom property declared in the theme's `@theme inline` block. */
function themeToken(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(theme);
  if (!match) throw new Error(`theme.css does not declare ${name}`);
  return match[1].trim();
}

/** Body of `@utility press-feedback { ... }` (brace matched). */
function pressUtility(source: string): string {
  const start = source.indexOf("@utility press-feedback");
  expect(start).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced press-feedback utility");
}

/** Every double-quoted string literal in a component source that names press-feedback. */
function pressClassStrings(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*\bpress-feedback\b[^"\n]*)"/g)].map(
    (m) => m[1],
  );
}

function componentSource(file: string): string {
  return readFileSync(join(componentsDir, file), "utf8");
}

describe("motion tokens (D-H)", () => {
  it("declares the three durations next to the easings", () => {
    expect(themeToken("--duration-fast")).toBe("120ms");
    expect(themeToken("--duration-base")).toBe("200ms");
    expect(themeToken("--duration-slow")).toBe("300ms");
    expect(themeToken("--ease-out")).toMatch(/^cubic-bezier\(/);
    expect(themeToken("--ease-in-out")).toMatch(/^cubic-bezier\(/);
  });

  it("exposes the durations to Tailwind as duration-fast|base|slow", () => {
    for (const name of ["fast", "base", "slow"]) {
      expect(themeToken(`--transition-duration-${name}`)).toBe(
        `var(--duration-${name})`,
      );
    }
  });

  it("declares --ease-spring as a linear() spring with about 1.5% overshoot", () => {
    const value = themeToken("--ease-spring");
    const body = /^linear\((.*)\)$/.exec(value)?.[1];
    expect(body).toBeDefined();
    const points = (body ?? "").split(",").map((p) => Number(p.trim()));
    expect(points.every((p) => Number.isFinite(p))).toBe(true);
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(1);
    const peak = Math.max(...points);
    expect(peak).toBeGreaterThanOrEqual(1.01);
    expect(peak).toBeLessThanOrEqual(1.02);
  });
});

describe("press feedback utility (D-H rule 1)", () => {
  const utility = pressUtility(css);

  it("releases with --duration-fast and --ease-out", () => {
    expect(utility).toMatch(/--tw-duration:\s*var\(--duration-fast\)/);
    expect(utility).toMatch(/--tw-ease:\s*var\(--ease-out\)/);
  });

  it("applies the pressed style within one frame (0-60 ms) on the way down", () => {
    const down = /&:active,\s*&\[data-pressed\]\s*\{([^}]*)\}/.exec(utility);
    expect(down).not.toBeNull();
    const duration = /--tw-duration:\s*(\d+)ms/.exec(down?.[1] ?? "");
    expect(duration).not.toBeNull();
    expect(Number(duration?.[1])).toBeLessThanOrEqual(60);
    expect(down?.[1]).toMatch(/scale:\s*var\(--press-scale,\s*0\.97\)/);
  });

  it("neutralizes pressed scale while disabled or actively dragging", () => {
    const guard =
      /&:is\(:disabled,\s*\[data-disabled\],\s*\[data-dragging\],\s*\[data-task-dragging="true"\]\)\s*\{([^}]*)\}/.exec(
        utility,
      );
    expect(guard).not.toBeNull();
    expect(guard?.[1]).toMatch(/scale:\s*none/);
  });

  it("is used by Button, tabs, the sidebar menu buttons and interactive Card/TableRow", () => {
    for (const file of [
      "button.tsx",
      "tabs.tsx",
      "sidebar.tsx",
      "card.tsx",
      "table.tsx",
    ]) {
      expect(pressClassStrings(componentSource(file)).length).toBeGreaterThan(
        0,
      );
    }
  });

  it("never sets its own duration or easing next to press-feedback", () => {
    // `duration-*` / `ease-*` write a literal transition-duration that beats the variables
    // press-feedback sets, so the instant press-down would silently stop working.
    for (const file of [
      "button.tsx",
      "tabs.tsx",
      "sidebar.tsx",
      "card.tsx",
      "table.tsx",
    ]) {
      for (const classes of pressClassStrings(componentSource(file))) {
        expect(classes).not.toMatch(/(?:^|\s)(?:duration|ease)-/);
        expect(classes).not.toMatch(/(?:^|[\s:])active:scale-/);
      }
    }
  });
});

describe("reduced-motion block (#676)", () => {
  it("drops positional transitions on every *-positioner slot", () => {
    const decl = declarationsFor(block, '[data-slot$="-positioner"]');
    expect(decl).toMatch(/transition-property:\s*none\s*!important/);
  });

  it("drops the Button press scale but keeps non-movement feedback", () => {
    const decl = declarationsFor(block, '[data-slot="button"]');
    expect(decl).toMatch(/scale:\s*none\s*!important/);
    expect(decl).toMatch(/transition-property:\s*box-shadow\s*!important/);
    expect(decl).not.toMatch(/opacity\s*:\s*(0|none)/);
  });

  it("drops the pressed scale of every press-feedback consumer", () => {
    expect(declarationsFor(block, ".press-feedback")).toMatch(
      /scale:\s*none\s*!important/,
    );
  });

  it("snaps the tab indicator to the selected tab without sliding or morphing width", () => {
    const indicator = declarationsFor(block, '[data-slot="tab-indicator"]');
    expect(indicator).toMatch(/transition:\s*none\s*!important/);
    // Base UI positions the active indicator via translate; keep its resting placement intact.
    expect(indicator).not.toMatch(/translate:\s*none/);
  });

  it("stops the switch thumb and keeps only the fade on the helper text", () => {
    const thumb = declarationsFor(block, '[data-slot="switch-thumb"]');
    expect(thumb).toMatch(/transition:\s*none\s*!important/);
    expect(thumb).toMatch(/scale:\s*none\s*!important/);
    const helper = declarationsFor(block, '[data-slot="switch-helper-line"]');
    expect(helper).toMatch(/translate:\s*none\s*!important/);
    expect(helper).toMatch(
      /transition-property:\s*opacity,\s*visibility\s*!important/,
    );
  });

  it("stops the skeleton shimmer", () => {
    // One grouped rule: the Skeleton slot and the bare animation class share it.
    expect(block).toMatch(
      /\[data-slot="skeleton"\],\s*\.animate-skeleton\s*\{/,
    );
    const decl = declarationsFor(block, ".animate-skeleton");
    expect(decl).toMatch(/animation:\s*none\s*!important/);
    expect(decl).toMatch(/--skeleton-highlight:\s*transparent\s*!important/);
  });

  it("still keeps opacity feedback on popup slots", () => {
    expect(block).toMatch(/transition-property:\s*opacity\s*!important/);
  });

  it("targets slot names the components really render", () => {
    const sources = readdirSync(componentsDir)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .map((f) => readFileSync(join(componentsDir, f), "utf8"));
    const positioners = new Set(
      sources.flatMap((src) =>
        [...src.matchAll(/data-slot="([a-z-]+-positioner)"/g)].map((m) => m[1]),
      ),
    );
    // The movement transition lives on these shared primitives today.
    for (const slot of ["popover-positioner", "tooltip-positioner"]) {
      expect(positioners.has(slot)).toBe(true);
    }
    expect(sources.some((src) => src.includes('"data-slot": "button"'))).toBe(
      true,
    );
    for (const slot of [
      "tab-indicator",
      "switch-thumb",
      "switch-helper-line",
      "skeleton",
    ]) {
      expect(
        sources.some(
          (src) =>
            src.includes(`data-slot="${slot}"`) ||
            src.includes(`"data-slot": "${slot}"`),
        ),
      ).toBe(true);
    }
  });
});
