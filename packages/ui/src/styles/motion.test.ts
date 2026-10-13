import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "motion.css"), "utf8");
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
  });
});
