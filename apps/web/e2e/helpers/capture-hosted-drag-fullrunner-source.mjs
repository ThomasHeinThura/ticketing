import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULLRUNNER_RESULT_DIRECTORY } from "./hosted-drag-fullrunner-evidence.mjs";
import { collectHostedDragSourceBinding } from "./hosted-drag-fullrunner-source.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const BINDING_PATH = path.join(
  FULLRUNNER_RESULT_DIRECTORY,
  "source-build-binding.json",
);

await mkdir(FULLRUNNER_RESULT_DIRECTORY, { recursive: true, mode: 0o700 });
await chmod(FULLRUNNER_RESULT_DIRECTORY, 0o700);
const binding = await collectHostedDragSourceBinding(ROOT);
if (!binding.buildManifestSha256)
  throw new Error("The built web manifest is unavailable before measurement.");
await writeFile(
  BINDING_PATH,
  `${JSON.stringify({ schemaVersion: 1, diagnosticOnly: true, ...binding })}\n`,
  { encoding: "utf8", flag: "w", mode: 0o600 },
);
await chmod(BINDING_PATH, 0o600);
process.stdout.write(
  `Bound pre-measurement source and build hashes: ${binding.buildManifestSha256}\n`,
);
