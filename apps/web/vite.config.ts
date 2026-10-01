import path from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import packageJson from "../../package.json";

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

        const files = new Set<string>();
        const addChunkAndImports = (fileName: string) => {
          if (files.has(fileName)) return;
          files.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk")
            for (const imported of chunk.imports) addChunkAndImports(imported);
        };
        addChunkAndImports(routeChunk.fileName);

        const localeAssets = Object.values(bundle).flatMap((item) => {
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
        if (localeAssets.length === 0)
          throw new Error(
            "G11 work-route preload could not resolve locale assets.",
          );

        const script = `(()=>{if(!/^\\/agent\\/projects\\/[^/]+\\/work\\/?$/.test(location.pathname))return;const routeFiles=${JSON.stringify([...files].map((file) => `/${file}`))};const locales=${JSON.stringify(Object.fromEntries(localeAssets))};const candidates=[navigator.language,navigator.languages?.[0]].filter(Boolean).map(value=>value.toLowerCase());let locale="en-US";for(const candidate of candidates){const exact=Object.keys(locales).find(value=>value.toLowerCase()===candidate);if(exact){locale=exact;break}const language=Object.keys(locales).find(value=>value.toLowerCase().split("-")[0]===candidate.split("-")[0]);if(language){locale=language;break}}for(const file of routeFiles){const link=document.createElement("link");link.rel="modulepreload";link.href=file;link.crossOrigin="anonymous";document.head.append(link)}const localeLink=document.createElement("link");localeLink.rel="modulepreload";localeLink.href=locales[locale];localeLink.crossOrigin="anonymous";localeLink.fetchPriority="high";document.head.append(localeLink)})();`;
        const source = String(html.source);
        const head = source.match(/<head(?:\s[^>]*)?>/i)?.[0];
        if (!head)
          throw new Error(
            "G11 work-route preload could not find the agent HTML head.",
          );
        html.source = source.replace(head, `${head}<script>${script}</script>`);
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
            groups: isPortal
              ? []
              : [
                  {
                    name: "agent-initial-runtime",
                    tags: ["$initial"],
                    maxSize: 1_000_000,
                  },
                ],
          },
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
