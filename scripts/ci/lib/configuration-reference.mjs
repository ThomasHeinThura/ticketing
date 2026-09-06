import path from "node:path";
import { readText, repoRoot } from "./repo.mjs";

/**
 * docs/05-operations/configuration-reference.md is the single authoritative home for
 * environment variables (AGENTS.md rule 2, CLAUDE.md's identifier-authority table).
 * check:env derives its approved set from that document rather than restating it, so the
 * document cannot drift away from the gate that enforces it.
 */
export const configurationReferencePath = path.join(
  repoRoot,
  "docs/05-operations/configuration-reference.md",
);

const NAME = /^[A-Z][A-Z0-9_]+$/;

function cells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return null;
  }
  const parts = trimmed
    .slice(1, trimmed.endsWith("|") ? -1 : undefined)
    .split("|");
  return parts.map((part) => part.trim());
}

function namesIn(cell) {
  const found = [];
  for (const match of cell.matchAll(/`([^`]+)`/g)) {
    if (NAME.test(match[1])) {
      found.push(match[1]);
    }
  }
  return found;
}

/**
 * @returns {Promise<{
 *   required: Set<string>,
 *   optional: Set<string>,
 *   postgresImage: Set<string>,
 *   notReadByApplication: Map<string, string>,
 * }>}
 */
export async function readConfigurationReference() {
  const source = await readText(configurationReferencePath);
  const sections = {
    Required: new Set(),
    Optional: new Set(),
    "Postgres container": new Set(),
  };
  const notReadByApplication = new Map();

  let heading = "";
  for (const line of source.split("\n")) {
    const isHeading = /^#{2,4}\s+/.test(line);
    if (isHeading) {
      heading = line.replace(/^#{2,4}\s+/, "").trim();
      continue;
    }

    const row = cells(line);
    if (!row || row.length < 2 || /^-+$/.test(row[0].replace(/[\s:]/g, ""))) {
      continue;
    }

    const names = namesIn(row[0]);
    if (names.length === 0) {
      continue;
    }

    if (heading in sections) {
      for (const name of names) {
        sections[heading].add(name);
      }
      continue;
    }

    if (heading === "Variables the application does not read") {
      for (const name of names) {
        notReadByApplication.set(name, row[1]);
      }
    }
  }

  const required = sections.Required;
  const optional = sections.Optional;
  const postgresImage = sections["Postgres container"];

  if (required.size === 0 || optional.size === 0) {
    throw new Error(
      `Could not parse the bootstrap tables in ${configurationReferencePath}. ` +
        "check:env refuses to run against an unparsed authority document.",
    );
  }

  return { required, optional, postgresImage, notReadByApplication };
}
