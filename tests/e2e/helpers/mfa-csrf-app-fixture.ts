import { type ChildProcess, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { chmod, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PostgreSqlContainerInstance = {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
};

type PostgreSqlContainerBuilder = {
  withDatabase(name: string): PostgreSqlContainerBuilder;
  withUsername(name: string): PostgreSqlContainerBuilder;
  withPassword(password: string): PostgreSqlContainerBuilder;
  start(): Promise<PostgreSqlContainerInstance>;
};

type PostgreSqlContainerConstructor = new (
  image: string,
) => PostgreSqlContainerBuilder;

export type MfaCsrfAppFixture = {
  origin: string;
  email: string;
  password: string;
};

type MetricsLockOwner = { pid: number; token: string };
type MetricsLockOptions = {
  lockPath?: string;
  waitMs?: number;
  pollMs?: number;
};

const DEFAULT_METRICS_LOCK_PATH = resolve(
  tmpdir(),
  "taskdesk-mfa-csrf-metrics-9464.lock",
);

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readLockOwner(lockPath: string): MetricsLockOwner | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    const record = value as Record<string, unknown>;
    if (
      typeof value === "object" &&
      value !== null &&
      Number.isSafeInteger(record.pid) &&
      (record.pid as number) > 0 &&
      typeof record.token === "string" &&
      record.token.length > 0
    ) {
      return { pid: record.pid as number, token: record.token };
    }
  } catch {
    // A lock that is being created or is malformed is never reclaimed by guessing.
  }
  return undefined;
}

function reclaimDeadOwner(lockPath: string, owner: MetricsLockOwner) {
  if (processIsAlive(owner.pid)) return false;

  const reaperPath = `${lockPath}.reap`;
  const reaper = { pid: process.pid, token: randomUUID() };
  let descriptor: number;
  try {
    descriptor = openSync(reaperPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }

  try {
    writeFileSync(descriptor, JSON.stringify(reaper));
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    try {
      unlinkSync(reaperPath);
    } catch {
      // Keep the original creation failure.
    }
    throw error;
  }

  try {
    const before = statSync(lockPath);
    const current = readLockOwner(lockPath);
    const after = statSync(lockPath);
    if (
      !current ||
      current.pid !== owner.pid ||
      current.token !== owner.token ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      processIsAlive(current.pid)
    ) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(descriptor);
    const currentReaper = readLockOwner(reaperPath);
    if (
      currentReaper?.pid === reaper.pid &&
      currentReaper.token === reaper.token
    ) {
      try {
        unlinkSync(reaperPath);
      } catch {
        // A stale reaper lock fails closed on the next acquisition attempt.
      }
    }
  }
}

/**
 * Serializes test app lifetimes that bind the production metrics listener to 9464.
 * A stale lock is reclaimed only when its recorded process is definitely gone and
 * the same lock file is still present; malformed locks fail closed after a bounded wait.
 */
export async function withExclusiveMetricsListener<T>(
  run: () => Promise<T>,
  {
    lockPath = DEFAULT_METRICS_LOCK_PATH,
    waitMs = 180_000,
    pollMs = 100,
  }: MetricsLockOptions = {},
): Promise<T> {
  const deadline = Date.now() + waitMs;
  const owner = { pid: process.pid, token: randomUUID() };
  let acquired = false;

  while (!acquired) {
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(descriptor, JSON.stringify(owner));
        fsyncSync(descriptor);
        acquired = true;
      } catch (writeError) {
        try {
          unlinkSync(lockPath);
        } catch {
          // Preserve the write error; another process cannot own this created file.
        }
        throw writeError;
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readLockOwner(lockPath);
      if (existing) reclaimDeadOwner(lockPath, existing);
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting for the isolated MFA app metrics listener; the owner may still be active or its lock is malformed.",
        );
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
    }
  }

  let result!: T;
  let runFailure: unknown;
  let runFailed = false;
  try {
    result = await run();
  } catch (error) {
    runFailure = error;
    runFailed = true;
  }

  let releaseFailure: unknown;
  const current = readLockOwner(lockPath);
  if (current?.pid === owner.pid && current.token === owner.token) {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        releaseFailure = error;
      }
    }
  }

  if (runFailed && releaseFailure) {
    throw new AggregateError(
      [runFailure, releaseFailure],
      "The isolated fixture failed and its metrics lock could not be released.",
    );
  }
  if (runFailed) throw runFailure;
  if (releaseFailure) throw releaseFailure;
  return result;
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let accumulator = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replaceAll("=", "")) {
    const digit = alphabet.indexOf(character);
    if (digit < 0)
      throw new Error("The authenticator URI did not contain a valid key.");
    accumulator = (accumulator << 5) | digit;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >>> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  return Buffer.from(bytes);
}

/** Computes a current RFC 6238 code without returning or logging the shared key. */
export function totpForUri(uri: string, now = Date.now()) {
  let key: string | null = null;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "otpauth:") key = parsed.searchParams.get("secret");
  } catch {
    throw new Error(
      "The authenticator response did not contain a valid provisioning URI.",
    );
  }
  if (!key)
    throw new Error(
      "The authenticator response did not contain a provisioning key.",
    );
  const counter = Math.floor(now / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(key))
    .update(counterBytes)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
const apiPackageRequire = createRequire(
  resolve(repoRoot, "apps/api/package.json"),
);
const apiEntrypoint = resolve(repoRoot, "apps/api/dist/index.js");
const agentBuild = resolve(repoRoot, "apps/web/dist/agent/index.html");
const portalBuild = resolve(repoRoot, "apps/web/dist/portal/index.html");

function randomPassword() {
  return randomBytes(36).toString("base64url");
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve the disposable web port.");
  }
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function spawnWithPrivateLogs(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logPrefix: string,
  evidenceDir: string,
) {
  const stdoutFd = openSync(
    resolve(evidenceDir, `${logPrefix}.stdout.log`),
    "wx",
    0o600,
  );
  const stderrFd = openSync(
    resolve(evidenceDir, `${logPrefix}.stderr.log`),
    "wx",
    0o600,
  );
  try {
    return spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
}

async function waitForExit(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolveExit) => {
    child.once("close", (code) => resolveExit(code));
    child.once("error", () => resolveExit(null));
  });
}

async function runMigration(
  migrationUrl: string,
  applicationUrl: string,
  bootstrapEnv: NodeJS.ProcessEnv,
  evidenceDir: string,
) {
  const child = spawnWithPrivateLogs(
    process.execPath,
    [apiEntrypoint],
    {
      ...bootstrapEnv,
      TASKDESK_ROLE: "migrate",
      TASKDESK_DATABASE_URL: applicationUrl,
      TASKDESK_MIGRATION_DATABASE_URL: migrationUrl,
    },
    "migration",
    evidenceDir,
  );
  const code = await waitForExit(child);
  if (code !== 0) throw new Error("The disposable database migration failed.");
}

async function waitForHealth(child: ChildProcess, origin: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("The disposable application exited before health.");
    }
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Startup can take a few seconds while the API prepares its isolated database.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("The disposable application did not become healthy in time.");
}

async function terminate(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let gracefulTimeout: NodeJS.Timeout | undefined;
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    new Promise<boolean>((resolveTimeout) => {
      gracefulTimeout = setTimeout(() => resolveTimeout(false), 8_000);
    }),
  ]);
  if (gracefulTimeout) clearTimeout(gracefulTimeout);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    let forcedTimeout: NodeJS.Timeout | undefined;
    await Promise.race([
      waitForExit(child),
      new Promise<void>((resolveTimeout) => {
        forcedTimeout = setTimeout(resolveTimeout, 2_000);
      }),
    ]);
    if (forcedTimeout) clearTimeout(forcedTimeout);
  }
}

/**
 * Runs a callback against an isolated PostgreSQL 18 database and the real API
 * serving both compiled web entries. Child output is kept in a private
 * temporary directory so bootstrap credentials cannot enter public test logs.
 */
export async function withMfaCsrfApp<T>(
  run: (fixture: MfaCsrfAppFixture) => Promise<T>,
): Promise<T> {
  if (
    !existsSync(apiEntrypoint) ||
    !existsSync(agentBuild) ||
    !existsSync(portalBuild)
  ) {
    throw new Error(
      "Build the API and both web entries before the isolated MFA/CSRF journey.",
    );
  }

  return withExclusiveMetricsListener(() => runMfaCsrfApp(run));
}

async function runMfaCsrfApp<T>(
  run: (fixture: MfaCsrfAppFixture) => Promise<T>,
): Promise<T> {
  const { PostgreSqlContainer } = apiPackageRequire(
    "@testcontainers/postgresql",
  ) as {
    PostgreSqlContainer: PostgreSqlContainerConstructor;
  };
  let container: PostgreSqlContainerInstance | undefined;
  let apiProcess: ChildProcess | undefined;
  try {
    const evidenceDir = await mkdtemp(resolve(tmpdir(), "td-mfa-csrf-"));
    await chmod(evidenceDir, 0o700);
    const databaseName = `mfa_csrf_${randomUUID().replaceAll("-", "")}`;
    container = await new PostgreSqlContainer("postgres:18-alpine")
      .withDatabase(databaseName)
      .withUsername("postgres")
      .withPassword(randomPassword())
      .start();

    const migrationUrl = container.getConnectionUri();
    const appUrl = new URL(migrationUrl);
    appUrl.username = "taskdesk_e2e_app";
    appUrl.password = randomPassword();
    const applicationUrl = appUrl.toString();
    const port = await reserveLoopbackPort();
    // `localhost` is a trustworthy development host, so Chromium accepts the
    // app's real Secure `__Host-` session cookie while the service remains
    // bound to loopback. The origin stays same-site for the real auth flow.
    const origin = `http://localhost:${port}`;
    const email = `mfa-csrf-${randomUUID()}@example.test`;
    const password = randomPassword();
    const secret = randomBytes(48).toString("base64url");
    const bootstrapEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      TASKDESK_AUTH_SECRET: secret,
      TASKDESK_AGENT_URL: origin,
      TASKDESK_PORTAL_URL: `http://portal.localhost:${port}`,
      KANEO_API_URL: origin,
      TASKDESK_BOOTSTRAP_ADMIN_EMAIL: email,
      TASKDESK_DATABASE_URL: applicationUrl,
      TASKDESK_ROLE: "migrate",
      DISABLE_REGISTRATION: "false",
      DISABLE_PASSWORD_REGISTRATION: "false",
      DISABLE_EMAIL_OTP_SIGN_IN: "true",
      DISABLE_LOGIN_FORM: "false",
      DEMO_MODE: "false",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_SECURE: "",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      GITHUB_OAUTH_CLIENT_ID: "",
      GITHUB_OAUTH_CLIENT_SECRET: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      DISCORD_CLIENT_ID: "",
      DISCORD_CLIENT_SECRET: "",
      CUSTOM_OAUTH_CLIENT_ID: "",
      CUSTOM_OAUTH_CLIENT_SECRET: "",
      CUSTOM_OAUTH_AUTHORIZATION_URL: "",
      CUSTOM_OAUTH_TOKEN_URL: "",
      CUSTOM_OAUTH_USER_INFO_URL: "",
      CUSTOM_OAUTH_SCOPES: "",
      CUSTOM_OAUTH_RESPONSE_TYPE: "",
      CUSTOM_OAUTH_DISCOVERY_URL: "",
      CUSTOM_OAUTH_AUTO_LOGIN: "",
    };

    await runMigration(migrationUrl, applicationUrl, bootstrapEnv, evidenceDir);
    apiProcess = spawnWithPrivateLogs(
      process.execPath,
      [apiEntrypoint],
      {
        ...bootstrapEnv,
        TASKDESK_ROLE: "web",
        TASKDESK_PORT: String(port),
        TASKDESK_DATABASE_URL: applicationUrl,
        TASKDESK_MIGRATION_DATABASE_URL: undefined,
      },
      "api",
      evidenceDir,
    );
    await waitForHealth(apiProcess, origin);
    return await run({ origin, email, password });
  } finally {
    await terminate(apiProcess);
    if (container) await container.stop();
  }
}
