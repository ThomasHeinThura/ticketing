import {
  type CustomFieldFormat,
  type CustomFieldOption,
  formatValue,
} from "@/lib/custom-field";
import type { WorkItemPriority, WorkItemRow } from "@/types/work-item";

/** `VW-13`: non-state board columns. `cf.<key>` is a live custom-field key. */
export type WorkItemBoardGroupField =
  | "assignee"
  | "priority"
  | "label"
  | `cf.${string}`;

export type CustomFieldGroupDefinition = {
  key: string;
  name: string;
  format: CustomFieldFormat;
  options: CustomFieldOption[];
  visibility?: {
    workItemTypeId: string;
    visible: boolean;
    required: boolean;
  }[];
};

export type CustomFieldGroupPerson = {
  projectId: string;
  personId: string;
  name: string | null;
};

export type LabelGroupDefinition = { id: string; name: string; color: string };

export type CustomFieldGroupValue =
  | string
  | number
  | boolean
  | { amount: number; currency: string }
  | null;

export type WorkItemBoardGroup = {
  /** Prefixed so a group droppable can never collide with a state or work-item id. */
  id: string;
  field: WorkItemBoardGroupField;
  /** The person id, priority, label id or custom-field member value. */
  value: CustomFieldGroupValue | undefined;
  name: string | null;
  color?: string;
  /** False for stale values and custom fields hidden for this work item's type. */
  droppable: boolean;
  items: WorkItemRow[];
};

export type AssignablePerson = { personId: string; name: string | null };

export const PRIORITY_GROUP_ORDER: readonly WorkItemPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

function isCurrencyValue(
  value: unknown,
): value is { amount: number; currency: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.amount === "number" &&
    Number.isFinite(entry.amount) &&
    typeof entry.currency === "string" &&
    /^[A-Z]{3}$/u.test(entry.currency)
  );
}

function isCustomScalar(
  value: unknown,
): value is Exclude<CustomFieldGroupValue, null> {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    isCurrencyValue(value)
  );
}

function stableValueKey(value: CustomFieldGroupValue | undefined): string {
  if (value === undefined) return "__unavailable__";
  if (value === null) return "__none__";
  return JSON.stringify(value);
}

function serializeValue(value: Exclude<CustomFieldGroupValue, null>): string {
  return encodeURIComponent(JSON.stringify(value));
}

export function boardGroupId(
  field: WorkItemBoardGroupField,
  value: CustomFieldGroupValue | undefined,
): string {
  if (value === undefined) return `group:${field}:unavailable`;
  if (value === null) return `group:${field}:none`;
  if (field === "assignee" || field === "priority")
    return `group:${field}:${value}`;
  return `group:${field}:${serializeValue(value)}`;
}

/** The field and value a group id stands for, or undefined for any other droppable id. */
export function parseBoardGroupId(
  id: unknown,
):
  | { field: WorkItemBoardGroupField; value: CustomFieldGroupValue | undefined }
  | undefined {
  if (typeof id !== "string") return undefined;
  const match =
    /^group:(assignee|priority|label|cf\.[a-z][a-z0-9_]{0,63}):(.+)$/u.exec(id);
  if (!match) return undefined;
  const field = match[1] as WorkItemBoardGroupField;
  if (match[2] === "unavailable") return { field, value: undefined };
  if (match[2] === "none") return { field, value: null };
  if (field === "assignee" || field === "priority")
    return { field, value: match[2] };
  try {
    const value: unknown = JSON.parse(decodeURIComponent(match[2]));
    return isCustomScalar(value) ? { field, value } : undefined;
  } catch {
    return undefined;
  }
}

/** Distinguishes duplicate card instances when an item belongs to several groups. */
export function boardGroupItemId(
  group: WorkItemBoardGroup,
  itemId: string,
): string {
  return group.field === "label" || group.field.startsWith("cf.")
    ? `group-item:${encodeURIComponent(group.id)}:${encodeURIComponent(itemId)}`
    : itemId;
}

export function parseBoardGroupItemId(
  value: unknown,
): { groupId: string; itemId: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^group-item:([^:]+):([^:]+)$/u.exec(value);
  if (!match) return undefined;
  try {
    const groupId = decodeURIComponent(match[1]);
    const itemId = decodeURIComponent(match[2]);
    return groupId && itemId ? { groupId, itemId } : undefined;
  } catch {
    return undefined;
  }
}

/** Values represented by a row. `undefined` means the custom field is not available. */
export function itemGroupValues(
  item: Pick<
    WorkItemRow,
    "assigneeId" | "priority" | "labels" | "customFieldValues"
  >,
  field: WorkItemBoardGroupField,
  customField?: CustomFieldGroupDefinition,
): CustomFieldGroupValue[] | undefined {
  if (field === "assignee") return item.assigneeId ? [item.assigneeId] : [];
  if (field === "priority") return item.priority ? [item.priority] : [];
  if (field === "label") return (item.labels ?? []).map((label) => label.id);
  if (!customField || field !== `cf.${customField.key}`) return undefined;
  const key = customField.key;
  if (!item.customFieldValues || !Object.hasOwn(item.customFieldValues, key))
    return undefined;
  const value = item.customFieldValues[key];
  if (value === null || value === undefined || value === "") return [];
  if (
    customField.format === "multi_select" ||
    customField.format === "multi_user"
  ) {
    return Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
      ? [...new Set(value)]
      : undefined;
  }
  return isCustomScalar(value) ? [value] : undefined;
}

/** Single-value compatibility helper; multi-value callers should use `itemGroupValues`. */
export function itemGroupValue(
  item: Pick<
    WorkItemRow,
    "assigneeId" | "priority" | "labels" | "customFieldValues"
  >,
  field: WorkItemBoardGroupField,
  customField?: CustomFieldGroupDefinition,
): CustomFieldGroupValue | undefined {
  const values = itemGroupValues(item, field, customField);
  if (values === undefined) return undefined;
  return values.length === 0 ? null : values[0];
}

function displayCustomValue(
  field: CustomFieldGroupDefinition,
  value: Exclude<CustomFieldGroupValue, null>,
  projectId: string,
  people: readonly CustomFieldGroupPerson[],
): string {
  if (field.format === "user" || field.format === "multi_user") {
    const person = people.find(
      (entry) => entry.projectId === projectId && entry.personId === value,
    );
    return person?.name ?? "";
  }
  return formatValue(field, value);
}

function compareCustomValues(
  field: CustomFieldGroupDefinition,
  left: Exclude<CustomFieldGroupValue, null>,
  right: Exclude<CustomFieldGroupValue, null>,
  people: readonly CustomFieldGroupPerson[],
  projectId: string,
): number {
  if (field.format === "boolean") return Number(right) - Number(left);
  if (field.format === "number" || field.format === "decimal")
    return Number(left) - Number(right);
  if (field.format === "date" || field.format === "datetime")
    return Date.parse(String(left)) - Date.parse(String(right));
  if (field.format === "currency") {
    const a = left as { amount: number; currency: string };
    const b = right as { amount: number; currency: string };
    return a.currency.localeCompare(b.currency) || a.amount - b.amount;
  }
  if (field.format === "user" || field.format === "multi_user") {
    const leftName = displayCustomValue(field, left, projectId, people);
    const rightName = displayCustomValue(field, right, projectId, people);
    return (
      new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base",
      }).compare(leftName, rightName) ||
      String(left).localeCompare(String(right))
    );
  }
  return new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  }).compare(String(left), String(right));
}

/**
 * Splits loaded rows into groups. The API's order survives inside each group. Items with
 * multiple labels or custom values appear in every matching group; unavailable custom-field
 * values stay separate and non-droppable. The empty bucket is always last.
 */
export function buildBoardGroups(
  field: WorkItemBoardGroupField,
  items: readonly WorkItemRow[],
  people: readonly AssignablePerson[] = [],
  customField?: CustomFieldGroupDefinition,
  customFieldPeople: readonly CustomFieldGroupPerson[] = [],
  labels: readonly LabelGroupDefinition[] = [],
  includeEmpty = true,
): WorkItemBoardGroup[] {
  const byValue = new Map<string, WorkItemRow[]>();
  const values = new Map<string, CustomFieldGroupValue | undefined>();
  for (const item of items) {
    const itemValues = itemGroupValues(item, field, customField);
    const members =
      itemValues === undefined
        ? [undefined]
        : itemValues.length
          ? itemValues
          : [null];
    for (const value of members) {
      const key = stableValueKey(value);
      values.set(key, value);
      const bucket = byValue.get(key) ?? [];
      bucket.push(item);
      byValue.set(key, bucket);
    }
  }

  if (field === "priority") {
    const known = new Set<string>(PRIORITY_GROUP_ORDER);
    const order: CustomFieldGroupValue[] = [...PRIORITY_GROUP_ORDER];
    for (const value of values.values())
      if (value !== null && value !== undefined && !known.has(String(value)))
        order.push(value);
    if (includeEmpty || values.has("__none__")) order.push(null);
    return order.map((value) => ({
      id: boardGroupId(field, value),
      field,
      value,
      name: null,
      droppable: value === null || known.has(String(value)),
      items: byValue.get(stableValueKey(value)) ?? [],
    }));
  }

  if (field === "assignee") {
    const groups: WorkItemBoardGroup[] = [];
    const seen = new Set<string>();
    for (const person of people) {
      if (seen.has(person.personId)) continue;
      seen.add(person.personId);
      groups.push({
        id: boardGroupId(field, person.personId),
        field,
        value: person.personId,
        name: person.name,
        droppable: true,
        items: byValue.get(stableValueKey(person.personId)) ?? [],
      });
    }
    for (const [key, bucket] of byValue) {
      const value = values.get(key);
      if (value == null || typeof value !== "string" || seen.has(value))
        continue;
      groups.push({
        id: boardGroupId(field, value),
        field,
        value,
        name: bucket[0]?.assigneeName ?? null,
        droppable: false,
        items: bucket,
      });
    }
    if (includeEmpty || values.has("__none__"))
      groups.push({
        id: boardGroupId(field, null),
        field,
        value: null,
        name: null,
        droppable: true,
        items: byValue.get("__none__") ?? [],
      });
    return groups;
  }

  if (field === "label") {
    const groups: WorkItemBoardGroup[] = [];
    const seen = new Set<string>();
    for (const label of labels) {
      if (seen.has(label.id)) continue;
      seen.add(label.id);
      groups.push({
        id: boardGroupId(field, label.id),
        field,
        value: label.id,
        name: label.name,
        color: label.color,
        droppable: true,
        items: byValue.get(stableValueKey(label.id)) ?? [],
      });
    }
    for (const [key, bucket] of byValue) {
      const value = values.get(key);
      if (typeof value !== "string" || seen.has(value)) continue;
      seen.add(value);
      const label = bucket[0]?.labels?.find((entry) => entry.id === value);
      groups.push({
        id: boardGroupId(field, value),
        field,
        value,
        name: label?.name ?? null,
        color: label?.color,
        droppable: false,
        items: bucket,
      });
    }
    if (includeEmpty || values.has("__none__"))
      groups.push({
        id: boardGroupId(field, null),
        field,
        value: null,
        name: null,
        droppable: true,
        items: byValue.get("__none__") ?? [],
      });
    return groups;
  }

  if (!customField || field !== `cf.${customField.key}`) return [];
  const groups: WorkItemBoardGroup[] = [];
  const knownValues = new Set<string>();
  const add = (
    value: CustomFieldGroupValue | undefined,
    name: string | null,
    droppable: boolean,
  ) => {
    const key = stableValueKey(value);
    if (knownValues.has(key)) return;
    knownValues.add(key);
    groups.push({
      id: boardGroupId(field, value),
      field,
      value,
      name,
      droppable,
      items: byValue.get(key) ?? [],
    });
  };

  if (customField.format === "select" || customField.format === "multi_select")
    for (const option of customField.options)
      add(option.key, option.label, true);
  if (customField.format === "boolean") {
    add(true, "", true);
    add(false, "", true);
  }

  const existing = [...values.entries()]
    .filter(([key]) => key !== "__none__" && key !== "__unavailable__")
    .map(([, value]) => value)
    .filter(
      (value): value is Exclude<CustomFieldGroupValue, null | undefined> =>
        value !== null && value !== undefined,
    );
  const uniqueExisting = [
    ...new Map(
      existing.map((value) => [stableValueKey(value), value]),
    ).values(),
  ]
    .filter((value) => !knownValues.has(stableValueKey(value)))
    .sort((left, right) =>
      compareCustomValues(
        customField,
        left,
        right,
        customFieldPeople,
        items[0]?.projectId ?? "",
      ),
    );
  for (const value of uniqueExisting) {
    if (
      (customField.format === "select" ||
        customField.format === "multi_select") &&
      !customField.options.some((option) => option.key === value)
    ) {
      const bucket = byValue.get(stableValueKey(value)) ?? [];
      add(value, bucket[0] ? String(value) : null, false);
      continue;
    }
    const bucket = byValue.get(stableValueKey(value)) ?? [];
    const name = bucket[0]
      ? displayCustomValue(
          customField,
          value,
          bucket[0].projectId,
          customFieldPeople,
        )
      : String(value);
    add(value, name, true);
  }

  if (values.has("__unavailable__")) add(undefined, "", false);
  if (includeEmpty || values.has("__none__")) add(null, "", true);
  return groups;
}
