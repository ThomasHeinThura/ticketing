/** Trivy v0.73's OCI archive reader chooses the first child of an index and
 * does not apply --platform there. Give each scan its own single-platform view
 * of the already hash-validated graph, rather than accidentally scanning amd64 twice. */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCandidateStage,
  writeOutputs,
} from "./pr-candidate-policy.mjs";
import { inspectCandidateLayout } from "./pr-candidate-publish.mjs";

export async function prepareCandidateScans({
  layoutDir,
  scanDir,
  expectedDigest,
}) {
  const graph = await inspectCandidateLayout(layoutDir, expectedDigest);
  await mkdir(scanDir);
  for (const architecture of ["amd64", "arm64"]) {
    const directory = join(scanDir, architecture);
    await mkdir(directory);
    const descriptor = graph.nodes.find(
      (node) => node.digest === graph.platforms[`linux/${architecture}`],
    );
    await writeFile(
      join(directory, "oci-layout"),
      JSON.stringify({ imageLayoutVersion: "1.0.0" }),
      { flag: "wx" },
    );
    await writeFile(
      join(directory, "index.json"),
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          {
            mediaType: descriptor.mediaType,
            digest: descriptor.digest,
            size: descriptor.size,
            platform: { os: "linux", architecture },
          },
        ],
      }),
      { flag: "wx" },
    );
    // This link is made by trusted policy, after rejecting symlinks in the input.
    // No candidate filesystem content is extracted or executed on the runner.
    await symlink(resolve(layoutDir, "blobs"), join(directory, "blobs"), "dir");
  }
  return {
    digest: expectedDigest,
    amd64_digest: graph.platforms["linux/amd64"],
    arm64_digest: graph.platforms["linux/arm64"],
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const env = process.env;
    const binding = validateCandidateStage(env, ["BUILD"]);
    writeOutputs(
      {
        ...(await prepareCandidateScans({
          layoutDir: env.LAYOUT_DIR,
          scanDir: env.SCAN_DIR,
          expectedDigest: env.CANDIDATE_DIGEST,
        })),
        ...binding,
      },
      env.GITHUB_OUTPUT,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
