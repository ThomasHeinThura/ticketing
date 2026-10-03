import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const probePath = resolve(
  repositoryRoot,
  "tests/api-integration/fixtures/bootstrap-registration-boot-probe.mjs",
);
const probePrefix = "BOOTSTRAP_REGISTRATION_RESULT:";
const refusalMessage = "Registration is currently unavailable.";

type ProbeResult = {
  unclaimedPlain: { status: number; body: string; message: string | null };
  unclaimedInvitation: { status: number; body: string; message: string | null };
  bootstrapStatus: number;
  setupCompleted: boolean;
  claimedPlain: { status: number; body: string; message: string | null };
  claimedInvitation: { status: number; body: string; message: string | null };
};

function runBootProbe(
  disableRegistration: boolean,
  disablePasswordRegistration: boolean,
  proofMode: "setup-token" | "headless",
): Promise<ProbeResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", probePath, proofMode],
      {
        cwd: resolve(repositoryRoot, "apps/api"),
        env: {
          ...process.env,
          DISABLE_REGISTRATION: String(disableRegistration),
          DISABLE_PASSWORD_REGISTRATION: String(disablePasswordRegistration),
          TASKDESK_BOOTSTRAP_ADMIN_EMAIL: `boot-${randomUUID()}@example.com`,
          TASKDESK_AGENT_URL: "http://localhost:1337",
          TASKDESK_PORTAL_URL: "http://portal.localhost:5174",
          KANEO_API_URL: "http://localhost:1337",
          TASKDESK_AUTH_SECRET: "private-test-secret-long-enough-for-auth",
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let result: ProbeResult | undefined;
    let failedAt: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.resume();
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      for (const line of stdout.split("\n")) {
        if (!line.startsWith(probePrefix)) continue;
        const payload = JSON.parse(line.slice(probePrefix.length)) as
          | ProbeResult
          | { failedAt: string };
        if ("failedAt" in payload) {
          failedAt = payload.failedAt;
          return;
        }
        result = payload;
      }
      if (stdout.length > 2_000_000) child.kill("SIGTERM");
    });
    child.once("error", () =>
      rejectResult(new Error("pre-import probe did not start")),
    );
    child.once("close", (code) => {
      if (timer) clearTimeout(timer);
      if (failedAt) {
        rejectResult(new Error(`pre-import probe failed at ${failedAt}`));
        return;
      }
      if (code !== 0) {
        rejectResult(new Error(`pre-import probe exited with status ${code}`));
        return;
      }
      if (!result) {
        rejectResult(new Error("pre-import probe returned no result"));
        return;
      }
      resolveResult(result);
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectResult(new Error("pre-import probe timed out"));
    }, 45_000);
  });
}

describe("registration refusal behavior from real boot configuration", () => {
  afterEach(async () => resetTestDatabase());

  it.each([
    { disableRegistration: true, disablePasswordRegistration: false },
    { disableRegistration: false, disablePasswordRegistration: true },
    { disableRegistration: true, disablePasswordRegistration: true },
  ])(
    "keeps denied signups indistinguishable when DISABLE_REGISTRATION=$disableRegistration and DISABLE_PASSWORD_REGISTRATION=$disablePasswordRegistration",
    async ({ disableRegistration, disablePasswordRegistration }) => {
      await resetTestDatabase();
      for (const proofMode of ["setup-token", "headless"] as const) {
        await resetTestDatabase();
        const result = await runBootProbe(
          disableRegistration,
          disablePasswordRegistration,
          proofMode,
        );

        for (const refusal of [
          result.unclaimedPlain,
          result.unclaimedInvitation,
          result.claimedPlain,
          result.claimedInvitation,
        ]) {
          expect(refusal.status).toBe(403);
          expect(refusal.message).toBe(refusalMessage);
        }
        expect(result.unclaimedPlain.body).toBe(result.claimedPlain.body);
        expect(result.unclaimedInvitation.body).toBe(
          result.claimedInvitation.body,
        );
        expect(result.bootstrapStatus).toBe(200);
        expect(result.setupCompleted).toBe(true);
      }
    },
  );
});
