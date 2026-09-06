import { readText } from "./repo.mjs";
import { ciCdPath } from "./security-paths.mjs";

/**
 * docs/04-engineering/ci-cd.md declares itself "the single list of CI checks". So the list
 * is read out of it rather than restated, and scripts/ci/test-all.mjs reconciles what CI
 * actually runs against what that document says it runs. A gate added to the document with
 * no implementation shows up as missing; a gate implemented with no entry in the document
 * shows up as invented. Both are reported.
 */

/**
 * The document's boxes put the command and its one-line explanation in the same cell, and
 * two rows separate them with a single space. Keep the command, drop the prose.
 */
function normaliseGate(cell) {
  const pnpm = /^pnpm\s+(\S+)(?:\s+(--\S+))?/.exec(cell);
  if (pnpm) {
    return pnpm[2] ? `pnpm ${pnpm[1]} ${pnpm[2]}` : `pnpm ${pnpm[1]}`;
  }
  if (/^helm\b/.test(cell)) {
    return "helm lint + helm template";
  }
  if (/^pr-template\b/.test(cell)) {
    return "pr-template check";
  }
  return cell.split(/\s+/)[0];
}

/** @returns {Promise<{ fast: string[], full: string[] }>} */
export async function readDeclaredGates() {
  const source = await readText(ciCdPath);
  const blocks = (source.match(/```[\s\S]*?```/g) ?? []).filter((block) =>
    block.includes("│"),
  );

  if (blocks.length < 2) {
    throw new Error(
      `Could not find the fast and full stage blocks in ${ciCdPath}. ` +
        "test:all refuses to run against an unparsed authority document.",
    );
  }

  const parse = (block) => {
    const gates = [];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("│")) {
        continue;
      }
      const body = trimmed.replace(/^│/, "").replace(/│$/, "");
      const first = body.split(/\s{2,}/)[0].trim();
      if (first === "" || /^[─│├┌└┤]+$/.test(first)) {
        continue;
      }
      gates.push(normaliseGate(first));
    }
    return gates;
  };

  return { fast: parse(blocks[0]), full: parse(blocks[1]) };
}
