type IntakeVisibilityCondition = {
  field_key: string;
  op: string;
  value?: unknown;
};

/** Shared portal/editor semantics for request-type conditional visibility. */
export function isIntakeConditionSatisfied(
  condition: IntakeVisibilityCondition,
  value: unknown,
): boolean {
  switch (condition.op) {
    case "is_set":
      return value !== undefined && value !== null && value !== "";
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(value);
    default:
      return false;
  }
}
