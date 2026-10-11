import { execFileSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PolicyEnforcementConfigError,
  parseEnforcedPolicySources,
} from "../../../apps/api/src/permissions/enforcement-config";

const SOURCES = [
  "apps/api/src/project/policy.ts",
  "apps/api/src/workspace/policy.ts",
  "apps/api/src/task/policy.ts",
] as const;

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const apiEntrypoint = resolve(repositoryRoot, "apps/api/dist/index.js");
const buildTimeoutMs = 5_000;
const bootTimeoutMs = 5_000;
const invalidPolicySource = "apps/api/src/not-registered/policy.ts";
const expectedBootError =
  "PolicyEnforcementConfigError: TASKDESK_POLICY_ENFORCE must contain unique, exact registered policy-source paths";
const successfulImportMarker = "TASKDESK_API_IMPORT_SUCCEEDED";

describe("TASKDESK_POLICY_ENFORCE config", () => {
  beforeAll(() => {
    let previousBuildMtimeMs: number | undefined;
    try {
      previousBuildMtimeMs = statSync(apiEntrypoint).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const buildStartedAtMs = Date.now();
    execFileSync("pnpm", ["--filter", "@taskdesk/api", "build"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "pipe",
      timeout: buildTimeoutMs,
    });

    const built = statSync(apiEntrypoint);
    expect(built.isFile()).toBe(true);
    expect(built.mtimeMs).toBeGreaterThanOrEqual(buildStartedAtMs);
    if (previousBuildMtimeMs !== undefined) {
      expect(built.mtimeMs).toBeGreaterThan(previousBuildMtimeMs);
    }
  }, buildTimeoutMs);

  it("keeps strict enforcement off unless exact sources are selected", () => {
    expect(parseEnforcedPolicySources(undefined, SOURCES).size).toBe(0);
    expect(parseEnforcedPolicySources("", SOURCES).size).toBe(0);
    expect(
      parseEnforcedPolicySources(SOURCES.slice(0, 2).join(","), SOURCES),
    ).toEqual(new Set(SOURCES.slice(0, 2)));
  });

  it.each(["unknown", ",", `${SOURCES[0]},${SOURCES[0]}`, ` ${SOURCES[0]}`])(
    "refuses malformed or unregistered source selections (%s)",
    (value) => {
      expect(() => parseEnforcedPolicySources(value, SOURCES)).toThrow(
        PolicyEnforcementConfigError,
      );
    },
  );

  it("requires all other router sources before the task source", () => {
    expect(() => parseEnforcedPolicySources(SOURCES[2], SOURCES)).toThrow(
      PolicyEnforcementConfigError,
    );
    expect(parseEnforcedPolicySources(SOURCES.join(","), SOURCES)).toEqual(
      new Set(SOURCES),
    );
    expect(() =>
      parseEnforcedPolicySources(
        `${SOURCES[2]},${SOURCES[0]},${SOURCES[1]}`,
        SOURCES,
      ),
    ).toThrow(PolicyEnforcementConfigError);
  });

  it("refuses an invalid source before the production API module can boot", async () => {
    const startedAt = process.hrtime.bigint();
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { writeSync } from "node:fs";
          const startedAt = process.hrtime.bigint();
          const phase = (name, exitCode) => writeSync(2, JSON.stringify({
            phase: name,
            elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
            ...(exitCode === undefined ? {} : { exitCode }),
          }) + "\\n");
          process.on("exit", (code) => phase("exit", code));
          phase("child-start");
          const { pathToFileURL } = await import("node:url");
          try {
            phase("before-import");
            await import(pathToFileURL(process.argv[1]).href);
            phase("after-import");
            process.stdout.write(
              ${JSON.stringify(`${successfulImportMarker}\n`)},
              () => process.exit(0),
            );
          } catch (error) {
            phase("guard-catch");
            console.error(error);
            phase("after-error-log");
            process.exitCode = 1;
          }
        `,
        apiEntrypoint,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TASKDESK_AUTH_SECRET: "unit-test-enforcement-secret-0123456789abcdef",
          TASKDESK_AGENT_URL: "https://agent.example.test",
          TASKDESK_PORTAL_URL: "https://portal.example.test",
          TASKDESK_POLICY_ENFORCE: invalidPolicySource,
        },
        timeout: bootTimeoutMs,
      },
    );
    const spawnError: NodeJS.ErrnoException | undefined =
      result.error ?? undefined;

    const diagnostic = JSON.stringify(
      {
        elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        status: result.status,
        signal: result.signal,
        error: spawnError
          ? {
              name: spawnError.name,
              message: spawnError.message,
              code: spawnError.code,
              errno: spawnError.errno,
              syscall: spawnError.syscall,
            }
          : null,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      null,
      2,
    );

    expect(result.error, diagnostic).toBeUndefined();
    expect(result.signal, diagnostic).toBeNull();
    expect(result.status, diagnostic).not.toBe(0);
    expect(result.stderr, diagnostic).toContain(expectedBootError);
    expect(result.stdout, diagnostic).not.toContain(successfulImportMarker);
  });
});
