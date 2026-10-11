/** Browser-safe public entry point for the pure intake rules and data types. */
export {
  isVisibilityConditionSatisfied,
  resolveFormVisibility,
  validateSubmissionData,
} from "./request-type.js";
export type { FormSchema, FormValue, VisibilityCondition } from "./types.js";
