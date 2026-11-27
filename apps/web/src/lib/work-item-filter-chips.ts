import type { WorkItemFilter } from "@/lib/work-item-filter";
import { FILTER_FIELDS } from "@/lib/work-item-filter-fields";

export type FilterLeaf = Extract<WorkItemFilter, { field: string }>;

const KNOWN_FIELDS = new Set(FILTER_FIELDS.map((field) => field.id));

/**
 * The chips of a filter: one per leaf when it is a single leaf or one flat AND of leaves on
 * known fields, `[]` when there is no filter, and `null` when it is anything else (OR, nested
 * groups, fields the table does not list). A `null` filter stays editable in the Advanced editor.
 */
export function toChips(
  filter: WorkItemFilter | undefined,
): FilterLeaf[] | null {
  if (!filter) return [];
  const leaves: WorkItemFilter[] =
    "clauses" in filter
      ? filter.op === "and"
        ? filter.clauses
        : []
      : [filter];
  if (!leaves.length) return null;
  const chips: FilterLeaf[] = [];
  for (const leaf of leaves) {
    if ("clauses" in leaf || !KNOWN_FIELDS.has(leaf.field)) return null;
    chips.push(leaf);
  }
  return chips;
}

/** The inverse of `toChips`; print the result with `printWorkItemFilterText`. */
export function fromChips(
  leaves: readonly FilterLeaf[],
): WorkItemFilter | undefined {
  const [only] = leaves;
  if (!only) return undefined;
  return leaves.length === 1 ? only : { op: "and", clauses: [...leaves] };
}

export function chipValues(leaf: FilterLeaf): string[] {
  return Array.isArray(leaf.value) ? leaf.value : [leaf.value];
}

/** Sets the picked values: none removes the chip (`undefined`), one is `eq`, several are `in`. */
export function withValues(
  leaf: FilterLeaf,
  values: readonly string[],
): FilterLeaf | undefined {
  const [first] = values;
  if (first === undefined) return undefined;
  return values.length === 1
    ? { ...leaf, op: "eq", value: first }
    : { ...leaf, op: "in", value: [...values] };
}

/** Switches the operator, keeping one scalar value unless the new operator is `in`. */
export function withOperator(leaf: FilterLeaf, op: string): FilterLeaf {
  const [first = ""] = chipValues(leaf);
  return op === "in"
    ? { ...leaf, op, value: chipValues(leaf) }
    : { ...leaf, op, value: first };
}
