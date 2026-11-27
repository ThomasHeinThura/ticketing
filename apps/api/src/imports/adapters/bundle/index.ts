import { registerImportAdapter } from "../../engine/adapter";
import { createBundleAdapter } from "./adapter";

export { BUNDLE_CHUNK_SIZE, createBundleAdapter } from "./adapter";
export { BundleSourceError, readBundle } from "./parse";

/** Registers `import.bundle`. Called from `adapters/index.ts`. */
export function registerBundleAdapter() {
  registerImportAdapter("import.bundle", () => createBundleAdapter());
}
