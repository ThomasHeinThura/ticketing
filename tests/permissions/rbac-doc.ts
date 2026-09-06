/**
 * `docs/01-architecture/rbac.md`, parsed.
 *
 * rbac.md is the single authoritative home for capabilities and policy kinds (AGENTS.md
 * do-not 11), and its built-in-role table "is the seed data and the permission-matrix
 * fixture". Parsing it here is what makes "add it there first, in the same change" a build
 * failure rather than a sentence.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RBAC_PATH = fileURLToPath(
  new URL("../../docs/01-architecture/rbac.md", import.meta.url),
);

const RBAC = readFileSync(RBAC_PATH, "utf8");

function tableRowsAfter(heading: string): string[][] {
  const start = RBAC.indexOf(heading);
  if (start === -1) throw new Error(`rbac.md no longer contains: ${heading}`);
  const lines = RBAC.slice(start).split("\n");
  const rows: string[][] = [];
  let seenSeparator = false;
  for (const line of lines.slice(1)) {
    if (!line.startsWith("|")) {
      if (rows.length > 0 || seenSeparator) break;
      continue;
    }
    const cells = line
      .slice(1, line.lastIndexOf("|"))
      .split("|")
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) {
      seenSeparator = true;
      continue;
    }
    if (!seenSeparator) continue;
    rows.push(cells);
  }
  return rows;
}

export type DocumentedCapability = {
  readonly name: string;
  readonly group: string;
  readonly implies: readonly string[];
  readonly description: string;
};

/** The capability table: `| Group | Capability | Implies | Description |`. */
export function documentedCapabilities(): DocumentedCapability[] {
  const rows = tableRowsAfter("| Group | Capability | Implies | Description |");
  const capabilities: DocumentedCapability[] = [];
  let group = "";
  for (const row of rows) {
    const [
      groupCell = "",
      nameCell = "",
      impliesCell = "",
      descriptionCell = "",
    ] = row;
    if (groupCell !== "") group = groupCell.replace(/\*\*/g, "");
    capabilities.push({
      name: unquote(nameCell),
      group,
      implies: impliesCell
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "")
        .map((entry) =>
          entry.startsWith("every") ? "instance:*" : unquote(entry),
        ),
      description: descriptionCell.replace(/`/g, ""),
    });
  }
  return capabilities;
}

export type DocumentedRole = {
  readonly key: string;
  readonly rank: number;
  readonly capabilityExpression: string;
};

/** The built-in role table: `| Key | Rank | Intent | Capabilities |`. */
export function documentedRoles(): DocumentedRole[] {
  return tableRowsAfter("| Key | Rank | Intent | Capabilities |").map((row) => {
    const [keyCell = "", rankCell = "", , capabilitiesCell = ""] = row;
    return {
      key: unquote(keyCell),
      rank: Number(rankCell),
      capabilityExpression: capabilitiesCell,
    };
  });
}

/**
 * Resolve the shorthand the role table is written in — "every capability except `instance:*`",
 * "as `owner` minus `workspace:delete`", "all `work_item:*`" — into a concrete set.
 */
export function resolveRoleCapabilities(
  expression: string,
  allCapabilities: readonly string[],
  resolved: ReadonlyMap<string, readonly string[]>,
): string[] {
  const collected = new Set<string>();
  const removed = new Set<string>();

  // "and nothing else, ever" and similar trailing prose carry no capabilities.
  const body = expression.split(" — ")[0] ?? "";

  for (const rawTerm of body.split(",")) {
    const term = rawTerm.trim();
    if (term === "") continue;

    const everyExcept = term.match(/^every capability except\s+`([^`]+)`$/);
    if (everyExcept?.[1] !== undefined) {
      const prefix = everyExcept[1].replace(/\*$/, "");
      for (const capability of allCapabilities) {
        if (!capability.startsWith(prefix)) collected.add(capability);
      }
      continue;
    }

    const asRoleMinus = term.match(/^as\s+`([^`]+)`\s+minus\s+`([^`]+)`$/);
    if (asRoleMinus?.[1] !== undefined && asRoleMinus[2] !== undefined) {
      for (const capability of resolved.get(asRoleMinus[1]) ?? []) {
        collected.add(capability);
      }
      removed.add(asRoleMinus[2]);
      continue;
    }

    const allWithPrefix = term.match(/^all\s+`([^`]+)\*`$/);
    if (allWithPrefix?.[1] !== undefined) {
      const prefix = allWithPrefix[1];
      for (const capability of allCapabilities) {
        if (capability.startsWith(prefix)) collected.add(capability);
      }
      continue;
    }

    const plain = term.match(/^`([^`]+)`$/);
    if (plain?.[1] !== undefined) {
      collected.add(plain[1]);
      continue;
    }

    throw new Error(
      `rbac.md's role table uses a phrase this parser does not understand: "${term}". Either write it as a capability list, or teach tests/permissions/rbac-doc.ts the new shorthand — do not let it be silently ignored.`,
    );
  }

  for (const capability of removed) collected.delete(capability);
  return [...collected];
}

/** Route keys named in the single elevated-action table. */
export function documentedElevatedRoutes(): string[] {
  const start = RBAC.indexOf("## Elevated and audited actions");
  if (start === -1) {
    throw new Error("rbac.md no longer has the elevated-action table");
  }
  const section = RBAC.slice(start, RBAC.indexOf("\n## ", start + 1));
  const routes = new Set<string>();
  for (const match of section.matchAll(
    /`(GET|POST|PUT|PATCH|DELETE)\s+(\/[^`\s]*)`/g,
  )) {
    routes.add(`${match[1]} ${match[2]}`);
  }

  // `POST/PATCH /api/instance/plugins/{id}` — one cell naming two methods.
  for (const match of section.matchAll(
    /`(GET|POST|PUT|PATCH|DELETE)\/(GET|POST|PUT|PATCH|DELETE)\s+(\/[^`\s]*)`/g,
  )) {
    routes.add(`${match[1]} ${match[3]}`);
    routes.add(`${match[2]} ${match[3]}`);
  }
  return [...routes].sort();
}

function unquote(cell: string): string {
  return cell.replace(/`/g, "").replace(/\*\*/g, "").trim();
}
