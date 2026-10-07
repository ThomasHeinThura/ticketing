import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeAptSourceContent,
  normalizeAptSourceTree,
} from "./normalize-ubuntu-apt-mirror.mjs";

const BLOCKED = "http://azure.archive.ubuntu.com/ubuntu";
const REPLACEMENT = "https://archive.ubuntu.com/ubuntu";

test("mirror list rewrites only the blocked Ubuntu HTTP URI and keeps priorities", () => {
  const input = [
    `${BLOCKED}/\tpriority:1`,
    `${REPLACEMENT}/\tpriority:2`,
    "https://security.ubuntu.com/ubuntu/\tpriority:3",
    "http://packages.microsoft.com/ubuntu/24.04/prod\tpriority:4",
    "http://azure.archive.ubuntu.com/ubuntu-extra\tpriority:5",
    "http://azure.archive.ubuntu.com/ubuntu noble\tpriority:6",
    "",
  ].join("\n");
  const expected = input
    .replace(`${BLOCKED}/\tpriority:1`, `${REPLACEMENT}/\tpriority:1`)
    .replace(`${BLOCKED} noble`, `${REPLACEMENT} noble`);

  assert.equal(normalizeAptSourceContent(input, "mirror-list"), expected);
});

test("one-line sources rewrite only the source URI and retain suites, components, and options", () => {
  const input = [
    `deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu.gpg] ${BLOCKED}/ noble main restricted`,
    `deb-src ${BLOCKED} noble-updates main`,
    "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main",
    "deb https://azure.archive.ubuntu.com/ubuntu noble main",
    "deb http://azure.archive.ubuntu.com/ubuntu-extra noble main",
    `# deb ${BLOCKED} noble main`,
  ].join("\n");
  const expected = input
    .replace(`${BLOCKED}/ noble`, `${REPLACEMENT}/ noble`)
    .replace(`${BLOCKED} noble-updates`, `${REPLACEMENT} noble-updates`);

  assert.equal(normalizeAptSourceContent(input, "source-list"), expected);
});

test("deb822 rewrites URIs fields only and preserves suites, components, and Signed-By", () => {
  const input = [
    "Types: deb deb-src",
    `URIs: ${BLOCKED}/ https://security.ubuntu.com/ubuntu/`,
    "Suites: noble noble-updates noble-backports noble-security",
    "Components: main restricted universe multiverse",
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg",
    "",
    "Types: deb",
    `URIs:\n  ${BLOCKED}\n  https://packages.microsoft.com/ubuntu/24.04/prod`,
    "Suites: noble",
    "Components: main",
    "",
    `# URIs: ${BLOCKED}`,
  ].join("\n");
  const expected = input
    .replace(`${BLOCKED}/ https://security`, `${REPLACEMENT}/ https://security`)
    .replace(`  ${BLOCKED}\n`, `  ${REPLACEMENT}\n`);

  assert.equal(normalizeAptSourceContent(input, "deb822"), expected);
  assert.throws(
    () => normalizeAptSourceContent(input, "arbitrary"),
    /Unsupported/,
  );
});

test("APT source walk updates only mirror list and active source files", async () => {
  const aptRoot = await mkdtemp(path.join(os.tmpdir(), "taskdesk-apt-source-"));
  const sourceDirectory = path.join(aptRoot, "sources.list.d");
  try {
    await mkdir(sourceDirectory);
    const mirrorList = `${BLOCKED}/\tpriority:1\n${REPLACEMENT}/\tpriority:2\n`;
    const sourceList = `deb ${BLOCKED} noble main\n`;
    const deb822 = `Types: deb\nURIs: ${BLOCKED}/\nSuites: noble\nComponents: main\nSigned-By: /key.gpg\n`;
    await writeFile(path.join(aptRoot, "apt-mirrors.txt"), mirrorList);
    await writeFile(path.join(aptRoot, "sources.list"), sourceList);
    await writeFile(path.join(sourceDirectory, "ubuntu.sources"), deb822);
    await writeFile(
      path.join(sourceDirectory, "third-party.list"),
      "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
    );
    await writeFile(
      path.join(sourceDirectory, "not-an-apt-source.conf"),
      `URI=${BLOCKED}\n`,
    );

    const result = await normalizeAptSourceTree(aptRoot);

    assert.deepEqual(
      result.changed.map((filePath) => path.basename(filePath)).sort(),
      ["apt-mirrors.txt", "sources.list", "ubuntu.sources"],
    );
    assert.equal(
      await readFile(path.join(aptRoot, "apt-mirrors.txt"), "utf8"),
      mirrorList.replace(
        `${BLOCKED}/\tpriority:1`,
        `${REPLACEMENT}/\tpriority:1`,
      ),
    );
    assert.equal(
      await readFile(path.join(aptRoot, "sources.list"), "utf8"),
      sourceList.replace(BLOCKED, REPLACEMENT),
    );
    assert.equal(
      await readFile(path.join(sourceDirectory, "ubuntu.sources"), "utf8"),
      deb822.replace(`${BLOCKED}/`, `${REPLACEMENT}/`),
    );
    assert.equal(
      await readFile(path.join(sourceDirectory, "third-party.list"), "utf8"),
      "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
    );
    assert.equal(
      await readFile(
        path.join(sourceDirectory, "not-an-apt-source.conf"),
        "utf8",
      ),
      `URI=${BLOCKED}\n`,
    );
  } finally {
    await rm(aptRoot, { recursive: true, force: true });
  }
});

test("missing APT mirror/source files are a valid no-op", async () => {
  const aptRoot = await mkdtemp(path.join(os.tmpdir(), "taskdesk-apt-source-"));
  try {
    await mkdir(path.join(aptRoot, "sources.list.d"));
    assert.deepEqual(await normalizeAptSourceTree(aptRoot), {
      changed: [],
      missing: false,
    });
  } finally {
    await rm(aptRoot, { recursive: true, force: true });
  }
});

test("source walk rejects symlinked directories and source files before touching targets", async () => {
  const aptRoot = await mkdtemp(path.join(os.tmpdir(), "taskdesk-apt-source-"));
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-apt-outside-"),
  );
  try {
    const outsideFile = path.join(outside, "ubuntu.sources");
    await writeFile(outsideFile, `URIs: ${BLOCKED}\nSuites: noble\n`);
    await symlink(outside, path.join(aptRoot, "sources.list.d"));
    await assert.rejects(
      normalizeAptSourceTree(aptRoot),
      /unsafe APT directory/,
    );
    assert.equal(
      await readFile(outsideFile, "utf8"),
      `URIs: ${BLOCKED}\nSuites: noble\n`,
    );

    await rm(path.join(aptRoot, "sources.list.d"));
    await mkdir(path.join(aptRoot, "sources.list.d"));
    await symlink(outsideFile, path.join(aptRoot, "apt-mirrors.txt"));
    await assert.rejects(
      normalizeAptSourceTree(aptRoot),
      /unsafe APT source file/,
    );
    assert.equal(
      await readFile(outsideFile, "utf8"),
      `URIs: ${BLOCKED}\nSuites: noble\n`,
    );

    await rm(path.join(aptRoot, "apt-mirrors.txt"));
    await symlink(
      outsideFile,
      path.join(aptRoot, "sources.list.d", "redirected.sources"),
    );
    await assert.rejects(
      normalizeAptSourceTree(aptRoot),
      /symlinked APT source file/,
    );
    assert.equal(
      await readFile(outsideFile, "utf8"),
      `URIs: ${BLOCKED}\nSuites: noble\n`,
    );
  } finally {
    await rm(aptRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("source walk rejects hard-linked config rather than replacing an external alias", async () => {
  const aptRoot = await mkdtemp(path.join(os.tmpdir(), "taskdesk-apt-source-"));
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "taskdesk-apt-outside-"),
  );
  try {
    await mkdir(path.join(aptRoot, "sources.list.d"));
    const outsideFile = path.join(outside, "mirror.list");
    const aptFile = path.join(aptRoot, "apt-mirrors.txt");
    const content = `${BLOCKED}/\tpriority:1\n`;
    await writeFile(outsideFile, content);
    await link(outsideFile, aptFile);
    await assert.rejects(
      normalizeAptSourceTree(aptRoot),
      /unsafe APT source file/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), content);
  } finally {
    await rm(aptRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("every Playwright dependency install has the bounded Ubuntu mirror pre-step", async () => {
  const workflowPaths = [
    [path.resolve(".github/workflows/ci-fast.yml"), { static: "sudo" }],
    [
      path.resolve(".github/workflows/ci-full.yml"),
      { e2e: "sudo", a11y: "sudo", visual: "root", performance: "sudo" },
    ],
  ];
  for (const [workflowPath, expectedExecutors] of workflowPaths) {
    const workflow = await readFile(workflowPath, "utf8");
    const actualJobs = new Set();
    for (const [jobId, expectedExecutor] of Object.entries(expectedExecutors)) {
      const jobHeading = new RegExp(`^  ${jobId}:\\s*$`, "m");
      const start = workflow.search(jobHeading);
      assert.notEqual(start, -1, `${workflowPath} declares ${jobId}`);
      const tail = workflow.slice(start + 1);
      const nextHeading = /^ {2}[a-z][a-z0-9_-]*:\s*$/m.exec(tail);
      const end = nextHeading ? start + 1 + nextHeading.index : workflow.length;
      const job = workflow.slice(start, end);
      const steps = job.split(/(?=^ {6}- name:)/m);
      const installSteps = steps
        .map((step, stepIndex) => ({ step, stepIndex }))
        .filter(({ step }) =>
          /playwright install --with-deps chromium/.test(step),
        );
      if (installSteps.length === 0) continue;

      actualJobs.add(jobId);
      assert.equal(
        installSteps.length,
        1,
        `${workflowPath} ${jobId} has one dependency install`,
      );
      const { stepIndex } = installSteps[0];
      assert.ok(stepIndex > 0, `${workflowPath} ${jobId} has a pre-step`);
      const normalizer = steps[stepIndex - 1];
      assert.match(
        normalizer,
        /name: Normalize Ubuntu APT mirror for Chromium dependencies/,
      );
      const invocation = normalizer.match(/^\s+run: (.+)$/m)?.[1];
      assert.equal(
        invocation,
        expectedExecutor === "root"
          ? "node scripts/ci/normalize-ubuntu-apt-mirror.mjs"
          : 'sudo -- "$(command -v node)" scripts/ci/normalize-ubuntu-apt-mirror.mjs',
        `${workflowPath} ${jobId} runs the helper with its required privileges`,
      );
      if (expectedExecutor === "root") {
        assert.match(job, /^ {4}container:\s*$/m);
      } else {
        assert.doesNotMatch(job, /^ {4}container:\s*$/m);
      }
    }
    assert.deepEqual(actualJobs, new Set(Object.keys(expectedExecutors)));
    assert.equal(
      [...workflow.matchAll(/playwright install --with-deps chromium/g)].length,
      Object.keys(expectedExecutors).length,
      `${workflowPath} has no unclassified Playwright dependency installs`,
    );
  }
});
