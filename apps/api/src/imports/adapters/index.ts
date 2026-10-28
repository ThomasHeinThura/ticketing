/**
 * CSV-family import adapters (P6 Lane C1): generic CSV, Planner CSV, Power Apps CSV.
 *
 * Wiring: `ensureImportAdaptersRegistered()` registers every adapter (CSV family, Jira and JSM, Azure
 * DevOps, Plane) once per process. It is called when the import router is built and when the runner
 * starts, so any process role can resolve an adapter by plugin id. Registration never replaces an
 * adapter registered earlier (tests, deployment hooks).
 *
 * Jira and JSM export mode reads the export from the connection's inline `config.exportText`
 * (size-limited, see `MAX_INLINE_EXPORT_BYTES`). There is no stored-file service, so a `config.exportFile`
 * reference resolves to nothing and the source reports `export_text_missing`.
 */
import {
  registerImportAdapter,
  registerMissingImportAdapters,
} from "../engine/adapter";
import { registerAzureDevOpsAdapter } from "./azure-devops";
import { createCsvAdapter } from "./csv";
import { registerJiraAdapters } from "./jira";
import { registerPlaneAdapter } from "./plane";
import { createPlannerCsvAdapter } from "./planner-csv";
import { createPowerAppsAdapter } from "./power-apps";

export function registerCsvImportAdapters() {
  registerImportAdapter("import.csv", createCsvAdapter);
  registerImportAdapter("import.planner", createPlannerCsvAdapter);
  registerImportAdapter("import.power-apps", createPowerAppsAdapter);
}

export { createCsvAdapter, createPlannerCsvAdapter, createPowerAppsAdapter };

let registered = false;

export function ensureImportAdaptersRegistered() {
  if (registered) return;
  registered = true;
  registerMissingImportAdapters(() => {
    registerCsvImportAdapters();
    registerJiraAdapters({ loadExportFile: async () => null });
    registerAzureDevOpsAdapter();
    registerPlaneAdapter();
  });
}
