import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectContrastSourcePaths,
  composite,
  contrastRatio,
  declaredBodyBackground,
  failsContrastThreshold,
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

  it("reports an actionable error when an inventoried source has no TypeScript project", () => {
    const missing = `apps/web/src/components/.contrast-missing-source-${process.pid}.tsx`;
    assert.throws(
      () =>
        observeInheritedForegroundSurfaces([missing], new Set(["background"])),
      new RegExp(
        `Contrast analysis cannot load source \\"${missing}\\": TypeScript has no default project.*included by its owning tsconfig`,
      ),
    );
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
    const fixture = `apps/web/src/components/.contrast-inheritance-${process.pid}.test.tsx`;
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
    const fixture = `apps/web/src/components/.contrast-hover-ancestor-${process.pid}.test.tsx`;
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

  it("binds reachable data-state ancestor backgrounds without losing the opaque fallback", async () => {
    const fixture = `apps/web/src/components/.contrast-data-state-${process.pid}.test.tsx`;
    await writeFile(
      fixture,
      '<main className="bg-background"><div className="bg-background data-[task-dragging=true]:bg-card data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50" data-task-dragging={dragging ? "true" : undefined} data-task-selected={selected ? "true" : undefined}><span className="text-muted-foreground">Selected</span></div></main>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["background", "card", "accent", "muted-foreground"]),
      );
      assert.equal(result.unresolved.size, 0);
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-background|bg-background|light",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-card|data-[task-dragging=true]:bg-card|light",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-accent|data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50|light|backdrop:bg-background",
        ),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("keeps unsupported state background variants unresolved", async () => {
    const fixture = `apps/web/src/components/.contrast-unknown-state-${process.pid}.test.tsx`;
    await writeFile(
      fixture,
      '<main className="bg-background"><div className="data-[mystery=true]:bg-card"><span className="text-muted-foreground">Unknown</span></div></main>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["background", "card", "muted-foreground"]),
      );
      assert.equal(result.unresolved.size, 1);
      assert.equal(
        result.pairs.has(
          "--color-muted-foreground|--color-card|data-[mystery=true]:bg-card|light",
        ),
        false,
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("enumerates a supported backdrop-filter background override with its fallback", async () => {
    const fixture = `apps/web/src/components/.contrast-supports-state-${process.pid}.test.tsx`;
    await writeFile(
      fixture,
      '<main className="bg-background"><div className="bg-card/80 supports-[backdrop-filter]:bg-card/70"><span className="text-muted-foreground">Card</span></div></main>',
    );
    try {
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["background", "card", "muted-foreground"]),
      );
      assert.equal(result.unresolved.size, 0);
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-card|bg-card/80|light|backdrop:bg-background",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-card|supports-[backdrop-filter]:bg-card/70|light|backdrop:bg-background",
        ),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("accepts a Base UI highlighted menu surface only on the forwarded menu item primitive", async () => {
    const fixture = `packages/ui/src/components/.contrast-base-ui-state-${process.pid}.tsx`;
    try {
      await writeFile(
        fixture,
        'import { Menu as MenuPrimitive } from "@base-ui/react/menu"; export function MenuItem(){ return <div className="bg-popover"><MenuPrimitive.Item className="data-highlighted:bg-accent/50" {...props}><span className="text-foreground">Item</span></MenuPrimitive.Item></div>; }',
      );
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set(["popover", "accent", "foreground"]),
      );
      assert.equal(result.unresolved.size, 0);
      assert.ok(
        result.pairs.has("--color-foreground|--color-popover|bg-popover|light"),
      );
      assert.ok(
        result.pairs.has(
          "--color-foreground|--color-accent|data-highlighted:bg-accent/50|light|backdrop:bg-popover",
        ),
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("binds direct JSX-return helpers through renamed imports at every real caller", async () => {
    const helper = `apps/web/src/components/.contrast-icon-helper-${process.pid}.tsx`;
    const caller = `apps/web/src/components/.contrast-icon-caller-${process.pid}.tsx`;
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
        helper,
        'export function renderIcon(){ return <svg className="text-primary" />; }',
      );
      await writeFile(
        caller,
        'import { renderIcon as paintIcon } from "./.contrast-icon-helper-' +
          process.pid +
          '"; export function Caller(){ return <main className="bg-background"><button className="bg-muted/50">{paintIcon()}</button><div className="bg-card">{paintIcon()}</div></main>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [helper, caller],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      const muted = observed.uses.occurrences.get(
        "--color-primary|--color-muted|bg-muted/50|light|backdrop:bg-background",
      );
      const card = observed.uses.occurrences.get(
        "--color-primary|--color-card|bg-card|light",
      );
      assert.equal(muted.length, 1);
      assert.equal(card.length, 1);
      assert.equal(muted[0].surfaceContext, "caller-chain");
      assert.equal(card[0].surfaceContext, "caller-chain");
    } finally {
      await Promise.all(
        [helper, caller].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("keeps a direct JSX-return helper unresolved when any caller surface is unsupported", async () => {
    const helper = `apps/web/src/components/.contrast-unbound-helper-${process.pid}.tsx`;
    const caller = `apps/web/src/components/.contrast-unbound-caller-${process.pid}.tsx`;
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
        helper,
        'export function renderIcon(){ return <svg className="text-primary" />; }',
      );
      await writeFile(
        caller,
        'import { renderIcon as paintIcon } from "./.contrast-unbound-helper-' +
          process.pid +
          '"; export function Caller(){ return <main className="bg-background"><div className="data-[mystery=true]:bg-card">{paintIcon()}</div></main>; }',
      );
      const observed = observeInheritedForegroundSurfaces(
        [helper, caller],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 1);
      assert.equal(
        [...observed.pairs].some((key) => key.includes("--color-card")),
        false,
      );
    } finally {
      await Promise.all(
        [helper, caller].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("binds a local memo-wrapped row to its actual module caller", async () => {
    const fixture = `apps/web/src/components/.contrast-local-memo-${process.pid}.tsx`;
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
        'import { memo } from "react"; const WorkItemTableRow = memo(function WorkItemTableRow(){ return <span className="text-primary">Row</span>; }); function WorkItemList(){ return <div className="bg-card"><WorkItemTableRow /></div>; } export default memo(WorkItemList);',
      );
      const observed = observeInheritedForegroundSurfaces(
        [fixture],
        tokenNames,
      );
      assert.equal(observed.unresolved.size, 0);
      const contexts = observed.uses.occurrences.get(
        "--color-primary|--color-card|bg-card|light",
      );
      assert.equal(contexts.length, 1);
      assert.equal(contexts[0].usage, fixture);
      assert.equal(contexts[0].surfaceContext, "caller-chain");
      assert.ok(contexts[0].id.includes("WorkItemTableRow"));
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

  it("binds the explicitly selected named export in React.lazy and rejects other mappings", async () => {
    const suffix = `-${process.pid}`;
    const route = `apps/web/src/.contrast-lazy-named-route${suffix}.tsx`;
    const component = `apps/web/src/.contrast-lazy-named-component${suffix}.tsx`;
    const tokenNames = new Set(["background", "muted-foreground"]);
    try {
      await Promise.all([
        writeFile(
          route,
          `import { lazy, Suspense } from "react";\nconst Deferred = lazy(() => import("@/.contrast-lazy-named-component${suffix}").then((module) => ({ default: module.NamedLeaf })));\nexport function Route(){ return <main className="bg-background"><Suspense fallback={null}><Deferred /></Suspense></main>; }`,
        ),
        writeFile(
          component,
          'export function NamedLeaf(){ return <p className="text-muted-foreground">Deferred</p>; }',
        ),
      ]);
      const bound = observeInheritedForegroundSurfaces(
        [route, component],
        tokenNames,
      );
      assert.ok(
        bound.pairs.has(
          "--color-muted-foreground|--color-background|bg-background|light",
        ),
        "the named lazy export inherits the caller's actual opaque surface",
      );
      assert.equal(bound.unresolved.size, 0);

      await writeFile(
        route,
        `import { lazy, Suspense } from "react";\nconst Deferred = lazy(() => import("@/.contrast-lazy-named-component${suffix}").then((module) => ({ default: module.NamedLeaf, extra: module.OtherLeaf })));\nexport function Route(){ return <main className="bg-background"><Suspense fallback={null}><Deferred /></Suspense></main>; }`,
      );
      const unsupported = observeInheritedForegroundSurfaces(
        [route, component],
        tokenNames,
      );
      assert.equal(unsupported.unresolved.size, 1);
      assert.equal(
        unsupported.pairs.has(
          "--color-muted-foreground|--color-background|bg-background|light",
        ),
        false,
        "an unrecognized lazy mapping cannot inherit a caller surface",
      );
    } finally {
      await Promise.all(
        [route, component].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("fails closed for a colored text node without a supported surface context", async () => {
    const fixture = `apps/web/src/components/.contrast-unresolved-${process.pid}.test.tsx`;
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
    const fixture = `apps/web/src/components/.contrast-occurrence-contexts-${process.pid}.test.tsx`;
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
    const component = `apps/web/src/components/.contrast-memo-leaf-${process.pid}.tsx`;
    const caller = `apps/web/src/components/.contrast-memo-caller-${process.pid}.tsx`;
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
    const fixture = `apps/web/src/components/.contrast-returned-icon-${process.pid}.test.tsx`;
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
    try {
      await writeFile(
        sourcePath,
        'import "@/components/task/editor-styles.css"; export function Fixture(){ return <div className="taskdesk-comment-editor-bubble"><span className="text-destructive">Error</span></div>; }',
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
      const result = observeInheritedForegroundSurfaces(
        [sourcePath],
        tokenNames,
      );
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
    } finally {
      await rm(sourcePath, { force: true });
    }
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
    const fixture = `apps/web/src/components/.contrast-wrapper-${process.pid}.test.tsx`;
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
    const component = `apps/web/src/components/contrast-alias-surface-${process.pid}.tsx`;
    const caller = `apps/web/src/components/contrast-alias-caller-${process.pid}.tsx`;
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
    const leaf = `apps/web/src/components/contrast-branch-leaf-${process.pid}.tsx`;
    const branch = `apps/web/src/components/contrast-branch-owner-${process.pid}.tsx`;
    const root = `apps/web/src/components/contrast-branch-root-${process.pid}.tsx`;
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
    const component = `apps/web/src/components/.contrast-leaf-${process.pid}.tsx`;
    const product = `apps/web/src/components/.contrast-product-${process.pid}.tsx`;
    const testRenderer = `apps/web/src/components/.contrast-renderer-${process.pid}.test.tsx`;
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

  it("carries a declared route body surface through nested components and rejects unknown call paths", async () => {
    const suffix = `-${process.pid}`;
    const leaf = `apps/web/src/components/.contrast-route-leaf${suffix}.tsx`;
    const wrapper = `apps/web/src/components/.contrast-route-wrapper${suffix}.tsx`;
    const route = `apps/web/src/routes/.contrast-route-surface${suffix}.tsx`;
    const unknownCaller = `apps/web/src/components/.contrast-route-unknown${suffix}.tsx`;
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
        'export function Leaf(){ return <p className="text-primary">Status</p>; }',
      );
      await writeFile(
        wrapper,
        `import { Leaf } from "./.contrast-route-leaf${suffix}"; export function Wrapper(){ return <main><Leaf /></main>; }`,
      );
      await writeFile(
        route,
        `import { Wrapper } from "../components/.contrast-route-wrapper${suffix}"; export const Route = createFileRoute("/contrast-route${suffix}")({ component: () => <Wrapper /> });`,
      );

      const valid = observeInheritedForegroundSurfaces(
        [leaf, wrapper, route],
        tokenNames,
      );
      const bodyPair = "--color-primary|--color-background|bg-background|light";
      assert.equal(valid.unresolved.size, 0);
      assert.ok(valid.pairs.has(bodyPair));
      assert.ok(
        valid.uses.occurrences
          .get(bodyPair)
          .some((occurrence) =>
            occurrence.chain.includes(
              "apps/web/src/index.css:body>@apply bg-background",
            ),
          ),
      );

      await writeFile(
        unknownCaller,
        `import { Leaf } from "./.contrast-route-leaf${suffix}"; export function UnknownCaller(){ return <Leaf />; }`,
      );
      const mixedCallers = observeInheritedForegroundSurfaces(
        [leaf, wrapper, route, unknownCaller],
        tokenNames,
      );
      assert.ok(mixedCallers.unresolved.size > 0);

      await writeFile(
        route,
        `import { Wrapper } from "../components/.contrast-route-wrapper${suffix}"; export const Route = createFileRoute("/contrast-route${suffix}")({ component: () => <main className="bg-unregistered"><Wrapper /></main> });`,
      );
      const unknownPaint = observeInheritedForegroundSurfaces(
        [leaf, wrapper, route],
        tokenNames,
      );
      assert.ok(unknownPaint.unresolved.size > 0);
      assert.equal(unknownPaint.pairs.has(bodyPair), false);

      const noRouteSurface = observeInheritedForegroundSurfaces(
        [leaf, wrapper],
        tokenNames,
      );
      assert.ok(noRouteSurface.unresolved.size > 0);
    } finally {
      await Promise.all(
        [leaf, wrapper, route, unknownCaller].map((file) =>
          rm(file, { force: true }),
        ),
      );
    }
  });

  it("uses the declared body contract only and keeps low-contrast colors below threshold", () => {
    assert.equal(
      declaredBodyBackground("body { @apply bg-background; }"),
      "bg-background",
    );
    assert.equal(declaredBodyBackground("body { color: black; }"), undefined);
    assert.equal(
      failsContrastThreshold([255, 255, 255], [255, 255, 255], 4.5),
      true,
    );
    assert.equal(
      failsContrastThreshold([0, 0, 0], [255, 255, 255], 4.5),
      false,
    );
  });

  it("ignores an unreferenced component only when module reachability proves it dead", async () => {
    const route = `apps/web/src/routes/.contrast-reachability-${process.pid}.tsx`;
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
        route,
        'function Unreferenced(){ return <p className="text-primary">Dead</p>; } function Page(){ return <p className="text-primary">Live</p>; } export const Route = createFileRoute("/contrast-reachability")({ component: Page });',
      );
      const result = observeInheritedForegroundSurfaces(
        [route],
        tokenNames,
        undefined,
        { trackReachability: true },
      );
      assert.equal(
        [...result.uses.occurrences.values()]
          .flat()
          .some((item) => item.component === "Unreferenced"),
        false,
      );

      await writeFile(
        route,
        'function Unreferenced(){ return <p className="text-primary">Dead</p>; } function Page(){ return <main className="bg-background"><Unreferenced /><p className="text-primary">Live</p></main>; } export const Route = createFileRoute("/contrast-reachability")({ component: Page });',
      );
      const nowReferenced = observeInheritedForegroundSurfaces(
        [route],
        tokenNames,
        undefined,
        { trackReachability: true },
      );
      assert.ok(
        [...nowReferenced.uses.occurrences.values()]
          .flat()
          .some((item) => item.component === "Unreferenced"),
      );
    } finally {
      await rm(route, { force: true });
    }
  });

  it("keeps lazy-loaded and unknown dynamic module owners reachable for contrast validation", async () => {
    const route = `apps/web/src/routes/.contrast-lazy-reach-${process.pid}.tsx`;
    const component = `apps/web/src/components/.contrast-lazy-reach-${process.pid}.tsx`;
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
        'export default function LazyLeaf(){ return <p className="text-primary">Lazy</p>; }',
      );
      await writeFile(
        route,
        `import { lazy, Suspense } from "react"; const Deferred = lazy(() => import("../components/.contrast-lazy-reach-${process.pid}")); function Page(){ return <main className="bg-unregistered"><Suspense fallback={null}><Deferred /></Suspense></main>; } export const Route = createFileRoute("/contrast-lazy-reach")({ component: Page });`,
      );
      const lazyResult = observeInheritedForegroundSurfaces(
        [route, component],
        tokenNames,
        undefined,
        { trackReachability: true },
      );
      assert.ok(
        [...lazyResult.unresolved.keys()].some((id) =>
          id.includes("contrast-lazy-reach"),
        ),
      );

      await writeFile(
        route,
        `import { lazy, Suspense } from "react"; const moduleName = "../components/.contrast-lazy-reach-${process.pid}"; const Deferred = lazy(() => import(moduleName)); function Page(){ return <main className="bg-unregistered"><Suspense fallback={null}><Deferred /></Suspense></main>; } export const Route = createFileRoute("/contrast-lazy-reach")({ component: Page });`,
      );
      const unknownResult = observeInheritedForegroundSurfaces(
        [route, component],
        tokenNames,
        undefined,
        { trackReachability: true },
      );
      assert.ok(
        [...unknownResult.unresolved.keys()].some((id) =>
          id.includes("contrast-lazy-reach"),
        ),
      );
    } finally {
      await Promise.all(
        [route, component].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("composites Alert and DialogDescription text over their declared variant surfaces", async () => {
    const route = `apps/web/src/routes/.contrast-alert-dialog-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const sources = [
      "packages/ui/src/components/alert.tsx",
      "packages/ui/src/components/dialog.tsx",
      route,
    ];
    try {
      await writeFile(
        route,
        'import { Alert, AlertDescription, Dialog, DialogContent, DialogDescription, DialogHeader } from "@taskdesk/ui"; function Page(){ return <main className="bg-background"><Dialog open><DialogContent><DialogHeader><DialogDescription>Dialog body</DialogDescription></DialogHeader><Alert><AlertDescription>Default alert</AlertDescription></Alert><Alert variant="error"><AlertDescription>Error alert</AlertDescription></Alert></DialogContent></Dialog></main>; } export const Route = createFileRoute("/contrast-alert-dialog")({ component: Page });',
      );
      const result = observeInheritedForegroundSurfaces(sources, tokenNames);
      assert.equal(result.unresolved.size, 0);
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-popover|bg-popover|light",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-input|dark:bg-input/32|dark|backdrop:bg-popover",
        ),
      );
      assert.ok(
        result.pairs.has(
          "--color-muted-foreground|--color-destructive|bg-destructive/4|light|backdrop:bg-popover",
        ),
      );
    } finally {
      await rm(route, { force: true });
    }
  });

  it("traces a returned map renderer through its JSX caller and rejects an unpainted caller", async () => {
    const fixture = `apps/web/src/components/.contrast-renderer-${process.pid}.tsx`;
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
        'function renderNode(){ return <span className="text-primary">Value</span>; } function renderNodes(nodes){ return nodes.map((node) => renderNode()); } function KbArticleContent({ nodes }){ return <article>{renderNodes(nodes)}</article>; } export function Page(){ return <main className="bg-background"><KbArticleContent nodes={[]} /></main>; }',
      );
      const painted = observeInheritedForegroundSurfaces([fixture], tokenNames);
      const pair = "--color-primary|--color-background|bg-background|light";
      assert.equal(painted.unresolved.size, 0);
      assert.ok(painted.pairs.has(pair));

      await writeFile(
        fixture,
        'function renderNode(){ return <span className="text-primary">Value</span>; } function renderNodes(nodes){ return nodes.map((node) => renderNode()); } function KbArticleContent({ nodes }){ return <article>{renderNodes(nodes)}</article>; } export function Page(){ return <main className="bg-background"><KbArticleContent nodes={[]} /></main>; } export function UnknownPage(){ return <KbArticleContent nodes={[]} />; }',
      );
      const mixed = observeInheritedForegroundSurfaces([fixture], tokenNames);
      assert.ok(mixed.unresolved.size > 0);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it("traces a local JSX render-prop helper and its returned row alias only when the prop is rendered", async () => {
    const host = `apps/web/src/components/.contrast-render-prop-host-${process.pid}.tsx`;
    const fixture = `apps/web/src/components/.contrast-render-prop-${process.pid}.tsx`;
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
        host,
        "export function VirtualizedSortableList({ items, renderItem }) { return <div>{items.map((item, index) => renderItem(item, { index }))}</div>; }",
      );
      const source = `import { VirtualizedSortableList } from "./.contrast-render-prop-host-${process.pid}"; function WorkItemKaneoList({ items }){ const renderTaskRow = (task, virtualItem) => { const row = <div className="bg-accent/45 hover:bg-accent/60"><span className="text-foreground">Selected row</span></div>; if (!virtualItem) return row; return <div>{row}</div>; }; return <section className="bg-card"><VirtualizedSortableList items={items} renderItem={(task, virtualItem) => renderTaskRow(task, virtualItem)} /></section>; } export function Page(){ return <main className="bg-background"><WorkItemKaneoList items={[{}]} /></main>; }`;
      await writeFile(fixture, source);
      const rendered = observeInheritedForegroundSurfaces(
        [host, fixture],
        tokenNames,
      );
      assert.equal(rendered.unresolved.size, 0);
      assert.ok(
        rendered.pairs.has(
          "--color-foreground|--color-accent|bg-accent/45|light|backdrop:bg-card",
        ),
        [...rendered.pairs].join("\n"),
      );
      assert.ok(
        rendered.pairs.has(
          "--color-foreground|--color-accent|hover:bg-accent/60|light|backdrop:bg-card",
        ),
      );

      await writeFile(
        host,
        "export function VirtualizedSortableList({ items, renderItem }) { return <div>{items.map((item) => <span key={item.id}>{item.id}</span>)}</div>; }",
      );
      const ignoredProp = observeInheritedForegroundSurfaces(
        [host, fixture],
        tokenNames,
      );
      assert.equal(ignoredProp.unresolved.size, 0);
      assert.equal(
        ignoredProp.pairs.has(
          "--color-foreground|--color-accent|bg-accent/45|light|backdrop:bg-card",
        ),
        false,
      );
    } finally {
      await Promise.all(
        [host, fixture].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("retains real Kaneo TaskRow selected and hover contexts through WorkItemKaneoList virtualization", async () => {
    const route = `apps/web/src/routes/.contrast-work-item-renderer-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const sources = [
      "packages/ui/src/index.ts",
      "packages/ui/src/components/fieldset.tsx",
      "apps/web/src/components/list-view/task-row.tsx",
      "apps/web/src/components/list-view/list-column-section.tsx",
      "apps/web/src/components/work-item/virtualization/virtualized-sortable-list.tsx",
      "apps/web/src/components/work-item/work-item-kaneo-list.tsx",
      route,
    ];
    try {
      await writeFile(
        route,
        'import WorkItemKaneoList from "../components/work-item/work-item-kaneo-list"; function Page(){ return <main className="bg-background"><WorkItemKaneoList projectId="project" workspaceId="workspace" workItems={[]} hasPartialFailure={false} isLoading={false} isError={false} sort="position" dir="asc" onSortChange={() => {}} onRetry={() => {}} /></main>; } export const Route = createFileRoute("/contrast-work-item-renderer")({ component: Page });',
      );
      const actual = observeInheritedForegroundSurfaces(
        sources,
        tokenNames,
        undefined,
        { trackReachability: true },
      );
      assert.ok(
        actual.pairs.has(
          "--color-foreground|--color-accent|bg-accent/45|light|backdrop:bg-accent/60>bg-card",
        ),
      );
      assert.ok(
        actual.pairs.has(
          "--color-foreground|--color-accent|hover:bg-accent/60|light|backdrop:bg-accent/60>bg-card",
        ),
      );
    } finally {
      await rm(route, { force: true });
    }
  });

  it("traces KbArticleContent table cells through renderNode and renderNodes to its route surface", async () => {
    const route = `apps/web/src/routes/.contrast-kb-route-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const sources = [
      "packages/ui/src/components/table.tsx",
      "apps/web/src/components/kb/kb-article-content.tsx",
      route,
    ];
    try {
      await writeFile(
        route,
        'import { KbArticleContent } from "../components/kb/kb-article-content"; export const Route = createFileRoute("/contrast-kb")({ component: () => <main className="bg-background"><KbArticleContent body={{ content: [] }} /></main> });',
      );
      const routed = observeInheritedForegroundSurfaces(sources, tokenNames);
      const pair =
        "--color-muted-foreground|--color-background|bg-background|light";
      assert.equal(
        [...routed.unresolved.keys()].some((id) => id.includes("TableHead")),
        false,
      );
      assert.ok(routed.pairs.has(pair));

      await writeFile(
        route,
        'import { KbArticleContent } from "../components/kb/kb-article-content"; export function Unknown(){ return <KbArticleContent body={{ content: [] }} />; }',
      );
      const unpainted = observeInheritedForegroundSurfaces(sources, tokenNames);
      assert.ok(
        [...unpainted.unresolved.keys()].some((id) => id.includes("TableHead")),
      );
      assert.equal(unpainted.pairs.has(pair), false);
    } finally {
      await rm(route, { force: true });
    }
  });

  it("binds helper results passed through an object prop only when the consumer renders that property", async () => {
    const helper = `apps/web/src/components/.contrast-object-helper-${process.pid}.tsx`;
    const consumer = `apps/web/src/components/.contrast-object-consumer-${process.pid}.tsx`;
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
        helper,
        'export function renderIcon(){ return <svg className="text-muted-foreground" />; }',
      );
      await writeFile(
        consumer,
        `import { renderIcon } from "./.contrast-object-helper-${process.pid}"; function StackedIcons({ items }){ return <span>{items.map((item) => <span key={item.id} className="bg-background">{item.node}</span>)}</span>; } export function Page(){ return <main className="bg-background"><StackedIcons items={[{ id: "one", node: renderIcon() }]} /></main>; }`,
      );
      const rendered = observeInheritedForegroundSurfaces(
        [helper, consumer],
        tokenNames,
      );
      const pair =
        "--color-muted-foreground|--color-background|bg-background|light";
      assert.equal(rendered.unresolved.size, 0);
      assert.ok(rendered.pairs.has(pair));

      await writeFile(
        consumer,
        `import { renderIcon } from "./.contrast-object-helper-${process.pid}"; function StackedIcons({ items }){ return <span>{items.map((item) => <span key={item.id} className="bg-background">{item.node}</span>)}</span>; } export function Page(){ return <main className="bg-background"><StackedIcons items={["one"].map((id) => ({ id, node: renderIcon() }))} /></main>; }`,
      );
      const mapped = observeInheritedForegroundSurfaces(
        [helper, consumer],
        tokenNames,
      );
      assert.equal(mapped.unresolved.size, 0);
      assert.ok(mapped.pairs.has(pair));

      await writeFile(
        consumer,
        `import { renderIcon } from "./.contrast-object-helper-${process.pid}"; function StackedIcons({ items }){ return <span>{items.map((item) => <span key={item.id} className="bg-background">{item.id}</span>)}</span>; } export function Page(){ return <main className="bg-background"><StackedIcons items={[{ id: "one", node: renderIcon() }]} /></main>; }`,
      );
      const unrendered = observeInheritedForegroundSurfaces(
        [helper, consumer],
        tokenNames,
      );
      assert.ok(unrendered.unresolved.size > 0);
    } finally {
      await Promise.all(
        [helper, consumer].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("binds button descendants to the caller's declared button variant", async () => {
    const fixture = `apps/web/src/components/.contrast-button-${process.pid}.test.tsx`;
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

  it("binds button state colors to explicit overrides and proven backdrops", async () => {
    const helper = `apps/web/src/lib/.contrast-button-state-${process.pid}.tsx`;
    const fixture = `apps/web/src/components/.contrast-button-state-caller-${process.pid}.tsx`;
    const theme = await readFile(
      path.join(process.cwd(), "packages/ui/src/styles/theme.css"),
      "utf8",
    );
    const tokenNames = new Set(
      [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(
        (match) => match[1],
      ),
    );
    const foreground = "--color-foreground";
    try {
      await writeFile(
        helper,
        'export function IconFunction(){ return <span className="text-foreground">Save</span>; }',
      );
      await writeFile(
        fixture,
        `import { Button } from "@taskdesk/ui"; import { IconFunction } from "@/lib/.contrast-button-state-${process.pid}"; export function Fixture(){ return <main className="bg-card"><Button variant="secondary" className="bg-background hover:bg-accent/60 active:bg-accent/50">{IconFunction()}</Button></main>; }`,
      );
      const overridden = observeInheritedForegroundSurfaces(
        [helper, fixture],
        tokenNames,
      );
      assert.ok(
        overridden.pairs.has(
          `${foreground}|--color-background|bg-background|light`,
        ),
      );
      assert.ok(
        overridden.pairs.has(
          `${foreground}|--color-accent|hover:bg-accent/60|light|backdrop:bg-background`,
        ),
      );
      assert.ok(
        overridden.pairs.has(
          `${foreground}|--color-accent|active:bg-accent/50|light|backdrop:bg-background`,
        ),
      );
      assert.equal(overridden.unresolved.size, 0);

      await writeFile(
        fixture,
        `import { Button } from "@taskdesk/ui"; import { IconFunction } from "@/lib/.contrast-button-state-${process.pid}"; export function Fixture(){ return <main className="bg-card"><Button variant="ghost" className="hover:bg-accent/60 active:bg-accent/50">{IconFunction()}</Button></main>; }`,
      );
      const ancestorBackdrop = observeInheritedForegroundSurfaces(
        [helper, fixture],
        tokenNames,
      );
      assert.ok(
        ancestorBackdrop.pairs.has(
          `${foreground}|--color-accent|hover:bg-accent/60|light|backdrop:bg-card`,
        ),
      );
      assert.ok(
        ancestorBackdrop.pairs.has(
          `${foreground}|--color-accent|active:bg-accent/50|light|backdrop:bg-card`,
        ),
      );
      assert.equal(ancestorBackdrop.unresolved.size, 0);

      await writeFile(
        fixture,
        `import { Button } from "@taskdesk/ui"; import { IconFunction } from "@/lib/.contrast-button-state-${process.pid}"; export function Fixture(){ return <Button variant="ghost" className="hover:bg-accent/60 active:bg-accent/50">{IconFunction()}</Button>; }`,
      );
      const missingBackdrop = observeInheritedForegroundSurfaces(
        [helper, fixture],
        tokenNames,
      );
      assert.ok(missingBackdrop.unresolved.size > 0);
      assert.equal(
        missingBackdrop.pairs.has(
          `${foreground}|--color-accent|hover:bg-accent/60|light|backdrop:bg-background`,
        ),
        false,
      );

      await writeFile(
        fixture,
        `import { Button } from "@taskdesk/ui"; import { IconFunction } from "@/lib/.contrast-button-state-${process.pid}"; export function Fixture(){ return <main className="bg-card"><Button variant="secondary" className="bg-background bg-popover hover:bg-accent/60">{IconFunction()}</Button></main>; }`,
      );
      const ambiguousBackdrop = observeInheritedForegroundSurfaces(
        [helper, fixture],
        tokenNames,
      );
      assert.ok(ambiguousBackdrop.unresolved.size > 0);
      assert.equal(
        ambiguousBackdrop.pairs.has(
          `${foreground}|--color-accent|hover:bg-accent/60|light|backdrop:bg-background`,
        ),
        false,
      );
    } finally {
      await Promise.all(
        [helper, fixture].map((file) => rm(file, { force: true })),
      );
    }
  });

  it("binds returned helper icons to their real trigger and portal contexts, including selected state", async () => {
    const fixture = `apps/web/src/components/.contrast-helper-portal-${process.pid}.tsx`;
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
        `import { Button, HoverCardContent } from "@taskdesk/ui"; export function Fixture(){ const getStatus = () => { return { icon: <svg className="text-success-foreground" /> }; }; return <div data-task-selected={selected ? "true" : undefined} data-task-dragging={dragging ? "true" : undefined} className="bg-background data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50"><Button variant="ghost" className="bg-muted/55">{getStatus().icon}</Button><HoverCardContent>{getStatus().icon}</HoverCardContent></div>; }`,
      );
      const observed = observeInheritedForegroundSurfaces(
        [fixture],
        tokenNames,
      );
      const selectedTrigger =
        "--color-success-foreground|--color-muted|bg-muted/55|light|backdrop:data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50>bg-background";
      assert.ok(
        observed.pairs.has(selectedTrigger),
        "the translucent trigger surface is composited over the selected card state",
      );
      assert.ok(
        observed.pairs.has(
          "--color-success-foreground|--color-popover|bg-popover|light",
        ),
        "the returned icon inside portal content uses the popup surface",
      );
      const popupUses = observed.uses.occurrences
        .get("--color-success-foreground|--color-popover|bg-popover|light")
        ?.filter((item) => item.usage === fixture);
      assert.equal(popupUses.length, 1);
      assert.equal(
        popupUses[0].chain.some((item) => item.includes("task-selected")),
        false,
        "portal content does not inherit the trigger card's selected backdrop",
      );
      const selectedTriggerUses =
        observed.uses.occurrences.get(selectedTrigger);
      assert.equal(
        selectedTriggerUses.filter((item) => item.usage === fixture).length,
        1,
        "the selected-state pair is bound to this fixture's actual trigger call",
      );

      await writeFile(
        fixture,
        `import { Button } from "@taskdesk/ui"; export function Fixture(){ const getStatus = () => { return { icon: <svg className="text-success-foreground" /> }; }; return <div data-task-selected={selected ? "true" : undefined} className="bg-background data-[task-selected=true]:not-data-[task-dragging=true]:bg-accent/50"><Button variant="ghost" className="bg-muted/55">{getStatus().icon}</Button></div>; }`,
      );
      const unsupported = observeInheritedForegroundSurfaces(
        [fixture],
        tokenNames,
      );
      assert.ok(
        unsupported.unresolved.size > 0,
        "the selected backdrop stays unresolved when its negated data-state cannot be proven",
      );
      assert.equal(observed.unresolved.size, 0);
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
            usage: "fixture.tsx",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["fixture.tsx:Fixture", "jsx:p[0]>bg-card"],
            backdropLayers: [],
          },
        ],
        occurrenceIds: ["Fixture::p[0]::text-primary#0"],
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

  it("keeps occurrence summaries as ordered unique IDs without dropping detail contexts", () => {
    const key = "--color-foreground|--color-background|bg-background|light";
    const firstId = "Fixture::p[0]::text-foreground#0";
    const secondId = "Fixture::p[1]::text-foreground#0";
    const occurrences = [
      {
        id: firstId,
        usage: "fixture.tsx",
        surfaceContext: "nearest-opaque-ancestor",
        category: "body",
        chain: ["fixture.tsx:Fixture", "jsx:p[0]>bg-background"],
        backdropLayers: [],
      },
      {
        id: firstId,
        usage: "fixture.tsx",
        surfaceContext: "nearest-opaque-ancestor",
        category: "body",
        chain: ["fixture.tsx:OtherFixture", "jsx:p[0]>bg-background"],
        backdropLayers: [],
      },
      {
        id: secondId,
        usage: "fixture.tsx",
        surfaceContext: "nearest-opaque-ancestor",
        category: "body",
        chain: ["fixture.tsx:Fixture", "jsx:p[1]>bg-background"],
        backdropLayers: [],
      },
    ];
    const observed = new Set([key]);
    observed.occurrences = new Map([[key, occurrences]]);
    const makePair = (occurrenceIds) => ({
      fg: "--color-foreground",
      bg: "--color-background",
      category: "body",
      minRatio: 4.5,
      themes: ["light"],
      usage: "fixture.tsx",
      backdrop: "--color-background",
      foregroundClass: "text-foreground",
      backgroundClass: { light: "bg-background" },
      surfaceContext: "nearest-opaque-ancestor",
      occurrenceIds,
      occurrences,
    });
    const source =
      '<main className="bg-background"><p className="text-foreground">One</p><p className="text-foreground">Two</p></main>';

    assert.deepEqual(
      validatePairManifest(
        [makePair([firstId, secondId])],
        () => source,
        observed,
      ),
      [],
      "repeated detailed paint contexts collapse to one summary ID in first-seen order",
    );

    for (const summary of [
      [firstId],
      [firstId, secondId, "Fixture::p[2]::text-foreground#0"],
      [secondId, firstId],
      [firstId, firstId, secondId],
    ]) {
      assert.ok(
        validatePairManifest([makePair(summary)], () => source, observed).some(
          (failure) =>
            failure.includes(
              "occurrenceIds must match the first-seen unique IDs in occurrences",
            ),
        ),
        `rejects a missing, extra, or reordered summary: ${summary.join(", ")}`,
      );
    }
  });

  it("fails closed on missing or malformed occurrence contract arrays", () => {
    const firstId = "Fixture::p[0]::text-foreground#0";
    const occurrence = {
      id: firstId,
      usage: "fixture.tsx",
      surfaceContext: "nearest-opaque-ancestor",
      category: "body",
      chain: ["fixture.tsx:Fixture", "jsx:p[0]>bg-background"],
      backdropLayers: [],
    };
    const makePair = () => ({
      fg: "--color-foreground",
      bg: "--color-background",
      category: "body",
      minRatio: 4.5,
      themes: ["light"],
      usage: "fixture.tsx",
      backdrop: "--color-background",
      foregroundClass: "text-foreground",
      backgroundClass: { light: "bg-background" },
      surfaceContext: "nearest-opaque-ancestor",
      occurrenceIds: [firstId],
      occurrences: [occurrence],
    });
    const key = "--color-foreground|--color-background|bg-background|light";
    const observed = new Set([key]);
    observed.occurrences = new Map([[key, [occurrence]]]);
    const source =
      '<main className="bg-background"><p className="text-foreground">One</p></main>';
    const malformed = [
      ["missing summary", (pair) => delete pair.occurrenceIds],
      ["string summary", (pair) => (pair.occurrenceIds = firstId)],
      ["non-string summary item", (pair) => (pair.occurrenceIds = [1])],
      ["missing details", (pair) => delete pair.occurrences],
      ["string details", (pair) => (pair.occurrences = "not-an-array")],
      [
        "details without string IDs",
        (pair) => (pair.occurrences = [{ ...occurrence, id: 1 }]),
      ],
      [
        "details without usage",
        (pair) => {
          pair.occurrences = [{ ...occurrence }];
          delete pair.occurrences[0].usage;
        },
      ],
      [
        "unknown surface context",
        (pair) =>
          (pair.occurrences = [
            { ...occurrence, surfaceContext: "body-default" },
          ]),
      ],
      [
        "empty source chain",
        (pair) => (pair.occurrences = [{ ...occurrence, chain: [] }]),
      ],
      [
        "unexpected detail property",
        (pair) => (pair.occurrences = [{ ...occurrence, waiver: true }]),
      ],
      [
        "both arrays missing",
        (pair) => {
          delete pair.occurrenceIds;
          delete pair.occurrences;
        },
      ],
    ];

    for (const [label, mutate] of malformed) {
      const pair = makePair();
      mutate(pair);
      assert.ok(
        validatePairManifest([pair], () => source, observed).some((failure) =>
          failure.includes("well-shaped occurrence records"),
        ),
        label,
      );
    }
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
            backdropLayers: [],
          },
          {
            id: "Second::p[0]::text-primary#0",
            usage: "second.tsx",
            surfaceContext: "nearest-opaque-ancestor",
            category: "body",
            chain: ["second.tsx:Second", "jsx:p[0]>bg-card"],
            backdropLayers: [],
          },
        ],
        occurrenceIds: [
          "First::p[0]::text-primary#0",
          "Second::p[0]::text-primary#0",
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

describe("source-bound shared component paint slots", () => {
  async function inspectFixture(source, inspect) {
    const fixture = `apps/web/src/components/.contrast-slots-${process.pid}.tsx`;
    try {
      await writeFile(fixture, source);
      const result = observeInheritedForegroundSurfaces(
        [fixture],
        new Set([
          "foreground",
          "muted-foreground",
          "background",
          "card",
          "muted",
          "popover",
          "accent",
          "accent-foreground",
        ]),
      );
      inspect(result, fixture);
    } finally {
      await rm(fixture, { force: true });
    }
  }
  it("binds a main children slot without claiming the sibling rightSidebar card", async () => {
    await inspectFixture(
      'function TaskPageFrame({children,rightSidebar}) {return <main><section className="bg-background">{children}</section><aside className="bg-card">{rightSidebar}</aside></main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <TaskPageFrame rightSidebar={<span/>}><Leaf/></TaskPageFrame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-background|bg-background|light",
          ),
        );
        assert.ok(
          !result.pairs.has("--color-foreground|--color-card|bg-card|light"),
        );
        const contexts = result.uses.occurrences.get(
          "--color-foreground|--color-background|bg-background|light",
        );
        assert.ok(
          contexts.some((context) =>
            context.chain.some(
              (entry) =>
                entry.includes("component-slot:") &&
                entry.includes("TaskPageFrame.children"),
            ),
          ),
        );
      },
    );
  });
  it("measures main and rightSidebar slots independently when each actually renders text", async () => {
    await inspectFixture(
      'function TaskPageFrame({children,rightSidebar}) {return <main><section className="bg-background">{children}</section><aside className="bg-card">{rightSidebar}</aside></main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <TaskPageFrame rightSidebar={<Leaf/>}><Leaf/></TaskPageFrame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const bg of ["background", "card"])
          for (const theme of ["light", "dark"])
            assert.ok(
              result.pairs.has(
                `--color-foreground|--color-${bg}|bg-${bg}|${theme}`,
              ),
            );
      },
    );
  });
  it("traces render-prop children(visibleItemId) to the exact Sheet body", async () => {
    await inspectFixture(
      'function SheetFrame({children,visibleItemId}) {return <section className="bg-background">{visibleItemId ? children(visibleItemId) : null}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <SheetFrame>{visibleItemId=><Leaf id={visibleItemId}/>}</SheetFrame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-background|bg-background|dark",
          ),
        );
      },
    );
  });
  it("resolves heading/subtasks/relations/activity by their actual named JSX slots", async () => {
    await inspectFixture(
      'function Detail({heading,subtasks,relations,activity}) {return <main className="bg-background"><header className="bg-background">{heading}</header><section className="bg-card">{subtasks}</section><section className="bg-muted">{relations}</section><section className="bg-popover">{activity}</section></main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Detail heading={<Leaf/>} subtasks={<Leaf/>} relations={<Leaf/>} activity={<Leaf/>}/>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const bg of ["background", "card", "popover"])
          assert.ok(
            result.pairs.has(`--color-foreground|--color-${bg}|bg-${bg}|light`),
          );
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-muted|bg-muted|light|backdrop:bg-background",
          ),
        );
      },
    );
  });
  it("keeps a shared translucent CommentCard over its actual caller backdrop", async () => {
    await inspectFixture(
      'function CommentCard({children}) {return <article className="bg-card/60">{children}</article>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <main className="bg-background"><CommentCard><Leaf/></CommentCard></main>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const theme of ["light", "dark"])
          assert.ok(
            result.pairs.has(
              `--color-foreground|--color-card|bg-card/60|${theme}|backdrop:bg-background`,
            ),
          );
      },
    );
  });
  it("does not invent a surface for an unpainted slot from an opaque sibling", async () => {
    await inspectFixture(
      'function Frame({children}) {return <main><aside className="bg-card">Other</aside><section>{children}</section></main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
        assert.ok(
          !result.pairs.has("--color-foreground|--color-card|bg-card|light"),
        );
      },
    );
  });
  it("proves forwarded ContextMenu highlighted state and still refuses unknown primitives", async () => {
    await inspectFixture(
      'import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"; export function ContextMenuItem(){return <div className="bg-popover"><ContextMenuPrimitive.Item className="data-highlighted:bg-accent" {...props}><span className="text-foreground"/></ContextMenuPrimitive.Item></div>;} export function Unknown(){return <div className="bg-popover"><Mystery.Item className="data-highlighted:bg-accent" {...props}><span className="text-foreground"/></Mystery.Item></div>;}',
      (result) => {
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-accent|data-highlighted:bg-accent|light|backdrop:bg-popover",
          ),
        );
        assert.equal(result.unresolved.size, 1);
      },
    );
  });
  it("refuses a declared slot that is discarded despite an opaque sibling", async () => {
    await inspectFixture(
      'function Frame({children}) {return <main className="bg-card">Other</main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
        assert.equal(result.pairs.size, 0);
      },
    );
  });
  it("does not treat a slot used only as an event handler as rendered content", async () => {
    await inspectFixture(
      'function Frame({children}) {return <main className="bg-card" onClick={children}>Other</main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
        assert.equal(result.pairs.size, 0);
      },
    );
  });
  it("rejects a shadowed slot while tracing destructured aliases and object properties", async () => {
    await inspectFixture(
      'function Alias({children:content}) {return <main className="bg-card">{content}</main>;} function ObjectFrame(props){return <main className="bg-background">{props.children}</main>;} function Shadow({children}){return <main className="bg-card">{[1].map(children => <section>{children}</section>)}</main>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <><Alias><Leaf/></Alias><ObjectFrame><Leaf/></ObjectFrame><Shadow><Leaf/></Shadow></>;}',
      (result) => {
        // One unresolved caller invalidates the shared leaf's overall proof.
        assert.equal(result.unresolved.size, 1);
      },
    );
  });

  it("binds actual aliased Base UI item imports but refuses a forged alias or missing forwarding", async () => {
    await inspectFixture(
      'import { ContextMenu as Real } from "@base-ui/react/context-menu"; import { ContextMenu as Fake } from "unknown-library"; export function Good(){return <div className="bg-popover"><Real.Item className="data-highlighted:bg-card" {...props}><span className="text-foreground"/></Real.Item></div>;} export function Forged(){return <div className="bg-popover"><Fake.Item className="data-highlighted:bg-card" {...props}><span className="text-foreground"/></Fake.Item></div>;} export function NotForwarded(){return <div className="bg-popover"><Real.Item className="data-highlighted:bg-card"><span className="text-foreground"/></Real.Item></div>;}',
      (result) => {
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-card|data-highlighted:bg-card|light",
          ),
        );
        assert.equal(result.unresolved.size, 2);
      },
    );
  });
  it("follows split menu re-exports to the real highlighted item and popup surface", async () => {
    await inspectFixture(
      'import { MenuPopup as MenuContent, MenuItem as MenuOption } from "@taskdesk/ui"; export function Page(){return <MenuContent><MenuOption className="data-highlighted:bg-accent" {...props}><span className="text-foreground">Item</span></MenuOption></MenuContent>;} ',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-accent|data-highlighted:bg-accent|light|backdrop:bg-popover",
          ),
        );
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-popover|bg-popover|light",
          ),
        );
      },
    );
  });
  it("follows property-object spread forwarding without treating replaced children as forwarded", async () => {
    await inspectFixture(
      'function Forward(props){return <section className="bg-card" {...props}/>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Forward><Leaf/></Forward>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has("--color-foreground|--color-card|bg-card|dark"),
        );
      },
    );
    await inspectFixture(
      'function Replaced(props){return <section className="bg-card" {...props}>Other</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Replaced><Leaf/></Replaced>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
  });
  it("traces destructured aliases and property access slots to both painted branches", async () => {
    await inspectFixture(
      'function Alias({children:content}){return <section className="bg-card">{content}</section>;} function ObjectFrame(props){return <section className="bg-background">{props.children}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <><Alias><Leaf/></Alias><ObjectFrame><Leaf/></ObjectFrame></>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const bg of ["card", "background"])
          for (const theme of ["light", "dark"])
            assert.ok(
              result.pairs.has(
                `--color-foreground|--color-${bg}|bg-${bg}|${theme}`,
              ),
            );
      },
    );
  });
  it("follows a const slot alias through a returned conditional without treating condition-only references as values", async () => {
    await inspectFixture(
      'function Frame({render,enabled}){const content=enabled ? render : null; return <section className="bg-card">{content}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame render={<Leaf/>}/>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has("--color-foreground|--color-card|bg-card|light"),
        );
      },
    );
    await inspectFixture(
      'function Frame({render}){const content=render ? "Other" : null; return <section className="bg-card">{content}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame render={<Leaf/>}/>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
    await inspectFixture(
      'function Frame({render}){const content=unknownTransform(render); return <section className="bg-card">{content}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame render={<Leaf/>}/>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
  });
  it("composites a proven full-host before layer over its actual opaque surface", async () => {
    await inspectFixture(
      'function Frame({children}){return <section className="relative bg-popover before:absolute before:inset-0 before:pointer-events-none before:bg-muted/72">{children}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const theme of ["light", "dark"])
          assert.ok(
            result.pairs.has(
              `--color-foreground|--color-muted|before:bg-muted/72|${theme}|backdrop:bg-popover`,
            ),
          );
      },
    );
  });
  it("refuses an unproven decorative pseudo box instead of using it as a full text backdrop", async () => {
    await inspectFixture(
      'function Frame({children}){return <section className="bg-popover before:bg-muted/72">{children}</section>;} function Leaf(){return <p className="text-foreground">Text</p>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
  });

  it("binds descendant hover backgrounds only to the actual child host slot", async () => {
    await inspectFixture(
      'function Frame({children}){return <section className="bg-card *:data-[slot=control]:hover:bg-accent">{children}</section>;} function Leaf(){return <button data-slot="control" className="text-foreground">Text</button>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-accent|*:data-[slot=control]:hover:bg-accent|light|backdrop:bg-card",
          ),
        );
      },
    );
    await inspectFixture(
      'function Frame({children}){return <section className="bg-card *:data-[slot=control]:hover:bg-accent">{children}</section>;} function Leaf(){return <button data-slot="other" className="text-foreground">Text</button>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
  });

  it("does not apply a direct-child slot selector through an intervening DOM wrapper", async () => {
    await inspectFixture(
      'function Frame({children}){return <section className="bg-card *:data-[slot=control]:hover:bg-accent"><div>{children}</div></section>;} function Leaf(){return <button data-slot="control" className="text-foreground">Text</button>;} export function Page(){return <Frame><Leaf/></Frame>;}',
      (result) => {
        assert.equal(result.unresolved.size, 1);
      },
    );
  });
  it("measures a source-proven Base UI active tab indicator as an additional sibling backdrop", async () => {
    await inspectFixture(
      'import { Tabs as T } from "@base-ui/react/tabs"; function TabList({children,variant="default",className}){return <T.List className="relative z-0 bg-card">{children}<T.Indicator className={cn("absolute bottom-0 left-0 translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) h-(--active-tab-height) w-(--active-tab-width)",variant === "underline" ? "z-10 bg-card" : "-z-1 bg-background dark:bg-input",className)}/></T.List>;} function Leaf(){return <button data-slot="control" className="data-active:text-foreground">Text</button>;} export function Page(){return <TabList><Leaf/></TabList>;}',
      (result) => {
        assert.equal(result.unresolved.size, 0);
        for (const bg of ["card", "background"])
          assert.ok(
            result.pairs.has(`--color-foreground|--color-${bg}|bg-${bg}|light`),
          );
        assert.ok(
          result.pairs.has(
            "--color-foreground|--color-input|dark:bg-input|dark|backdrop:bg-card",
          ),
        );
        const proof = result.uses.occurrences.get(
          "--color-foreground|--color-background|bg-background|light",
        );
        assert.ok(
          proof.some((value) =>
            value.chain.some((entry) =>
              entry.startsWith("active-tab-indicator:"),
            ),
          ),
        );
      },
    );
  });

  it("refuses unknown active-indicator geometry or a dynamic presentation variant", async () => {
    const base =
      'import { Tabs as T } from "@base-ui/react/tabs"; function TabList({children,variant="default",className}){return <T.List className="relative z-0 bg-card">{children}<T.Indicator className={cn("absolute bottom-0 left-0 translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) h-(--active-tab-height) w-(--active-tab-width)",variant === "underline" ? "z-10 bg-card" : "-z-1 bg-background",className)}/></T.List>;} function Leaf(){return <button data-slot="control" className="data-active:text-foreground">Text</button>;} export function Page(){return <TabList><Leaf/></TabList>;}';
    await inspectFixture(
      base.replace("w-(--active-tab-width)", "w-4"),
      (result) => assert.equal(result.unresolved.size, 1),
    );
    await inspectFixture(
      base.replace("<TabList>", "<TabList variant={unknownVariant}>"),
      (result) => assert.equal(result.unresolved.size, 1),
    );
    await inspectFixture(
      base.replace("<TabList>", '<TabList variant="underline">'),
      (result) => {
        assert.equal(result.unresolved.size, 0);
        assert.equal(
          result.pairs.has(
            "--color-foreground|--color-background|bg-background|light",
          ),
          false,
        );
      },
    );
  });
});
