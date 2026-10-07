import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_G11_DIAGNOSTICS = Object.freeze({
  lcp: "G11: work-list LCP",
  board: "G11: board render, 200 tasks",
});

export function countG11Diagnostics(output) {
  return Object.fromEntries(
    Object.entries(EXPECTED_G11_DIAGNOSTICS).map(([key, title]) => [
      key,
      output.split(title).length - 1,
    ]),
  );
}

export function requireExactlyOneOfEach(counts) {
  const problems = Object.entries(EXPECTED_G11_DIAGNOSTICS)
    .filter(([key]) => counts[key] !== 1)
    .map(([key, title]) => `${title}: expected 1, got ${counts[key] ?? 0}`);
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
}

export async function readMetadataValue(file, key) {
  const contents = await readFile(file, "utf8");
  const matches = contents
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${key}=`));
  if (matches.length !== 1 || matches[0].length === key.length + 1) {
    throw new Error(
      `Expected exactly one non-empty ${key} metadata field in ${file}`,
    );
  }
  return matches[0].slice(key.length + 1);
}

async function main(args) {
  const [command, ...values] = args;
  if (command === "count-tests" && values.length === 1) {
    const output = await readFile(values[0], "utf8");
    const counts = countG11Diagnostics(output);
    process.stdout.write(
      `lcp_count=${counts.lcp}\nboard_count=${counts.board}\n`,
    );
    requireExactlyOneOfEach(counts);
    return;
  }
  if (command === "metadata" && values.length === 2) {
    process.stdout.write(await readMetadataValue(values[0], values[1]));
    return;
  }
  if (command === "cpu-model" && values.length === 1) {
    const contents = await readFile(values[0], "utf8");
    const match = contents.match(/^(?:model name|Hardware)\s*:\s*(.+)$/m);
    if (match) process.stdout.write(match[1]);
    return;
  }
  throw new Error(
    "Usage: diagnostic-g11-ab-utils.mjs count-tests <file> | metadata <file> <key> | cpu-model <file>",
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
