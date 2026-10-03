import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectContrastSourcePaths,
  composite,
  contrastRatio,
  observedPairsInSources,
  observeInheritedForegroundSurfaces,
  probeSurfaceDescriptor,
  sidebarSurfaceContract,
  storybookBodySurfaceContract,
  validatePairManifest,
} from "./check-contrast.mjs";

describe("G3 contrast inventory and math", () => {
  it("scans styled sources across shared UI and application compositions", async () => {
    const sources = await collectContrastSourcePaths();
    assert.ok(sources.includes("packages/ui/src/components/button.tsx"));
    assert.ok(sources.includes("apps/web/src/components/SettingsSidebar.tsx"));
    const applicationSource = await readFile(
      path.join(process.cwd(), "apps/web/src/components/SettingsSidebar.tsx"),
      "utf8",
    );
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const observed = observedPairsInSources([applicationSource], tokenNames);
    const sidebarPair =
      "--color-sidebar-foreground|--color-sidebar|bg-sidebar|light";
    assert.ok(observed.has(sidebarPair));
    assert.ok(
      validatePairManifest([], () => applicationSource, observed).some(
        (failure) => failure.includes(`${sidebarPair} has no manifest entry`),
      ),
    );
  });

  it("keeps product and Storybook TSX in scope while excluding only test/spec renderers", async () => {
    const suffix = `-${process.pid}`;
    const product = `apps/web/src/components/.contrast-product${suffix}.tsx`;
    const story = `packages/ui/src/components/.contrast-product${suffix}.stories.tsx`;
    const unitTest = `apps/web/src/components/.contrast-product${suffix}.test.tsx`;
    const spec = `packages/ui/src/components/.contrast-product${suffix}.spec.jsx`;
    try {
      await Promise.all(
        [product, story, unitTest, spec].map((file) =>
          writeFile(file, "export function Example(){ return <div />; }"),
        ),
      );
      const sources = await collectContrastSourcePaths();
      assert.ok(sources.includes(product));
      assert.ok(sources.includes(story));
      assert.equal(sources.includes(unitTest), false);
      assert.equal(sources.includes(spec), false);
      assert.ok(
        sources.includes("apps/web/src/components/team/members-table.tsx"),
        "a similarly named shipped component remains in scope",
      );
    } finally {
      await Promise.all(
        [product, story, unitTest, spec].map((file) =>
          rm(file, { force: true }),
        ),
      );
    }
  });

  it("fails closed when a source introduces an unlisted foreground/background pair", () => {
    const usage = '<div className="text-foreground bg-background" />';
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
        '<div className="text-foreground bg-background" />; <div className="text-primary-foreground bg-primary" />; <p className="text-destructive bg-background" />;',
      ],
      new Set([
        "foreground",
        "primary-foreground",
        "destructive",
        "background",
        "primary",
      ]),
    );
    const failures = validatePairManifest(manifest, () => usage, observed);
    assert.ok(
      failures.some((failure) =>
        failure.includes("--color-primary-foreground|--color-primary"),
      ),
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes("--color-destructive|--color-background"),
      ),
    );
  });

  it("measures a colored descendant against its nearest opaque ancestor", async () => {
    const fixture = `scripts/ci/.contrast-inheritance-${process.pid}.tsx`;
    await writeFile(
      fixture,
      '<div className="bg-card"><p className="text-destructive">Card error</p></div><div className="bg-popover"><p className="text-destructive">Popover error</p></div><div className="bg-background"><p className="text-destructive">Body error</p></div>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["destructive", "card", "popover", "background"]),
      );
      assert.ok(
        result.pairs.has("--color-destructive|--color-card|bg-card|light"),
      );
      assert.ok(
        result.pairs.has(
          "--color-destructive|--color-popover|bg-popover|light",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-destructive|--color-background|bg-background|light",
        ),
      );
      assert.equal(
        result.uses.occurrences.get(
          "--color-destructive|--color-card|bg-card|light",
        ).length,
        1,
      );
      assert.equal(
        result.uses.occurrences.get(
          "--color-destructive|--color-popover|bg-popover|light",
        ).length,
        1,
      );
      const occurrenceIds = [
        "--color-destructive|--color-card|bg-card|light",
        "--color-destructive|--color-popover|bg-popover|light",
        "--color-destructive|--color-background|bg-background|light",
      ].map((key) => result.uses.occurrences.get(key)[0].id);
      assert.equal(new Set(occurrenceIds).size, 3);
      assert.equal(result.unresolved.size, 0);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("keeps supported ancestor hover surfaces as a distinct measured context", async () => {
    const fixture = `scripts/ci/.contrast-hover-ancestor-${process.pid}.tsx`;
    await writeFile(
      fixture,
      '<main className="bg-background"><div className="bg-card hover:bg-muted"><p className="text-muted-foreground">Muted</p></div></main>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["card", "muted", "muted-foreground", "background"]),
      );
      assert.ok(
        result.pairs.has("--color-muted-foreground|--color-card|bg-card|light"),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-muted|hover:bg-muted|light|backdrop:bg-background",
        ),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("follows inline lazy imports when binding shipped caller surfaces", async () => {
    const suffix = `-${process.pid}`;
    const route = `apps/web/src/.contrast-lazy-route${suffix}.tsx`;
    const component = `apps/web/src/.contrast-lazy-component${suffix}.tsx`;
    try {
      await Promise.all([
        writeFile(
          route,
          `import { lazy, Suspense } from "react";\nconst Deferred = lazy(\n  () => import("@/.contrast-lazy-component${suffix}"),\n);\nexport function Route(){ return <main className="bg-background"><Suspense fallback={null}><Deferred /></Suspense></main>; }`,
        ),
        writeFile(
          component,
          'export default function Deferred(){ return <p className="text-muted-foreground">Deferred</p>; }',
        ),
      ]);
      const result = observeInheritedForegroundSurfaces(
        [route, component],
        new Set(["muted-foreground", "background"]),
      );
      assert.ok(
        [...result.pairs].some((pair) =>
          pair.startsWith(
            "--color-muted-foreground|--color-background|bg-background|light",
          ),
        ),
        "the lazily imported foreground inherits its real route surface",
      );
      assert.equal(result.unresolved.size, 0);
    } finally {
      await Promise.all(
        [route, component].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("fails closed for a colored text node without a supported surface context", async () => {
    const fixture = `scripts/ci/.contrast-unresolved-${process.pid}.tsx`;
    await writeFile(fixture, '<p className="text-destructive">Invalid</p>');
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["destructive"]),
      );
      const [occurrence] = result.unresolved.values();
      assert.equal(occurrence.usage, fixture);
      assert.equal(occurrence.foregroundClass, "text-destructive");
      assert.match(occurrence.id, /<module>::p\[0\]::text-destructive#0$/u);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("deduplicates class-combination derivations without merging distinct JSX contexts", async () => {
    const fixture = `scripts/ci/.contrast-occurrence-contexts-${process.pid}.tsx`;
    await writeFile(
      fixture,
      '<><p className={cn("text-primary bg-card", "bg-card")}>One</p><p className={cn("text-primary bg-card", "bg-card")}>Two</p></>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["primary", "card"]),
      );
      const occurrences = result.uses.occurrences.get(
        "--color-primary|--color-card|bg-card|light",
      );
      assert.equal(occurrences.length, 2);
      assert.equal(new Set(occurrences.map(({ id }) => id)).size, 2);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("traces JSX-returning helper calls through their painted caller surface", async () => {
    const suffix = process.pid;
    const helper = `apps/web/src/lib/.contrast-icon-${suffix}.tsx`;
    const caller = `apps/web/src/lib/.contrast-icon-caller-${suffix}.tsx`;
    try {
      await writeFile(
        helper,
        'export function IconFunction(){ return <span className="text-primary">Icon</span>; }',
      );
      await writeFile(
        caller,
        `import { IconFunction } from "./.contrast-icon-${suffix}"; export function Render(){ return <div className="bg-card">{IconFunction()}</div>; }`,
      );
      const result = observeInheritedForegroundSurfaces(
        [helper, caller],
        new Set(["primary", "card"]),
      );
      assert.equal(result.unresolved.size, 0);
      assert.ok(result.pairs.has("--color-primary|--color-card|bg-card|light"));
    } finally {
      await Promise.all(
        [helper, caller].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("traces default memo exports through their actual painted caller", async () => {
    const component = `scripts/ci/.contrast-memo-leaf-${process.pid}.tsx`;
    const caller = `scripts/ci/.contrast-memo-caller-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        component,
        'export function MemoLeaf(){ return <span className="text-primary">Status</span>; } export default memo(MemoLeaf);',
      );
      await writeFile(
        caller,
        'import MemoLeaf from "./.contrast-memo-leaf-' +
          process.pid +
          '"; export function Caller(){ return <div className="bg-card"><MemoLeaf /></div>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [component, caller],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      assert.ok(
        observed.pairs.has("--color-primary|--color-card|bg-card|light"),
      );
    } finally {
      await Promise.all(
        [component, caller].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("follows JSX values returned through object properties to every real use", async () => {
    const fixture = `scripts/ci/.contrast-returned-icon-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        fixture,
        'import { HoverCardContent } from "@taskdesk/ui"; function getInfo(){ return { icon: <span className="text-primary">Icon</span> }; } export function Fixture(){ return <main className="bg-background"><><button className="bg-muted">{getInfo().icon}</button><div className="bg-card"><HoverCardContent className="w-72">{getInfo().icon}</HoverCardContent></div></></main>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [fixture],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      const muted = observed.uses.occurrences.get(
        "--color-primary|--color-muted|bg-muted|light|backdrop:bg-background",
      );
      const popover = observed.uses.occurrences.get(
        "--color-primary|--color-popover|bg-popover|light",
      );
      assert.equal(muted.length, 1);
      assert.equal(popover.length, 1);
      assert.equal(muted[0].id, popover[0].id);
      assert.equal(muted[0].surfaceContext, "function-return-property");
      assert.equal(popover[0].surfaceContext, "function-return-property");
      assert.ok(
        popover[0].chain.some((entry) => entry.includes("HoverCardContent")),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("binds a named global CSS surface to its real JSX ancestor", async () => {
    const sourcePath = `apps/web/src/components/.contrast-global-css-${process.pid}.tsx`;
    await writeFile(
      sourcePath,
      'export function Fixture(){ return <div className="taskdesk-comment-editor-bubble"><span className="text-destructive">Error</span></div>; }',
    );
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const result = observeInheritedForegroundSurfaces([sourcePath], tokenNames);
    const key = "--color-destructive|--color-popover|bg-popover|light";
    const occurrence = result.uses.occurrences.get(key)?.[0];
    assert.ok(occurrence);
    assert.ok(
      occurrence.chain.some((entry) =>
        entry.includes(
          "css:.taskdesk-comment-editor-bubble>background:var(--popover)",
        ),
      ),
    );
    assert.equal(result.unresolved.size, 0);
    await rm(sourcePath, { force: true });
  });

  it("binds Sidebar badge text and peer states to source-defined opaque surfaces", async () => {
    const source = await readFile(
      path.join(process.cwd(), "packages/ui/src/components/sidebar.tsx"),
      "utf8",
    );
    const occurrence = (foregroundClass) => ({
      usage: "packages/ui/src/components/sidebar.tsx",
      component: "SidebarMenuBadge",
      foregroundClass,
    });
    assert.equal(
      sidebarSurfaceContract(occurrence("text-sidebar-foreground"), source)[0]
        .className,
      "bg-sidebar",
    );
    assert.equal(
      sidebarSurfaceContract(
        occurrence("peer-hover/menu-button:text-sidebar-accent-foreground"),
        source,
      )[0].className,
      "bg-sidebar-accent",
    );
    assert.equal(
      sidebarSurfaceContract(
        occurrence(
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        ),
        source,
      )[0].className,
      "bg-sidebar-accent",
    );
    assert.equal(
      sidebarSurfaceContract(
        occurrence("peer-hover/menu-button:text-sidebar-accent-foreground"),
        source.replaceAll("hover:bg-sidebar-accent", "hover:bg-card"),
      ),
      undefined,
    );
    assert.equal(
      sidebarSurfaceContract(
        occurrence("text-sidebar-foreground"),
        source,
        true,
      ),
      undefined,
    );
  });

  it("uses the Storybook canvas only when its imported stylesheet paints the semantic body", async () => {
    const preview = await readFile(
      path.join(process.cwd(), "packages/ui/.storybook/preview.ts"),
      "utf8",
    );
    const styles = await readFile(
      path.join(process.cwd(), "packages/ui/.storybook/tailwind.css"),
      "utf8",
    );
    const pathName = "packages/ui/src/components/timeline.stories.tsx";
    const surface = storybookBodySurfaceContract(pathName, preview, styles);
    assert.equal(surface.className, "bg-background");
    assert.ok(
      surface.chain.some((entry) =>
        entry.includes("#storybook-root.background-color:var(--background)"),
      ),
    );
    assert.equal(
      storybookBodySurfaceContract(
        pathName,
        preview,
        styles.replace(
          "background-color: var(--background)",
          "background: transparent",
        ),
      ),
      undefined,
    );
    assert.equal(
      storybookBodySurfaceContract(
        pathName,
        preview.replace("./tailwind.css", "./other.css"),
        styles,
      ),
      undefined,
    );
  });

  it("binds foregrounds in unpainted Storybook JSX to the explicit story canvas", async () => {
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const storyPaths = [
      "packages/ui/src/components/context-menu.stories.tsx",
      "packages/ui/src/components/separator.stories.tsx",
    ];
    const result = observeInheritedForegroundSurfaces(storyPaths, tokenNames);
    assert.equal(result.unresolved.size, 0);
    assert.ok(
      result.pairs.has(
        "--color-muted-foreground|--color-background|bg-background|light",
      ),
    );
    assert.ok(
      result.pairs.has(
        "--color-foreground|--color-background|bg-background|light",
      ),
    );
  });

  it("binds imported surfaces to the current caller tag and rejects caller overrides", async () => {
    const fixture = `scripts/ci/.contrast-wrapper-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        fixture,
        'import { Card as Surface } from "@taskdesk/ui"; export function Fixture(){ return <Surface><p className="text-destructive">Error</p></Surface>; }',
      );
      const valid = observeInheritedForegroundSurfaces([fixture], tokenNames);
      assert.ok(
        valid.pairs.has("--color-destructive|--color-card|bg-card|light"),
      );
      const bound = valid.uses.occurrences.get(
        "--color-destructive|--color-card|bg-card|light",
      )[0];
      assert.equal(bound.wrapper, "Surface");

      await writeFile(
        fixture,
        'import { Card as Surface } from "@taskdesk/ui"; export function Fixture(){ return <main className="bg-background"><Surface className="bg-muted"><p className="text-destructive">Error</p></Surface></main>; }',
      );
      const changed = observeInheritedForegroundSurfaces([fixture], tokenNames);
      assert.equal(changed.unresolved.size, 0);
      assert.equal(changed.importedUses.size, 0);
      assert.ok(
        changed.pairs.has(
          "--color-destructive|--color-muted|bg-muted|light|backdrop:bg-background",
        ),
      );
      assert.equal(
        changed.pairs.has("--color-destructive|--color-card|bg-card|light"),
        false,
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("resolves local named export aliases to their painted implementation", async () => {
    const component = `scripts/ci/contrast-alias-surface-${process.pid}.tsx`;
    const caller = `scripts/ci/contrast-alias-caller-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        component,
        'function Popup({ children }) { return <div className="bg-popover">{children}</div>; } export { Popup as PopupContent };',
      );
      await writeFile(
        caller,
        'import { PopupContent } from "./contrast-alias-surface-' +
          process.pid +
          '"; export function Caller(){ return <PopupContent><p className="text-muted-foreground">Status</p></PopupContent>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [component, caller],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      assert.ok(
        observed.pairs.has(
          "--color-muted-foreground|--color-popover|bg-popover|light",
        ),
      );
    } finally {
      await Promise.all(
        [component, caller].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("resolves conditional alpha caller surfaces against the next opaque ancestor", async () => {
    const leaf = `scripts/ci/contrast-branch-leaf-${process.pid}.tsx`;
    const branch = `scripts/ci/contrast-branch-owner-${process.pid}.tsx`;
    const root = `scripts/ci/contrast-branch-root-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        leaf,
        'export function BranchLeaf(){ return <span className="text-warning-foreground/80">Warn</span>; }',
      );
      await writeFile(
        branch,
        'import { BranchLeaf } from "./contrast-branch-leaf-' +
          process.pid +
          '"; export function BranchOwner({ active }){ return <div className={`relative $' +
          '{active ? "bg-accent/60" : "bg-muted/40 dark:bg-card/90"}`}><BranchLeaf /></div>; }',
      );
      await writeFile(
        root,
        'import { BranchOwner } from "./contrast-branch-owner-' +
          process.pid +
          '"; export function BranchRoot(){ return <main className="bg-background"><section className="bg-muted/20"><div className="bg-muted/30"><BranchOwner active={false} /></div></section></main>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [leaf, branch, root],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      const contexts = [...observed.uses.occurrences.values()].flat();
      assert.deepEqual(
        new Set(contexts.map((entry) => entry.backgroundClass)),
        new Set(["bg-muted/40", "dark:bg-card/90", "bg-accent/60"]),
      );
      assert.ok(
        contexts.every((entry) => entry.backdropClass === "bg-background"),
      );
      assert.ok(
        contexts.some(
          (entry) =>
            JSON.stringify(entry.backdropLayers) ===
            JSON.stringify(["bg-muted/30", "bg-muted/20", "bg-background"]),
        ),
      );
      assert.ok(
        [...observed.pairs].some((key) =>
          key.includes(
            "|dark:bg-card/90|dark|backdrop:bg-muted/30>bg-muted/20>bg-background|text-warning-foreground/80",
          ),
        ),
      );
      assert.equal(
        [...observed.pairs].some((key) =>
          key.includes("|bg-muted/40|dark|text-warning-foreground/80"),
        ),
        false,
      );
      assert.equal(
        [...observed.pairs].some((key) =>
          key.includes("|dark:bg-card/90|light|text-warning-foreground/80"),
        ),
        false,
      );
    } finally {
      await Promise.all(
        [leaf, branch, root].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("does not treat test renderer mounts as additional product surfaces", async () => {
    const component = `scripts/ci/.contrast-leaf-${process.pid}.tsx`;
    const product = `scripts/ci/.contrast-product-${process.pid}.tsx`;
    const testRenderer = `scripts/ci/.contrast-renderer-${process.pid}.test.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        component,
        'export function Leaf(){ return <span className="text-primary">Status</span>; } export default Leaf;',
      );
      await writeFile(
        product,
        'import { Card } from "@taskdesk/ui"; import Leaf from "./.contrast-leaf-' +
          process.pid +
          '"; export function Product(){ return <Card><Leaf /></Card>; }',
      );
      await writeFile(
        testRenderer,
        'import Leaf from "./.contrast-leaf-' +
          process.pid +
          '"; export function TestRenderer(){ return <Leaf />; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [component, product, testRenderer],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      assert.ok(
        observed.pairs.has("--color-primary|--color-card|bg-card|light"),
      );
      assert.equal(
        observed.uses.occurrences
          .get("--color-primary|--color-card|bg-card|light")
          .some((entry) => entry.usage === testRenderer),
        false,
      );
    } finally {
      await Promise.all(
        [component, product, testRenderer].map((file) =>
          rm(file, { force: true }),
        ),
      );
    }
  });

  it("binds route text to the current parent Outlet surface", async () => {
    const parent = `apps/web/src/routes/.contrast-parent-${process.pid}.tsx`;
    const child = `apps/web/src/routes/.contrast-child-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        parent,
        'export const Parent = createFileRoute("/contrast-parent")({ component: () => <div className="bg-card"><Outlet /></div> });',
      );
      await writeFile(
        child,
        'export const Child = createFileRoute("/contrast-parent/child")({ component: () => <p className="text-primary">Status</p> });',
      );
      const first = observeInheritedForegroundSurfaces(
        [parent, child],
        tokenNames,
      );
      assert.ok(first.pairs.has("--color-primary|--color-card|bg-card|light"));
      assert.ok(
        first.routeUses.has(
          `${child}|--color-primary|--color-card|bg-card|light`,
        ),
      );

      await writeFile(
        parent,
        'export const Parent = createFileRoute("/contrast-parent")({ component: () => <div className="bg-muted"><Outlet /></div> });',
      );
      const changed = observeInheritedForegroundSurfaces(
        [parent, child],
        tokenNames,
      );
      assert.ok(
        changed.pairs.has("--color-primary|--color-muted|bg-muted|light"),
      );
      assert.equal(
        changed.pairs.has("--color-primary|--color-card|bg-card|light"),
        false,
      );

      await writeFile(
        parent,
        'export const Parent = createFileRoute("/contrast-parent")({ component: () => <Outlet /> });',
      );
      const body = observeInheritedForegroundSurfaces(
        [parent, child],
        tokenNames,
      );
      const bodyPair = "--color-primary|--color-background|bg-background|light";
      assert.ok(body.pairs.has(bodyPair));
      assert.ok(
        body.uses.occurrences
          .get(bodyPair)
          .some((occurrence) =>
            occurrence.chain.includes(
              "apps/web/src/index.css:body>@apply bg-background",
            ),
          ),
      );
    } finally {
      await rm(parent, { force: true });
      await rm(child, { force: true });
    }
  });

  it("binds button descendants to the caller's declared button variant", async () => {
    const fixture = `scripts/ci/.contrast-button-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    try {
      await writeFile(
        fixture,
        'import { Button } from "@taskdesk/ui"; export function Fixture(){ return <main className="bg-background"><Button variant="secondary"><span className="text-muted-foreground">Save</span></Button></main>; }',
      );
      const secondary = observeInheritedForegroundSurfaces(
        [fixture],
        tokenNames,
      );
      assert.ok(
        secondary.pairs.has(
          "--color-muted-foreground|--color-secondary|bg-secondary|light|backdrop:bg-background",
        ),
      );
      await writeFile(
        fixture,
        'import { Button } from "@taskdesk/ui"; export function Fixture(){ return <main className="bg-background"><Button variant="outline"><span className="text-muted-foreground">Save</span></Button></main>; }',
      );
      const outline = observeInheritedForegroundSurfaces([fixture], tokenNames);
      assert.ok(
        outline.pairs.has(
          "--color-muted-foreground|--color-popover|bg-popover|light",
        ),
      );
      assert.equal(
        outline.pairs.has(
          "--color-muted-foreground|--color-secondary|bg-secondary|light",
        ),
        false,
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("fails when a manifest row no longer has an observed source use", () => {
    const usage = '<div className="text-foreground bg-background" />';
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

  it("rejects translucent manifest surfaces without an opaque terminal backdrop", () => {
    const manifest = [
      {
        fg: "--color-foreground",
        bg: "--color-accent",
        category: "body",
        minRatio: 4.5,
        themes: ["light"],
        usage: "fixture.tsx",
        backdrop: "--color-accent",
        foregroundClass: "text-foreground",
        backgroundClass: { light: "bg-accent/60" },
      },
    ];
    const observed = new Set([
      "--color-foreground|--color-accent|bg-accent/60|light",
    ]);
    const failures = validatePairManifest(
      manifest,
      () => '<p className="text-foreground bg-accent/60">Text</p>',
      observed,
    );
    assert.ok(
      failures.some((failure) =>
        failure.includes(
          "needs a source-bound paint chain ending at its opaque backdrop",
        ),
      ),
    );
  });

  it("binds measured pairs to the exact live foreground occurrence", () => {
    const key = "--color-primary|--color-card|bg-card|light";
    const manifest = [
      {
        fg: "--color-primary",
        bg: "--color-card",
        category: "body",
        minRatio: 4.5,
        themes: ["light"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-primary",
        backgroundClass: { light: "bg-card" },
        occurrences: [
          {
            id: "Fixture::p[0]::text-primary#0",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["fixture.tsx:Fixture", "jsx:p[0]>bg-card"],
          },
        ],
      },
    ];
    const observed = new Set([key]);
    observed.occurrences = new Map([
      [
        key,
        [
          {
            id: "Fixture::p[0]::text-primary#0",
            usage: "fixture.tsx",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["fixture.tsx:Fixture", "jsx:p[0]>bg-card"],
          },
        ],
      ],
    ]);
    assert.deepEqual(
      validatePairManifest(
        manifest,
        () => '<p className="text-primary bg-card" />',
        observed,
      ),
      [],
    );
    manifest[0].occurrences[0].id = "Fixture::p[1]::text-primary#0";
    assert.ok(
      validatePairManifest(
        manifest,
        () => '<p className="text-primary bg-card" />',
        observed,
      ).some((failure) =>
        failure.includes("occurrence contract no longer matches"),
      ),
    );
  });

  it("keeps source occurrence bindings separate for foreground opacity states", async () => {
    const fixture = `apps/web/src/components/.contrast-alpha-identity-${process.pid}.tsx`;
    try {
      await writeFile(
        fixture,
        'export function Fixture(){ return <main className="bg-background"><button className="text-foreground/70 hover:text-foreground bg-background">Save</button><span className="text-warning-foreground bg-accent">Warning</span></main>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["foreground", "accent", "background", "warning-foreground"]),
      );
      const occurrenceKeys = [...observed.uses.occurrences.keys()];
      const baseKey = occurrenceKeys.find((key) =>
        key.endsWith("|text-foreground/70"),
      );
      const hoverKey = occurrenceKeys.find(
        (key) =>
          key.includes("|bg-background|") &&
          !key.endsWith("|text-foreground/70"),
      );
      assert.ok(baseKey);
      assert.ok(hoverKey);
      assert.ok(
        [...observed.pairs].some((key) =>
          key.includes("|bg-accent|light|backdrop:bg-background"),
        ),
      );
      assert.ok(
        observed.uses.occurrences
          .get(baseKey)
          .every((entry) => entry.foregroundClass.includes("/70")),
      );
      assert.ok(
        observed.uses.occurrences
          .get(hoverKey)
          .every(
            (entry) =>
              entry.foregroundClass.startsWith("hover:") &&
              !entry.foregroundClass.includes("/70"),
          ),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("deduplicates a numeric pair while binding every source occurrence", () => {
    const key = "--color-primary|--color-card|bg-card|light";
    const manifest = [
      {
        fg: "--color-primary",
        bg: "--color-card",
        category: "body",
        minRatio: 4.5,
        themes: ["light"],
        usage: "first.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-primary",
        backgroundClass: { light: "bg-card" },
        occurrences: [
          {
            id: "First::p[0]::text-primary#0",
            usage: "first.tsx",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["first.tsx:First", "jsx:p[0]>bg-card"],
          },
          {
            id: "Second::p[0]::text-primary#0",
            usage: "second.tsx",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["second.tsx:Second", "jsx:p[0]>bg-card"],
          },
        ],
      },
    ];
    const observed = new Set([key]);
    observed.occurrences = new Map([
      [
        key,
        manifest[0].occurrences.map(
          ({ id, usage, surfaceContext, category, chain }) => ({
            id,
            usage,
            surfaceContext,
            category,
            chain,
          }),
        ),
      ],
    ]);
    const sources = new Map([
      ["first.tsx", '<p className="text-primary bg-card" />'],
      ["second.tsx", '<p className="text-primary bg-card" />'],
    ]);
    assert.deepEqual(
      validatePairManifest(manifest, (usage) => sources.get(usage), observed),
      [],
    );
    assert.ok(
      validatePairManifest(
        [...manifest, { ...manifest[0] }],
        (usage) => sources.get(usage),
        observed,
      ).some((failure) => failure.includes("duplicates")),
    );
    manifest[0].occurrences[1].id = "Second::p[1]::text-primary#0";
    assert.ok(
      validatePairManifest(
        manifest,
        (usage) => sources.get(usage),
        observed,
      ).some((failure) =>
        failure.includes("occurrence contract no longer matches"),
      ),
    );
    manifest[0].occurrences[1].chain[0] = "second.tsx:ChangedCaller";
    assert.ok(
      validatePairManifest(
        manifest,
        (usage) => sources.get(usage),
        observed,
      ).some((failure) =>
        failure.includes("occurrence contract no longer matches"),
      ),
    );
    manifest[0].occurrences[1].chain[0] = "second.tsx:Second";
    manifest[0].occurrences.push({ ...manifest[0].occurrences[0] });
    assert.ok(
      validatePairManifest(
        manifest,
        (usage) => sources.get(usage),
        observed,
      ).some((failure) =>
        failure.includes("occurrence contract no longer matches"),
      ),
    );
    manifest[0].occurrences.pop();
    manifest[0].occurrences.pop();
    assert.ok(
      validatePairManifest(
        manifest,
        (usage) => sources.get(usage),
        observed,
      ).some((failure) => failure.includes("omits a live source context")),
    );
  });

  it("inventories foreground and background classes split across cn arguments", () => {
    const source = '<div className={cn("text-white", "bg-white")} />';
    const observed = observedPairsInSources([source], new Set(["white"]));
    assert.ok(observed.has("--color-white|--color-white|bg-white|light"));
    assert.ok(observed.has("--color-white|--color-white|bg-white|dark"));
  });

  it("keeps foreground opacity in pair identity and fails closed on unsupported opacity", () => {
    const sources = [
      '<span className="text-muted-foreground/80 bg-background">80%</span><span className="text-muted-foreground/50 bg-background">50%</span><span className="dark:text-muted-foreground/72 bg-background">dark alpha</span><span className="text-muted-foreground/120 bg-background">unsupported</span><span className="text-[#123456] bg-background">arbitrary hex</span><span className="text-[rgb(1,2,3)] bg-background">arbitrary function</span>',
    ];
    const observed = observedPairsInSources(
      sources,
      new Set(["muted-foreground", "background"]),
      ["fixture.tsx"],
    );
    const eighty =
      "--color-muted-foreground|--color-background|bg-background|light|text-muted-foreground/80";
    const fifty =
      "--color-muted-foreground|--color-background|bg-background|light|text-muted-foreground/50";
    const darkAlpha =
      "--color-muted-foreground|--color-background|bg-background|dark|text-muted-foreground/72";
    assert.ok(observed.has(eighty));
    assert.ok(observed.has(fifty));
    assert.ok(observed.has(darkAlpha));
    assert.equal(
      observed.has(
        "--color-muted-foreground|--color-background|bg-background|light|text-muted-foreground/72",
      ),
      false,
    );
    assert.notEqual(eighty, fifty);
    assert.deepEqual(observed.unsupportedForegrounds, [
      { className: "text-muted-foreground/120", usage: "fixture.tsx" },
      { className: "text-[#123456]", usage: "fixture.tsx" },
      { className: "text-[rgb(1,2,3)]", usage: "fixture.tsx" },
    ]);

    const manifest = [
      {
        fg: "--color-muted-foreground",
        bg: "--color-background",
        category: "body",
        minRatio: 4.5,
        themes: ["light"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-muted-foreground/80",
        backgroundClass: { light: "bg-background" },
      },
    ];
    const failures = validatePairManifest(manifest, () => sources[0], observed);
    assert.ok(
      failures.some((failure) =>
        failure.includes(`used pair ${fifty} has no manifest entry`),
      ),
    );
  });

  it("does not invent color pairs across mutually exclusive cn branches", () => {
    const observed = observedPairsInSources(
      [
        '<div className={cn(variant === "a" && "text-foreground bg-background", variant === "b" && "text-primary-foreground bg-primary")} />',
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
      ['<div className={cn(condition && "text-white", "bg-white")} />'],
      new Set(["white"]),
    );
    assert.ok(observed.has("--color-white|--color-white|bg-white|light"));
  });

  it("pairs compatible conditional cn arguments and object entries", () => {
    for (const source of [
      '<div className={cn(a && "text-white", b && "bg-white")} />',
      '<div className={cn({ "text-white": a, "bg-white": b })} />',
    ]) {
      const observed = observedPairsInSources([source], new Set(["white"]));
      assert.ok(observed.has("--color-white|--color-white|bg-white|light"));
    }
  });

  it("does not cross-pair mutually exclusive conditional class strings", () => {
    const observed = observedPairsInSources(
      [
        '<div className={cn(variant === "light" && "text-foreground", variant === "dark" && "bg-background")} />',
      ],
      new Set(["foreground", "background"]),
    );
    assert.equal(
      observed.has("--color-foreground|--color-background|bg-background|light"),
      false,
    );
  });

  it("keeps nested ternary paint states mutually exclusive", () => {
    const observed = observedPairsInSources(
      [
        '<span className={cn("size-5", isToday(day) ? "bg-primary text-primary-foreground" : !isSameMonth(day, month) ? "text-muted-foreground" : undefined)} />',
      ],
      new Set(["primary", "primary-foreground", "muted-foreground"]),
    );
    assert.ok(
      observed.has(
        "--color-primary-foreground|--color-primary|bg-primary|light",
      ),
    );
    assert.equal(
      observed.has("--color-muted-foreground|--color-primary|bg-primary|light"),
      false,
    );
  });

  it("materializes descendant state selectors on the real child probe", () => {
    assert.deepEqual(
      probeSurfaceDescriptor("*:data-[slot=tabs-tab]:hover:bg-accent"),
      {
        className: "data-[slot=tabs-tab]:hover:bg-accent",
        descendant: true,
      },
    );
    assert.deepEqual(probeSurfaceDescriptor("hover:bg-accent"), {
      className: "hover:bg-accent",
      descendant: false,
    });
  });

  it("does not cross-pair foregrounds from a className template conditional", () => {
    const source = `function Fixture({ active }) { return <button className={\`border \${active ? "bg-primary text-primary" : "bg-background text-foreground"}\`} />; }`;
    const observed = observedPairsInSources(
      [source],
      new Set(["primary", "foreground", "background"]),
    );
    assert.ok(observed.has("--color-primary|--color-primary|bg-primary|light"));
    assert.ok(
      observed.has("--color-foreground|--color-background|bg-background|light"),
    );
    assert.equal(
      observed.has("--color-foreground|--color-primary|bg-primary/10|light"),
      false,
    );
  });

  it("inventories nested arbitrary state variants as real surface classes", () => {
    const activeSurface = "[:active,[data-pressed]]:bg-card";
    const usage = `<div className={\`text-secondary-foreground ${activeSurface}\`} />`;
    const manifest = [
      {
        fg: "--color-secondary-foreground",
        bg: "--color-card",
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
      new Set(["card", "secondary-foreground"]),
    );
    assert.ok(
      observed.has(
        `--color-secondary-foreground|--color-card|${activeSurface}|light`,
      ),
    );
    assert.ok(
      observed.has(
        `--color-secondary-foreground|--color-card|${activeSurface}|dark`,
      ),
    );
    assert.deepEqual(
      validatePairManifest(manifest, () => usage, observed),
      [],
    );
  });

  it("retains dark theme modifiers on measured surface classes", () => {
    const darkSurface = "dark:has-autofill:bg-background";
    const usage = `<div className={\`text-foreground bg-background ${darkSurface}\`} />`;
    const _manifest = [
      {
        fg: "--color-foreground",
        bg: "--color-background",
        category: "body",
        minRatio: 4.5,
        themes: ["light", "dark"],
        usage: "fixture.tsx",
        backdrop: "--color-background",
        foregroundClass: "text-foreground",
        backgroundClass: {
          light: "bg-background",
          dark: "bg-background",
        },
      },
    ];
    const observed = observedPairsInSources(
      [usage],
      new Set(["foreground", "background"]),
    );
    assert.ok(
      observed.has(`--color-foreground|--color-background|${darkSurface}|dark`),
    );
  });

  it("does not inventory dark-only foregrounds in light theme", () => {
    const observed = observedPairsInSources(
      ['<div className="text-foreground bg-background dark:text-white" />'],
      new Set(["foreground", "white", "background"]),
    );
    assert.equal(
      observed.has("--color-white|--color-background|bg-background|light"),
      false,
    );
    assert.equal(
      observed.has("--color-foreground|--color-primary|hover:bg-primary|light"),
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

  it("pairs hover foregrounds with the active hover surface instead of the base surface", () => {
    const observed = observedPairsInSources(
      [
        '<div className="bg-background text-foreground hover:text-white hover:bg-primary" />',
      ],
      new Set(["background", "foreground", "white", "primary"]),
    );
    assert.ok(
      observed.has("--color-foreground|--color-background|bg-background|light"),
    );
    assert.ok(
      observed.has("--color-white|--color-primary|hover:bg-primary|light"),
    );
    assert.equal(
      observed.has("--color-white|--color-background|bg-background|light"),
      false,
    );
  });

  it("composites translucent surfaces before measuring WCAG contrast", () => {
    const tintedWhite = composite([255, 0, 0, 0.08], [255, 255, 255]);
    assert.deepEqual(tintedWhite, [255, 235, 235]);
    assert.ok(contrastRatio([120, 0, 0], tintedWhite) >= 4.5);
    assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]), 1);
  });
});
