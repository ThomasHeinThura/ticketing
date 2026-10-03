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
      JSON.stringify({ pid: child.pid, token: "dead-owner" }),
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

  it("fails closed on malformed locks, live owners, and active reapers", async () => {
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

    const staleOwnerPath = await lockPath();
    const deadProcess = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(deadProcess.status).toBe(0);
    expect(deadProcess.pid).toBeGreaterThan(0);
    await writeFile(
      staleOwnerPath,
      JSON.stringify({ pid: deadProcess.pid, token: "stale-owner" }),
      { mode: 0o600 },
    );
    await writeFile(
      `${staleOwnerPath}.reap`,
      JSON.stringify({ pid: process.pid, token: "another-reaper" }),
      { mode: 0o600 },
    );
    await expect(
      withExclusiveMetricsListener(async () => "must-not-run", {
        lockPath: staleOwnerPath,
        waitMs: 15,
        pollMs: 2,
      }),
    ).rejects.toThrow("Timed out waiting");
    await expect(readFile(staleOwnerPath, "utf8")).resolves.toContain(
      "stale-owner",
    );
    await expect(readFile(`${staleOwnerPath}.reap`, "utf8")).resolves.toContain(
      "another-reaper",
    );
  });
});
