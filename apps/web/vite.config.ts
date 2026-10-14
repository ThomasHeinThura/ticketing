import { existsSync, readFileSync } from "node:fs";
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
        const routeChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.isDynamicEntry &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith(
                "/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx?tsr-split=component",
              ) === true,
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

        const script = `(()=>{if(!/^\\/agent\\/projects\\/[^/]+\\/work\\/?$/.test(location.pathname))return;const routeFiles=${JSON.stringify([...files].map((file) => `/${file}`))};const locales=${JSON.stringify(Object.fromEntries(localeAssets))};const candidates=[navigator.language,navigator.languages?.[0]].filter(Boolean).map(value=>value.toLowerCase());let locale="en-US";for(const candidate of candidates){const exact=Object.keys(locales).find(value=>value.toLowerCase()===candidate);if(exact){locale=exact;break}const language=Object.keys(locales).find(value=>value.toLowerCase().split("-")[0]===candidate.split("-")[0]);if(language){locale=language;break}}const localeLink=document.createElement("link");localeLink.rel="modulepreload";localeLink.href=locales[locale];localeLink.crossOrigin="anonymous";localeLink.fetchPriority="high";document.head.append(localeLink);const fontLink=document.createElement("link");fontLink.rel="preload";fontLink.as="font";fontLink.type="font/woff2";fontLink.href=${JSON.stringify(`/${latinFontAsset.fileName}`)};fontLink.crossOrigin="anonymous";fontLink.fetchPriority="high";document.head.append(fontLink);for(const file of routeFiles){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}})();`;
        // The legacy project board is the other measured direct-visit screen (G11 board
        // render). Its route chunk is only requested after the session resolves, so start it
        // and the full locale catalog it renders with alongside the entry instead.
        const boardRouteChunk = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.isDynamicEntry &&
            item.facadeModuleId
              ?.replaceAll("\\", "/")
              .endsWith(
                "/dashboard/workspace/$workspaceId/project/$projectId/board.tsx?tsr-split=component",
              ) === true,
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
        const boardScript = `(()=>{if(!/^\\/dashboard\\/workspace\\/[^/]+\\/project\\/[^/]+\\/board\\/?$/.test(location.pathname))return;const routeFiles=${JSON.stringify([...boardFiles].map((file) => `/${file}`))};const locales=${JSON.stringify(Object.fromEntries(fullLocaleAssets))};const candidates=[navigator.language,navigator.languages?.[0]].filter(Boolean).map(value=>value.toLowerCase());let locale="en-US";for(const candidate of candidates){const exact=Object.keys(locales).find(value=>value.toLowerCase()===candidate);if(exact){locale=exact;break}const language=Object.keys(locales).find(value=>value.toLowerCase().split("-")[0]===candidate.split("-")[0]);if(language){locale=language;break}}for(const file of [locales[locale],...routeFiles]){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}})();`;
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

export default defineConfig(({ mode }) => {
  const isPortal = mode === "portal";
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
    isPortal ? "dist/portal" : "dist/agent",
  );

  return {
    root,
    // The visual suite starts agent and portal Vite servers in the same workspace.
    // Keep their optimizer manifests isolated so one server cannot invalidate the
    // other's optimized-dependency URLs during startup.
    cacheDir: path.resolve(
      __dirname,
      isPortal ? "node_modules/.vite-portal" : "node_modules/.vite-agent",
    ),
    publicDir: path.resolve(__dirname, "public"),
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
    base: "/",
    plugins: [
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
      sourcemap: "hidden",
      rolldownOptions: {
        input: path.resolve(root, "index.html"),
        output: {
          codeSplitting: {
            groups: [
              {
                name: isPortal
                  ? "portal-initial-runtime"
                  : "agent-initial-runtime",
                tags: ["$initial"],
                maxSize: 1_000_000,
              },
            ],
          },
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
