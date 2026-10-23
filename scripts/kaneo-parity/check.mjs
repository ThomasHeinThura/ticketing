import path from "node:path";
import { validatePair } from "./manifest.mjs";
import { runComparison } from "./run-comparison.mjs";

try {
  const [
    upstreamDirectory,
    candidateDirectory,
    candidateSource = process.cwd(),
  ] = process.argv.slice(2);
  if (!upstreamDirectory || !candidateDirectory)
    throw new Error(
      "Usage: check:kaneo-parity UPSTREAM_CAPTURE_DIR CANDIDATE_CAPTURE_DIR [CANDIDATE_SOURCE_DIR]",
    );
  const upstream = path.resolve(upstreamDirectory);
  const candidate = path.resolve(candidateDirectory);
  validatePair(upstream, candidate, path.resolve(candidateSource));
  const result = runComparison(upstream, candidate);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Kaneo parity failed: ${error.message}`);
  process.exitCode = 1;
}
