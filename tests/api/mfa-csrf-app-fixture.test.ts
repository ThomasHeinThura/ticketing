import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  totpForUri,
  withExclusiveMetricsListener,
} from "../e2e/helpers/mfa-csrf-app-fixture";

describe("isolated MFA app fixture helpers", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function lockPath() {
    const directory = await mkdtemp(join(tmpdir(), "taskdesk-mfa-lock-test-"));
    temporaryDirectories.push(directory);
    return join(directory, "metrics.lock");
  }

  it("computes the RFC 6238 SHA-1 six digit test vector", () => {
    const uri =
      "otpauth://totp/TaskDesk:test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=TaskDesk";

    expect(totpForUri(uri, 59_000)).toBe("287082");
  });

  it("serializes concurrent fixture lifetimes and releases after completion", async () => {
    const path = await lockPath();
    let signalFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    const first = withExclusiveMetricsListener(
      async () => {
        order.push("first-start");
        signalFirstStarted();
        await firstMayFinish;
        order.push("first-end");
      },
      { lockPath: path, waitMs: 2_000, pollMs: 2 },
    );
    await firstStarted;

    const second = withExclusiveMetricsListener(
      async () => {
        order.push("second-start");
      },
      { lockPath: path, waitMs: 2_000, pollMs: 2 },
    );

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("serializes independent Node processes on the shared metrics port", async () => {
    const path = await lockPath();
    let childOutput = "";
    let signalChildWaiting!: () => void;
    let signalChildContended!: () => void;
    const childWaiting = new Promise<void>((resolveWaiting) => {
      signalChildWaiting = resolveWaiting;
    });
    const childContended = new Promise<void>((resolveContended) => {
      signalChildContended = resolveContended;
    });
    const helperUrl = new URL(
      "../e2e/helpers/mfa-csrf-app-fixture.ts",
      import.meta.url,
    ).href;
    const childScript = [
      `import { withExclusiveMetricsListener } from ${JSON.stringify(helperUrl)};`,
      `const lockPath = ${JSON.stringify(path)};`,
      "let reportedContention = false;",
      'process.stdout.write("MFA_LOCK_CHILD_WAITING\\n");',
      "await withExclusiveMetricsListener(async () => {",
      '  process.stdout.write("MFA_LOCK_CHILD_ENTERED\\n");',
      "}, {",
      "  lockPath,",
      "  waitMs: 10_000,",
      "  pollMs: 5,",
      "  onLockContention: () => {",
      "    if (reportedContention) return;",
      "    reportedContention = true;",
      '    process.stdout.write("MFA_LOCK_CHILD_CONTENDED\\n");',
      "  },",
      "});",
    ].join("\n");
    let child: ReturnType<typeof spawn> | undefined;
    let childDone: Promise<void> | undefined;
    let childError: Error | undefined;

    try {
      await withExclusiveMetricsListener(
        async () => {
          const spawnedChild = spawn(
            process.execPath,
            [
              "--experimental-strip-types",
              "--input-type=module",
              "-e",
              childScript,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          child = spawnedChild;
          if (!spawnedChild.stdout)
            throw new Error("Lock child stdout was not piped.");
          spawnedChild.stdout.on("data", (chunk: Buffer) => {
            childOutput += chunk.toString();
            if (childOutput.includes("MFA_LOCK_CHILD_WAITING"))
              signalChildWaiting();
            if (childOutput.includes("MFA_LOCK_CHILD_CONTENDED"))
              signalChildContended();
          });
          childDone = new Promise<void>((resolveChild) => {
            spawnedChild.once("error", (error) => {
              childError = error;
              resolveChild();
            });
            spawnedChild.once("close", (code) => {
              if (code !== 0)
                childError = new Error(`Lock child exited with code ${code}.`);
              resolveChild();
            });
          });
          await childWaiting;
          await childContended;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
          expect(childOutput).not.toContain("MFA_LOCK_CHILD_ENTERED");
        },
        { lockPath: path, waitMs: 10_000, pollMs: 5 },
      );
      await childDone;
      if (childError) throw childError;
      expect(childOutput).toContain("MFA_LOCK_CHILD_ENTERED");
    } finally {
      const runningChild = child;
      if (
        runningChild &&
        runningChild.exitCode === null &&
        runningChild.signalCode === null
      ) {
        runningChild.kill("SIGKILL");
        await new Promise<void>((resolveExit) =>
          runningChild.once("close", () => resolveExit()),
        );
      }
    }
  }, 20_000);

  it("releases its lock after a fixture callback throws", async () => {
    const path = await lockPath();
    await expect(
      withExclusiveMetricsListener(
        async () => {
          throw new Error("fixture callback failed");
        },
        { lockPath: path },
      ),
    ).rejects.toThrow("fixture callback failed");

    await expect(
      withExclusiveMetricsListener(async () => "recovered", {
        lockPath: path,
      }),
    ).resolves.toBe("recovered");
  });

  it("reclaims a lock only after its recorded owner process has exited", async () => {
    const path = await lockPath();
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(child.status).toBe(0);
    expect(child.pid).toBeGreaterThan(0);
    await writeFile(
      path,
      JSON.stringify({ pid: child.pid, token: "dead-owner", childPids: [] }),
      {
        mode: 0o600,
      },
    );

    await expect(
      withExclusiveMetricsListener(async () => "reclaimed", {
        lockPath: path,
        waitMs: 500,
        pollMs: 2,
      }),
    ).resolves.toBe("reclaimed");
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("serializes concurrent stale reapers and preserves a replacement owner lock", async () => {
    const path = await lockPath();
    const deadOwner = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadOwner.status).toBe(0);
    expect(deadOwner.pid).toBeGreaterThan(0);
    await writeFile(
      path,
      JSON.stringify({
        pid: deadOwner.pid,
        token: "stale-owner",
        childPids: [],
      }),
      { mode: 0o600 },
    );

    const reaperScript = [
      'import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";',
      'import { createServer } from "node:net";',
      'const reaperPath = process.argv[1] + ".reap";',
      "const server = createServer((socket) => socket.destroy());",
      'server.listen(9464, "0.0.0.0", () => {',
      '  const fd = openSync(reaperPath, "wx", 0o600);',
      '  const owner = { pid: process.pid, token: "controlled-reaper", childPids: [] };',
      "  writeFileSync(fd, JSON.stringify(owner)); fsyncSync(fd);",
      '  process.stdout.write("REAPER_LOCK_HELD\\n");',
      '  process.stdin.once("data", () => {',
      '    const current = JSON.parse(readFileSync(reaperPath, "utf8"));',
      "    if (current.pid === owner.pid && current.token === owner.token) unlinkSync(reaperPath);",
      '    closeSync(fd); server.close(() => { process.stdout.write("REAPER_RELEASED\\n"); process.exit(0); });',
      "  });",
      "});",
    ].join("\n");
    const reaper = spawn(process.execPath, ["-e", reaperScript, path], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const reaperClosed = new Promise<void>((resolveClose) =>
      reaper.once("close", () => resolveClose()),
    );
    let reaperOutput = "";
    reaper.stdout.on("data", (chunk: Buffer) => {
      reaperOutput += chunk.toString();
    });

    const helperUrl = new URL(
      "../e2e/helpers/mfa-csrf-app-fixture.ts",
      import.meta.url,
    ).href;
    const contenderScript = [
      "const { withExclusiveMetricsListener } = await import(process.argv[1]);",
      "const lockPath = process.argv[2];",
      "let waitCount = 0;",
      "await withExclusiveMetricsListener(async () => {",
      '  process.stdout.write("CONTENDER_ENTERED\\n");',
      '}, { lockPath, waitMs: 3_000, pollMs: 5, onLockContention: () => process.stdout.write("CONTENDER_WAITING " + (++waitCount) + "\\n") });',
      'process.stdout.write("CONTENDER_DONE\\n");',
    ].join("\n");
    const contender = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        contenderScript,
        helperUrl,
        path,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    contender.stdin.end();
    const contenderClosed = new Promise<void>((resolveClose) =>
      contender.once("close", () => resolveClose()),
    );
    let contenderOutput = "";
    let contenderError = "";
    contender.stdout.on("data", (chunk: Buffer) => {
      contenderOutput += chunk.toString();
    });
    contender.stderr.on("data", (chunk: Buffer) => {
      contenderError += chunk.toString();
    });

    const waitForMarker = (
      child: typeof reaper,
      readOutput: () => string,
      marker: string,
      readError: () => string = () => "",
    ) =>
      new Promise<void>((resolveMarker, rejectMarker) => {
        if (readOutput().includes(marker)) {
          resolveMarker();
          return;
        }
        const timer = setTimeout(() => {
          rejectMarker(new Error(`Timed out waiting for ${marker}.`));
        }, 3_000);
        const check = () => {
          if (readOutput().includes(marker)) {
            clearTimeout(timer);
            resolveMarker();
          }
        };
        child.stdout.on("data", check);
        child.once("error", (error) => {
          clearTimeout(timer);
          rejectMarker(error);
        });
        child.once("close", (code) => {
          if (!readOutput().includes(marker)) {
            clearTimeout(timer);
            rejectMarker(
              new Error(
                `Process closed (${code}) before ${marker}. ${readError()}`,
              ),
            );
          }
        });
      });
    const replacementPath = `${path}.replacement-${process.pid}`;
    let replacementOwnerPrepared = false;
    let replacementOwnerWritten = false;
    try {
      await waitForMarker(reaper, () => reaperOutput, "REAPER_LOCK_HELD");
      await waitForMarker(
        contender,
        () => contenderOutput,
        "CONTENDER_WAITING 1",
        () => contenderError,
      );
      expect(contenderOutput).not.toContain("CONTENDER_ENTERED");
      await expect(readFile(path, "utf8")).resolves.toContain("stale-owner");
      await expect(readFile(`${path}.reap`, "utf8")).resolves.toContain(
        "controlled-reaper",
      );

      // Publish a complete live owner without an absent-path window. A contender
      // opens the lock path before it can acquire the reaper lease, so unlinking
      // first lets it claim the gap and makes this fixture's wx create fail.
      await writeFile(
        replacementPath,
        JSON.stringify({
          pid: process.pid,
          token: "replacement-owner",
          childPids: [],
        }),
        { flag: "wx", mode: 0o600 },
      );
      replacementOwnerPrepared = true;
      await expect(readFile(path, "utf8")).resolves.toContain("stale-owner");
      await rename(replacementPath, path);
      replacementOwnerPrepared = false;
      replacementOwnerWritten = true;
      await expect(readFile(path, "utf8")).resolves.toContain(
        "replacement-owner",
      );
      reaper.stdin.write("release\\n");
      await waitForMarker(reaper, () => reaperOutput, "REAPER_RELEASED");
      await reaperClosed;

      await waitForMarker(
        contender,
        () => contenderOutput,
        "CONTENDER_WAITING 2",
        () => contenderError,
      );
      expect(contenderOutput).not.toContain("CONTENDER_ENTERED");
      await expect(readFile(path, "utf8")).resolves.toContain(
        "replacement-owner",
      );

      await rm(path, { force: true });
      replacementOwnerWritten = false;
      await waitForMarker(contender, () => contenderOutput, "CONTENDER_DONE");
      expect(contenderOutput).toContain("CONTENDER_ENTERED");
      await contenderClosed;
    } finally {
      if (replacementOwnerPrepared) await rm(replacementPath, { force: true });
      if (replacementOwnerWritten) await rm(path, { force: true });
      if (reaper.exitCode === null && reaper.signalCode === null) {
        reaper.stdin.write("release\\n");
        reaper.kill("SIGTERM");
        await reaperClosed;
      }
      if (contender.exitCode === null && contender.signalCode === null) {
        contender.kill("SIGKILL");
        await contenderClosed;
      }
    }
  });

  it("recovers a killed reaper after the OS releases the metrics-port lease", async () => {
    const path = await lockPath();
    const deadOwner = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadOwner.status).toBe(0);
    expect(deadOwner.pid).toBeGreaterThan(0);
    await writeFile(
      path,
      JSON.stringify({
        pid: deadOwner.pid,
        token: "stale-owner",
        childPids: [],
      }),
      { mode: 0o600 },
    );

    const reaperScript = [
      'import { openSync, fsyncSync, writeFileSync } from "node:fs";',
      'import { createServer } from "node:net";',
      "const lockPath = process.argv[1];",
      "const server = createServer((socket) => socket.destroy());",
      'server.listen(9464, "0.0.0.0", () => {',
      '  const fd = openSync(lockPath + ".reap", "wx", 0o600);',
      '  writeFileSync(fd, JSON.stringify({ pid: process.pid, token: "killed-reaper", childPids: [] }));',
      "  fsyncSync(fd);",
      '  process.stdout.write("ORPHAN_REAPER_GUARD_READY\\n");',
      "  setInterval(() => {}, 1000);",
      "});",
    ].join("\n");
    const reaper = spawn(process.execPath, ["-e", reaperScript, path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const reaperClosed = new Promise<void>((resolveClose) =>
      reaper.once("close", () => resolveClose()),
    );
    let reaperOutput = "";
    let reaperError = "";
    reaper.stdout.on("data", (chunk: Buffer) => {
      reaperOutput += chunk.toString();
    });
    reaper.stderr.on("data", (chunk: Buffer) => {
      reaperError += chunk.toString();
    });
    try {
      await new Promise<void>((resolveMarker, rejectMarker) => {
        const timer = setTimeout(
          () =>
            rejectMarker(new Error(`Reaper did not bind 9464. ${reaperError}`)),
          3_000,
        );
        const check = () => {
          if (reaperOutput.includes("ORPHAN_REAPER_GUARD_READY")) {
            clearTimeout(timer);
            resolveMarker();
          }
        };
        reaper.stdout.on("data", check);
        reaper.once("close", (code) => {
          if (!reaperOutput.includes("ORPHAN_REAPER_GUARD_READY")) {
            clearTimeout(timer);
            rejectMarker(
              new Error(
                `Reaper exited before its guard was ready (${code}). ${reaperError}`,
              ),
            );
          }
        });
      });
    } catch (error) {
      if (reaper.exitCode === null && reaper.signalCode === null) {
        reaper.kill("SIGKILL");
        await reaperClosed;
      }
      throw error;
    }

    const contenderScript = [
      "const { withExclusiveMetricsListener } = await import(process.argv[1]);",
      'const { createServer } = await import("node:net");',
      "await withExclusiveMetricsListener(async () => {",
      "  const server = createServer((socket) => socket.destroy());",
      '  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(9464, "0.0.0.0", resolve); });',
      "  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));",
      '  process.stdout.write("LEASE_RELEASED_BEFORE_FIXTURE_CALLBACK\\n");',
      "}, { lockPath: process.argv[2], waitMs: 3000, pollMs: 5 });",
      'process.stdout.write("RECOVERY_CONTENDER_DONE\\n");',
    ].join("\n");
    const contender = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        contenderScript,
        new URL("../e2e/helpers/mfa-csrf-app-fixture.ts", import.meta.url).href,
        path,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const contenderClosed = new Promise<void>((resolveClose) =>
      contender.once("close", () => resolveClose()),
    );
    let contenderOutput = "";
    let contenderError = "";
    contender.stdout.on("data", (chunk: Buffer) => {
      contenderOutput += chunk.toString();
    });
    contender.stderr.on("data", (chunk: Buffer) => {
      contenderError += chunk.toString();
    });
    try {
      expect(reaper.kill("SIGKILL")).toBe(true);
      await reaperClosed;
      await expect(readFile(`${path}.reap`, "utf8")).resolves.toContain(
        "killed-reaper",
      );
      await new Promise<void>((resolveMarker, rejectMarker) => {
        const timer = setTimeout(
          () =>
            rejectMarker(
              new Error(`Contender did not recover. ${contenderError}`),
            ),
          5_000,
        );
        const check = () => {
          if (contenderOutput.includes("RECOVERY_CONTENDER_DONE")) {
            clearTimeout(timer);
            resolveMarker();
          }
        };
        contender.stdout.on("data", check);
        contender.once("close", (code) => {
          if (!contenderOutput.includes("RECOVERY_CONTENDER_DONE")) {
            clearTimeout(timer);
            rejectMarker(
              new Error(
                `Contender exited before recovery (${code}). ${contenderError}`,
              ),
            );
          }
        });
      });
      await contenderClosed;
      expect(contender.exitCode).toBe(0);
      expect(contenderOutput).toContain(
        "LEASE_RELEASED_BEFORE_FIXTURE_CALLBACK",
      );
      await expect(readFile(path, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(`${path}.reap`, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      if (reaper.exitCode === null && reaper.signalCode === null) {
        reaper.kill("SIGKILL");
        await reaperClosed;
      }
      if (contender.exitCode === null && contender.signalCode === null) {
        contender.kill("SIGKILL");
        await contenderClosed;
      }
    }
  });

  it("preserves stale locks when the live metrics listener owns the lease", async () => {
    const path = await lockPath();
    const deadOwner = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    const deadReaper = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadOwner.status).toBe(0);
    expect(deadReaper.status).toBe(0);
    const staleMain = JSON.stringify({
      pid: deadOwner.pid,
      token: "stale-main-owner",
      childPids: [],
    });
    const staleGuard = JSON.stringify({
      pid: deadReaper.pid,
      token: "stale-reaper-owner",
      childPids: [],
    });
    await writeFile(path, staleMain, { mode: 0o600 });
    await writeFile(`${path}.reap`, staleGuard, { mode: 0o600 });
    const listener = createServer((socket) => socket.destroy());
    await new Promise<void>((resolveListen, rejectListen) => {
      listener.once("error", rejectListen);
      listener.listen(9464, "0.0.0.0", resolveListen);
    });
    try {
      await expect(
        withExclusiveMetricsListener(async () => "must-not-run", {
          lockPath: path,
          waitMs: 50,
          pollMs: 5,
        }),
      ).rejects.toThrow("Timed out waiting");
      await expect(readFile(path, "utf8")).resolves.toBe(staleMain);
      await expect(readFile(`${path}.reap`, "utf8")).resolves.toBe(staleGuard);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        listener.close((error) =>
          error ? rejectClose(error) : resolveClose(),
        ),
      );
    }
  });

  it("does not reclaim a dead supervisor lock while a recorded child is alive", async () => {
    const path = await lockPath();
    const deadOwner = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadOwner.status).toBe(0);
    expect(deadOwner.pid).toBeGreaterThan(0);
    const ownedChild = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    expect(ownedChild.pid).toBeGreaterThan(0);
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      ownedChild.once("spawn", resolveSpawn);
      ownedChild.once("error", rejectSpawn);
    });
    await writeFile(
      path,
      JSON.stringify({
        pid: deadOwner.pid,
        token: "dead-supervisor-with-live-child",
        childPids: [ownedChild.pid],
      }),
      { mode: 0o600 },
    );

    try {
      await expect(
        withExclusiveMetricsListener(async () => "must-not-run", {
          lockPath: path,
          waitMs: 30,
          pollMs: 2,
        }),
      ).rejects.toThrow("owned children to exit");
      expect(() => process.kill(ownedChild.pid as number, 0)).not.toThrow();
      await expect(readFile(path, "utf8")).resolves.toContain(
        "dead-supervisor-with-live-child",
      );
    } finally {
      ownedChild.kill("SIGKILL");
      await new Promise<void>((resolveExit) =>
        ownedChild.once("close", () => resolveExit()),
      );
    }
  });

  it("keeps owned children and the lock alive until they are gone after parent death", async () => {
    const path = await lockPath();
    const directory = path.slice(0, path.lastIndexOf("/"));
    const signalPath = join(directory, "owned-child-sigterm");
    const childReadyPath = join(directory, "owned-child-ready");
    const helperUrl = new URL(
      "../e2e/helpers/mfa-csrf-app-fixture.ts",
      import.meta.url,
    ).href;
    const childScript = [
      `import { withExclusiveMetricsListener } from ${JSON.stringify(helperUrl)};`,
      `const lockPath = ${JSON.stringify(path)};`,
      `const evidenceDir = ${JSON.stringify(directory)};`,
      `const signalPath = ${JSON.stringify(signalPath)};`,
      `const childReadyPath = ${JSON.stringify(childReadyPath)};`,
      "await withExclusiveMetricsListener(async (supervisor) => {",
      `  const childCode = ${JSON.stringify(`import { writeFileSync } from "node:fs"; process.on("SIGTERM", () => { writeFileSync(${JSON.stringify(signalPath)}, "received"); setTimeout(() => process.exit(0), 500); }); writeFileSync(${JSON.stringify(childReadyPath)}, "ready"); setInterval(() => {}, 1000);`)};`,
      '  const child = await supervisor.spawn(process.execPath, ["-e", childCode], process.env, "owned-child", evidenceDir);',
      '  process.stdout.write("OWNED_CHILD_READY " + child.pid + "\\n");',
      "  await new Promise(() => {});",
      "}, { lockPath, waitMs: 2_000, pollMs: 2 });",
    ].join("\n");
    const worker = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", childScript],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const ready = new Promise<number>((resolveReady, rejectReady) => {
      worker.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/OWNED_CHILD_READY (\d+)/u);
        if (match?.[1]) resolveReady(Number(match[1]));
      });
      worker.once("error", rejectReady);
      worker.once("close", (code) => {
        if (!output.includes("OWNED_CHILD_READY") && code !== null) {
          rejectReady(new Error(`Fixture worker exited before ready: ${code}`));
        }
      });
    });
    let ownedChildPid: number | undefined;
    try {
      ownedChildPid = await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("Fixture worker did not become ready.")),
            5_000,
          ),
        ),
      ]);
      const childPid = ownedChildPid;
      const lockState = JSON.parse(await readFile(path, "utf8")) as {
        pid: number;
        childPids: number[];
      };
      expect(lockState.pid).toBeGreaterThan(0);
      expect(lockState.childPids).toContain(childPid);
      const childReadyDeadline = Date.now() + 5_000;
      let childReady = false;
      while (Date.now() < childReadyDeadline && !childReady) {
        try {
          await readFile(childReadyPath, "utf8");
          childReady = true;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        }
      }
      expect(childReady).toBe(true);
      worker.kill("SIGKILL");
      await new Promise<void>((resolveExit) =>
        worker.once("close", () => resolveExit()),
      );

      const signalDeadline = Date.now() + 2_000;
      let receivedTerm = false;
      while (Date.now() < signalDeadline && !receivedTerm) {
        try {
          await readFile(signalPath, "utf8");
          receivedTerm = true;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 10));
        }
      }
      expect(receivedTerm).toBe(true);
      const heldLock = JSON.parse(await readFile(path, "utf8")) as {
        childPids: number[];
      };
      expect(heldLock.childPids).toContain(childPid);
      expect(() => process.kill(childPid, 0)).not.toThrow();

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        let childAlive = true;
        try {
          process.kill(childPid, 0);
        } catch (error) {
          childAlive = (error as NodeJS.ErrnoException).code !== "ESRCH";
        }
        try {
          await readFile(path, "utf8");
        } catch (error) {
          if (
            !childAlive &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
          ) {
            return;
          }
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      throw new Error("Owned child or metrics lock survived parent death.");
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
        await new Promise<void>((resolveExit) =>
          worker.once("close", () => resolveExit()),
        );
      }
      if (ownedChildPid !== undefined) {
        try {
          process.kill(ownedChildPid, 0);
          process.kill(ownedChildPid, "SIGKILL");
        } catch {
          // The supervisor normally reaps it; this only cleans this test's own child.
        }
      }
    }
  });

  it("fails closed on malformed locks, live owners, and legacy locks without child ownership", async () => {
    const malformedPath = await lockPath();
    await writeFile(malformedPath, "not-json", { mode: 0o600 });
    await expect(
      withExclusiveMetricsListener(async () => "must-not-run", {
        lockPath: malformedPath,
        waitMs: 15,
        pollMs: 2,
      }),
    ).rejects.toThrow("Timed out waiting");
    await expect(readFile(malformedPath, "utf8")).resolves.toBe("not-json");

    const livePath = await lockPath();
    await writeFile(
      livePath,
      JSON.stringify({ pid: process.pid, token: "live-owner" }),
      { mode: 0o600 },
    );
    await expect(
      withExclusiveMetricsListener(async () => "must-not-run", {
        lockPath: livePath,
        waitMs: 15,
        pollMs: 2,
      }),
    ).rejects.toThrow("Timed out waiting");
    await expect(readFile(livePath, "utf8")).resolves.toContain("live-owner");

    const legacyPath = await lockPath();
    const deadProcess = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadProcess.status).toBe(0);
    expect(deadProcess.pid).toBeGreaterThan(0);
    await writeFile(
      legacyPath,
      JSON.stringify({
        pid: deadProcess.pid,
        token: "legacy-without-child-list",
      }),
      { mode: 0o600 },
    );
    await expect(
      withExclusiveMetricsListener(async () => "must-not-run", {
        lockPath: legacyPath,
        waitMs: 15,
        pollMs: 2,
      }),
    ).rejects.toThrow("Timed out waiting");
    await expect(readFile(legacyPath, "utf8")).resolves.toContain(
      "legacy-without-child-list",
    );
  });
});
