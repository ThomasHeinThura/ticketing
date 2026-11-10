/** Copy an OCI graph without running candidate content or adding a registry client.
 * Only this trusted-main helper receives the package-scoped registry credentials. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateCoordinates } from "../../deploy/pr-candidate-attestation.mjs";
import {
  validateCandidateStage,
  writeOutputs,
} from "./pr-candidate-policy.mjs";

const INDEX = "application/vnd.oci.image.index.v1+json";
const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const CONFIG = "application/vnd.oci.image.config.v1+json";
const ATTESTATION = "application/vnd.in-toto+json";
const LAYER_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar+gzip",
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+zstd",
]);
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const fail = (message) => {
  throw new Error(`Candidate publication: ${message}`);
};
async function regular(file) {
  const stat = await lstat(file);
  if (!stat.isFile()) fail("OCI content must be a regular file.");
  return stat;
}
export function platformDigests(index) {
  if (
    index?.schemaVersion !== 2 ||
    index.mediaType !== INDEX ||
    !Array.isArray(index.manifests)
  )
    fail("invalid OCI image index.");
  const platforms = {};
  for (const manifest of index.manifests) {
    if (
      manifest?.mediaType !== MANIFEST ||
      !digestPattern.test(manifest.digest)
    )
      fail("invalid image descriptor.");
    const platform = `${manifest.platform?.os}/${manifest.platform?.architecture}`;
    if (["linux/amd64", "linux/arm64"].includes(platform)) {
      if (
        platforms[platform] ||
        (manifest.platform.variant &&
          !(platform === "linux/arm64" && manifest.platform.variant === "v8"))
      )
        fail("duplicate or unexpected platform variant.");
      platforms[platform] = manifest.digest;
    } else if (
      platform !== "unknown/unknown" ||
      manifest.annotations?.["vnd.docker.reference.type"] !==
        "attestation-manifest"
    )
      fail("unexpected image platform.");
  }
  if (
    Object.keys(platforms).length !== 2 ||
    new Set(Object.values(platforms)).size !== 2
  )
    fail("both distinct shipping platforms are required.");
  for (const manifest of index.manifests)
    if (
      manifest.platform.os === "unknown" &&
      !Object.values(platforms).includes(
        manifest.annotations?.["vnd.docker.reference.digest"],
      )
    )
      fail("build attestation references an unknown platform.");
  return platforms;
}
export async function inspectCandidateLayout(layoutDir, expectedDigest) {
  if (!digestPattern.test(expectedDigest))
    fail("expected root digest is invalid.");
  for (const directory of [
    layoutDir,
    join(layoutDir, "blobs"),
    join(layoutDir, "blobs", "sha256"),
  ])
    if (!(await lstat(directory)).isDirectory())
      fail("OCI layout directories must not be symlinks.");
  await regular(join(layoutDir, "oci-layout"));
  if (
    JSON.parse(await readFile(join(layoutDir, "oci-layout"), "utf8"))
      .imageLayoutVersion !== "1.0.0"
  )
    fail("invalid OCI layout version.");
  await regular(join(layoutDir, "index.json"));
  const layoutIndex = JSON.parse(
    await readFile(join(layoutDir, "index.json"), "utf8"),
  );
  if (
    layoutIndex.schemaVersion !== 2 ||
    !Array.isArray(layoutIndex.manifests) ||
    layoutIndex.manifests.length !== 1 ||
    layoutIndex.manifests[0].digest !== expectedDigest ||
    layoutIndex.manifests[0].mediaType !== INDEX
  )
    fail("OCI layout must bind exactly the build's root index digest.");
  const nodes = new Map();
  let platforms;
  const visit = async (descriptor, role) => {
    const kind = role.split(":")[0];
    const allowed =
      kind === "root"
        ? [INDEX]
        : ["image-manifest", "attestation-manifest"].includes(kind)
          ? [MANIFEST]
          : ["image-config", "attestation-config"].includes(kind)
            ? [CONFIG]
            : kind === "image-layer"
              ? [...LAYER_TYPES]
              : kind === "attestation-layer"
                ? [ATTESTATION]
                : [];
    if (
      !digestPattern.test(descriptor?.digest) ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size < 0 ||
      descriptor.urls ||
      descriptor.data ||
      !allowed.includes(descriptor.mediaType)
    )
      fail("unsupported OCI descriptor for its graph role.");
    const existing = nodes.get(descriptor.digest);
    if (existing) {
      if (
        existing.size !== descriptor.size ||
        existing.mediaType !== descriptor.mediaType ||
        existing.role !== role
      )
        fail("conflicting OCI descriptor roles.");
      return;
    }
    const file = join(layoutDir, "blobs", "sha256", descriptor.digest.slice(7));
    const stat = await regular(file);
    if (stat.size !== descriptor.size) fail("OCI blob size mismatch.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (`sha256:${hash.digest("hex")}` !== descriptor.digest)
      fail("OCI blob digest mismatch.");
    const node = { ...descriptor, file, role };
    if (kind !== "image-layer") {
      if (stat.size > 32 * 1024 * 1024) fail("OCI metadata is too large.");
      node.content = await readFile(file);
      try {
        node.document = JSON.parse(node.content);
      } catch {
        fail("OCI metadata must be JSON for its graph role.");
      }
      if (
        !node.document ||
        typeof node.document !== "object" ||
        Array.isArray(node.document)
      )
        fail("invalid OCI metadata object.");
    }
    const document = node.document;
    if (kind === "root" || kind.endsWith("manifest")) {
      if (
        document.schemaVersion !== 2 ||
        document.mediaType !== descriptor.mediaType ||
        document.subject
      )
        fail("invalid OCI manifest body.");
      if (kind === "root") {
        if (document.config || document.layers)
          fail("index contains image-manifest fields.");
        platforms = platformDigests(document);
        if (document.manifests.length > 64) fail("too many OCI manifests.");
        for (const child of document.manifests) {
          const childRole =
            child.platform.os === "linux"
              ? `image-manifest:${child.platform.architecture}`
              : "attestation-manifest";
          await visit(child, childRole);
        }
      } else {
        if (
          document.manifests ||
          !Array.isArray(document.layers) ||
          document.layers.length > 63 ||
          (kind === "attestation-manifest" && !document.layers.length)
        )
          fail("invalid OCI image-manifest children.");
        const architecture = role.split(":")[1];
        await visit(
          document.config,
          kind === "image-manifest"
            ? `image-config:${architecture}`
            : "attestation-config",
        );
        for (const child of document.layers)
          await visit(
            child,
            kind === "image-manifest" ? "image-layer" : "attestation-layer",
          );
      }
    } else if (kind === "image-config") {
      if (
        document.os !== "linux" ||
        document.architecture !== role.split(":")[1] ||
        document.manifests ||
        document.config?.mediaType ||
        document.layers
      )
        fail("runtime image config does not match its platform role.");
    } else if (kind === "attestation-config") {
      if (
        document.os !== "unknown" ||
        document.architecture !== "unknown" ||
        document.manifests ||
        document.layers ||
        document.config?.mediaType ||
        document.rootfs?.diff_ids?.length
      )
        fail("attestation config must not contain a runtime filesystem.");
    } else if (kind === "attestation-layer") {
      if (
        ![
          "https://in-toto.io/Statement/v0.1",
          "https://in-toto.io/Statement/v1",
        ].includes(document._type) ||
        typeof document.predicateType !== "string" ||
        !document.predicateType ||
        !Array.isArray(document.subject) ||
        !document.predicate ||
        typeof document.predicate !== "object" ||
        Array.isArray(document.predicate)
      )
        fail("attestation layers must contain in-toto JSON statements.");
    }
    // Insert children first so registry manifest references always resolve.
    nodes.set(descriptor.digest, node);
  };
  await visit(layoutIndex.manifests[0], "root");
  if (new Set([expectedDigest, ...Object.values(platforms)]).size !== 3)
    fail("index and platform digests must differ.");
  return { nodes: [...nodes.values()], platforms };
}
export async function publishCandidateLayout({
  layoutDir,
  expectedDigest,
  sourceSha,
  runId,
  runAttempt,
  actor,
  token,
  beforePublish,
  fetcher = fetch,
}) {
  const coordinates = candidateCoordinates({ sourceSha, runId, runAttempt });
  const { nodes, platforms } = await inspectCandidateLayout(
    layoutDir,
    expectedDigest,
  );
  if (typeof beforePublish !== "function")
    fail("run/ref authority guard is required.");
  const binding = beforePublish();
  if (binding?.run_id !== runId || binding?.run_attempt !== runAttempt)
    fail("publication run binding is invalid.");
  if (!actor || !token) fail("registry credentials are required.");
  const repository = coordinates.name.slice("ghcr.io/".length);
  const base = `https://ghcr.io/v2/${repository}`;
  const request = async (url, options = {}) => {
    try {
      return await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(300000),
      });
    } catch {
      return fail("registry request failed.");
    }
  };
  const authUrl = new URL("https://ghcr.io/token");
  authUrl.searchParams.set("service", "ghcr.io");
  authUrl.searchParams.set("scope", `repository:${repository}:pull,push`);
  const authResponse = await request(authUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}`,
    },
  });
  if (!authResponse.ok) fail("registry authentication failed.");
  let auth;
  try {
    auth = await authResponse.json();
  } catch {
    fail("registry authentication response is invalid.");
  }
  const bearer = auth.token || auth.access_token;
  if (typeof bearer !== "string" || !bearer || /[\r\n]/.test(bearer))
    fail("invalid registry token.");
  const headers = { Authorization: `Bearer ${bearer}` };
  const unused = await request(`${base}/manifests/${coordinates.tag}`, {
    method: "HEAD",
    headers: { ...headers, Accept: INDEX },
  });
  if (unused.status !== 404)
    fail(
      "candidate destination is already used or cannot be established as unused.",
    );
  for (const node of nodes) {
    if ([INDEX, MANIFEST].includes(node.mediaType)) {
      const response = await request(`${base}/manifests/${node.digest}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": node.mediaType },
        body: node.content,
      });
      if (
        response.status !== 201 ||
        response.headers.get("Docker-Content-Digest") !== node.digest
      )
        fail("registry manifest publication failed.");
    } else {
      const start = await request(`${base}/blobs/uploads/`, {
        method: "POST",
        headers,
      });
      if (start.status !== 202 || !start.headers.get("Location"))
        fail("blob upload could not start.");
      const location = new URL(start.headers.get("Location"), base);
      if (
        location.origin !== "https://ghcr.io" ||
        !location.pathname.startsWith(`/v2/${repository}/blobs/uploads/`) ||
        location.username ||
        location.password ||
        location.hash
      )
        fail("registry upload location is outside the candidate package.");
      location.searchParams.set("digest", node.digest);
      const response = await request(location, {
        method: "PUT",
        headers: {
          ...headers,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(node.size),
        },
        body: createReadStream(node.file),
        duplex: "half",
      });
      if (
        response.status !== 201 ||
        response.headers.get("Docker-Content-Digest") !== node.digest
      )
        fail("registry blob publication failed.");
    }
  }
  // Hashing/uploading a graph can take time. Recheck the frozen authority again
  // before creating the final tag; drift leaves only unsigned partial content.
  const finalBinding = beforePublish();
  if (
    finalBinding?.run_id !== runId ||
    finalBinding?.run_attempt !== runAttempt
  )
    fail("publication run binding is invalid.");
  const root = nodes.find((node) => node.digest === expectedDigest);
  const tagged = await request(`${base}/manifests/${coordinates.tag}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": INDEX },
    body: root.content,
  });
  if (
    tagged.status !== 201 ||
    tagged.headers.get("Docker-Content-Digest") !== expectedDigest
  )
    fail("candidate tag publication failed.");
  const check = await request(`${base}/manifests/${expectedDigest}`, {
    headers: { ...headers, Accept: INDEX },
  });
  if (
    !check.ok ||
    `sha256:${createHash("sha256")
      .update(Buffer.from(await check.arrayBuffer()))
      .digest("hex")}` !== expectedDigest
  )
    fail("published root digest could not be independently read back.");
  return {
    digest: expectedDigest,
    amd64_digest: platforms["linux/amd64"],
    arm64_digest: platforms["linux/arm64"],
    ...binding,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const env = process.env;
    const output = await publishCandidateLayout({
      layoutDir: env.LAYOUT_DIR,
      expectedDigest: env.CANDIDATE_DIGEST,
      sourceSha: env.SOURCE_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      actor: env.GITHUB_ACTOR,
      token: env.GHCR_TOKEN,
      beforePublish: () => validateCandidateStage(env, ["BUILD", "SCAN"]),
    });
    writeOutputs(output, env.GITHUB_OUTPUT);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
