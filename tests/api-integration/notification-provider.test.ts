import { createHash, randomUUID } from "node:crypto";
import net, { type Socket } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { decryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import * as providerRuntime from "../../apps/api/src/notification-provider/runtime";
import {
  getEmailProvider,
  updateEmailProvider,
} from "../../apps/api/src/notification-provider/service";

import {
  bootstrapSmtpConfiguration,
  openSmtpSocket,
  resolveSmtpConfiguration,
} from "../../packages/email/dist/smtp-runtime";

import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const config = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  requireTLS: true,
  username: "synthetic-user",
  fromAddress: "sender@example.test",
  replyTo: null,
};
const route = "/api/instance/notification-providers/email";
async function administrator() {
  const owner = await createWorkspaceMember({ role: "admin" });
  const user = requireRow(
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, owner.user.id))
      .returning(),
    "instance admin",
  );
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
    "person",
  );
  await db.insert(schema.sessionTable).values({
    id: `session-${user.id}`,
    token: `token-${user.id}`,
    userId: user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockAuthenticatedSession(user);
  const { app } = createApp();
  return {
    app,
    user,
    person,
    actor: { userId: user.id, personId: person.id },
    cookie: `__Host-tdk_agent_session=token-${user.id}`,
  };
}
async function patch(
  f: Awaited<ReturnType<typeof administrator>>,
  body: unknown,
) {
  return csrfRequest(
    f.app,
    route,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: f.cookie },
      body: JSON.stringify(body),
    },
    f.cookie,
  );
}
async function providerRow() {
  return requireRow(
    await db
      .select()
      .from(schema.instancePluginConfigTable)
      .where(eq(schema.instancePluginConfigTable.pluginId, "notify.email")),
    "provider",
  );
}

beforeEach(async () => {
  await resetTestDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("persisted SMTP provider backend", () => {
  it("stores row-bound ciphertext, returns fixed masks, preserves omitted password, and clears explicitly", async () => {
    const f = await administrator();
    const password = `synthetic-${randomUUID()}`;
    const created = await patch(f, {
      version: 0,
      enabled: true,
      config,
      password,
    });
    expect(created.status).toBe(200);
    const text = await created.text();
    expect(text).not.toContain(password);
    expect(JSON.parse(text)).toMatchObject({
      version: 1,
      source: "runtime",
      passwordConfigured: true,
      passwordPreview: "••••••••",
    });
    const row = await providerRow();
    expect(row.secrets).not.toBeNull();
    if (!row.secrets) throw new Error("Fixture ciphertext missing");
    const ciphertext = row.secrets;
    expect(row.secrets?.toString()).not.toContain(password);
    expect(decryptIdentityClientSecret(row.id, row.secrets)).toBe(password);
    expect(() =>
      decryptIdentityClientSecret(`wrong-${row.id}`, ciphertext),
    ).toThrow();
    expect(
      (
        await patch(f, {
          version: 1,
          enabled: true,
          config: { ...config, port: 465, secure: true },
        })
      ).status,
    ).toBe(200);
    expect((await providerRow()).secrets).toEqual(row.secrets);
    expect(
      (await patch(f, { version: 2, enabled: false, password: null })).status,
    ).toBe(200);
    expect(await getEmailProvider()).toMatchObject({
      version: 3,
      enabled: false,
      passwordConfigured: false,
      passwordPreview: null,
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.changed"));
    expect(audit).toHaveLength(3);
    expect(
      JSON.stringify(
        audit.map((row) => ({ before: row.before, after: row.after })),
      ),
    ).not.toContain(password);
  });
  it("CAS permits exactly one concurrent update and does not leak or overwrite the winning secret", async () => {
    const f = await administrator();
    await updateEmailProvider({ version: 0, enabled: false, config }, f.actor);
    const attempts = await Promise.allSettled([
      updateEmailProvider(
        { version: 1, enabled: true, password: "synthetic-choice-one" },
        f.actor,
      ),
      updateEmailProvider(
        { version: 1, enabled: true, password: "synthetic-choice-two" },
        f.actor,
      ),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await providerRow()).configVersion).toBe(2);
    const stale = await patch(f, { version: 1, enabled: false });
    expect(stale.status).toBe(409);
    expect((await providerRow()).enabled).toBe(true);
  });
  it("previous-key reads work, wrong-row swapping fails, explicit replacement encrypts using current key", async () => {
    const f = await administrator();
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "a".repeat(64));
    await updateEmailProvider(
      { version: 0, enabled: true, config, password: "synthetic-old-secret" },
      f.actor,
    );
    const first = await providerRow();
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "b".repeat(64));
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "a".repeat(64));
    expect(
      (await providerRuntime.resolveRuntimeSmtp())?.options.auth,
    ).toMatchObject({ pass: "synthetic-old-secret" });
    await updateEmailProvider(
      { version: 1, enabled: true, password: "synthetic-new-secret" },
      f.actor,
    );
    const second = await providerRow();
    expect(second.secrets).not.toEqual(first.secrets);
    if (!second.secrets) throw new Error("Fixture ciphertext missing");
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "");
    expect(decryptIdentityClientSecret(second.id, second.secrets)).toBe(
      "synthetic-new-secret",
    );
    await expect(providerRuntime.resolveRuntimeSmtp()).resolves.toBeDefined();
  });
  it("runtime disabled overrides bootstrap globally; read failures fail closed", async () => {
    const f = await administrator();
    vi.stubEnv("SMTP_HOST", "bootstrap.example.test");
    vi.stubEnv("SMTP_FROM", "sender@example.test");
    expect(bootstrapSmtpConfiguration()).not.toBeNull();
    expect((await getEmailProvider()).source).toBe("bootstrap");
    await updateEmailProvider({ version: 0, enabled: false }, f.actor);
    expect(await resolveSmtpConfiguration()).toBeNull();
    expect(await providerRuntime.resolveRuntimeSmtp()).toBeNull();
    // A wrong encryption key is a configuration-read failure, never a fallback to env.
    await updateEmailProvider(
      { version: 1, enabled: true, config, password: "synthetic-password" },
      f.actor,
    );
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "c".repeat(64));
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "");
    await expect(resolveSmtpConfiguration()).rejects.toThrow(
      "SMTP configuration unavailable",
    );
  });
  it.each(["runtime", "disabled", "read_failure"] as const)(
    "uses authoritative %s availability for public settings and MFA reset",
    async (state) => {
      const f = await administrator();
      vi.stubEnv(
        "SMTP_HOST",
        state === "runtime" ? "" : "bootstrap.example.test",
      );
      vi.stubEnv("SMTP_FROM", state === "runtime" ? "" : "sender@example.test");
      await updateEmailProvider(
        state === "disabled"
          ? { version: 0, enabled: false }
          : {
              version: 0,
              enabled: true,
              config,
              password: "synthetic-password",
            },
        f.actor,
      );
      if (state === "read_failure") {
        vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "d".repeat(64));
        vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "");
      }
      const response = await f.app.request("/api/config");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        hasSmtp: state === "runtime",
      });
      const reset = await csrfRequest(
        f.app,
        "/api/instance/users/missing-synthetic-user/reset-mfa",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: f.cookie,
            "x-taskdesk-step-up-token": "synthetic-step-up-token",
          },
          body: JSON.stringify({
            verificationNote: "Synthetic identity verification",
          }),
        },
        f.cookie,
      );
      // A missing target reaches the real target lookup only when SMTP is usable.
      expect(reset.status).toBe(state === "runtime" ? 404 : 503);
    },
  );
  it("rejects header injection, unknown insecure TLS switches, and non-admin access", async () => {
    const f = await administrator();
    for (const bad of [
      {
        ...config,
        fromAddress: "sender@example.test\r\nBcc: extra@example.test",
      },
      { ...config, tls: { rejectUnauthorized: false } },
      { ...config, host: "smtp.example.test/path" },
    ]) {
      expect(
        (
          await patch(f, {
            version: 0,
            enabled: true,
            config: bad,
            password: "synthetic",
          })
        ).status,
      ).toBe(400);
    }
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);
    expect((await f.app.request(route)).status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.instancePluginConfigTable)
        .where(eq(schema.instancePluginConfigTable.pluginId, "notify.email")),
    ).toHaveLength(0);
  });
  it("refuses API-key mutations and customer-host access", async () => {
    const f = await administrator();
    const rawKey = `taskdesk_test_${randomUUID()}`;
    await db.insert(schema.apikeyTable).values({
      referenceId: f.user.id,
      userId: f.user.id,
      key: createHash("sha256").update(rawKey).digest("base64url"),
      name: "Synthetic provider key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ instance: ["manage_plugins"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const [url, method] of [
      [route, "PATCH"],
      [`${route}/test`, "POST"],
    ] as const) {
      const response = await f.app.request(url, {
        method,
        headers: { "x-api-key": rawKey, "content-type": "application/json" },
        body: JSON.stringify({ version: 0, enabled: false }),
      });
      expect(response.status).toBe(403);
    }
    const portal = await f.app.request(`http://portal.localhost:1337${route}`, {
      headers: { host: "portal.localhost:1337", cookie: f.cookie },
    });
    expect(portal.status).toBeGreaterThanOrEqual(400);
  });
  it("blocks private runtime destinations and audits failed verification without saving unsaved inputs", async () => {
    const f = await administrator();
    const response = await csrfRequest(
      f.app,
      `${route}/test`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: f.cookie },
        body: JSON.stringify({
          version: 0,
          config: { ...config, host: "127.0.0.1", username: null },
        }),
      },
      f.cookie,
    );
    expect(response.status).toBe(502);
    expect(
      await db
        .select()
        .from(schema.instancePluginConfigTable)
        .where(eq(schema.instancePluginConfigTable.pluginId, "notify.email")),
    ).toHaveLength(0);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"));
    expect(audit).toHaveLength(1);
    expect(
      JSON.stringify(
        audit.map((row) => ({ before: row.before, after: row.after })),
      ),
    ).not.toContain("pass:");
  });
  it("verifies through an injected private SMTP receiver with no message and enforces persisted rate limits", async () => {
    const f = await administrator();
    const sockets = new Set<Socket>();
    let mailCommands = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.write("220 synthetic.test ESMTP\r\n");
      socket.on("data", (chunk) => {
        for (const line of chunk.toString().split("\r\n")) {
          if (/^EHLO|^HELO/u.test(line)) socket.write("250 synthetic.test\r\n");
          else if (line === "QUIT") socket.end("221 bye\r\n");
          else if (/^MAIL FROM/u.test(line)) {
            mailCommands++;
            socket.write("250 OK\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("receiver address missing");
    const original = providerRuntime.runtimeSmtpConfiguration;
    vi.spyOn(providerRuntime, "runtimeSmtpConfiguration").mockImplementation(
      (settings, password) => ({
        ...original(settings, password),
        connect: (signal) =>
          openSmtpSocket(
            { host: "127.0.0.1", port: address.port, secure: false },
            signal,
          ),
      }),
    );
    try {
      for (let index = 0; index < 5; index++) {
        const response = await csrfRequest(
          f.app,
          `${route}/test`,
          {
            method: "POST",
            headers: { "content-type": "application/json", cookie: f.cookie },
            body: JSON.stringify({
              version: 0,
              config: { ...config, requireTLS: false, username: null },
            }),
          },
          f.cookie,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ verified: true });
      }
      const limited = await csrfRequest(
        f.app,
        `${route}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: f.cookie },
          body: JSON.stringify({
            version: 0,
            config: { ...config, requireTLS: false, username: null },
          }),
        },
        f.cookie,
      );
      expect(limited.status).toBe(429);
      expect(mailCommands).toBe(0);
      expect(
        await db
          .select()
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "plugin.tested")),
      ).toHaveLength(5);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("fails verification unavailable before networking when its audit reservation cannot persist", async () => {
    const f = await administrator();
    const factory = vi.spyOn(providerRuntime, "runtimeSmtpConfiguration");
    await db.execute(
      sql`CREATE FUNCTION smtp_test_audit_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='plugin.tested' THEN RAISE EXCEPTION 'synthetic test audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER smtp_test_audit_probe BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION smtp_test_audit_probe()`,
    );
    try {
      const response = await csrfRequest(
        f.app,
        `${route}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: f.cookie },
          body: JSON.stringify({
            version: 0,
            config: { ...config, username: null },
          }),
        },
        f.cookie,
      );
      expect(response.status).toBe(503);
      expect(factory).not.toHaveBeenCalled();
      expect(
        await db
          .select()
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.type, "audit_write_failed")),
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER smtp_test_audit_probe ON audit_log`);
      await db.execute(sql`DROP FUNCTION smtp_test_audit_probe()`);
    }
  });
  it("preserves mutation on audit failure with a durable administrator alert", async () => {
    const f = await administrator();
    await db.execute(
      sql`CREATE FUNCTION smtp_audit_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='plugin.changed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER smtp_audit_probe BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION smtp_audit_probe()`,
    );
    try {
      await expect(
        updateEmailProvider({ version: 0, enabled: false }, f.actor),
      ).resolves.toMatchObject({ version: 1, enabled: false });
      expect(
        await db
          .select()
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.type, "audit_write_failed")),
      ).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER smtp_audit_probe ON audit_log`);
      await db.execute(sql`DROP FUNCTION smtp_audit_probe()`);
    }
  });
});
