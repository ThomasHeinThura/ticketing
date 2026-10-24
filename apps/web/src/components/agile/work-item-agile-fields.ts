/**
 * The agile fields the work item list and detail responses carry (`cycleId`, `moduleId`,
 * `estimatePointId`). Read through one helper so a row from a producer that does not resolve
 * them (search, saved views) reads as "not in a cycle or module, unestimated" rather than
 * crashing.
 */
export type WorkItemAgileFields = {
  cycleId: string | null;
  moduleId: string | null;
  estimatePointId: string | null;
};

export function agileFieldsOf(item: unknown): WorkItemAgileFields {
  const row = (item ?? {}) as Partial<
    Record<keyof WorkItemAgileFields, unknown>
  >;
  const pick = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    cycleId: pick(row.cycleId),
    moduleId: pick(row.moduleId),
    estimatePointId: pick(row.estimatePointId),
  };
}
