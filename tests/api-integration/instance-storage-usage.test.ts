import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const password = "storage-usage-integration-fixture-password";

async function makeUser(role: string | null) {
  const id = `storage-usage-${randomUUID()}`;
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() })
    .onConflictDoNothing();
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "Synthetic storage usage actor",
      email: `${id}@example.test`,
      emailVerified: true,
      role,
    })
    .returning();
  if (!user) throw new Error("Storage usage actor fixture was not created");
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("Storage usage person fixture was not created");
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  return user;
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(`Fixture sign-in returned ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie)
    throw new Error("Fixture sign-in did not issue an agent session");
  return cookie;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("instance storage usage HTTP API", () => {
  it("returns only persisted limits and logical attachment metadata", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/storage/usage", {
      headers: { cookie },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.backend).toMatchObject({
      source: "bootstrap",
      connectivity: "not_checked",
    });
    expect(body.usageBasis).toBe("attachment_metadata");
    expect(body.physicalUsageAvailable).toBe(false);
    expect(body.limits).toEqual({
      maxAttachmentBytes: expect.any(Number),
      maxAttachmentsPerItem: expect.any(Number),
      allowedExtensions: expect.any(Array),
    });
    expect(body.attachments).toEqual({
      ready: { count: 0, bytes: "0" },
      pending: { count: 0, bytes: "0" },
      deleted: { count: 0, bytes: "0" },
    });
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "objectKey",
      "filename",
      "mimeType",
      "workspaceId",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("denies a signed-in non-admin", async () => {
    const user = await makeUser(null);
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await app.request("/api/instance/storage/usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
  });
});

describe("instance storage probe HTTP API", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "taskdesk-storage-probe-http-"));
    vi.stubEnv("TASKDESK_STORAGE_DRIVER", "filesystem");
    vi.stubEnv("TASKDESK_STORAGE_FILESYSTEM_ROOT", storageRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function probe(
    app: ReturnType<typeof createApp>["app"],
    cookie: string,
  ) {
    return csrfRequest(
      app,
      "/api/instance/storage/test",
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      },
      cookie,
    );
  }

  it("retains fixed diagnostic bytes, reports unverified cleanup and leaves metadata totals unchanged", async () => {
    const user = await makeUser("admin");
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const response = await probe(app, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "verified",
      cleanup: "not_attempted",
      diagnosticObjectMayRemain: true,
      durationMs: expect.any(Number),
    });
    const files = await readdir(storageRoot);
    expect(files).toHaveLength(1);
    const name = files[0];
    if (!name) throw new Error("Diagnostic fixture was not retained");
    expect(name).toMatch(/^taskdesk-storage-probe-[0-9a-f-]{36}$/u);
    expect(await readFile(join(storageRoot, name), "utf8")).toBe(
      "taskdesk-storage-probe-v1-check!",
    );
    expect(JSON.stringify(body)).not.toContain(name);
    const usage = await app.request("/api/instance/storage/usage", {
      headers: { cookie },
    });
    expect(usage.status).toBe(200);
    expect((await usage.json()).attachments).toEqual({
      ready: { count: 0, bytes: "0" },
      pending: { count: 0, bytes: "0" },
      deleted: { count: 0, bytes: "0" },
    });
    const throttled = await probe(app, cookie);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await readdir(storageRoot)).toEqual(files);
  });

  it("denies a signed-in non-admin without writing diagnostic bytes", async () => {
    const user = await makeUser(null);
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    expect((await probe(app, cookie)).status).toBe(403);
    expect(await readdir(storageRoot)).toEqual([]);
  });

  it("denies an unauthenticated probe without writing diagnostic bytes", async () => {
    const { app } = createApp();
    const response = await app.request("/api/instance/storage/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(await readdir(storageRoot)).toEqual([]);
  });
});
