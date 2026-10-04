import { policyRegistry } from "../policy-registry";

const TASK_POLICY_SOURCE = "apps/api/src/task/policy.ts";
const RAW = process.env.TASKDESK_POLICY_ENFORCE;

export class PolicyEnforcementConfigError extends Error {}

/** Parse exact registry source paths; an operator typo must never select a weaker mode. */
export function parseEnforcedPolicySources(
  value: string | undefined,
  registeredSources: readonly string[],
): ReadonlySet<string> {
  if (value === undefined || value === "") return new Set();

  const registered = new Set(registeredSources);
  const selected = value.split(",");
  if (
    selected.some((source) => source === "" || source.trim() !== source) ||
    new Set(selected).size !== selected.length ||
    selected.some((source) => !registered.has(source))
  ) {
    throw new PolicyEnforcementConfigError(
      "TASKDESK_POLICY_ENFORCE must contain unique, exact registered policy-source paths",
    );
  }

  if (selected.includes(TASK_POLICY_SOURCE)) {
    const allOtherSources = registeredSources.filter(
      (source) => source !== TASK_POLICY_SOURCE,
    );
    if (
      allOtherSources.some((source) => !selected.includes(source)) ||
      selected.at(-1) !== TASK_POLICY_SOURCE
    ) {
      throw new PolicyEnforcementConfigError(
        "the task policy source may be enforced only after every other registered source and must be listed last",
      );
    }
  }

  return new Set(selected);
}

const registeredSources = [
  ...new Set(policyRegistry.entries.map((entry) => entry.source)),
];

/** Read once at boot; routers switch only through an explicit, reviewed deployment change. */
export const enforcedPolicySources = parseEnforcedPolicySources(
  RAW,
  registeredSources,
);
