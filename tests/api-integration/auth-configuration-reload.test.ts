import { type ChildProcess, fork } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createId } from "../../apps/api/node_modules/@paralleldrive/cuid2";
import Redis from "../../apps/api/node_modules/ioredis";
import { reloadAuthConfiguration } from "../../apps/api/src/auth";
import * as authReload from "../../apps/api/src/auth/configuration-reload";
import { publishCommittedAuthConfigurationReload } from "../../apps/api/src/auth/configuration-reload";
import db, { schema } from "../../apps/api/src/database";
import * as oidcProvider from "../../apps/api/src/identity/oidc-provider";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import {
  initializeWebSocketAdapter,
  shutdownWebSocketAdapter,
} from "../../apps/api/src/ws";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { startTestValkey, type TestValkeyServer } from "./helpers/test-valkey";

vi.mock("../../apps/api/src/identity/oidc-provider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/identity/oidc-provider")
    >();
  return {
    ...actual,
    loadEntraDiscovery: vi.fn(async (tenantId: string) => ({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorizationEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenEndpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      jwksUri: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    })),
  };
});

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const ADMIN_PASSWORD = "Auth-reload-test-password-92!";
const ADMIN_ID = "auth-reload-config-admin";
const AUTH_RELOAD_ENCRYPTION_KEY = "a9".repeat(32);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("failed to reserve auth reload replica port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function startReplica(valkeyUrl: string, port: number) {
  const entry = fileURLToPath(
    new URL("./helpers/auth-reload-instance-server.ts", import.meta.url),
  );
  const child = fork(entry, [], {
    cwd: process.cwd(),
    detached: true,
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      TASKDESK_PORT: String(port),
      TASKDESK_AGENT_URL: `http://127.0.0.1:${port}`,
      TASKDESK_VALKEY_URL: valkeyUrl,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const ready = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("auth reload API replica startup timed out")),
      15_000,
    );
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("auth reload API replica failed to start"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`auth reload API replica exited early (${code ?? "signal"})`),
      );
    });
    child.on("message", (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message)
      )
        return;
      if (message.type === "startup-error") {
        clearTimeout(timer);
        reject(new Error("auth reload API replica reported startup failure"));
      } else if (
        message.type === "ready" &&
        "port" in message &&
        typeof message.port === "number"
      ) {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
  });
  return { child, ready };
}

async function stopReplica(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.send("stop");
  await Promise.race([exited, sleep(8_000)]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGTERM");
}

async function magicLinkStatus(port?: number): Promise<number> {
  const agentOrigin = port
    ? `http://127.0.0.1:${port}`
    : "http://localhost:1337";
  const target = `${agentOrigin}/api/auth/sign-in/magic-link`;
  const headers = {
    "content-type": "application/json",
    host: new URL(agentOrigin).host,
    origin: agentOrigin,
  };
  const response = port
    ? await fetch(target, {
        method: "POST",
        headers,
        body: "{}",
      })
    : await createApp().app.request(target, {
        method: "POST",
        headers,
        body: "{}",
      });
  return response.status;
}

async function waitForMagicLink(port: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  let status = 404;
  while (Date.now() < deadline) {
    status = await magicLinkStatus(port);
    if (status !== 404) return status;
    await sleep(50);
  }
  return status;
}

describe("committed authentication configuration reload propagation", () => {
  const originalValkeyUrl = process.env.TASKDESK_VALKEY_URL;
  const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;
  let replica: ChildProcess | undefined;
  let valkey: TestValkeyServer | undefined;
  let parentAdapterStarted = false;
  let controlMonitor: Redis | undefined;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
    await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
    process.env.TASKDESK_ENCRYPTION_KEY = AUTH_RELOAD_ENCRYPTION_KEY;
  });

  afterEach(async () => {
    try {
      controlMonitor?.disconnect();
      controlMonitor = undefined;
      if (replica) {
        await stopReplica(replica);
        replica = undefined;
      }
    } finally {
      try {
        if (parentAdapterStarted) {
          await shutdownWebSocketAdapter();
          parentAdapterStarted = false;
        }
      } finally {
        if (valkey) {
          await valkey.stop();
          valkey = undefined;
        }
        if (originalValkeyUrl === undefined)
          delete process.env.TASKDESK_VALKEY_URL;
        else process.env.TASKDESK_VALKEY_URL = originalValkeyUrl;
        if (originalEncryptionKey === undefined)
          delete process.env.TASKDESK_ENCRYPTION_KEY;
        else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
      }
    }
  });

  it("reloads local and peer auth instances only after the persisted version commits", async () => {
    const instanceKey = `auth-reload-${createId()}`;
    const pluginId = createId();
    await db.insert(schema.instancePluginConfigTable).values({
      id: pluginId,
      pluginId: "auth.magic-link",
      instanceKey,
      displayName: "Magic link",
      enabled: false,
      config: {},
      secrets: null,
      scope: "instance",
      workspaceId: null,
      portalScope: "agent",
      configVersion: 1,
    });

    await reloadAuthConfiguration();
    expect(await magicLinkStatus()).toBe(404);

    valkey = await startTestValkey();
    const valkeyUrl = valkey.url;
    process.env.TASKDESK_VALKEY_URL = valkeyUrl;
    await initializeWebSocketAdapter();
    parentAdapterStarted = true;
    const replicaPortReservation = await reservePort();
    const started = startReplica(valkeyUrl, replicaPortReservation);
    replica = started.child;
    const replicaPort = await started.ready;
    expect(await magicLinkStatus(replicaPort)).toBe(404);

    controlMonitor = new Redis(valkeyUrl);
    const controlMessages: string[] = [];
    controlMonitor.on("message", (channel, message) => {
      if (channel === "taskdesk:control") controlMessages.push(message);
    });
    await controlMonitor.subscribe("taskdesk:control");

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(schema.instancePluginConfigTable)
          .set({ enabled: true, configVersion: 2 })
          .where(eq(schema.instancePluginConfigTable.id, pluginId));
        throw new Error("rollback auth reload fixture");
      }),
    ).rejects.toThrow("rollback auth reload fixture");
    await sleep(100);
    expect(controlMessages).toEqual([]);
    expect(await magicLinkStatus(replicaPort)).toBe(404);

    await db
      .update(schema.instancePluginConfigTable)
      .set({ enabled: true, configVersion: 2, updatedAt: new Date() })
      .where(eq(schema.instancePluginConfigTable.id, pluginId));
    await publishCommittedAuthConfigurationReload();

    const peerStatus = await waitForMagicLink(replicaPort);
    expect(peerStatus).not.toBe(404);
    expect(await magicLinkStatus()).not.toBe(404);
    expect(controlMessages).toEqual([JSON.stringify({ type: "auth.reload" })]);
    const [persisted] = await db
      .select({
        enabled: schema.instancePluginConfigTable.enabled,
        configVersion: schema.instancePluginConfigTable.configVersion,
      })
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.id, pluginId));
    expect(persisted).toEqual({ enabled: true, configVersion: 2 });
  }, 90_000);

  it("emits no hint for a rejected create and observes the committed row before notifying", async () => {
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: ADMIN_ID,
        name: "Auth Reload Administrator",
        email: "auth-reload-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("auth reload administrator was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${ADMIN_ID}`,
      token: `token-${ADMIN_ID}`,
      userId: ADMIN_ID,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accountTable).values({
      id: `account-${ADMIN_ID}`,
      accountId: ADMIN_ID,
      providerId: "credential",
      userId: ADMIN_ID,
      password: await bcrypt.hash(ADMIN_PASSWORD, 4),
    });

    const app = createApp().app;
    const request = {
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: null,
      displayName: "Auth reload test connection",
      tenantId: "12345678-1234-4234-8234-123456789012",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientSecret: "one-time-auth-reload-secret",
      scopes: ["openid", "profile"],
      claimMapping: { version: 1, displayName: "name" },
      domainBindings: [],
      jitPolicy: {
        enabled: false,
        default_role_id: null,
        required_entra_app_role: "TaskDesk.User",
      },
      maxRoleRank: 10,
    } as const;
    const committedRowCounts: number[] = [];
    const reloadSpy = vi
      .spyOn(authReload, "publishCommittedAuthConfigurationReload")
      .mockImplementation(async () => {
        const rows = await db
          .select({ id: schema.identityConnectionTable.id })
          .from(schema.identityConnectionTable);
        committedRowCounts.push(rows.length);
      });

    const denied = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": "invalid-proof",
        },
        body: JSON.stringify(request),
      },
      `__Host-tdk_agent_session=token-${ADMIN_ID}`,
    );
    expect(denied.status).toBe(403);
    expect(reloadSpy).not.toHaveBeenCalled();

    const binding = {
      kind: "operation",
      operation: "identity_connection_create",
      request,
    };
    const challengeResponse = await csrfRequest(
      app,
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(binding),
      },
      `__Host-tdk_agent_session=token-${ADMIN_ID}`,
    );
    expect(challengeResponse.status).toBe(200);
    const challenge = (await challengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const proofResponse = await csrfRequest(
      app,
      "/api/me/step-up",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...binding,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: "password",
          password: ADMIN_PASSWORD,
        }),
      },
      `__Host-tdk_agent_session=token-${ADMIN_ID}`,
    );
    expect(proofResponse.status).toBe(200);
    const proof = (await proofResponse.json()) as { token: string };
    const created = await csrfRequest(
      app,
      "/api/instance/identity-connections",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": proof.token,
        },
        body: JSON.stringify(request),
      },
      `__Host-tdk_agent_session=token-${ADMIN_ID}`,
    );
    expect(created.status).toBe(201);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(committedRowCounts).toEqual([1]);
    expect(JSON.stringify(await created.json())).not.toContain(
      request.clientSecret,
    );
    expect(oidcProvider.loadEntraDiscovery).toHaveBeenCalled();
  });
});
