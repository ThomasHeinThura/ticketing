import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { grantInstanceAdmin } from "./cli/grant-instance-admin";
import { resolveBreakGlassOperatorIdentity } from "./cli/operator-identity";
import db, { closeDatabasePool } from "./database";
import { resolveDatabaseConfig } from "./database/resolve-database-url";

function operatorIdentity() {
  const effectiveUid = process.getuid?.();
  if (effectiveUid === undefined) {
    throw new Error(
      "Run this command as the TaskDesk service user inside its container.",
    );
  }
  const passwd = userInfo();
  return resolveBreakGlassOperatorIdentity({
    passwdContents: readFileSync("/etc/passwd", "utf8"),
    effectiveUid,
    reportedUid: passwd.uid,
    reportedUsername: passwd.username,
  });
}

async function run(): Promise<void> {
  const [command, email, ...extra] = process.argv.slice(2);
  if (command !== "grant-instance-admin" || !email || extra.length > 0) {
    throw new Error("Usage: node dist/cli.js grant-instance-admin <email>");
  }
  const operator = operatorIdentity();
  if (resolveDatabaseConfig().source === "LOCAL_FALLBACK") {
    throw new Error("An explicitly configured service database is required.");
  }
  const io = createInterface({ input: stdin, output: stdout });
  try {
    const result = await grantInstanceAdmin(db, email, operator, {
      isTTY: stdin.isTTY === true && stdout.isTTY === true,
      write(message) {
        stdout.write(`${message}\n`);
      },
      ask(prompt) {
        return io.question(prompt);
      },
    });
    if (result.outcome === "cancelled") {
      stdout.write("Recovery cancelled; no authority changed.\n");
      return;
    }
    stdout.write(
      `Recovery ${result.outcome === "granted" ? "granted" : "already present"}. Email delivery: ${result.emailSucceeded} succeeded, ${result.emailFailed} failed.\n`,
    );
    if (result.emailFailed > 0) {
      stdout.write(
        "Notify recipients through the host's established incident channel.\n",
      );
      process.exitCode = 1;
    }
  } finally {
    io.close();
  }
}

try {
  await run();
} catch (error) {
  const safeMessage =
    error instanceof Error &&
    [
      "Run this command as the TaskDesk service user inside its container.",
      "The effective process identity does not match the TaskDesk service account.",
      "An explicitly configured service database is required.",
      "Usage: node dist/cli.js grant-instance-admin <email>",
      "This recovery command requires an interactive TTY.",
      "Recovery is available only after instance setup is complete.",
      "The exact stored email did not resolve to one user.",
      "The resolved user does not have one eligible active staff identity.",
      "The displayed instance or target changed. Restart and verify the target again.",
    ].includes(error.message)
      ? error.message
      : "Recovery command failed closed. Check service and database health without sharing credentials.";
  stdout.write(`${safeMessage}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabasePool().catch(() => {
    process.exitCode = 1;
  });
}
