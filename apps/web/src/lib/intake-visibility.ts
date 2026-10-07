import {
  type FormValue,
  isVisibilityConditionSatisfied,
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
