import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function sha256File(filename) {
  try {
    return createHash("sha256")
      .update(await readFile(filename))
      .digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256TrackedTree(root, prefixes = []) {
  const args = ["ls-files", "-z"];
  if (prefixes.length) args.push("--", ...prefixes);
  const listed = execFileSync("git", args, { cwd: root });
  const names = listed.toString("utf8").split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  for (const name of names) {
    digest.update(name);
    digest.update("\0");
    digest.update(await readFile(path.join(root, name)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function collectHostedDragSourceBinding(root) {
  const fixturePath = path.join(
    root,
    "apps/web/e2e/helpers/g11-performance-fixture.ts",
  );
  const manifestPath = path.join(
    root,
    "apps/web/dist/agent/.vite/manifest.json",
  );
  return {
    commitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    sourceTreeSha256: await sha256TrackedTree(root),
    webSourceSha256: await sha256TrackedTree(root, ["apps/web"]),
    buildManifestSha256: await sha256File(manifestPath),
    fixtureSha256: await sha256File(fixturePath),
  };
}
