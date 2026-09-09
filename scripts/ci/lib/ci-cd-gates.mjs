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

/**
 * The two stage headings, in the order they must appear. A block is attributed to
 * whichever of these headings is the NEAREST one preceding it in the document — never to
 * its raw position among all `│`-containing blocks. Document position is a proxy for
 * "which heading this sits under"; reordering the two blocks, or inserting a third
 * `│`-containing block anywhere earlier in the document, used to swap or corrupt the
 * result silently. Anchoring to the heading text itself removes the proxy.
 */
const STAGES = [
  { stage: "fast", heading: /^\*\*Fast\b/m },
  { stage: "full", heading: /^\*\*Full\b/m },
];

/** @returns {Promise<{ fast: string[], full: string[] }>} */
export async function readDeclaredGates() {
  const source = await readText(ciCdPath);

  // Every stage heading's position, so a block can be attributed to whichever one comes
  // immediately before it — not to array order.
  const headings = [];
  for (const { stage, heading } of STAGES) {
    const match = heading.exec(source);
    if (!match) {
      throw new Error(
        `Could not find a "${stage}" stage heading (matching ${heading}) in ${ciCdPath}. ` +
          "test:all refuses to attribute gates to a stage it cannot locate.",
      );
    }
    headings.push({ stage, index: match.index });
  }

  // Every `│`-containing fenced block, with its position, so it can be matched to the
  // nearest heading above it rather than to its index among these blocks.
  const blocks = [];
  for (const match of source.matchAll(/```[\s\S]*?```/g)) {
    if (match[0].includes("│")) {
      blocks.push({ text: match[0], index: match.index });
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      `Could not find any \`│\`-containing fenced block in ${ciCdPath}. ` +
        "test:all refuses to run against an unparsed authority document.",
    );
  }

  const attributed = new Map(); // stage -> block text
  for (const block of blocks) {
    const preceding = headings
      .filter((heading) => heading.index < block.index)
      .sort((a, b) => b.index - a.index);
    const nearest = preceding[0];

    if (!nearest) {
      throw new Error(
        `Found a \`│\`-containing block in ${ciCdPath} before any stage heading. I could ` +
          "not determine which stage it belongs to, and test:all refuses to guess by " +
          "falling back to document position.",
      );
    }
    if (attributed.has(nearest.stage)) {
      throw new Error(
        `Two \`│\`-containing blocks in ${ciCdPath} both sit nearest the "${nearest.stage}" ` +
          "heading, with no other stage heading between them. I could not tell which one " +
          "is authoritative for that stage, and test:all refuses to guess by falling back " +
          "to document position.",
      );
    }
    attributed.set(nearest.stage, block.text);
  }

  for (const { stage } of STAGES) {
    if (!attributed.has(stage)) {
      throw new Error(
        `Found no \`│\`-containing block under the "${stage}" heading in ${ciCdPath}. ` +
          "test:all refuses to run against an unparsed authority document.",
      );
    }
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

  return {
    fast: parse(attributed.get("fast")),
    full: parse(attributed.get("full")),
  };
}
