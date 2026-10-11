/**
 * Closed feature-flag registry. Keep the key set in sync with
 * `docs/01-architecture/plugin-architecture.md` § Feature toggles; the contract test
 * compares the two so a flag cannot quietly exist in only one authority.
 */
export const FEATURE_FLAGS = [
  "feature.cycles",
  "feature.modules",
  "feature.estimates",
  "feature.intake",
  "feature.sla",
  "feature.approvals",
  "feature.time_tracking",
  "feature.cost_tracking",
  "feature.knowledge_base",
  "feature.service_catalogue",
  "feature.customer_portal",
  "feature.reports",
  "feature.automations",
  "feature.timeline",
  "feature.calendar",
  "feature.pages",
  "feature.mcp",
  "feature.scim",
  "feature.import",
  "feature.public_boards",
  "feature.dev_links",
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = {
  "feature.cycles": false,
  "feature.modules": false,
  "feature.estimates": false,
  "feature.intake": false,
  "feature.sla": false,
  "feature.approvals": false,
  "feature.time_tracking": false,
  "feature.cost_tracking": false,
  "feature.knowledge_base": false,
  "feature.service_catalogue": false,
  "feature.customer_portal": false,
  "feature.reports": false,
  "feature.automations": false,
  "feature.timeline": false,
  "feature.calendar": false,
  "feature.pages": false,
  "feature.mcp": false,
  "feature.scim": true,
  "feature.import": true,
  "feature.public_boards": false,
  "feature.dev_links": false,
};

export const LOCKED_FEATURE_DEFAULTS: ReadonlySet<FeatureFlag> = new Set([
  "feature.import",
]);

export function isFeatureFlag(value: string): value is FeatureFlag {
  return (FEATURE_FLAGS as readonly string[]).includes(value);
}

export function resolveFeatureFlag(input: {
  feature: FeatureFlag;
  instance?: { enabled: boolean; locked: boolean } | null;
  workspace?: boolean | null;
  project?: boolean | null;
}): {
  enabled: boolean;
  source: "project" | "workspace" | "instance" | "default";
} {
  if (input.instance?.locked) {
    return { enabled: input.instance.enabled, source: "instance" };
  }
  if (!input.instance && LOCKED_FEATURE_DEFAULTS.has(input.feature)) {
    return { enabled: FEATURE_FLAG_DEFAULTS[input.feature], source: "default" };
  }
  if (input.project !== null && input.project !== undefined) {
    return { enabled: input.project, source: "project" };
  }
  if (input.workspace !== null && input.workspace !== undefined) {
    return { enabled: input.workspace, source: "workspace" };
  }
  if (input.instance) {
    return { enabled: input.instance.enabled, source: "instance" };
  }
  return { enabled: FEATURE_FLAG_DEFAULTS[input.feature], source: "default" };
}
