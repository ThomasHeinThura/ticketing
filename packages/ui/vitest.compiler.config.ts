import { resolve } from "node:path";
import { loadConfigFromFile } from "vite";

// Run the application-owned compiler configuration against the shared UI recovery tests.
const loaded = await loadConfigFromFile(
  { command: "serve", mode: "test" },
  resolve(import.meta.dirname, "../../apps/web/vitest.ui-compiler.config.ts"),
);
if (!loaded)
  throw new Error("Could not load the app's UI compiler test configuration");
export default loaded.config;
