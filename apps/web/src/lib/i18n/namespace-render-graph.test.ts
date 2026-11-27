import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeRegExp,
  findBoundaryElements,
  findUngatedDeferredReads,
  importSpecifiers,
  isContainedInBoundary,
} from "../../../vite/namespace-render-graph";
import {
  BOUNDARY_ONLY_NAMESPACES,
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
    only: BOUNDARY_ONLY_NAMESPACES,
    read: (target) => {
      const source = readFileSync(target, "utf8");
      return byFile.get(target)?.(source) ?? source;
    },
  }).map((violation) => path.relative(srcDir, violation.file));
}

const inject = (source: string) =>
  `${source}\nexport const injected = () => t("tasksExtra:injected.key");\n`;
/** The first boundary loses its children: they move outside it and an empty boundary stays beside. */
const moveOutsideBoundary = (source: string) => {
  const [boundary] = findBoundaryElements(source);
  if (!boundary) throw new Error("no boundary to move out of");
  return (
    source.slice(0, boundary.openStart) +
    source.slice(boundary.openEnd, boundary.closeStart) +
    "<NamespaceBoundary></NamespaceBoundary>" +
    source.slice(boundary.closeEnd)
  );
};
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
  {
    name: "legacy task sheet",
    importer: "components/task/task-details-sheet.tsx",
    surface: "components/task/task-details-sheet-body.tsx",
  },
  {
    name: "notification menu",
    importer: "components/notification/notification-dropdown.tsx",
    surface: "components/notification/notification-menu.tsx",
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

  it.each(SURFACES)(
    "$name: fails when the surface is moved outside its boundary and an empty one sits beside it",
    ({ importer, surface }) => {
      const violations = scan({ [importer]: moveOutsideBoundary });
      expect(violations.length).toBeGreaterThan(0);
      expect(
        scan({ [importer]: moveOutsideBoundary, [surface]: inject }),
      ).toContain(surface);
    },
  );

  it("only counts a boundary that contains the component, not a fallback or a sibling", () => {
    const gate = (body: string) => `import Surface from "./surface";\n${body}`;
    expect(
      isContainedInBoundary(
        gate("<NamespaceBoundary><Surface /></NamespaceBoundary>"),
        "./surface",
      ),
    ).toBe(true);
    expect(
      isContainedInBoundary(
        gate("<NamespaceBoundary fallback={<Surface />}>x</NamespaceBoundary>"),
        "./surface",
      ),
    ).toBe(false);
    expect(
      isContainedInBoundary(
        gate("<Surface /><NamespaceBoundary></NamespaceBoundary>"),
        "./surface",
      ),
    ).toBe(false);
    expect(
      isContainedInBoundary(
        gate("<NamespaceBoundary />\n<Surface />"),
        "./surface",
      ),
    ).toBe(false);
    expect(isContainedInBoundary("export const a = 1;", "./surface")).toBe(
      false,
    );
  });

  it("recognises a loader shared by lazy() and the boundary's preload", () => {
    const shared = (body: string) =>
      `const load = () => import("./surface");\nconst Surface = lazy(load);\n${body}`;
    expect(
      isContainedInBoundary(
        shared(
          "<NamespaceBoundary preload={load}><Surface /></NamespaceBoundary>",
        ),
        "./surface",
      ),
    ).toBe(true);
    expect(
      isContainedInBoundary(
        shared(
          "<Surface /><NamespaceBoundary preload={load}></NamespaceBoundary>",
        ),
        "./surface",
      ),
    ).toBe(false);
  });

  it("recognises a declared loader that answers synchronously once loaded", () => {
    const declared = (body: string) =>
      `let done;\nfunction load() {\n  if (done) return done;\n  return import("./surface");\n}\nconst Surface = lazy(load);\n${body}`;
    expect(
      isContainedInBoundary(
        declared(
          "<NamespaceBoundary preload={load}><Surface /></NamespaceBoundary>",
        ),
        "./surface",
      ),
    ).toBe(true);
    expect(isContainedInBoundary(declared("<Surface />"), "./surface")).toBe(
      false,
    );
  });

  it("matches source text literally: every RegExp metacharacter is escaped", () => {
    const text = "load$1.x(a|b)[c]{2}+*?^\\";
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    // `.` is not "any character" and `$` is not an anchor once escaped.
    expect(new RegExp(escapeRegExp("load$1.x")).test("load$1Zx")).toBe(false);
    const shared = (loader: string, body: string) =>
      `const ${loader} = () => import("./surface");\nconst Surface = lazy(${loader});\n${body}`;
    const inside =
      "<NamespaceBoundary preload={load$1}><Surface /></NamespaceBoundary>";
    expect(isContainedInBoundary(shared("load$1", inside), "./surface")).toBe(
      true,
    );
    // A loader whose name is only a regex-lookalike of another one is not the same binding.
    expect(
      isContainedInBoundary(
        `const load$1 = () => import("./surface");\nconst Surface = lazy(loadX1);\n${inside}`,
        "./surface",
      ),
    ).toBe(false);
  });

  it("follows dynamic imports and stops only at the boundary component", () => {
    // The form and its label picker are only reached through `lazy(() => import(...))`.
    expect(
      scan({
        "components/work-item/create-work-item-dialog.tsx": stripBoundary,
      }),
    ).toContain("components/work-item/create-work-item-properties.tsx");
  });

  it("fails when the shell's notification dropdown reads its namespace outside a boundary", () => {
    const notificationsRead = (source: string) =>
      `${source}\nexport const injected = () => t("notifications:title");\n`;
    expect(
      scan({
        "components/notification/notification-dropdown.tsx": notificationsRead,
      }),
    ).toContain("components/notification/notification-dropdown.tsx");
    // The clear dialog is gated too: stripping its boundary exposes its reads.
    expect(
      scan({
        "components/notification/notification-dropdown.tsx": stripBoundary,
      }),
    ).toEqual(
      expect.arrayContaining([
        "components/notification/notification-menu.tsx",
        "components/notification/notification-clear-dialog.tsx",
      ]),
    );
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
