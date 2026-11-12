import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface TailwindCompiler {
  build: (candidates: string[]) => string;
}

interface TailwindModule {
  compile: (
    css: string,
    options: {
      base: string;
      loadStylesheet: (
        id: string,
        base: string,
      ) => Promise<{ path: string; base: string; content: string }>;
    },
  ) => Promise<TailwindCompiler>;
}

interface LightningCssModule {
  transform: (options: {
    filename: string;
    code: Uint8Array;
    targets: { chrome: number };
  }) => { code: Uint8Array };
}

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, "../styles");
const uiRequire = createRequire(resolve(here, "../../package.json"));
const twViteRequire = createRequire(uiRequire.resolve("@tailwindcss/vite"));
const { compile } = twViteRequire("tailwindcss") as TailwindModule;
const twNodeRequire = createRequire(twViteRequire.resolve("@tailwindcss/node"));
const lightningcss = twNodeRequire("lightningcss") as LightningCssModule;

let cachedCompilerPromise: Promise<TailwindCompiler> | null = null;

function getMotionCompiler(): Promise<TailwindCompiler> {
  if (!cachedCompilerPromise) {
    cachedCompilerPromise = compile(
      '@import "tailwindcss/utilities.css";\n@import "./theme.css";\n@import "./motion.css";',
      {
        base: stylesDir,
        loadStylesheet: async (id: string, base: string) => {
          const sheetPath = id.startsWith("tailwindcss/")
            ? twViteRequire.resolve(id)
            : resolve(base, id);
          return {
            path: sheetPath,
            base: dirname(sheetPath),
            content: readFileSync(sheetPath, "utf8"),
          };
        },
      },
    );
  }
  return cachedCompilerPromise;
}

/**
 * Compiles the real `packages/ui/src/styles/theme.css` + `motion.css` through Tailwind v4
 * and flattens CSS nesting with LightningCSS (matching `@tailwindcss/vite`'s build pipeline)
 * so jsdom `getComputedStyle` evaluates production rules rather than handwritten stubs.
 */
export async function mountCompiledMotionStyles(
  candidates: string[],
): Promise<{ css: string; cleanup: () => void }> {
  const compiler = await getMotionCompiler();
  const rawCss = compiler.build(candidates);
  const { code } = lightningcss.transform({
    filename: "motion.css",
    code: new TextEncoder().encode(rawCss),
    targets: { chrome: 100 << 16 },
  });
  const css = new TextDecoder().decode(code);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return {
    css,
    cleanup: () => style.remove(),
  };
}
