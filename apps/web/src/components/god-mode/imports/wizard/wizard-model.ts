import type {
  ImportEnginePhase,
  ImportPluginId,
  MappingDomain,
  MappingTarget,
  PriorityValue,
  StateGroup,
} from "@/fetchers/god-mode/imports";
import { PRIORITY_VALUES, STATE_GROUPS } from "@/fetchers/god-mode/imports";
import { IMPORT_WIZARD_STEPS, type ImportWizardStep } from "@/lib/routes";

/** Wizard steps in pipeline order (import-and-cutover.md: connect, discover, map, dry run, import, reconcile). */
export const WIZARD_STEPS = IMPORT_WIZARD_STEPS;
export type WizardStep = ImportWizardStep;

export function isWizardStep(value: unknown): value is WizardStep {
  return (WIZARD_STEPS as readonly unknown[]).includes(value);
}

/** Furthest step a run in `phase` may open; later steps need the earlier work first. */
export function maxStepFor(phase: ImportEnginePhase): WizardStep {
  switch (phase) {
    case "created":
      return "discover";
    case "discovered":
      return "dry-run";
    case "dry_run_ready":
      return "execute";
    case "executing":
      return "execute";
    case "completed":
      return "reconcile";
  }
}

/** The step a run belongs on when the URL names none. */
export function defaultStepFor(phase: ImportEnginePhase): WizardStep {
  switch (phase) {
    case "created":
      return "discover";
    case "discovered":
      return "mapping";
    case "dry_run_ready":
      return "dry-run";
    case "executing":
      return "execute";
    case "completed":
      return "reconcile";
  }
}

export function clampStep(
  requested: WizardStep | undefined,
  phase: ImportEnginePhase,
): WizardStep {
  if (!requested) return defaultStepFor(phase);
  const limit = WIZARD_STEPS.indexOf(maxStepFor(phase));
  return WIZARD_STEPS.indexOf(requested) <= limit
    ? requested
    : maxStepFor(phase);
}

export type SourceField = {
  /** Key sent in `config` (never a secret), or `credential` for the secret field. */
  key: string;
  kind?: "text" | "secret" | "file";
  optional?: boolean;
};

export type SourcePluginInfo = {
  id: ImportPluginId;
  /** i18n key under `godModeImports:wizard.plugins.<labelKey>`. */
  labelKey: string;
  fields: SourceField[];
};

/** Largest CSV the adapters accept (`CSV_LIMITS.maxBytes`, 5 MiB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Sources offered by the wizard. Config keys are the ones the registered adapters read
 * (`apps/api/src/imports/adapters`): CSV-family sources take the file text in `csvText`; Jira and
 * JSM read `baseUrl`, `projectKey` and `email` (a bare API token needs the email in config);
 * Azure DevOps reads `organization` and optional `project`; Plane reads `workspace` and optional
 * `baseUrl` and `project`. Secrets only ever go in `credential`.
 */
export const SOURCE_PLUGINS: readonly SourcePluginInfo[] = [
  {
    id: "import.csv",
    labelKey: "csv",
    fields: [{ key: "csvText", kind: "file" }],
  },
  {
    id: "import.planner",
    labelKey: "planner",
    fields: [{ key: "csvText", kind: "file" }],
  },
  {
    id: "import.power-apps",
    labelKey: "powerApps",
    fields: [{ key: "csvText", kind: "file" }],
  },
  {
    id: "import.jira",
    labelKey: "jira",
    fields: [
      { key: "baseUrl" },
      { key: "projectKey" },
      { key: "email" },
      { key: "jqlFilter", optional: true },
      { key: "credential", kind: "secret" },
    ],
  },
  {
    id: "import.jsm",
    labelKey: "jsm",
    fields: [
      { key: "baseUrl" },
      { key: "projectKey" },
      { key: "email" },
      { key: "jqlFilter", optional: true },
      { key: "credential", kind: "secret" },
    ],
  },
  {
    id: "import.azure-devops",
    labelKey: "azureDevops",
    fields: [
      { key: "organization" },
      { key: "project", optional: true },
      { key: "credential", kind: "secret" },
    ],
  },
  {
    id: "import.plane",
    labelKey: "plane",
    fields: [
      { key: "workspace" },
      { key: "baseUrl", optional: true },
      { key: "project", optional: true },
      { key: "credential", kind: "secret" },
    ],
  },
];

export function pluginLabelKey(pluginId: string): string {
  if (pluginId === "import.mcp") return "mcp";
  return SOURCE_PLUGINS.find((p) => p.id === pluginId)?.labelKey ?? "unknown";
}

// --- target codec ---------------------------------------------------------------------------
// One string per picker option. Only the first `:` separates the kind from the payload, so ids
// that contain a colon survive a round trip.

export function encodeTarget(target: MappingTarget | null): string | undefined {
  if (!target) return undefined;
  switch (target.kind) {
    case "target":
      return `target:${target.id}`;
    case "group":
      return `group:${target.group}`;
    case "priority":
      return `priority:${target.value}`;
    case "placeholder":
      return "placeholder";
    case "ignore":
      return "ignore";
  }
}

export function decodeTarget(encoded: string): MappingTarget | null {
  const colon = encoded.indexOf(":");
  const kind = colon < 0 ? encoded : encoded.slice(0, colon);
  const payload = colon < 0 ? "" : encoded.slice(colon + 1);
  if (kind === "placeholder") return { kind: "placeholder" };
  if (kind === "ignore") return { kind: "ignore" };
  if (kind === "target" && payload) return { kind: "target", id: payload };
  if (kind === "group" && (STATE_GROUPS as readonly string[]).includes(payload))
    return { kind: "group", group: payload as StateGroup };
  if (
    kind === "priority" &&
    (PRIORITY_VALUES as readonly string[]).includes(payload)
  )
    return { kind: "priority", value: payload as PriorityValue };
  return null;
}

export type TargetCatalogue = Partial<
  Record<MappingDomain, { id: string; name: string }[]>
>;

export type TargetOption = { value: string; label: string };

/**
 * Valid targets per domain (mirrors the API's `isValidTarget`): `ignore` is never allowed for
 * type or state, `placeholder` only for person, groups only for state, priorities only for priority.
 */
export function targetOptionsFor(
  domain: MappingDomain,
  catalogue: TargetCatalogue,
  labels: {
    ignore: string;
    placeholder: string;
    group: (group: StateGroup) => string;
    priority: (value: PriorityValue) => string;
  },
): TargetOption[] {
  if (domain === "state")
    return STATE_GROUPS.map((group) => ({
      value: `group:${group}`,
      label: labels.group(group),
    }));
  if (domain === "priority")
    return PRIORITY_VALUES.map((value) => ({
      value: `priority:${value}`,
      label: labels.priority(value),
    }));
  const named = (catalogue[domain] ?? []).map((row) => ({
    value: `target:${row.id}`,
    label: row.name,
  }));
  if (domain === "type") return named;
  return [
    ...(domain === "person"
      ? [{ value: "placeholder", label: labels.placeholder }]
      : []),
    { value: "ignore", label: labels.ignore },
    ...named,
  ];
}
