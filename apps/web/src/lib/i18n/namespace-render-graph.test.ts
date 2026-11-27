import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUngatedDeferredReads,
  importSpecifiers,
} from "../../../vite/namespace-render-graph";
import {
  SPLIT_OUT_NAMESPACES,
  WORK_ROUTE_GATED_SURFACES,
  WORK_ROUTE_RENDER_ROOTS,
} from "./work-route-namespaces";

const srcDir = path.resolve(__dirname, "../..");
const known = Object.keys(
  JSON.parse(
    readFileSync(path.resolve(srcDir, "../../../i18n/en-US.json"), "utf8"),
  ),
);
const file = (relative: string) => path.join(srcDir, relative);

function scan(overrides: Record<string, (source: string) => string> = {}) {
  const byFile = new Map(
    Object.entries(overrides).map(([relative, edit]) => [file(relative), edit]),
  );
  return findUngatedDeferredReads({
    srcDir,
    roots: WORK_ROUTE_RENDER_ROOTS,
    gated: WORK_ROUTE_GATED_SURFACES,
    known,
    only: SPLIT_OUT_NAMESPACES,
    read: (target) => {
      const source = readFileSync(target, "utf8");
      return byFile.get(target)?.(source) ?? source;
    },
  }).map((violation) => path.relative(srcDir, violation.file));
}

const inject = (source: string) =>
  `${source}\nexport const injected = () => t("tasksExtra:injected.key");\n`;
const stripBoundary = (source: string) =>
  source.replaceAll(/<(Work(?:Item)?)?NamespaceBoundary\b/g, "<Fragment");

/** Each optional surface, the module that mounts it, and the module holding its reads. */
const SURFACES = [
  {
    name: "work-item context menu",
    importer: "components/work-item/work-item-context-menu.tsx",
    surface: "components/work-item/work-item-context-menu-content.tsx",
  },
  {
    name: "side pane (header actions and detail)",
    importer: "components/work-item/work-item-side-pane.tsx",
    surface: "components/work-item/work-item-side-pane-body.tsx",
  },
  {
    name: "deletion approval",
    importer: "components/pending-action/pending-action-approval-dialog.tsx",
    surface: "components/pending-action/pending-action-approval.tsx",
  },
  {
    name: "create work item form",
    importer: "components/work-item/create-work-item-dialog.tsx",
    surface: "components/work-item/create-work-item-dialog-form.tsx",
  },
] as const;

describe("work route render graph guard", () => {
  it("finds no split-out namespace read outside a boundary", () => {
    expect(scan()).toEqual([]);
  });

  it.each(SURFACES)(
    "$name: a deferred read inside the gated surface is allowed behind the boundary",
    ({ surface }) => {
      expect(scan({ [surface]: inject })).toEqual([]);
    },
  );

  it.each(SURFACES)(
    "$name: fails when the importer stops rendering the boundary",
    ({ importer, surface }) => {
      const violations = scan({ [importer]: stripBoundary });
      expect(violations.length).toBeGreaterThan(0);
      const injected = scan({
        [importer]: stripBoundary,
        [surface]: inject,
      });
      expect(injected).toContain(surface);
    },
  );

  it("follows dynamic imports and stops only at the boundary component", () => {
    // The form and its label picker are only reached through `lazy(() => import(...))`.
    expect(
      scan({
        "components/work-item/create-work-item-dialog.tsx": stripBoundary,
      }),
    ).toContain("components/work-item/create-work-item-properties.tsx");
  });

  it("fails for a deferred read in the work route itself", () => {
    expect(
      scan({
        "routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx":
          inject,
      }),
    ).toContain(
      "routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx",
    );
  });

  it("does not follow type-only imports or void preloads", () => {
    const source = [
      'import type { A } from "./a";',
      'import { b } from "./b";',
      'void import("./c").then(() => undefined);',
      'const D = lazy(() => import("./d"));',
    ].join("\n");
    expect(importSpecifiers(source)).toEqual(["./b", "./d"]);
  });
});
