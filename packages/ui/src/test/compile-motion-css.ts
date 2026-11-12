import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, "../styles");
const cacheDir = resolve(here, "../../node_modules/.cache/motion-css");

const compiled = new Map<string, Promise<string>>();

/**
 * Builds the real `packages/ui/src/styles/theme.css` + `motion.css` for the given class
 * candidates through Vite with the `@tailwindcss/vite` plugin — the production CSS pipeline,
 * including the lowering of CSS nesting — using only this package's declared dependencies.
 */
function compileMotionCss(candidates: string[]): Promise<string> {
  const key = [...candidates].sort().join(" ");
  let pending = compiled.get(key);
  if (!pending) {
    pending = (async () => {
      mkdirSync(cacheDir, { recursive: true });
      const entry = resolve(
        cacheDir,
        `motion-${compiled.size}-${process.pid}.css`,
      );
      const inline = key.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
      writeFileSync(
        entry,
        [
          '@import "tailwindcss/utilities.css" source(none);',
          `@import "${resolve(stylesDir, "theme.css")}";`,
          `@import "${resolve(stylesDir, "motion.css")}";`,
          `@source inline("${inline}");`,
          "",
        ].join("\n"),
      );
      try {
        const result = await build({
          configFile: false,
          logLevel: "silent",
          root: resolve(here, "../.."),
          plugins: [tailwindcss()],
          build: {
            write: false,
            minify: false,
            cssMinify: false,
            cssTarget: "chrome100",
            rollupOptions: { input: entry },
          },
        });
        const outputs = (Array.isArray(result) ? result : [result]).flatMap(
          (item) => ("output" in item ? item.output : []),
        );
        const css = outputs
          .filter(
            (chunk) =>
              chunk.type === "asset" && chunk.fileName.endsWith(".css"),
          )
          .map((chunk) => (chunk.type === "asset" ? String(chunk.source) : ""))
          .join("\n");
        if (!css) throw new Error("Motion CSS build produced no stylesheet");
        return css;
      } finally {
        rmSync(entry, { force: true });
      }
    })();
    compiled.set(key, pending);
  }
  return pending;
}

/**
 * Mounts the compiled production motion rules so jsdom `getComputedStyle` evaluates the real
 * stylesheet rather than handwritten stubs.
 */
export async function mountCompiledMotionStyles(
  candidates: string[],
): Promise<{ css: string; cleanup: () => void }> {
  const css = await compileMotionCss(candidates);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return {
    css,
    cleanup: () => style.remove(),
  };
}
