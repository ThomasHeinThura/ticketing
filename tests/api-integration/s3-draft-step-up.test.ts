import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfiguredCustomerOrigin } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as draftRepository from "../../apps/api/src/storage/s3-draft-repository";
import type { S3DraftWrite } from "../../apps/api/src/storage/s3-draft-schema";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";

// Only provider I/O is mocked here; sessions, CSRF, proofs, transactions and storage are real.
const network = vi.hoisted(() => ({
  calls: 0,
  observe: null as null | (() => Promise<void>),
}));
vi.mock("../../apps/api/src/storage/s3-draft-probe", () => ({
  createS3DraftProbeAdapter: () => {
    let bytes = Buffer.alloc(0);
    return {
      driver: "s3",
      write: async (_key: string, value: Buffer) => {
        network.calls += 1;
        await network.observe?.();
        bytes = Buffer.from(value);
      },
      read: async () => Buffer.from(bytes),
      delete: async () => {
        throw new Error("unexpected diagnostic deletion");
      },
      close: () => {},
    };
  },
}));
const bcrypt = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("bcryptjs") as { hash(value: string, rounds: number): Promise<string> };
const PASSWORD = "synthetic-storage-settings-proof-password";
const PATH = "/api/instance/storage/s3-draft";
const TOKEN_HEADER = "x-taskdesk-step-up-token";
type App = ReturnType<typeof createApp>["app"];
type Operation = "storage_config_save" | "storage_config_test";
const candidate: S3DraftWrite = {
  version: 0,
  config: {
    connector: "bundled_seaweedfs",
    forcePathStyle: true,
    publicBaseUrl: "https://files.example.test",
    region: "us-east-1",
    bucket: "draft-bucket",
    keyPrefix: "test/",
    maxImageUploadBytes: 10_485_760,
    presignTtlSeconds: 300,
  },
  credentials: {
    accessKeyId: "synthetic-access",
    secretAccessKey: "synthetic-secret",
  },
};
beforeEach(async () => {
  network.calls = 0;
  network.observe = null;
  await resetTestDatabase();
});
afterEach(() => vi.restoreAllMocks());

async function actor(app: App, role: string | null = "admin") {
  const id = randomUUID();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  await db.insert(schema.userTable).values({
    id,
    name: "Synthetic storage administrator",
    email: `${id}@example.test`,
    emailVerified: true,
    role,
  });
  await ensureStaffPersonForUser(id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  const login = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ email: `${id}@example.test`, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("Synthetic actor session unavailable");
  return cookie;
}
function request(
  app: App,
  cookie: string,
  path: string,
  body: unknown,
  method = "POST",
  token?: string,
) {
  return csrfRequest(
    app,
    path,
    {
      method,
      headers: {
        cookie,
        "content-type": "application/json",
        ...(token ? { [TOKEN_HEADER]: token } : {}),
      },
      body: JSON.stringify(body),
    },
    cookie,
  );
}
async function proof(
  app: App,
  cookie: string,
  operation: Operation,
  body = candidate,
) {
  const binding = { kind: "operation", operation, ...body };
  const challenge = await request(
    app,
    cookie,
    "/api/me/step-up/challenges",
    binding,
  );
  expect(challenge.status).toBe(200);
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const response = await request(app, cookie, "/api/me/step-up", {
    ...binding,
    challengeId: issued.challengeId,
    nonce: issued.nonce,
    method: "password",
    password: PASSWORD,
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}
async function drafts() {
  return db
    .select()
    .from(schema.instancePluginConfigTable)
    .where(eq(schema.instancePluginConfigTable.pluginId, "storage.s3"));
}
async function proofState() {
  return db
    .select({
      state: schema.stepUpConfirmationTable.state,
      operation: schema.stepUpConfirmationTable.operationKey,
    })
    .from(schema.stepUpConfirmationTable);
}

describe("S3 draft configuration-bound step-up HTTP API", () => {
  it("denies ordinary staff, missing proofs and host confusion without I/O or persistence", async () => {
    const { app } = createApp();
    const member = await actor(app, null);
    expect(
      (await app.request(PATH, { headers: { cookie: member } })).status,
    ).toBe(403);
    expect((await request(app, member, PATH, candidate, "PUT")).status).toBe(
      403,
    );
    const cookie = await actor(app);
    const customerOrigin = getConfiguredCustomerOrigin();
    expect(
      (
        await app.request(`${customerOrigin}${PATH}`, {
          headers: { host: new URL(customerOrigin).host, cookie },
        })
      ).status,
    ).toBe(404); // Agent administration routes are concealed on the customer host.
    expect((await request(app, cookie, PATH, candidate, "PUT")).status).toBe(
      403,
    );
    expect((await request(app, cookie, `${PATH}/test`, candidate)).status).toBe(
      403,
    );
    expect(await drafts()).toHaveLength(0);
    expect(network.calls).toBe(0);
  });

  it("binds settings and secrets, saves encrypted state, preserves credentials on reload and denies replay", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const token = await proof(app, cookie, "storage_config_save");
    const changed = {
      ...candidate,
      credentials: {
        ...candidate.credentials,
        secretAccessKey: "changed-secret",
      },
    };
    expect(
      (await request(app, cookie, PATH, changed, "PUT", token)).status,
    ).toBe(403);
    expect(await drafts()).toHaveLength(0);
    const response = await request(app, cookie, PATH, candidate, "PUT", token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const saved = (await response.json()) as { version: number };
    expect(saved.version).toBe(1);
    const [row] = await drafts();
    expect(row?.enabled).toBe(false);
    expect(JSON.stringify(row?.config)).not.toContain("synthetic-secret");
    expect(row?.secrets).not.toContain("synthetic-secret");
    const read = await app.request(PATH, { headers: { cookie } });
    const publicValue = await read.text();
    expect(publicValue).not.toContain("synthetic-secret");
    expect(publicValue).not.toContain("synthetic-access");
    expect(JSON.parse(publicValue)).toMatchObject({
      version: 1,
      credentialConfigured: true,
    });
    const keep = { version: 1, config: candidate.config };
    const keepToken = await proof(app, cookie, "storage_config_save", keep);
    expect(
      (await request(app, cookie, PATH, keep, "PUT", keepToken)).status,
    ).toBe(200);
    expect(
      (
        await request(
          app,
          cookie,
          PATH,
          { ...keep, version: 2 },
          "PUT",
          keepToken,
        )
      ).status,
    ).toBe(403);
    expect(network.calls).toBe(0);
  });

  it("separates save/test proofs and consumes the test once before provider I/O", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const saveToken = await proof(app, cookie, "storage_config_save");
    expect(
      (await request(app, cookie, `${PATH}/test`, candidate, "POST", saveToken))
        .status,
    ).toBe(403);
    expect(network.calls).toBe(0);
    const testToken = await proof(app, cookie, "storage_config_test");
    network.observe = async () => {
      const rows = await proofState();
      expect(
        rows.find((row) => row.operation === "storage_config_test")?.state,
      ).toBe("consumed");
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "plugin.tested"));
      expect(audit).toHaveLength(1);
    };
    const result = await request(
      app,
      cookie,
      `${PATH}/test`,
      candidate,
      "POST",
      testToken,
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: "verified",
      cleanup: "not_attempted",
      diagnosticObjectMayRemain: true,
      browserPathVerified: false,
    });
    expect(
      (await proofState()).find(
        (row) => row.operation === "storage_config_test",
      )?.state,
    ).toBe("consumed");
    expect(network.calls).toBe(1);
    expect(await drafts()).toHaveLength(0);
    expect(
      (await request(app, cookie, `${PATH}/test`, candidate, "POST", testToken))
        .status,
    ).toBe(403);
    expect(network.calls).toBe(1);
    // A test attempt cannot consume the separately issued save proof.
    expect(
      (await request(app, cookie, PATH, candidate, "PUT", saveToken)).status,
    ).toBe(200);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "plugin.tested"),
          eq(schema.auditLogTable.entityType, "instance_plugin_config"),
        ),
      );
    expect(audit).toHaveLength(1);
    const serialized = JSON.stringify(audit, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    for (const secret of [
      "synthetic-access",
      "synthetic-secret",
      "files.example.test",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("takes the shared storage probe lease and keeps the proof when it is refused", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const first = await proof(app, cookie, "storage_config_test");
    expect(
      (await request(app, cookie, `${PATH}/test`, candidate, "POST", first))
        .status,
    ).toBe(200);
    const second = await proof(app, cookie, "storage_config_test");
    const refused = await request(
      app,
      cookie,
      `${PATH}/test`,
      candidate,
      "POST",
      second,
    );
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(network.calls).toBe(1);
    // The refused attempt rolled back its spend and wrote no extra audit row.
    expect(
      (await proofState()).filter((row) => row.state === "consumed"),
    ).toHaveLength(1);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"));
    expect(audit).toHaveLength(1);
  });

  it("rejects stale versions before spending a fresh proof and serializes concurrent saves", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const token = await proof(app, cookie, "storage_config_save");
    const responses = await Promise.all([
      request(app, cookie, PATH, candidate, "PUT", token),
      request(app, cookie, PATH, candidate, "PUT", token),
    ]);
    expect(responses.map((value) => value.status).sort()).toEqual([200, 409]);
    const staleToken = await proof(app, cookie, "storage_config_save");
    expect(
      (await request(app, cookie, PATH, candidate, "PUT", staleToken)).status,
    ).toBe(409);
    expect((await proofState()).some((row) => row.state === "issued")).toBe(
      true,
    );
    expect((await drafts())[0]?.configVersion).toBe(1);
  });

  it("rejects a proof from another session without spending it", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const other = await actor(app);
    const token = await proof(app, cookie, "storage_config_save");
    expect(
      (await request(app, other, PATH, candidate, "PUT", token)).status,
    ).toBe(403);
    expect(
      (await request(app, cookie, PATH, candidate, "PUT", token)).status,
    ).toBe(200);
  });
  it("rolls back proof consumption when the guarded save does not persist", async () => {
    const { app } = createApp();
    const cookie = await actor(app);
    const token = await proof(app, cookie, "storage_config_save");
    vi.spyOn(draftRepository, "persistS3Draft").mockResolvedValueOnce(
      undefined,
    );
    expect(
      (await request(app, cookie, PATH, candidate, "PUT", token)).status,
    ).toBe(409);
    expect(await drafts()).toHaveLength(0);
    expect(
      (await proofState()).find(
        (row) => row.operation === "storage_config_save",
      )?.state,
    ).toBe("issued");
    expect(
      (await request(app, cookie, PATH, candidate, "PUT", token)).status,
    ).toBe(200);
  });
});
