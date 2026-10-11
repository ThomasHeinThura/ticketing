import {
  type FormSchema,
  type FormValue,
  isVisibilityConditionSatisfied,
  resolveFormVisibility,
  type VisibilityCondition,
} from "@taskdesk/domain";

type PortalVisibilityCondition = {
  field_key: string;
  op: string;
  value?: unknown;
};

/** Use the domain's RT-5 operator semantics for every portal visibility surface. */
export function isIntakeConditionSatisfied(
  condition: PortalVisibilityCondition,
  value: unknown,
): boolean {
  return isVisibilityConditionSatisfied(
    condition as VisibilityCondition,
    value as FormValue,
  );
}

/** Resolve every portal field with the same visibility result used by validation. */
export function resolveIntakeVisibility(
  schema: FormSchema,
  answers: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, boolean> {
  return resolveFormVisibility(schema, answers as Record<string, FormValue>);
}
