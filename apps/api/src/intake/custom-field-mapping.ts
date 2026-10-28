import type { FormField, FormSchema, FormValue } from "@taskdesk/domain";
import {
  type CustomFieldFormat,
  isValueSet,
  validateFieldValue,
} from "../custom-field/logic";
import {
  applyWorkItemFieldValues,
  listFields,
  type MaterializedField,
  workItemCustomFields,
} from "../custom-field/repository";
import type { Executor } from "../database/executor";

/**
 * `CF-11`: a request-type form may collect a custom field the workspace marked customer-visible.
 *
 * The mapping is the form field's existing `mapsTo.field`, spelled `cf.<key>`. Only a customer
 * can fill the form, so only a field the customer is allowed to see may be collected through it:
 * the field must be live, `customer_visible`, applicable to the request type's work-item type
 * (CF-2/CF-3) and of a format the form control can produce. The same rules are checked at
 * publish AND again when the submission is accepted, so a field made internal, deleted or hidden
 * for the type after publication is dropped (and named in the acceptance audit row) rather than
 * written from customer input.
 */

export const CUSTOM_FIELD_MAPPING = /^cf\.([A-Za-z0-9_-]{1,64})$/u;

export function customFieldKeyOf(mapsToField: string): string | null {
  return CUSTOM_FIELD_MAPPING.exec(mapsToField)?.[1] ?? null;
}

/** Which custom-field formats each form control can feed. */
const FORM_TYPE_FORMATS: Record<string, readonly CustomFieldFormat[]> = {
  text: ["text", "url", "email"],
  textarea: ["long_text", "text"],
  number: ["number", "decimal"],
  date: ["date"],
  checkbox: ["boolean"],
  select: ["select", "multi_select"],
  combobox: ["select", "multi_select"],
};

function formControlCompatible(
  field: FormField,
  target: MaterializedField,
): boolean {
  if (!FORM_TYPE_FORMATS[field.type]?.includes(target.format)) return false;
  if (field.type === "select" || field.type === "combobox") {
    // `multiple` form controls feed multi_select, single ones feed select.
    if ((field.multiple === true) !== (target.format === "multi_select"))
      return false;
    // Every offered option must resolve to one of the field's option keys.
    const keys = new Set(target.options.map((option) => option.key));
    return (field.options ?? []).every((option) =>
      keys.has(field.mapsTo?.map?.[option] ?? option),
    );
  }
  return true;
}

/** A live, customer-visible field applicable to the work-item type, by key. */
function collectableFields(
  fields: readonly MaterializedField[],
  workItemTypeId: string,
): Map<string, MaterializedField> {
  return new Map(
    fields
      .filter(
        (field) =>
          field.customerVisible &&
          field.visibility.some(
            (row) => row.workItemTypeId === workItemTypeId && row.visible,
          ),
      )
      .map((field) => [field.key, field]),
  );
}

/** Publish-time check: the `cf.<key>` mappings of a form that may NOT be collected. */
export async function refusedCustomFieldMappings(
  executor: Executor,
  input: {
    workspaceId: string;
    workItemTypeId: string;
    form: FormSchema;
  },
): Promise<string[]> {
  const mapped = input.form.fields.filter(
    (field) => field.mapsTo && customFieldKeyOf(field.mapsTo.field) !== null,
  );
  if (mapped.length === 0) return [];
  const collectable = collectableFields(
    await listFields(input.workspaceId, {}, executor),
    input.workItemTypeId,
  );
  const refused: string[] = [];
  for (const field of mapped) {
    const key = customFieldKeyOf(field.mapsTo?.field ?? "") as string;
    const target = collectable.get(key);
    if (!target || !formControlCompatible(field, target))
      refused.push(`cf.${key}`);
  }
  return refused;
}

/**
 * Accept-time write: the customer's mapped answers for collectable fields are validated against
 * the field's format and written to the new work item. Anything that fails a rule is skipped and
 * named, never written. Required-field enforcement (CF-4) is deliberately not applied here: the
 * customer cannot fill a staff field, so conversion must not fail on one; the transition guard
 * still holds the item at the `started`/`completed` boundary.
 */
export async function applyAcceptedCustomFields(
  tx: Executor,
  item: { id: string; workspaceId: string; projectId: string; typeId: string },
  mapped: Readonly<Record<string, FormValue>>,
): Promise<{ written: string[]; skipped: string[] }> {
  const entries = Object.entries(mapped).flatMap(([field, value]) => {
    const key = customFieldKeyOf(field);
    return key === null ? [] : [[key, value] as const];
  });
  const fields = await listFields(item.workspaceId, {}, tx);
  const collectable = collectableFields(fields, item.typeId);
  const accepted: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [key, value] of entries) {
    const target = collectable.get(key);
    const checked = target
      ? validateFieldValue(
          { format: target.format, options: target.options },
          value,
        )
      : null;
    if (!target || !checked?.ok) skipped.push(`cf.${key}`);
    else accepted[key] = checked.value;
  }
  // Defaults (CF-5) fill every applicable field the customer left out.
  await applyWorkItemFieldValues(tx, item, accepted, {
    create: true,
    enforceRequired: false,
  });
  return { written: Object.keys(accepted).map((key) => `cf.${key}`), skipped };
}

export type PortalCustomField = {
  key: string;
  label: string;
  format: string;
  helpText: string | null;
  /** Option labels for a select, never keys; person ids are never sent. */
  value: unknown;
};

/** Formats whose stored value is a staff person id: never shown on the portal. */
const STAFF_ONLY_FORMATS: ReadonlySet<string> = new Set(["user", "multi_user"]);

/**
 * `CF-11`: the customer-visible custom fields of one request's work item, for the portal
 * request detail. A field that is not customer-visible, not applicable to the item's type
 * (CF-3), hidden by its own condition (CF-6), empty, or holding a staff person is absent. The
 * projection carries no field id, section, option list, condition or requiredness: a customer
 * sees a label and a value.
 */
export async function loadPortalCustomFields(
  executor: Executor,
  workItem: { id: string; workspaceId: string; typeId: string },
): Promise<PortalCustomField[]> {
  const all = await workItemCustomFields(executor, workItem);
  const customerKeys = new Set(
    all.filter((field) => field.customerVisible).map((field) => field.key),
  );
  return all
    .filter(
      (field) =>
        field.customerVisible &&
        // CF-6 on the portal: a field conditioned on a staff-only field would reveal that
        // field's value by appearing or not, so it is absent unless its controller is
        // customer-visible too.
        (field.visibilityCondition === null ||
          customerKeys.has(field.visibilityCondition.field_key)) &&
        field.shown &&
        !STAFF_ONLY_FORMATS.has(field.format) &&
        isValueSet(field.value),
    )
    .map((field) => {
      const labelOf = (key: unknown) =>
        field.options.find((option) => option.key === key)?.label ??
        String(key);
      const value =
        field.format === "select"
          ? labelOf(field.value)
          : field.format === "multi_select" && Array.isArray(field.value)
            ? field.value.map(labelOf)
            : field.value;
      return {
        key: field.key,
        label: field.name,
        format: field.format,
        helpText: field.helpText,
        value,
      };
    });
}
