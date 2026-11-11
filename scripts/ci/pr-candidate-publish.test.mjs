/** Synthetic local OCI fixtures and a fake registry; never builds or publishes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CANDIDATE_REPOSITORY,
  CANDIDATE_WORKFLOW,
  candidateCoordinates,
} from "../../deploy/pr-candidate-attestation.mjs";
import { validateCandidateStage } from "./pr-candidate-policy.mjs";
import {
  inspectCandidateLayout,
  platformDigests,
  publishCandidateLayout,
} from "./pr-candidate-publish.mjs";
import { prepareCandidateScans } from "./pr-candidate-scan.mjs";

const INDEX = "application/vnd.oci.image.index.v1+json";
const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const coordinates = candidateCoordinates({
  sourceSha: "a".repeat(40),
  runId: "123",
  runAttempt: "2",
});
const repository = coordinates.name.slice(8);
async function fixture(
  t,
  mutateIndex = () => {},
  mutateManifest = () => {},
  mutateAttestation = () => {},
) {
  const dir = await mkdtemp(join(tmpdir(), "taskdesk-candidate-layout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "blobs", "sha256"), { recursive: true });
  const blob = async (value, mediaType) => {
    const content = typeof value === "string" ? value : JSON.stringify(value);
    const hex = createHash("sha256").update(content).digest("hex");
    await writeFile(join(dir, "blobs", "sha256", hex), content);
    return {
      mediaType,
      digest: `sha256:${hex}`,
      size: Buffer.byteLength(content),
    };
  };
  const manifests = [];
  const blobFiles = [];
  for (const architecture of ["amd64", "arm64"]) {
    const config = await blob(
      { architecture, os: "linux", rootfs: { type: "layers", diff_ids: [] } },
      "application/vnd.oci.image.config.v1+json",
    );
    blobFiles.push(join(dir, "blobs", "sha256", config.digest.slice(7)));
    const document = {
      schemaVersion: 2,
      mediaType: MANIFEST,
      config,
      layers: [],
    };
    await mutateManifest(document, architecture, blob);
    manifests.push({
      ...(await blob(document, MANIFEST)),
      platform: { os: "linux", architecture },
    });
  }
  const attestationConfig = await blob(
    { architecture: "unknown", os: "unknown" },
    "application/vnd.oci.image.config.v1+json",
  );
  for (const manifest of [...manifests]) {
    const layer = await blob(
      {
        _type: "https://in-toto.io/Statement/v0.1",
        predicateType: "https://example.invalid/test-only",
        subject: [],
        predicate: { testOnly: manifest.digest },
      },
      "application/vnd.in-toto+json",
    );
    const document = {
      schemaVersion: 2,
      mediaType: MANIFEST,
      config: attestationConfig,
      layers: [layer],
    };
    await mutateAttestation(document, blob);
    const descriptor = await blob(document, MANIFEST);
    manifests.push({
      ...descriptor,
      platform: { os: "unknown", architecture: "unknown" },
      annotations: {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": manifest.digest,
      },
    });
  }
  const index = { schemaVersion: 2, mediaType: INDEX, manifests };
  mutateIndex(index);
  const root = await blob(index, INDEX);
  await writeFile(
    join(dir, "oci-layout"),
    JSON.stringify({ imageLayoutVersion: "1.0.0" }),
  );
  await writeFile(
    join(dir, "index.json"),
    JSON.stringify({ schemaVersion: 2, mediaType: INDEX, manifests: [root] }),
  );
  return { dir, digest: root.digest, index, blobFiles };
}
function registry({ uploadLocation, override = () => {} } = {}) {
  const calls = [];
  const manifests = new Map();
  const response = (status, headers = {}, body = "") =>
    new Response(body, { status, headers });
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    const method = options.method || "GET";
    const call = { url: parsed, method, options };
    calls.push(call);
    const changed = override(call);
    if (changed) return changed;
    assert.equal(options.redirect, "error");
    assert.equal(parsed.origin, "https://ghcr.io");
    if (parsed.pathname === "/token") {
      assert.equal(
        parsed.searchParams.get("scope"),
        `repository:${repository}:pull,push`,
      );
      return response(
        200,
        { "Content-Type": "application/json" },
        JSON.stringify({ token: "synthetic-scoped-token" }),
      );
    }
    assert.equal(
      options.headers.Authorization,
      "Bearer synthetic-scoped-token",
    );
    assert.ok(parsed.pathname.startsWith(`/v2/${repository}/`));
    if (method === "HEAD") return response(404);
    if (method === "POST")
      return response(202, {
        Location:
          uploadLocation ??
          `https://ghcr.io/v2/${repository}/blobs/uploads/example?state=synthetic`,
      });
    if (method === "PUT" && parsed.pathname.includes("/blobs/uploads/")) {
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of options.body) {
        hash.update(chunk);
        size += chunk.length;
      }
      assert.equal(String(size), options.headers["Content-Length"]);
      const digest = `sha256:${hash.digest("hex")}`;
      assert.equal(parsed.searchParams.get("digest"), digest);
      return response(201, { "Docker-Content-Digest": digest });
    }
    if (method === "PUT" && parsed.pathname.includes("/manifests/")) {
      const digest = `sha256:${createHash("sha256").update(options.body).digest("hex")}`;
      manifests.set(digest, options.body);
      return response(201, { "Docker-Content-Digest": digest });
    }
    if (method === "GET") {
      const digest = parsed.pathname.split("/").at(-1);
      return response(
        200,
        { "Docker-Content-Digest": digest },
        manifests.get(digest),
      );
    }
    assert.fail("unexpected fake registry call");
  };
  return { fetcher, calls };
}
function options(f, fake) {
  return {
    layoutDir: f.dir,
    expectedDigest: f.digest,
    sourceSha: "a".repeat(40),
    runId: "123",
    runAttempt: "2",
    actor: "synthetic-actor",
    token: "synthetic-credential",
    beforePublish: () => ({ run_id: "123", run_attempt: "2" }),
    fetcher: fake.fetcher,
  };
}
function stageEnvironment(f) {
  const env = {
    GITHUB_REPOSITORY: CANDIDATE_REPOSITORY,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@refs/heads/main`,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    SOURCE_REF: "refs/heads/fix/example",
    SOURCE_SHA: "a".repeat(40),
    TARGET_MAIN_SHA: "b".repeat(40),
    POLICY_SHA: "b".repeat(40),
    PULL_REQUEST: "",
    CANDIDATE_IMAGE: coordinates.name,
    CANDIDATE_DIGEST: f.digest,
  };
  for (const producer of ["RESOLVED", "BUILD", "SCAN"]) {
    env[`${producer}_RUN_ID`] = "123";
    env[`${producer}_RUN_ATTEMPT`] = "2";
  }
  return env;
}
function liveRefs(change = "") {
  const calls = [];
  const run = (_bin, args) => {
    calls.push(args);
    const endpoint = args[1];
    let value;
    if (endpoint.endsWith("heads/main"))
      value = {
        ref: "refs/heads/main",
        object: {
          type: "commit",
          sha: change === "main" ? "c".repeat(40) : "b".repeat(40),
        },
      };
    else if (endpoint.endsWith("heads/fix/example"))
      value = {
        ref: "refs/heads/fix/example",
        object: {
          type: "commit",
          sha: change === "source" ? "c".repeat(40) : "a".repeat(40),
        },
      };
    else
      value = {
        sha: "a".repeat(40),
        committer: { date: "2026-11-10T01:02:03Z" },
      };
    return { status: 0, stdout: JSON.stringify(value) };
  };
  return { run, calls };
}
describe("non-executing OCI graph validation", () => {
  it("validates every blob and preserves both platform and build attestation manifests", async (t) => {
    const f = await fixture(t);
    const result = await inspectCandidateLayout(f.dir, f.digest);
    assert.equal(result.nodes.at(-1).digest, f.digest);
    assert.deepEqual(result.platforms, platformDigests(f.index));
    assert.equal(
      result.nodes.filter((node) => node.mediaType === MANIFEST).length,
      4,
    );
  });
  it("creates separate Trivy OCI inputs pinned to each exact platform digest", async (t) => {
    const f = await fixture(t);
    const scanDir = join(f.dir, "scan-views");
    const output = await prepareCandidateScans({
      layoutDir: f.dir,
      scanDir,
      expectedDigest: f.digest,
    });
    assert.equal(output.digest, f.digest);
    for (const architecture of ["amd64", "arm64"]) {
      const index = JSON.parse(
        await readFile(join(scanDir, architecture, "index.json"), "utf8"),
      );
      assert.equal(index.manifests.length, 1);
      assert.equal(index.manifests[0].digest, output[`${architecture}_digest`]);
      assert.equal(index.manifests[0].platform.architecture, architecture);
      const manifest = JSON.parse(
        await readFile(
          join(
            scanDir,
            architecture,
            "blobs",
            "sha256",
            output[`${architecture}_digest`].slice(7),
          ),
          "utf8",
        ),
      );
      const config = JSON.parse(
        await readFile(
          join(
            scanDir,
            architecture,
            "blobs",
            "sha256",
            manifest.config.digest.slice(7),
          ),
          "utf8",
        ),
      );
      assert.equal(config.architecture, architecture);
    }
    await assert.rejects(
      prepareCandidateScans({
        layoutDir: f.dir,
        scanDir,
        expectedDigest: f.digest,
      }),
    );
  });
  for (const label of [
    "missing platform",
    "duplicate platform",
    "extra platform",
    "unknown attestation target",
    "duplicate platform digest",
    "external URL",
    "embedded data",
  ])
    it(`rejects ${label}`, async (t) => {
      const f = await fixture(t, (index) => {
        if (label === "missing platform")
          index.manifests = index.manifests.filter(
            (m) => m.platform.architecture !== "arm64",
          );
        if (label === "duplicate platform")
          index.manifests.push(index.manifests[0]);
        if (label === "extra platform")
          index.manifests[0].platform.architecture = "riscv64";
        if (label === "unknown attestation target")
          index.manifests[2].annotations["vnd.docker.reference.digest"] =
            `sha256:${"f".repeat(64)}`;
        if (label === "duplicate platform digest")
          index.manifests[1] = {
            ...index.manifests[0],
            platform: { os: "linux", architecture: "arm64" },
          };
        if (label === "external URL")
          index.manifests[0].urls = ["https://attacker.invalid/blob"];
        if (label === "embedded data")
          index.manifests[0].data = "attacker-data";
      });
      await assert.rejects(inspectCandidateLayout(f.dir, f.digest));
    });
  for (const [label, mutateImage, mutateAttestation] of [
    [
      "hidden attestation tar layer",
      async () => {},
      async (m, blob) => {
        m.layers.push(
          await blob(
            "hidden tar payload",
            "application/vnd.oci.image.layer.v1.tar",
          ),
        );
      },
    ],
    [
      "nested manifest as image config",
      async (m, _arch, blob) => {
        m.config = await blob({ ...m }, MANIFEST);
      },
      async () => {},
    ],
    [
      "nested manifest as image layer",
      async (m, _arch, blob) => {
        m.layers.push(await blob({ ...m }, MANIFEST));
      },
      async () => {},
    ],
    [
      "attestation JSON as runtime layer",
      async (m, _arch, blob) => {
        m.layers.push(
          await blob(
            {
              _type: "https://in-toto.io/Statement/v0.1",
              subject: [],
              predicateType: "https://example.invalid/test-only",
              predicate: {},
            },
            "application/vnd.in-toto+json",
          ),
        );
      },
      async () => {},
    ],
    [
      "nested index as image layer",
      async (m, _arch, blob) => {
        m.layers.push(
          await blob(
            { schemaVersion: 2, mediaType: INDEX, manifests: [] },
            INDEX,
          ),
        );
      },
      async () => {},
    ],
    [
      "nested manifest as attestation config",
      async () => {},
      async (m, blob) => {
        m.config = await blob({ ...m }, MANIFEST);
      },
    ],
    [
      "nested manifest as attestation layer",
      async () => {},
      async (m, blob) => {
        m.layers.push(await blob({ ...m }, MANIFEST));
      },
    ],
    [
      "non-JSON attestation payload",
      async () => {},
      async (m, blob) => {
        m.layers = [
          await blob("not JSON tar bytes", "application/vnd.in-toto+json"),
        ];
      },
    ],
    [
      "non-statement attestation JSON",
      async () => {},
      async (m, blob) => {
        m.layers = [
          await blob({ hidden: "payload" }, "application/vnd.in-toto+json"),
        ];
      },
    ],
    [
      "attestation runtime filesystem config",
      async () => {},
      async (m, blob) => {
        m.config = await blob(
          {
            os: "unknown",
            architecture: "unknown",
            rootfs: { diff_ids: ["sha256:hidden"] },
          },
          "application/vnd.oci.image.config.v1+json",
        );
      },
    ],
  ])
    it(`rejects ${label} before any registry request`, async (t) => {
      const f = await fixture(t, () => {}, mutateImage, mutateAttestation);
      const fake = registry();
      await assert.rejects(publishCandidateLayout(options(f, fake)));
      assert.equal(fake.calls.length, 0);
    });
  it("rejects wrong build root, corrupted bytes and missing blobs before registry authentication", async (t) => {
    const f = await fixture(t);
    const fake = registry();
    await assert.rejects(
      publishCandidateLayout({
        ...options(f, fake),
        expectedDigest: `sha256:${"f".repeat(64)}`,
      }),
    );
    assert.equal(fake.calls.length, 0);
    await writeFile(f.blobFiles[0], "changed bytes");
    await assert.rejects(
      publishCandidateLayout(options(f, fake)),
      /blob (size|digest) mismatch/,
    );
    assert.equal(fake.calls.length, 0);
    await rm(f.blobFiles[0]);
    await assert.rejects(publishCandidateLayout(options(f, fake)));
    assert.equal(fake.calls.length, 0);
  });
  it("rejects symlinked OCI content before credential use", async (t) => {
    const f = await fixture(t);
    const fake = registry();
    const content = await readFile(f.blobFiles[0]);
    const replacement = join(f.dir, "replacement");
    await writeFile(replacement, content);
    await rm(f.blobFiles[0]);
    await symlink(replacement, f.blobFiles[0]);
    await assert.rejects(
      publishCandidateLayout(options(f, fake)),
      /regular file/,
    );
    assert.equal(fake.calls.length, 0);
  });
  it("rejects unsupported layer media types", async (t) => {
    const f = await fixture(
      t,
      () => {},
      (manifest) => {
        manifest.config.mediaType = "application/foreign-code";
      },
    );
    await assert.rejects(
      inspectCandidateLayout(f.dir, f.digest),
      /unsupported OCI descriptor/,
    );
  });
});
describe("package-scoped OCI registry copy", () => {
  for (const producer of ["RESOLVED", "BUILD", "SCAN"])
    it(`refuses stale ${producer.toLowerCase()} attempt before registry auth or live ref reads`, async (t) => {
      const f = await fixture(t);
      const fake = registry();
      const env = stageEnvironment(f);
      const gh = liveRefs();
      env[`${producer}_RUN_ATTEMPT`] = "1";
      await assert.rejects(
        publishCandidateLayout({
          ...options(f, fake),
          beforePublish: () =>
            validateCandidateStage(env, ["BUILD", "SCAN"], gh.run),
        }),
        /run attempt does not match/,
      );
      assert.equal(gh.calls.length, 0);
      assert.equal(fake.calls.length, 0);
    });
  for (const moved of ["main", "source"])
    it(`rejects moved live ${moved} before any registry request`, async (t) => {
      const f = await fixture(t);
      const fake = registry();
      const env = stageEnvironment(f);
      const gh = liveRefs(moved);
      await assert.rejects(
        publishCandidateLayout({
          ...options(f, fake),
          beforePublish: () =>
            validateCandidateStage(env, ["BUILD", "SCAN"], gh.run),
        }),
        /moved/,
      );
      assert.equal(fake.calls.length, 0);
    });
  it("rechecks authority before the final tag and leaves no final tag after live ref drift during upload", async (t) => {
    const f = await fixture(t);
    const fake = registry();
    const env = stageEnvironment(f);
    let checks = 0;
    await assert.rejects(
      publishCandidateLayout({
        ...options(f, fake),
        beforePublish: () => {
          checks++;
          return validateCandidateStage(
            env,
            ["BUILD", "SCAN"],
            liveRefs(checks === 2 ? "source" : "").run,
          );
        },
      }),
      /moved/,
    );
    assert.equal(checks, 2);
    assert.equal(
      fake.calls.some(
        (call) =>
          call.method === "PUT" && call.url.pathname.endsWith(coordinates.tag),
      ),
      false,
    );
  });
  it("requires a matching publication authority guard", async (t) => {
    const f = await fixture(t);
    const fake = registry();
    await assert.rejects(
      publishCandidateLayout({ ...options(f, fake), beforePublish: undefined }),
      /authority guard/,
    );
    await assert.rejects(
      publishCandidateLayout({
        ...options(f, fake),
        beforePublish: () => ({ run_id: "123", run_attempt: "1" }),
      }),
      /run binding/,
    );
    assert.equal(fake.calls.length, 0);
  });

  it("uploads digest-preserving manifests and blobs without candidate execution, then verifies the published root", async (t) => {
    const f = await fixture(t);
    const fake = registry();
    const output = await publishCandidateLayout(options(f, fake));
    assert.equal(output.digest, f.digest);
    assert.equal(output.amd64_digest, f.index.manifests[0].digest);
    assert.equal(output.arm64_digest, f.index.manifests[1].digest);
    assert.ok(
      fake.calls.some(
        (call) =>
          call.method === "PUT" && call.url.pathname.endsWith(coordinates.tag),
      ),
    );
    assert.equal(fake.calls.at(-1).method, "GET");
    assert.equal(fake.calls.at(-1).url.pathname.split("/").at(-1), f.digest);
  });
  for (const location of [
    "https://attacker.invalid/v2/steal/blobs/uploads/id",
    "https://ghcr.io/v2/thomasheinthura/taskdesk/blobs/uploads/id",
    "http://ghcr.io/v2/test/blobs/uploads/id",
    "https://user:password@ghcr.io/v2/invalid/blobs/uploads/id",
  ])
    it(`rejects an upload location outside the exact candidate package (${new URL(location).hostname})`, async (t) => {
      const f = await fixture(t);
      const fake = registry({ uploadLocation: location });
      await assert.rejects(
        publishCandidateLayout(options(f, fake)),
        /outside the candidate package/,
      );
      assert.equal(
        fake.calls.some((call) => call.method === "PUT"),
        false,
      );
    });
  for (const [label, override] of [
    [
      "existing tag",
      (call) =>
        call.method === "HEAD" ? new Response("", { status: 200 }) : undefined,
    ],
    [
      "ambiguous destination",
      (call) =>
        call.method === "HEAD" ? new Response("", { status: 403 }) : undefined,
    ],
    [
      "failed authentication",
      (call) =>
        call.url.pathname === "/token"
          ? new Response("", { status: 403 })
          : undefined,
    ],
    [
      "wrong upload digest",
      (call) =>
        call.method === "PUT"
          ? new Response("", {
              status: 201,
              headers: { "Docker-Content-Digest": "sha256:wrong" },
            })
          : undefined,
    ],
    [
      "changed published bytes",
      (call) =>
        call.method === "GET" && call.url.pathname !== "/token"
          ? new Response("substitution", { status: 200 })
          : undefined,
    ],
  ])
    it(`rejects ${label}`, async (t) => {
      const f = await fixture(t);
      const fake = registry({ override });
      await assert.rejects(publishCandidateLayout(options(f, fake)));
    });
  it("does not leak a request failure's sensitive details", async (t) => {
    const f = await fixture(t);
    await assert.rejects(
      publishCandidateLayout({
        ...options(f, registry()),
        fetcher: async () => {
          throw new Error("sensitive token in downstream message");
        },
      }),
      { message: "Candidate publication: registry request failed." },
    );
  });
});
