/**
 * Mapping proposals for Jira / JSM facets. Proposals only: the operator confirms or edits each
 * one, and anything not proposed stays unmapped and blocks the import (never guessed).
 */
import type {
  DiscoveredFacet,
  ProposalContext,
  ProposedMapping,
  StateGroup,
} from "../../engine/adapter";
import { CATEGORY_NAMES } from "./normalize";

const norm = (value: string) => value.toLowerCase().replace(/[‘’]/gu, "'");

/** Resolutions that mean "closed without doing it". Everything else in Done is `completed`. */
const CANCELLED_RESOLUTIONS = new Set([
  "won't do",
  "wont do",
  "won't fix",
  "wont fix",
  "duplicate",
  "cancelled",
  "canceled",
  "declined",
  "rejected",
  "invalid",
  "obsolete",
  "cannot reproduce",
  "not a bug",
]);
const CANCELLED_STATUS =
  /\b(?:cancel+ed|rejected|declined|won'?t|duplicate|obsolete|abandoned)\b/iu;
const BACKLOG_STATUS = /\b(?:backlog|icebox|triage|inbox)\b/iu;

export function isCancelledResolution(resolution: string): boolean {
  return CANCELLED_RESOLUTIONS.has(norm(resolution).trim());
}

/** Label format written by the normaliser: `<category> · <resolution?>`. */
function parseStateLabel(
  label: string | undefined,
): { category: string; resolution?: string } | null {
  if (!label) return null;
  const separator = label.indexOf(" · ");
  const category = separator === -1 ? label : label.slice(0, separator);
  if (!CATEGORY_NAMES.includes(category)) return null;
  return separator === -1
    ? { category }
    : { category, resolution: label.slice(separator + 3) };
}

export function proposeState(
  facet: DiscoveredFacet,
): ProposedMapping | undefined {
  const parsed = parseStateLabel(facet.label);
  let group: StateGroup | undefined;
  let confidence: "exact" | "heuristic" = "heuristic";
  if (parsed) {
    if (parsed.category === "Done") {
      const cancelled =
        (parsed.resolution && isCancelledResolution(parsed.resolution)) ||
        CANCELLED_STATUS.test(facet.value);
      group = cancelled ? "cancelled" : "completed";
      confidence = cancelled ? "heuristic" : "exact";
    } else if (parsed.category === "In Progress") {
      group = "started";
      confidence = "exact";
    } else if (parsed.category === "To Do") {
      group = BACKLOG_STATUS.test(facet.value) ? "backlog" : "unstarted";
      confidence = group === "unstarted" ? "exact" : "heuristic";
    }
  }
  if (!group) return undefined; // no category: never guess
  return {
    domain: "state",
    value: facet.value,
    target: { kind: "group", group },
    confidence,
  };
}

const PRIORITY: Record<string, "low" | "medium" | "high" | "urgent"> = {
  highest: "urgent",
  blocker: "urgent",
  critical: "urgent",
  urgent: "urgent",
  high: "high",
  major: "high",
  medium: "medium",
  normal: "medium",
  low: "low",
  minor: "low",
  lowest: "low",
  trivial: "low",
};

export function proposePriority(
  facet: DiscoveredFacet,
): ProposedMapping | undefined {
  const value = PRIORITY[norm(facet.value).trim()];
  return value
    ? {
        domain: "priority",
        value: facet.value,
        target: { kind: "priority", value },
        confidence: "exact",
      }
    : undefined;
}

export function proposeType(
  facet: DiscoveredFacet,
  context: ProposalContext,
): ProposedMapping | undefined {
  const key = norm(facet.value)
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  const id =
    context.typeIdsByKey.get(key) ??
    context.typeIdsByKey.get(key.replace(/-/gu, ""));
  return id
    ? {
        domain: "type",
        value: facet.value,
        target: { kind: "target", id },
        confidence: "exact",
      }
    : undefined;
}

export function proposePerson(
  facet: DiscoveredFacet,
  context: ProposalContext,
): ProposedMapping {
  const id = context.peopleByEmail.get(facet.value.toLowerCase());
  return {
    domain: "person",
    value: facet.value,
    target: id ? { kind: "target", id } : { kind: "placeholder" },
    confidence: id ? "exact" : "heuristic",
  };
}

export function proposeAll(
  facets: DiscoveredFacet[],
  context: ProposalContext,
): ProposedMapping[] {
  const out: ProposedMapping[] = [];
  for (const facet of facets) {
    const proposal =
      facet.domain === "state"
        ? proposeState(facet)
        : facet.domain === "priority"
          ? proposePriority(facet)
          : facet.domain === "type"
            ? proposeType(facet, context)
            : facet.domain === "person"
              ? proposePerson(facet, context)
              : undefined;
    if (proposal) out.push(proposal);
  }
  return out;
}
