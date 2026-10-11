import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
  /** Private disposable DB URL, for isolated data setup by real-runtime journeys only. */
  databaseUrl: string;
  /** Private mode-0700 directory for runtime setup state and private child logs. */
  fixtureDir: string;
  /** Starts a child that the fixture supervisor will terminate on worker death. */
  spawnChild: SupervisedProcessManager["spawn"];
};

export type MfaCsrfAppFixtureSetup = Pick<
  MfaCsrfAppFixture,
  "databaseUrl" | "fixtureDir" | "origin" | "spawnChild"
>;

const DEFAULT_METRICS_LOCK_PATH = resolve(
  tmpdir(),
  "taskdesk-mfa-csrf-metrics-9464.lock",
);

export type SupervisedChild = {
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(
    event: "close",
    callback: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SupervisedChild;
  kill(signal?: NodeJS.Signals): boolean;
};

export type SupervisedProcessManager = {
  spawn(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    logPrefix: string,
    evidenceDir: string,
  ): Promise<SupervisedChild>;
};

type SupervisedChildState = {
  pid: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  closed: boolean;
  closeListeners: Array<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >;
};

class FixtureProcessSupervisor implements SupervisedProcessManager {
  private readonly child: ReturnType<typeof spawn>;
  private readonly children = new Map<string, SupervisedChildState>();
  private nextId = 0;
  private closePromise: Promise<void> | undefined;
  private readonly ready: Promise<void>;

  private constructor(
    ready: Promise<void>,
    lockPath: string,
    waitMs: number,
    pollMs: number,
  ) {
    this.ready = ready;
    this.child = spawn(
      process.execPath,
      [
        resolve(currentDir, "child-process-supervisor.mjs"),
        lockPath,
        String(waitMs),
        String(pollMs),
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    this.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const message = raw as Record<string, unknown>;
      if (message.type === "spawned" && typeof message.id === "string") {
        const state = this.children.get(message.id);
        if (state && typeof message.pid === "number") state.pid = message.pid;
      } else if (message.type === "exit" && typeof message.id === "string") {
        const state = this.children.get(message.id);
        if (!state) return;
        state.exitCode = typeof message.code === "number" ? message.code : null;
        state.signalCode =
          typeof message.signal === "string"
            ? (message.signal as NodeJS.Signals)
            : null;
        state.closed = true;
        for (const listener of state.closeListeners.splice(0)) {
          listener(state.exitCode, state.signalCode);
        }
      }
    });
  }

  static async start({
    lockPath = DEFAULT_METRICS_LOCK_PATH,
    waitMs = 180_000,
    pollMs = 100,
  }: {
    lockPath?: string;
    waitMs?: number;
    pollMs?: number;
  } = {}) {
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise;
      rejectReady = rejectPromise;
    });
    const supervisor = new FixtureProcessSupervisor(
      ready,
      lockPath,
      waitMs,
      pollMs,
    );
    supervisor.child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const message = raw as Record<string, unknown>;
      if (message.type === "ready") resolveReady();
      if (message.type === "error") {
        rejectReady(
          new Error(
            typeof message.message === "string"
              ? message.message
              : "Could not acquire the fixture metrics-listener lock.",
          ),
        );
      }
    });
    supervisor.child.once("error", () =>
      rejectReady(new Error("Could not start the fixture child supervisor.")),
    );
    supervisor.child.once("exit", (code) => {
      if (code !== 0) {
        rejectReady(
          new Error(
            "The fixture child supervisor exited before acquiring its lock.",
          ),
        );
      }
    });
    await ready;
    return supervisor;
  }

  async spawn(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    logPrefix: string,
    evidenceDir: string,
  ): Promise<SupervisedChild> {
    await this.ready;
    const id = `fixture-child-${this.nextId++}`;
    const state: SupervisedChildState = {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      closed: false,
      closeListeners: [],
    };
    this.children.set(id, state);
    this.child.send({
      type: "spawn",
      id,
      command,
      args,
      cwd: repoRoot,
      env,
      evidenceDir,
      logPrefix,
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const onMessage = (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const message = raw as Record<string, unknown>;
        if (message.id !== id) return;
        if (message.type === "spawned") {
          this.child.off("message", onMessage);
          resolveSpawn();
        } else if (message.type === "spawn-error") {
          this.child.off("message", onMessage);
          rejectSpawn(
            new Error(
              typeof message.message === "string"
                ? message.message
                : "The fixture child could not be started.",
            ),
          );
        }
      };
      this.child.on("message", onMessage);
    });
    const thisSupervisor = this;
    const remoteChild: SupervisedChild = {
      get pid() {
        return state.pid;
      },
      get exitCode() {
        return state.exitCode;
      },
      get signalCode() {
        return state.signalCode;
      },
      once(_event, callback) {
        if (state.closed) {
          queueMicrotask(() => callback(state.exitCode, state.signalCode));
        } else {
          state.closeListeners.push(callback);
        }
        return remoteChild;
      },
      kill(signal = "SIGTERM") {
        if (state.closed || !state.pid) return false;
        thisSupervisor.child.send({ type: "kill", id, signal });
        return true;
      },
    };
    return remoteChild;
  }

  close() {
    if (!this.closePromise) {
      this.closePromise = new Promise<void>((resolveClose, rejectClose) => {
        const onMessage = (raw: unknown) => {
          if (
            raw &&
            typeof raw === "object" &&
            (raw as Record<string, unknown>).type === "closed"
          ) {
            this.child.off("message", onMessage);
            resolveClose();
          }
        };
        this.child.on("message", onMessage);
        this.child.once("error", () =>
          rejectClose(
            new Error("Fixture child supervisor failed during shutdown."),
          ),
        );
        this.child.send({ type: "shutdown" });
      });
    }
    return this.closePromise;
  }
}

/** A dedicated supervisor owns the lock and children across test-worker death. */
export async function withExclusiveMetricsListener<T>(
  run: (supervisor: SupervisedProcessManager) => Promise<T>,
  options: {
    lockPath?: string;
    waitMs?: number;
    pollMs?: number;
  } = {},
): Promise<T> {
  const supervisor = await FixtureProcessSupervisor.start(options);
  try {
    return await run(supervisor);
  } finally {
    await supervisor.close();
  }
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
  supervisor: SupervisedProcessManager,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logPrefix: string,
  evidenceDir: string,
): Promise<SupervisedChild> {
  return supervisor.spawn(command, args, env, logPrefix, evidenceDir);
}

async function waitForExit(child: SupervisedChild) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolveExit) => {
    child.once("close", (code) => resolveExit(code));
  });
}

async function runMigration(
  migrationUrl: string,
  applicationUrl: string,
  bootstrapEnv: NodeJS.ProcessEnv,
  evidenceDir: string,
  supervisor: SupervisedProcessManager,
) {
  const child = spawnWithPrivateLogs(
    supervisor,
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
  const code = await waitForExit(await child);
  if (code !== 0) throw new Error("The disposable database migration failed.");
}

async function waitForHealth(child: SupervisedChild, origin: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
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

async function terminate(child: SupervisedChild | undefined) {
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
    await waitForExit(child);
  }
}

/**
 * Runs a callback against an isolated PostgreSQL 18 database and the real API
 * serving both compiled web entries. Child output is kept in a private
 * temporary directory so bootstrap credentials cannot enter public test logs.
 */
export async function withMfaCsrfApp<T>(
  run: (fixture: MfaCsrfAppFixture) => Promise<T>,
  options: {
    beforeStart?: (fixture: MfaCsrfAppFixtureSetup) => Promise<void>;
  } = {},
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

  return withExclusiveMetricsListener((supervisor) =>
    runMfaCsrfApp(run, options, supervisor),
  );
}

async function runMfaCsrfApp<T>(
  run: (fixture: MfaCsrfAppFixture) => Promise<T>,
  options: {
    beforeStart?: (fixture: MfaCsrfAppFixtureSetup) => Promise<void>;
  },
  supervisor: SupervisedProcessManager,
): Promise<T> {
  const { PostgreSqlContainer } = apiPackageRequire(
    "@testcontainers/postgresql",
  ) as {
    PostgreSqlContainer: PostgreSqlContainerConstructor;
  };
  let container: PostgreSqlContainerInstance | undefined;
  let apiProcess: SupervisedChild | undefined;
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

    await runMigration(
      migrationUrl,
      applicationUrl,
      bootstrapEnv,
      evidenceDir,
      supervisor,
    );
    await options.beforeStart?.({
      databaseUrl: applicationUrl,
      fixtureDir: evidenceDir,
      origin,
      spawnChild: supervisor.spawn.bind(supervisor),
    });
    apiProcess = await spawnWithPrivateLogs(
      supervisor,
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
    return await run({
      origin,
      email,
      password,
      databaseUrl: applicationUrl,
      fixtureDir: evidenceDir,
      spawnChild: supervisor.spawn.bind(supervisor),
    });
  } finally {
    await terminate(apiProcess);
    if (container) await container.stop();
  }
}
