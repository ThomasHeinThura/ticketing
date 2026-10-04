import type { FormField, FormSchema, FormValue } from "@taskdesk/domain/intake";

const STORAGE_PREFIX = "taskdesk:portal-request-draft:v1";

export function portalRequestDraftStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function portalRequestDraftStorageKey(
  requestTypeKey: string,
  version: number,
): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(requestTypeKey)}:${version}`;
}

function isDraftValue(field: FormField, value: unknown): value is FormValue {
  if (field.type === "file") return false;
  if (field.multiple && (field.type === "select" || field.type === "combobox"))
    return (
      Array.isArray(value) && value.every((item) => typeof item === "string")
    );

  switch (field.type) {
    case "checkbox":
      return typeof value === "boolean";
    case "number":
      return (
        value === null || (typeof value === "number" && Number.isFinite(value))
      );
    case "text":
    case "textarea":
    case "select":
    case "combobox":
    case "date":
      return typeof value === "string" || value === null;
  }
}

function knownFormValues(
  schema: FormSchema,
  values: unknown,
): Record<string, FormValue> {
  if (values === null || typeof values !== "object" || Array.isArray(values))
    return {};

  const source = values as Record<string, unknown>;
  const result: Record<string, FormValue> = {};
  for (const field of schema.fields) {
    const value = source[field.key];
    if (Object.hasOwn(source, field.key) && isDraftValue(field, value))
      result[field.key] = value;
  }
  return result;
}

export function readPortalRequestDraft(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  storageKey: string,
  schema: FormSchema,
): Record<string, FormValue> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return {};
    const result = knownFormValues(schema, JSON.parse(raw) as unknown);
    if (Object.keys(result).length === 0) storage.removeItem(storageKey);
    return result;
  } catch {
    try {
      storage.removeItem(storageKey);
    } catch {
      // Browser storage is best-effort for local drafts.
    }
    return {};
  }
}

export function writePortalRequestDraft(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  storageKey: string,
  schema: FormSchema,
  values: Readonly<Record<string, FormValue>>,
): void {
  if (!storage) return;
  try {
    const safeValues = knownFormValues(schema, values);
    if (Object.keys(safeValues).length === 0) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, JSON.stringify(safeValues));
  } catch {
    // Browser storage is best-effort for local drafts.
  }
}

export function clearPortalRequestDraft(
  storage: Pick<Storage, "removeItem"> | null,
  storageKey: string,
): void {
  if (!storage) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // Browser storage is best-effort for local drafts.
  }
}
