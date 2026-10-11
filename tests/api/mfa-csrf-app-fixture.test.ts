import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const childWaiting = new Promise<void>((resolveWaiting) => {
      signalChildWaiting = resolveWaiting;
    });
    const helperUrl = new URL(
      "../e2e/helpers/mfa-csrf-app-fixture.ts",
      import.meta.url,
    ).href;
    const childScript = [
      `import { withExclusiveMetricsListener } from ${JSON.stringify(helperUrl)};`,
      `const lockPath = ${JSON.stringify(path)};`,
      'process.stdout.write("MFA_LOCK_CHILD_WAITING\\n");',
      "await withExclusiveMetricsListener(async () => {",
      '  process.stdout.write("MFA_LOCK_CHILD_ENTERED\\n");',
      "}, { lockPath, waitMs: 10_000, pollMs: 5 });",
    ].join("\n");
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", childScript],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      childOutput += chunk.toString();
      if (childOutput.includes("MFA_LOCK_CHILD_WAITING")) signalChildWaiting();
    });
    const childDone = new Promise<void>((resolveChild, rejectChild) => {
      child.once("error", rejectChild);
      child.once("close", (code) => {
        if (code === 0) resolveChild();
        else rejectChild(new Error(`Lock child exited with code ${code}.`));
      });
    });

    try {
      await withExclusiveMetricsListener(
        async () => {
          await childWaiting;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
          expect(childOutput).not.toContain("MFA_LOCK_CHILD_ENTERED");
        },
        { lockPath: path, waitMs: 10_000, pollMs: 5 },
      );
      await childDone;
      expect(childOutput).toContain("MFA_LOCK_CHILD_ENTERED");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await new Promise<void>((resolveExit) =>
          child.once("close", () => resolveExit()),
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
