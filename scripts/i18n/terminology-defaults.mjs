import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const destination = path.join(
  root,
  "packages/domain/src/terminology-defaults.generated.ts",
);

export async function refreshTerminologyDefaults(write = false) {
  const files = (await readdir(path.join(root, "i18n")))
    .filter((file) => /^[a-z]{2}-[A-Z]{2}\.json$/u.test(file))
    .sort();
  const defaults = {};
  for (const file of files) {
    const locale = file.slice(0, -5);
    const catalog = JSON.parse(
      await readFile(path.join(root, "i18n", file), "utf8"),
    );
    if (!catalog.term?.agent || !catalog.term?.customer)
      throw new Error(`Missing terminology defaults for ${locale}`);
    defaults[locale] = catalog.term;
  }
  const source = `// Generated from i18n/*.json term namespaces by scripts/i18n/terminology-defaults.mjs.\n// Keep API/email fallback data small and independent of browser catalog loading.\nexport const TERMINOLOGY_LOCALES = ${JSON.stringify(Object.keys(defaults))} as const;\nexport const SHIPPED_TERMINOLOGY = ${JSON.stringify(defaults, null, 2)} as const;\n`;
  const formatted = execFileSync(
    "pnpm",
    ["exec", "biome", "format", "--stdin-file-path", destination],
    {
      cwd: root,
      input: source,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (write) await writeFile(destination, formatted);
  else if ((await readFile(destination, "utf8")) !== formatted)
    throw new Error(
      "Terminology defaults are stale; run node scripts/i18n/terminology-defaults.mjs --write",
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await refreshTerminologyDefaults(process.argv.includes("--write"));
  console.log("Terminology defaults match the shipped locale catalogs.");
}
