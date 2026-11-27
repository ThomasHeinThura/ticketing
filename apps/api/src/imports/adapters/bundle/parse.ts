/**
 * Reads the connection config of an `import.bundle` source and parses its NDJSON text with the
 * bundle schema (`./schema`). Pure: no network, no credential.
 */

import type { ConnectFailureReason } from "../../engine/adapter";
import {
  type BundleItem,
  type BundleProject,
  MAX_BUNDLE_BYTES,
  type ParsedBundle,
  parseBundleText,
} from "./schema";

const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export class BundleSourceError extends Error {
  constructor(readonly reason: ConnectFailureReason) {
    super(reason);
    this.name = "BundleSourceError";
  }
}

export type BundleView = {
  bundle: ParsedBundle;
  project: BundleProject;
  /** This project's items, in file order. */
  items: BundleItem[];
};

// One entry: the engine reads pages of the same text one after another.
let last: { text: string; bundle: ParsedBundle } | null = null;

function parseCached(text: string): ParsedBundle {
  if (last?.text === text) return last.bundle;
  const bundle = parseBundleText(text, { maxIssues: 1 });
  last = { text, bundle };
  return bundle;
}

/** Throws `BundleSourceError` with a fixed reason; never carries file content. */
export function readBundle(config: Record<string, unknown>): BundleView {
  const text = config.bundleText;
  if (typeof text !== "string" || text.length === 0)
    throw new BundleSourceError("export_text_missing");
  if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES)
    throw new BundleSourceError("file_too_large");
  const bundle = parseCached(text);
  if (bundle.errorCount > 0) throw new BundleSourceError("invalid_export");
  const wanted = config.projectKey;
  if (
    wanted !== undefined &&
    (typeof wanted !== "string" || !PROJECT_KEY.test(wanted))
  )
    throw new BundleSourceError("invalid_configuration");
  const projects = [...bundle.projects.values()];
  const project =
    wanted === undefined
      ? projects.length === 1
        ? projects[0]
        : undefined
      : projects.find((p) => p.key.toLowerCase() === wanted.toLowerCase());
  if (!project)
    throw new BundleSourceError(
      wanted === undefined ? "invalid_configuration" : "not_found",
    );
  return {
    bundle,
    project,
    items: bundle.items.filter((item) => item.project === project.id),
  };
}
