/**
 * The field table mirrors the P1 whitelist in api-design.md ("Work-item search v1"): the server
 * stays the authority. Shared by the visual editor and the chip filter bar (`SV-11`).
 */
export type FilterField = {
  id: string;
  /** Key under `workItems:filter.fields`. */
  labelKey: string;
  operators: readonly FilterOperator[];
  values?: readonly string[];
  fixedValue?: string;
};

export const OPERATORS = [
  "eq",
  "in",
  "contains",
  "lt",
  "lte",
  "gt",
  "gte",
] as const;
export type FilterOperator = (typeof OPERATORS)[number];

export function operatorKey(operator: string): FilterOperator | undefined {
  return (OPERATORS as readonly string[]).includes(operator)
    ? (operator as FilterOperator)
    : undefined;
}

export const FILTER_FIELDS: readonly FilterField[] = [
  {
    id: "state.group",
    labelKey: "stateGroup",
    operators: ["eq", "in"],
    values: ["backlog", "unstarted", "started", "completed", "cancelled"],
  },
  {
    id: "priority",
    labelKey: "priority",
    operators: ["eq", "in", "gt", "gte", "lt", "lte"],
    values: ["low", "medium", "high", "urgent"],
  },
  {
    id: "assignee",
    labelKey: "assignee",
    operators: ["eq"],
    fixedValue: "@me",
  },
  {
    id: "requester",
    labelKey: "requester",
    operators: ["eq"],
    fixedValue: "@me",
  },
  {
    id: "watcher",
    labelKey: "watcher",
    operators: ["contains"],
    fixedValue: "@me",
  },
  {
    id: "dueDate",
    labelKey: "dueDate",
    operators: ["lt", "lte", "gt", "gte"],
  },
  {
    id: "createdAt",
    labelKey: "createdAt",
    operators: ["lt", "lte", "gt", "gte"],
  },
  { id: "project", labelKey: "project", operators: ["eq"] },
  { id: "type", labelKey: "type", operators: ["eq"] },
  {
    id: "lifecycle",
    labelKey: "lifecycle",
    operators: ["eq"],
    values: ["active", "archived", "deleted"],
  },
];
