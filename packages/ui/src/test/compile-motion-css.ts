import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = resolve(here, "../styles");

/** Compile the actual motion and theme sources through the production Tailwind Vite plugin. */
export async function mountCompiledMotionStyles(
  candidates: string[],
): Promise<{ css: string; cleanup: () => void }> {
  const input = resolve(stylesDir, "__motion_test__.css");
  const source = [
    "@tailwind utilities source(none);",
    `@source inline(${JSON.stringify(candidates.join(" "))});`,
    readFileSync(resolve(stylesDir, "theme.css"), "utf8"),
    readFileSync(resolve(stylesDir, "motion.css"), "utf8"),
  ].join("\n");
  const result = await build({
    configFile: false,
    root: stylesDir,
    logLevel: "silent",
    plugins: [
      {
        name: "motion-test-source",
        resolveId(id) {
          if (id === input) return input;
        },
        load(id) {
          if (id === input) return source;
        },
      },
      ...tailwindcss(),
    ],
    build: {
      write: false,
      minify: false,
      cssMinify: true,
      rollupOptions: { input },
    },
  });
  if (!Array.isArray(result) && !("output" in result))
    throw new Error("Motion CSS build unexpectedly returned a watcher");
  const output = Array.isArray(result)
    ? result.flatMap((entry) => entry.output)
    : result.output;
  const asset = output.find(
    (entry) => entry.type === "asset" && entry.fileName.endsWith(".css"),
  );
  if (asset?.type !== "asset")
    throw new Error("Motion CSS build produced no stylesheet");
  const css =
    typeof asset.source === "string"
      ? asset.source
      : new TextDecoder().decode(asset.source);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return { css, cleanup: () => style.remove() };
}
