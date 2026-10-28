import type { Executor } from "../database/executor";
import { loadWorkItemRowFacts, type WorkItemRowFactsInput } from "./row-facts";
import { loadWorkItemRowSla, type WorkItemRowSlaInput } from "./row-sla";

type DecoratableItem = WorkItemRowFactsInput & WorkItemRowSlaInput;

export type RowDecorationLoaders = {
  facts: typeof loadWorkItemRowFacts;
  sla: typeof loadWorkItemRowSla;
};

/**
 * VW-16 / RH-17: the row display facts (`assigneeActive`, `assigneeOnProject`,
 * `blockedByOpenCount`) and the SLA badge, attached identically by the unfiltered list
 * (`GET /api/work-items`) and the filtered search (`POST /api/work-items/search`) so badges
 * never vanish when a filter is applied. Assignee display names are projected by each
 * route's own page query (workspace-member join); this helper owns the batched fact loads.
 * Pure over its loaders so it is unit-testable without a database.
 */
export async function decorateWorkItemRows<
  Row extends { workItem: DecoratableItem } | DecoratableItem,
>(
  executor: Executor,
  rows: readonly Row[],
  pickItem: (row: Row) => DecoratableItem,
  loaders: RowDecorationLoaders = {
    facts: loadWorkItemRowFacts,
    sla: loadWorkItemRowSla,
  },
): Promise<(row: Row) => Record<string, unknown>> {
  const items = rows.map(pickItem);
  const facts = await loaders.facts(executor, items);
  const sla = await loaders.sla(executor, items);
  return (row) => {
    const id = pickItem(row).id;
    return {
      ...facts.get(id),
      ...(sla.has(id) ? { sla: sla.get(id) } : {}),
    };
  };
}
