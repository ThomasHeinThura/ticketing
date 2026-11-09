/** Shared shapes and checks for the request type settings screen (list, editor, field rows). */

export type RequestTypeField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "file";
  required: boolean;
  help?: string;
  multiple?: boolean;
  options?: string[];
  mapsTo?: { field: string; map?: Record<string, string> };
  showIf?: {
    field_key: string;
    op: "eq" | "neq" | "in" | "is_set";
    value?: unknown;
  } | null;
};

export type RequestType = {
  id: string;
  name: string;
  description: string | null;
  group: string;
  workItemTypeId: string;
  defaultProjectId: string | null;
  formSchema: { fields: RequestTypeField[] };
  published: boolean;
  version: number;
  autoAccept: boolean;
  customerVisible: boolean;
  forcePrivate: boolean;
  position: number;
  key: string;
  updatedAt?: string;
};

export type RequestTypeDraft = Omit<
  RequestType,
  "id" | "version" | "published" | "key" | "updatedAt"
>;

export type RequestTypeVersion = { number: number; createdAt: string };

export const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

/** A blank draft. `position` appends the new type to the end of its catalogue group. */
export function blankRequestType(position = 0): RequestTypeDraft {
  return {
    name: "",
    description: "",
    group: "General",
    workItemTypeId: "",
    defaultProjectId: null,
    formSchema: {
      fields: [
        {
          key: "title",
          label: "Summary",
          type: "text",
          required: true,
          mapsTo: { field: "title" },
        },
      ],
    },
    autoAccept: false,
    customerVisible: false,
    forcePrivate: false,
    position,
  };
}

export function draftFromRequestType(type: RequestType): RequestTypeDraft {
  return {
    name: type.name,
    description: type.description,
    group: type.group,
    workItemTypeId: type.workItemTypeId,
    defaultProjectId: type.defaultProjectId,
    formSchema: type.formSchema,
    autoAccept: type.autoAccept,
    customerVisible: type.customerVisible,
    forcePrivate: type.forcePrivate,
    position: type.position,
  };
}

export function priorityValueFor(
  field: RequestTypeField,
  option: string,
): string | null {
  return (
    field.mapsTo?.map?.[option] ??
    ((PRIORITY_VALUES as readonly string[]).includes(option) ? option : null)
  );
}

/** Publishing needs exactly one required, always-visible text field mapped to the title. */
export function isTitleMappingValid(fields: RequestTypeField[]): boolean {
  return (
    fields.filter(
      (field) =>
        field.mapsTo?.field === "title" &&
        field.required &&
        (field.type === "text" || field.type === "textarea") &&
        !field.showIf,
    ).length === 1
  );
}

export function isPriorityMappingValid(fields: RequestTypeField[]): boolean {
  return fields.every((field) => {
    if (field.mapsTo?.field !== "priority") return true;
    if (field.type !== "select" || !field.options?.length) return false;
    return field.options.every((option) => {
      const mapped =
        field.mapsTo?.map && Object.hasOwn(field.mapsTo.map, option)
          ? field.mapsTo.map[option]
          : option;
      return (PRIORITY_VALUES as readonly string[]).includes(mapped ?? "");
    });
  });
}

export function isRequiredFileValid(fields: RequestTypeField[]): boolean {
  return fields.every(
    (field) => field.type !== "file" || field.required !== true,
  );
}

/**
 * Sections for the list: groups in catalogue order, then any group the saved order does not know
 * yet (so a type never disappears), each with its types sorted by position then name.
 */
export function groupRequestTypes(
  types: RequestType[],
  groupOrder: string[],
): Array<{ group: string; ordered: boolean; types: RequestType[] }> {
  const byGroup = new Map<string, RequestType[]>();
  for (const type of types) {
    const list = byGroup.get(type.group) ?? [];
    list.push(type);
    byGroup.set(type.group, list);
  }
  const sort = (list: RequestType[]) =>
    [...list].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
  const sections = groupOrder.map((group) => ({
    group,
    ordered: true,
    types: sort(byGroup.get(group) ?? []),
  }));
  for (const [group, list] of byGroup) {
    if (!groupOrder.includes(group))
      sections.push({ group, ordered: false, types: sort(list) });
  }
  return sections;
}
