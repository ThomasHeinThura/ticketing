import { existsSync, readFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import packageJson from "../../package.json";
import {
  findDeferredNamespaceUsers,
  i18nNamespaceGroups,
} from "./vite/i18n-namespace-groups";

function preloadWorkRouteForDirectVisits(): Plugin {
  return {
    name: "taskdesk:preload-work-route-for-direct-visits",
    apply: "build" as const,
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        // Matched by the module it contains: the route component shares its chunk with its
        // first-paint dependencies (the `work-route` code-splitting group).
        const routeChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith(
                  "/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx?tsr-split=component",
                ),
            ),
        );
        const html = bundle["index.html"];
        if (!routeChunk || !html || html.type !== "asset")
          throw new Error(
            "G11 work-route preload could not resolve its agent route chunk or index.html.",
          );

        const workItemsPanelChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith("/components/work-item/work-items-panel.tsx"),
            ),
        );
        if (workItemsPanelChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve the work-items panel chunk.",
          );

        const files = new Set<string>();
        const addChunkAndImports = (fileName: string) => {
          if (files.has(fileName)) return;
          files.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.imports) addChunkAndImports(imported);
        };
        addChunkAndImports(routeChunk.fileName);
        // The parent outlet must also load before this child can paint. Fetching it only
        // after session resolution adds a network round trip to the heading's LCP path.
        const projectRootChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith(
                  "/routes/agent/_layout/_authenticated/agent/projects/$projectKey.tsx?tsr-split=component",
                ),
            ),
        );
        if (projectRootChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve its parent outlet chunk.",
          );
        addChunkAndImports(projectRootChunk.fileName);
        // The restored Kaneo frame wraps the outlet. Its lazy import otherwise starts
        // after entry evaluation, serializing the frame's dependency downloads with
        // authentication and delaying the work heading's first paint.
        const projectLayoutChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith("/components/common/project-layout.tsx"),
            ),
        );
        if (projectLayoutChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve the Kaneo project frame.",
          );
        addChunkAndImports(projectLayoutChunk.fileName);
        // The authenticated shell wraps every agent screen. Its component chunk is otherwise
        // requested only after the session check resolves, a round trip queued behind the
        // route's other downloads that held back the work list's first paint (G11 LCP).
        const authenticatedShellChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith(
                  "/routes/agent/_layout/_authenticated.tsx?tsr-split=component",
                ),
            ),
        );
        if (authenticatedShellChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve the authenticated shell chunk.",
          );
        addChunkAndImports(authenticatedShellChunk.fileName);
        // Agent terminology is installed before a scoped locale is published. Its tiny
        // module otherwise starts after entry evaluation and adds a cold round trip.
        const agentTerminologyChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith("/lib/i18n/agent-translation.ts"),
            ),
        );
        if (agentTerminologyChunk?.type !== "chunk")
          throw new Error(
            "Work-route preload could not resolve agent terminology.",
          );
        addChunkAndImports(agentTerminologyChunk.fileName);
        // The panel supplies the route's first content and heading readiness
        // boundary, but is dynamically imported by beforeLoad only after the
        // route code executes. Fetch its static closure alongside the route so
        // this user-visible chunk does not begin at the end of the LCP window.
        addChunkAndImports(workItemsPanelChunk.fileName);

        // Guard for the deferred i18n namespaces (src/lib/i18n/work-route-namespaces.ts): every
        // source module the work route can paint from before the deferred group lands, that is
        // the entry and route closures plus the chunks they import dynamically, may only refer
        // to first-paint namespaces unless it is on the reviewed allowlist.
        const paintChunks = new Set<string>(files);
        const addStaticClosure = (fileName: string) => {
          if (paintChunks.has(fileName)) return;
          paintChunks.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.imports) addStaticClosure(imported);
        };
        // The entry and the layout routes the work route renders inside (shell, sidebar,
        // workspace switcher), plus whatever the route and panel import on demand.
        const shellRoutes = [
          "/routes/agent/__root.tsx",
          "/routes/agent/_layout.tsx",
          "/routes/agent/_layout/_authenticated.tsx",
        ];
        for (const item of Object.values(bundle)) {
          if (item.type !== "chunk") continue;
          const facade = item.facadeModuleId
            ?.split("?")[0]
            .replaceAll("\\", "/");
          if (
            item.isEntry ||
            shellRoutes.some((route) => facade?.endsWith(route))
          )
            addStaticClosure(item.fileName);
        }
        for (const fileName of [
          routeChunk.fileName,
          workItemsPanelChunk.fileName,
        ]) {
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.dynamicImports)
              addStaticClosure(imported);
        }
        const paintSources = new Map<string, string>();
        for (const fileName of paintChunks) {
          const chunk = bundle[fileName];
          if (chunk?.type !== "chunk") continue;
          for (const moduleId of Object.keys(chunk.modules)) {
            const file = moduleId.split("?")[0];
            // Route files in the entry chunk are stubs: their components are split into
            // chunks that only load after navigation, which the root route gates.
            const isRouteStub =
              file.includes("/src/routes/") &&
              !moduleId.includes("tsr-split=component");
            if (
              !isRouteStub &&
              file.includes("/apps/web/src/") &&
              !file.includes(".test.") &&
              existsSync(file)
            )
              paintSources.set(file, readFileSync(file, "utf8"));
          }
        }
        const catalogNamespaces = Object.keys(
          JSON.parse(
            readFileSync(
              path.resolve(__dirname, "../../i18n/en-US.json"),
              "utf8",
            ),
          ),
        );
        const deferredUsers = findDeferredNamespaceUsers(
          paintSources,
          catalogNamespaces,
        );
        if (deferredUsers.length > 0)
          throw new Error(
            "These modules can paint on the work route but use a namespace that loads after first paint:\n" +
              deferredUsers
                .map(
                  ({ file, namespace }) =>
                    `  ${path.relative(__dirname, file)} -> ${namespace}`,
                )
                .join("\n"),
          );

        // The route paints from the first-paint namespace group of its locale (see
        // `src/lib/i18n/index.ts`), not the full catalog, and reaches it through the group
        // loader table; fetch both alongside the route code.
        const localeAssets = Object.values(bundle).flatMap((item) => {
          if (item.type !== "chunk") return [];
          const locale = Object.keys(item.modules)
            .map(
              (moduleId) =>
                moduleId.match(
                  /virtual:taskdesk-i18n\/slim-([A-Za-z]{2,3}-[A-Za-z]{2,4})$/,
                )?.[1],
            )
            .find(Boolean);
          return locale ? [[locale, `/${item.fileName}`]] : [];
        });
        if (localeAssets.length === 0)
          throw new Error(
            "G11 work-route preload could not resolve locale assets.",
          );
        const slimLoaderChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId.endsWith("/src/lib/i18n/group-loaders-slim.ts"),
            ),
        );
        if (slimLoaderChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve the locale group loader.",
          );
        addChunkAndImports(slimLoaderChunk.fileName);

        // The board layout (`?layout=board`) renders from its own module graph, which `beforeLoad`
        // otherwise only requests once the entry has run; on a direct board visit start it with
        // the route's (G11 board render). Only the files the route closure does not already hold.
        const boardViewChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith("/components/work-item/work-item-board-view.tsx"),
            ),
        );
        if (boardViewChunk?.type !== "chunk")
          throw new Error(
            "G11 work-route preload could not resolve the board layout chunk.",
          );
        const boardViewFiles = new Set<string>();
        const addBoardViewChunk = (fileName: string) => {
          if (files.has(fileName) || boardViewFiles.has(fileName)) return;
          boardViewFiles.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.imports) addBoardViewChunk(imported);
        };
        addBoardViewChunk(boardViewChunk.fileName);

        const latinFontAsset = Object.values(bundle).find(
          (item) =>
            item.type === "asset" &&
            item.originalFileNames.some((file) =>
              file
                .replaceAll("\\", "/")
                .endsWith(
                  "/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
                ),
            ),
        );
        if (latinFontAsset?.type !== "asset")
          throw new Error(
            "G11 work-route preload could not resolve the Geist Latin font asset.",
          );

        const script = `(()=>{if(!/^\\/agent\\/projects\\/[^/]+\\/work\\/?$/.test(location.pathname))return;const routeFiles=${inlineScriptJson([...files].map((file) => `/${file}`))};const locales=${inlineScriptJson(Object.fromEntries(localeAssets))};const candidates=[navigator.language,navigator.languages?.[0]].filter(Boolean).map(value=>value.toLowerCase());let locale="en-US";for(const candidate of candidates){const exact=Object.keys(locales).find(value=>value.toLowerCase()===candidate);if(exact){locale=exact;break}const language=Object.keys(locales).find(value=>value.toLowerCase().split("-")[0]===candidate.split("-")[0]);if(language){locale=language;break}}const localeLink=document.createElement("link");localeLink.rel="modulepreload";localeLink.href=locales[locale];localeLink.crossOrigin="anonymous";localeLink.fetchPriority="high";document.head.append(localeLink);const fontLink=document.createElement("link");fontLink.rel="preload";fontLink.as="font";fontLink.type="font/woff2";fontLink.href=${inlineScriptJson(`/${latinFontAsset.fileName}`)};fontLink.crossOrigin="anonymous";fontLink.fetchPriority="high";document.head.append(fontLink);for(const file of routeFiles){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}if(new URLSearchParams(location.search).get("layout")!=="board")return;for(const file of ${inlineScriptJson([...boardViewFiles].map((file) => `/${file}`))}){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}})();`;
        // The legacy project board is the other measured direct-visit screen (G11 board
        // render). Its route chunk is only requested after the session resolves, so start it
        // and the full locale catalog it renders with alongside the entry instead.
        // Matched by the module it contains: rolldown 1.2.14 no longer reports this split chunk
        // as a dynamic entry with a facade module (vite 8.2.4).
        const boardRouteChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            Object.keys(item.modules).some((moduleId) =>
              moduleId
                .replaceAll("\\", "/")
                .endsWith(
                  "/dashboard/workspace/$workspaceId/project/$projectId/board.tsx?tsr-split=component",
                ),
            ),
        );
        if (boardRouteChunk?.type !== "chunk")
          throw new Error(
            "G11 board preload could not resolve its agent route chunk.",
          );
        const boardFiles = new Set<string>();
        const addBoardChunkAndImports = (fileName: string) => {
          if (boardFiles.has(fileName)) return;
          boardFiles.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.imports)
              addBoardChunkAndImports(imported);
        };
        addBoardChunkAndImports(boardRouteChunk.fileName);
        const fullLocaleAssets = Object.values(bundle).flatMap((item) => {
          if (item.type !== "chunk") return [];
          const locale = Object.keys(item.modules)
            .map(
              (moduleId) =>
                moduleId
                  .replaceAll("\\", "/")
                  .match(/\/i18n\/([A-Za-z]{2,3}-[A-Za-z]{2,4})\.json$/)?.[1],
            )
            .find(Boolean);
          return locale ? [[locale, `/${item.fileName}`]] : [];
        });
        if (fullLocaleAssets.length === 0)
          throw new Error("G11 board preload could not resolve locale assets.");
        const boardScript = `(()=>{if(!/^\\/dashboard\\/workspace\\/[^/]+\\/project\\/[^/]+\\/board\\/?$/.test(location.pathname))return;const routeFiles=${inlineScriptJson([...boardFiles].map((file) => `/${file}`))};const locales=${inlineScriptJson(Object.fromEntries(fullLocaleAssets))};const candidates=[navigator.language,navigator.languages?.[0]].filter(Boolean).map(value=>value.toLowerCase());let locale="en-US";for(const candidate of candidates){const exact=Object.keys(locales).find(value=>value.toLowerCase()===candidate);if(exact){locale=exact;break}const language=Object.keys(locales).find(value=>value.toLowerCase().split("-")[0]===candidate.split("-")[0]);if(language){locale=language;break}}for(const file of [locales[locale],...routeFiles]){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}})();`;
        const source = String(html.source);
        const head = source.match(/<head(?:\s[^>]*)?>/i)?.[0];
        if (!head)
          throw new Error(
            "G11 work-route preload could not find the agent HTML head.",
          );
        html.source = source.replace(
          head,
          `${head}<script>${script}</script><script>${boardScript}</script>`,
        );
      },
    },
  };
}

const WORK_ROUTE_PAINT_ROOT =
  /\/(?:routes\/agent\/_layout\/_authenticated\/agent\/projects\/\$projectKey\/work\.tsx\?tsr-split=component|components\/work-item\/work-(?:items-panel|item-light-list)\.tsx)$/u;

/**
 * Icons and `@taskdesk/ui` components those roots take from a package index. Their importer is
 * the index, not the root, so they are named here; a module missing from this list only costs
 * its own small request again.
 */
const WORK_ROUTE_PAINT_BARREL_MEMBERS =
  /\/(?:lucide-react\/dist\/esm\/icons\/(?:archive|calendar|calendar-clock|calendar-x|circle|circle-dashed|circle-dot|funnel|panels-top-left|rows-3|table-2)\.mjs|packages\/ui\/src\/components\/alert\.tsx)$/u;

/**
 * The `work-route` chunk: modules the work route component, the list panel or its preview
 * import directly, with their own dependencies (the group's default recursion). The roots keep
 * their chunks, so the route stays a dynamic entry of its own.
 */
function workRoutePaintDependency(
  moduleId: string,
  ctx: { getModuleInfo: (id: string) => { importers: string[] } | null },
) {
  const id = moduleId.replaceAll("\\", "/");
  if (WORK_ROUTE_PAINT_ROOT.test(id)) return null;
  if (WORK_ROUTE_PAINT_BARREL_MEMBERS.test(id)) return "work-route";
  return ctx
    .getModuleInfo(moduleId)
    ?.importers.some((importer) =>
      WORK_ROUTE_PAINT_ROOT.test(importer.replaceAll("\\", "/")),
    )
    ? "work-route"
    : null;
}

function portalModuleGraphMetadata(): Plugin {
  return {
    name: "taskdesk:portal-module-graph-metadata",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((item) => item.type === "chunk")
        .map((chunk) => ({
          file: chunk.fileName,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.keys(chunk.modules),
        }));
      this.emitFile({
        type: "asset",
        fileName: ".vite/module-graph.json",
        source: JSON.stringify({ version: 1, chunks }, null, 2),
      });
    },
  };
}

function isolatedPdfPreviewArtifacts(outputRoot: string): Plugin {
  return {
    name: "taskdesk:isolated-pdf-preview-artifacts",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(
        (item) => item.type === "chunk",
      );
      const entry = chunks.find(
        (chunk) => chunk.isEntry && chunk.name === "pdfPreview",
      );
      if (!entry)
        this.error(
          "The isolated PDF preview build must contain one viewer entry.",
        );

      const chunksByFile = new Map(
        chunks.map((chunk) => [chunk.fileName, chunk]),
      );
      const visited = new Set<string>();
      const visit = (fileName: string) => {
        if (visited.has(fileName)) return;
        if (!fileName.startsWith("assets/pdf-preview/"))
          this.error(
            `PDF preview dependency escaped its static asset prefix: ${fileName}`,
          );
        visited.add(fileName);
        const chunk = chunksByFile.get(fileName);
        if (!chunk) return;
        for (const imported of [...chunk.imports, ...chunk.dynamicImports])
          visit(imported);
        for (const moduleId of Object.keys(chunk.modules)) {
          const normalized = moduleId.replaceAll("\\", "/");
          if (
            normalized.includes("/apps/web/src/") &&
            !normalized.includes("/apps/web/src/pdf-preview/")
          ) {
            this.error(
              "The isolated PDF viewer imported application UI source.",
            );
          }
          if (
            /(?:^|\/)node_modules\/(?:react|react-dom|@tanstack\/router|i18next)(?:\/|$)/u.test(
              normalized,
            )
          ) {
            this.error(
              "The isolated PDF viewer imported app runtime dependencies.",
            );
          }
        }
      };
      visit(entry.fileName);
      if (Object.keys(bundle).some((fileName) => fileName.endsWith(".css")))
        this.error(
          "The isolated canvas-only PDF viewer must not emit application CSS.",
        );
    },
    async writeBundle(_options, bundle) {
      if (bundle["pdf-preview.html"]?.type !== "asset")
        this.error(
          "The isolated PDF build did not emit its public viewer document.",
        );
      const sourceHtml = path.join(outputRoot, "pdf-preview.html");
      const sourceAssets = path.join(outputRoot, "assets/pdf-preview");
      for (const surface of ["agent", "portal"] as const) {
        const destination = path.resolve(__dirname, "dist", surface);
        if (!existsSync(path.join(destination, "index.html")))
          throw new Error(
            `The ${surface} app must be built before copying the isolated PDF viewer.`,
          );
        await cp(sourceHtml, path.join(destination, "pdf-preview.html"));
        await cp(sourceAssets, path.join(destination, "assets/pdf-preview"), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

/**
 * JSON for a value spliced into an inline `<script>`: escapes the characters that could end the
 * element (`<`, `>`) or a JavaScript string (U+2028, U+2029). Build asset names never contain
 * them, so the emitted bytes are unchanged.
 */
function inlineScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export default defineConfig(({ mode }) => {
  const isPortal = mode === "portal";
  const isPdfPreview = mode === "pdf-preview";
  const root = isPortal ? path.resolve(__dirname, "portal") : __dirname;
  const routeTree = isPortal
    ? path.resolve(__dirname, "src/routeTree.portal.gen.ts")
    : path.resolve(__dirname, "src/routeTree.agent.gen.ts");
  const routesDirectory = path.resolve(
    __dirname,
    isPortal ? "src/routes/portal" : "src/routes/agent",
  );
  const outDir = path.resolve(
    __dirname,
    isPdfPreview ? "dist/pdf-preview" : isPortal ? "dist/portal" : "dist/agent",
  );
  const buildInput: Record<string, string> = isPdfPreview
    ? { pdfPreview: path.resolve(root, "pdf-preview.html") }
    : { index: path.resolve(root, "index.html") };

  return {
    root,
    // The visual suite starts agent and portal Vite servers in the same workspace.
    // Keep their optimizer manifests isolated so one server cannot invalidate the
    // other's optimized-dependency URLs during startup.
    cacheDir: path.resolve(
      __dirname,
      isPdfPreview
        ? "node_modules/.vite-pdf-preview"
        : isPortal
          ? "node_modules/.vite-portal"
          : "node_modules/.vite-agent",
    ),
    publicDir: isPdfPreview ? false : path.resolve(__dirname, "public"),
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    base: "/",
    plugins: isPdfPreview
      ? [isolatedPdfPreviewArtifacts(outDir)]
      : [
          tanstackRouter({
            routesDirectory,
            generatedRouteTree: routeTree,
            autoCodeSplitting: true,
            routeFileIgnorePattern: "\\.test\\.tsx?$",
          }),
          ...(!isPortal ? [preloadWorkRouteForDirectVisits()] : []),
          ...(isPortal ? [portalModuleGraphMetadata()] : []),
          i18nNamespaceGroups({
            i18nDir: path.resolve(__dirname, "../../i18n"),
            groupedEntry: !isPortal,
          }),
          tailwindcss(),
          react(),
          babel({ presets: [reactCompilerPreset()] }),
        ],
    server: {
      host: true,
      hmr: true,
      port: isPortal ? 5174 : 5173,
    },
    optimizeDeps: {
      entries: [
        "index.html",
        isPortal
          ? "../src/routes/portal/**/*.tsx"
          : "src/routes/agent/**/*.tsx",
      ],
      exclude: ["better-auth"],
    },
    ssr: {
      noExternal: ["better-auth"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@i18n": path.resolve(__dirname, "../../i18n"),
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      sourcemap: isPdfPreview ? false : "hidden",
      rolldownOptions: {
        input: buildInput,
        output: {
          entryFileNames: (chunk) =>
            isPdfPreview ||
            chunk.name === "pdfPreview" ||
            chunk.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith("/src/pdf-preview/viewer.ts")
              ? "assets/pdf-preview/viewer-[hash].js"
              : isPdfPreview
                ? "assets/pdf-preview/[name]-[hash].js"
                : "assets/[name]-[hash].js",
          chunkFileNames: (chunk) =>
            isPdfPreview || chunk.name.startsWith("pdf-preview")
              ? "assets/pdf-preview/[name]-[hash].js"
              : "assets/[name]-[hash].js",
          assetFileNames: (asset) =>
            asset.name?.includes("pdf.worker")
              ? "assets/pdf-preview/pdf.worker-[hash][extname]"
              : isPdfPreview
                ? "assets/pdf-preview/[name]-[hash][extname]"
                : "assets/[name]-[hash][extname]",
          ...(!isPdfPreview
            ? {
                codeSplitting: {
                  groups: [
                    {
                      name: isPortal
                        ? "portal-initial-runtime"
                        : "agent-initial-runtime",
                      tags: ["$initial"],
                      // Keep shared bootstrap modules in the initial graph before the frame
                      // group captures its remaining static dependencies below.
                      priority: 2,
                      maxSize: 1_000_000,
                    },
                    ...(!isPortal
                      ? [
                          {
                            // Dozens of small frame imports otherwise queue ahead of locale
                            // bootstrap on a cold connection. Preserve the same module graph
                            // and execution order while fetching that closure in one group.
                            name: "project-layout",
                            test: /\/src\/components\/common\/project-layout\.tsx$/u,
                            priority: 1,
                            maxSize: 1_000_000,
                          },
                          {
                            // The work list's panel and the first-viewport preview it paints
                            // from (G11 work-list LCP) are HTML-preloaded on a direct visit;
                            // as a dozen sub-kilobyte chunks they queued behind the entry for
                            // a round trip each. Fetch the panel and its preview as one request.
                            // Only these two modules: their shared dependencies (query hooks,
                            // icons, `@taskdesk/ui`) stay in their own chunks, so the toolbar and
                            // the create dialog never wait for the list's code.
                            name: "work-items-panel",
                            test: /\/src\/components\/work-item\/work-(?:items-panel|item-light-list)\.tsx$/u,
                            includeDependenciesRecursively: false,
                            priority: 1,
                            maxSize: 1_000_000,
                          },
                          {
                            // The static dependencies of the route's and the panel's first paint:
                            // icons, query hooks and skeletons that were two dozen sub-kilobyte
                            // chunks, each queued for a round trip behind the entry on a direct
                            // visit (G11 work-list LCP). The route component, the panel and its
                            // preview keep their own chunks, so nothing here is the list's code.
                            name: workRoutePaintDependency,
                            debugName: "work-route",
                            priority: 1,
                            maxSize: 1_000_000,
                          },
                          {
                            // Toolbar permissions, dialog primitives and the detail shell must
                            // not wait for the list panel. Warm the shell with the row controls;
                            // its data-heavy body remains a separate lazy module.
                            name: "work-item-shared-controls",
                            test: /\/src\/(?:hooks\/use-workspace-permission\.ts|components\/work-item\/(?:work-item-create-dialog-shell|work-item-side-pane)\.tsx|components\/kanban-board\/task-card-keyboard-sensor\.ts)$/u,
                            priority: 1,
                          },
                          {
                            // Fetch the grouped list and its drag window together instead of queuing
                            // dozens of small preload links before its interactive rows can mount.
                            name: "work-item-list-interactions",
                            test: /\/src\/components\/work-item\/(?:work-item-kaneo-list|virtualization\/virtualized-sortable-list)\.tsx$/u,
                            includeDependenciesRecursively: false,
                            priority: 1,
                          },
                        ]
                      : []),
                  ],
                },
              }
            : {}),
          strictExecutionOrder: true,
        },
      },
      commonjsOptions: {
        include: [/better-auth/, /node_modules/],
        transformMixedEsModules: true,
      },
      target: "esnext",
    },
  };
});
