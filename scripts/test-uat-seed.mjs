// Own exactly one disposable PostgreSQL container. Never reads private deployment env files.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = mkdtempSync(path.join(os.tmpdir(), "taskdesk-g1-"));
mkdirSync(path.join(directory, "storage"), { mode: 0o700 });
const password = randomBytes(32).toString("hex");
let container;
try {
  writeFileSync(
    path.join(directory, "postgres.env"),
    `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=taskdesk_g1_seed_test\n`,
    { mode: 0o600 },
  );
  container = execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--env-file",
      path.join(directory, "postgres.env"),
      "--publish",
      "127.0.0.1::5432",
      "postgres:18",
    ],
    { encoding: "utf8" },
  ).trim();
  console.log(`Disposable container started: ${container}`);
  const binding = execFileSync("docker", ["port", container, "5432/tcp"], {
    encoding: "utf8",
  }).trim();
  const port = Number(binding.split(":").at(-1));
  if (!port || [62870, 62871, 62873].includes(port))
    throw new Error("Refusing reserved database port");
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      execFileSync(
        "docker",
        ["exec", container, "pg_isready", "-U", "postgres"],
        { stdio: "ignore" },
      );
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    TASKDESK_AUTH_SECRET: randomBytes(32).toString("hex"),
    TASKDESK_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    TASKDESK_AGENT_URL: "http://localhost:5173",
    TASKDESK_PORTAL_URL: "http://portal.localhost:5174",
    TASKDESK_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/taskdesk_g1_seed_test`,
    TASKDESK_STORAGE_FILESYSTEM_ROOT: path.join(directory, "storage"),
  };
  try {
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@taskdesk/api",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.uat-seed.config.ts",
      ],
      { env, stdio: "pipe", timeout: 240000 },
    )
      .toString()
      .split(env.TASKDESK_DATABASE_URL)
      .join("[database redacted]")
      .split(password)
      .join("[redacted]")
      .split("\n")
      .forEach((line) => {
        console.log(line);
      });
  } catch (error) {
    console.error(
      `${error.stdout ?? ""}\n${error.stderr ?? ""}`
        .split(env.TASKDESK_DATABASE_URL)
        .join("[database redacted]")
        .split(password)
        .join("[redacted]"),
    );
    process.exitCode = 1;
  }
} finally {
  if (container) {
    execFileSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    console.log(`Disposable container removed: ${container}`);
  }
  rmSync(directory, { recursive: true, force: true });
}
