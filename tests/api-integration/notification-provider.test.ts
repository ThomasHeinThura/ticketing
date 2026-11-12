import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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
import * as emailRuntime from "../../packages/email/dist/smtp-runtime";

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
const recipient = "admin@example.test";
const bcrypt = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("bcryptjs") as { hash(value: string, rounds: number): Promise<string> };
const PASSWORD = "synthetic-email-provider-proof-password";
/** Service-level tests exercise the write itself; the HTTP tests below prove the proof. */
const noProof = async () => undefined;
const saveProvider = (
  input: Parameters<typeof updateEmailProvider>[0],
  actor: Parameters<typeof updateEmailProvider>[1],
) => updateEmailProvider(input, actor, noProof);
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
  await db.insert(schema.accountTable).values({
    id: `account-${user.id}`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(PASSWORD, 4),
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
type Administrator = Awaited<ReturnType<typeof administrator>>;
function serializeAuditRows(rows: unknown) {
  return JSON.stringify(rows, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}
/** One single-use proof bound to exactly this body; undefined when the body cannot be bound. */
async function proofFor(f: Administrator, body: unknown) {
  const binding = {
    kind: "operation",
    operation: "notification_provider_save",
    request: body,
  };
  const challenge = await csrfRequest(
    f.app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: f.cookie },
      body: JSON.stringify(binding),
    },
    f.cookie,
  );
  if (challenge.status !== 200) return undefined;
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const response = await csrfRequest(
    f.app,
    "/api/me/step-up",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: f.cookie },
      body: JSON.stringify({
        ...binding,
        challengeId: issued.challengeId,
        nonce: issued.nonce,
        method: "password",
        password: PASSWORD,
      }),
    },
    f.cookie,
  );
  if (response.status !== 200) return undefined;
  return ((await response.json()) as { token: string }).token;
}
/** Saves with a fresh proof for the body, unless a token (or none) is passed explicitly. */
async function patch(
  f: Administrator,
  body: unknown,
  token: string | null | undefined = undefined,
) {
  const proof = token === undefined ? await proofFor(f, body) : token;
  return csrfRequest(
    f.app,
    route,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: f.cookie,
        ...(proof ? { "x-taskdesk-step-up-token": proof } : {}),
      },
      body: JSON.stringify(body),
    },
    f.cookie,
  );
}
function testRequest(f: Administrator, body: Record<string, unknown>) {
  return csrfRequest(
    f.app,
    `${route}/test`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: f.cookie },
      body: JSON.stringify({ recipient, ...body }),
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

type SmtpConnector = NonNullable<
  ReturnType<typeof providerRuntime.runtimeSmtpConfiguration>["connect"]
>;

async function startPrivateSmtpEndpoint(
  onConnection: (socket: Socket) => void,
) {
  const sockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("SMTP diagnostic fixture address missing");
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** A plain-text SMTP receiver that accepts and records every message it is given. */
async function startMailReceiver() {
  const messages: { recipients: string[]; data: string }[] = [];
  const endpoint = await startPrivateSmtpEndpoint((socket) => {
    let buffer = "";
    let recipients: string[] = [];
    let data: string | null = null;
    socket.write("220 receiver.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== null) {
          if (line === ".") {
            messages.push({ recipients, data });
            data = null;
            recipients = [];
            socket.write("250 queued\r\n");
          } else data += `${line}\r\n`;
        } else if (/^EHLO|^HELO/u.test(line))
          socket.write("250-receiver.test\r\n250 8BITMIME\r\n");
        else if (/^MAIL FROM/u.test(line)) socket.write("250 OK\r\n");
        else if (/^RCPT TO/u.test(line)) {
          recipients.push(/<([^>]*)>/u.exec(line)?.[1] ?? "");
          socket.write("250 OK\r\n");
        } else if (line === "DATA") {
          data = "";
          socket.write("354 go ahead\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else if (line === "RSET") socket.write("250 OK\r\n");
        end = buffer.indexOf("\r\n");
      }
    });
  });
  return { port: endpoint.port, messages, close: endpoint.close };
}

function useInjectedConnector(connect: SmtpConnector) {
  const original = providerRuntime.runtimeSmtpConfiguration;
  vi.spyOn(providerRuntime, "runtimeSmtpConfiguration").mockImplementation(
    (settings, password) => ({ ...original(settings, password), connect }),
  );
}

async function verifyWithInjectedConnector(
  f: Administrator,
  configInput: Omit<typeof config, "username"> & { username: string | null },
  password: string | undefined,
  connect: SmtpConnector,
) {
  useInjectedConnector(connect);
  return testRequest(f, {
    version: 0,
    config: configInput,
    ...(password === undefined ? {} : { password }),
  });
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
    await saveProvider({ version: 0, enabled: false, config }, f.actor);
    const attempts = await Promise.allSettled([
      saveProvider(
        { version: 1, enabled: true, password: "synthetic-choice-one" },
        f.actor,
      ),
      saveProvider(
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
    await saveProvider(
      { version: 0, enabled: true, config, password: "synthetic-old-secret" },
      f.actor,
    );
    const first = await providerRow();
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY", "b".repeat(64));
    vi.stubEnv("TASKDESK_ENCRYPTION_KEY_PREVIOUS", "a".repeat(64));
    expect(
      (await providerRuntime.resolveRuntimeSmtp())?.options.auth,
    ).toMatchObject({ pass: "synthetic-old-secret" });
    await saveProvider(
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
    await saveProvider({ version: 0, enabled: false }, f.actor);
    expect(await resolveSmtpConfiguration()).toBeNull();
    expect(await providerRuntime.resolveRuntimeSmtp()).toBeNull();
    // A wrong encryption key is a configuration-read failure, never a fallback to env.
    await saveProvider(
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
      await saveProvider(
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
  it("refuses API keys and customer-host access", async () => {
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
    expect(
      (await f.app.request(route, { headers: { "x-api-key": rawKey } })).status,
    ).toBe(403);
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
  it("blocks private runtime destinations, reports a failed result and audits the attempt without saving unsaved inputs", async () => {
    const f = await administrator();
    const response = await testRequest(f, {
      version: 0,
      config: { ...config, host: "127.0.0.1", username: null },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      category: "failed",
      smtpCode: null,
      providerText: null,
      persisted: false,
    });
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
    const serialised = JSON.stringify(
      audit.map((row) => ({ before: row.before, after: row.after })),
    );
    expect(serialised).not.toContain("pass:");
    expect(serialised).not.toContain(recipient);
    expect(audit[0]?.after).toMatchObject({ recipientDomain: "example.test" });
  });
  it("reports a real SMTP 535 without returning authenticated provider text", async () => {
    const f = await administrator();
    const password = `synthetic-secret-${randomUUID()}`;
    const providerReply = `535 5.7.8 invalid credentials for ${config.username} ${password} sent to ops@example.test via mail.provider.example`;
    const endpoint = await startPrivateSmtpEndpoint((socket) => {
      socket.write("220 synthetic.test ESMTP\r\n");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        let end = buffer.indexOf("\r\n");
        while (end >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (/^EHLO|^HELO/u.test(line))
            socket.write("250-synthetic.test\r\n250 AUTH PLAIN LOGIN\r\n");
          else if (/^AUTH /u.test(line)) socket.write(`${providerReply}\r\n`);
          else if (line === "QUIT") socket.end("221 bye\r\n");
          end = buffer.indexOf("\r\n");
        }
      });
    });
    try {
      const response = await verifyWithInjectedConnector(
        f,
        { ...config, requireTLS: false },
        password,
        (signal) =>
          openSmtpSocket(
            { host: "127.0.0.1", port: endpoint.port, secure: false },
            signal,
          ),
      );
      const text = await response.text();
      expect(response.status).toBe(200);
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(body).toMatchObject({
        ok: false,
        category: "authentication",
        smtpCode: 535,
        providerText: null,
        persisted: false,
      });
      for (const leaked of [
        password,
        config.username,
        Buffer.from(`\0${config.username}\0${password}`).toString("base64"),
        "AUTH PLAIN",
        "ops@example.test",
        "mail.provider.example",
        "synthetic.test",
      ])
        expect(text).not.toContain(leaked);
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "plugin.tested"));
      expect(audit).toHaveLength(1);
      const recorded = serializeAuditRows(audit);
      for (const leaked of [
        password,
        config.username,
        Buffer.from(`\0${config.username}\0${password}`).toString("base64"),
        "AUTH PLAIN",
      ])
        expect(recorded).not.toContain(leaked);
      expect(
        await db
          .select()
          .from(schema.instancePluginConfigTable)
          .where(eq(schema.instancePluginConfigTable.pluginId, "notify.email")),
      ).toHaveLength(0);
    } finally {
      await endpoint.close();
    }
  });
  it("binds saved credentials to the saved SMTP destination and accepts a freshly typed password", async () => {
    const f = await administrator();
    const saved = { ...config, requireTLS: false };
    const savedPassword = "synthetic-stored-password";
    await saveProvider(
      { version: 0, enabled: true, config: saved, password: savedPassword },
      f.actor,
    );
    const execute = vi
      .spyOn(emailRuntime, "executeSmtp")
      .mockResolvedValue(undefined);
    const factory = vi.spyOn(providerRuntime, "runtimeSmtpConfiguration");
    const ses = {
      ...saved,
      provider: "ses",
      region: "eu-west-1",
      host: "email-smtp.eu-west-1.amazonaws.com",
      requireTLS: true,
    };
    for (const changed of [
      { ...saved, host: "other.example.test" },
      { ...saved, port: 2525 },
      { ...saved, secure: true },
      { ...saved, requireTLS: true },
      { ...saved, username: "other-user" },
      ses,
    ]) {
      const response = await testRequest(f, { version: 1, config: changed });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain(
        "smtp_test_password_required_for_changed_destination",
      );
      expect(body).not.toContain(savedPassword);
    }
    const cleared = await testRequest(f, {
      version: 1,
      config: { ...saved, host: "other.example.test", username: null },
      password: null,
    });
    expect(cleared.status).toBe(400);
    expect(await cleared.text()).toContain(
      "smtp_test_password_required_for_changed_destination",
    );
    expect(factory).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "plugin.tested")),
    ).toHaveLength(0);

    const same = await testRequest(f, { version: 1, config: saved });
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ ok: true, persisted: true });
    expect(execute.mock.calls[0]?.[0].options.auth).toMatchObject({
      user: saved.username,
      pass: savedPassword,
    });

    const replacement = "synthetic-new-password";
    const changed = await testRequest(f, {
      version: 1,
      config: { ...saved, host: "other.example.test" },
      password: replacement,
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ ok: true, persisted: false });
    expect(execute.mock.calls[1]?.[0].options.auth).toMatchObject({
      user: saved.username,
      pass: replacement,
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "plugin.tested"));
    expect(audit).toHaveLength(2);
    const recorded = serializeAuditRows(audit);
    expect(recorded).not.toContain(savedPassword);
    expect(recorded).not.toContain(replacement);
  });
  it("refuses to reuse an SES password for another region", async () => {
    const f = await administrator();
    const ses = {
      ...config,
      provider: "ses" as const,
      region: "eu-west-1" as const,
      host: "email-smtp.eu-west-1.amazonaws.com",
    };
    await saveProvider(
      {
        version: 0,
        enabled: true,
        config: ses,
        password: "synthetic-ses-secret",
      },
      f.actor,
    );
    const execute = vi
      .spyOn(emailRuntime, "executeSmtp")
      .mockResolvedValue(undefined);
    const factory = vi.spyOn(providerRuntime, "runtimeSmtpConfiguration");
    const response = await testRequest(f, {
      version: 1,
      config: {
        ...ses,
        region: "us-east-1",
        host: "email-smtp.us-east-1.amazonaws.com",
      },
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "smtp_test_password_required_for_changed_destination",
    );
    expect(factory).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "plugin.tested")),
    ).toHaveLength(0);
  });
  it("reports a real connection refusal as a connection failure", async () => {
    const f = await administrator();
    const reserved = net.createServer();
    await new Promise<void>((resolve) =>
      reserved.listen(0, "127.0.0.1", resolve),
    );
    const address = reserved.address();
    if (!address || typeof address === "string")
      throw new Error("SMTP refusal fixture address missing");
    await new Promise<void>((resolve) => reserved.close(() => resolve()));

    const response = await verifyWithInjectedConnector(
      f,
      { ...config, requireTLS: false, username: null },
      undefined,
      (signal) =>
        openSmtpSocket(
          { host: "127.0.0.1", port: address.port, secure: false },
          signal,
        ),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      category: "connection",
      smtpCode: null,
    });
    expect(text).not.toContain("ECONNREFUSED");
  });
  it("reports a real TLS handshake failure with its bounded category", async () => {
    const f = await administrator();
    const endpoint = await startPrivateSmtpEndpoint((socket) => {
      socket.write("220 plaintext is not TLS\r\n");
    });
    try {
      const response = await verifyWithInjectedConnector(
        f,
        { ...config, secure: true, requireTLS: false, username: null },
        undefined,
        (signal) =>
          openSmtpSocket(
            {
              host: "127.0.0.1",
              port: endpoint.port,
              secure: true,
              servername: "smtp.example.test",
            },
            signal,
          ),
      );
      const text = await response.text();
      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({ ok: false, category: "tls" });
      expect(text).not.toContain("plaintext is not TLS");
      expect(text).not.toContain("ERR_SSL_");
    } finally {
      await endpoint.close();
    }
  });
  it("maps unknown connector errors to the generic failure without provider text", async () => {
    const f = await administrator();
    const providerReply = "raw provider response synthetic-secret";
    const response = await verifyWithInjectedConnector(
      f,
      { ...config, requireTLS: false, username: null },
      undefined,
      async () => {
        throw new Error(providerReply);
      },
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      category: "failed",
      providerText: null,
    });
    expect(text).not.toContain(providerReply);
  });
  it("maps the SMTP attempt deadline to the bounded timeout category", async () => {
    const f = await administrator();
    vi.spyOn(emailRuntime, "executeSmtp").mockRejectedValue(
      new emailRuntime.SmtpAttemptError("deadline"),
    );
    const response = await verifyWithInjectedConnector(
      f,
      { ...config, requireTLS: false, username: null },
      undefined,
      async () => {
        throw new Error("unused connector");
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      category: "timeout",
    });
  });
  it("sends a real message to the typed recipient through a private receiver and enforces persisted rate limits", async () => {
    const f = await administrator();
    const receiver = await startMailReceiver();
    useInjectedConnector((signal) =>
      openSmtpSocket(
        { host: "127.0.0.1", port: receiver.port, secure: false },
        signal,
      ),
    );
    try {
      for (let index = 0; index < 5; index++) {
        const response = await testRequest(f, {
          version: 0,
          config: { ...config, requireTLS: false, username: null },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          recipientDomain: "example.test",
          persisted: false,
        });
      }
      const limited = await testRequest(f, {
        version: 0,
        config: { ...config, requireTLS: false, username: null },
      });
      expect(limited.status).toBe(429);
      // Five real messages were delivered; the refused sixth never reached the receiver.
      expect(receiver.messages).toHaveLength(5);
      expect(receiver.messages[0]).toMatchObject({
        recipients: [recipient],
      });
      expect(receiver.messages[0]?.data).toContain(
        "Subject: TaskDesk test email",
      );
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "plugin.tested"));
      expect(audit).toHaveLength(5);
      expect(JSON.stringify(audit.map((row) => row.after))).not.toContain(
        recipient,
      );
    } finally {
      await receiver.close();
    }
  });
  it("stores the test result against the saved settings, shows it, and resets it when the settings change", async () => {
    const f = await administrator();
    const receiver = await startMailReceiver();
    useInjectedConnector((signal) =>
      openSmtpSocket(
        { host: "127.0.0.1", port: receiver.port, secure: false },
        signal,
      ),
    );
    const plain = { ...config, requireTLS: false, username: null };
    try {
      expect(
        (await patch(f, { version: 0, enabled: true, config: plain })).status,
      ).toBe(200);
      expect((await getEmailProvider()).testStatus.state).toBe("stale");

      // Unsaved values that differ from the saved ones are shown, never stored.
      const unsaved = await testRequest(f, {
        version: 1,
        config: { ...plain, fromAddress: "other@example.test" },
      });
      expect(await unsaved.json()).toMatchObject({
        ok: true,
        persisted: false,
      });
      expect((await getEmailProvider()).testStatus.state).toBe("stale");

      const saved = await testRequest(f, { version: 1 });
      expect(await saved.json()).toMatchObject({ ok: true, persisted: true });
      const status = (await getEmailProvider()).testStatus;
      expect(status).toMatchObject({ state: "verified", smtpCode: null });
      expect(status.testedAt).not.toBeNull();
      // Recording a result neither bumps the version nor disturbs the open form.
      expect(await getEmailProvider()).toMatchObject({ version: 1 });
      expect(
        await (
          await f.app.request(route, { headers: { cookie: f.cookie } })
        ).json(),
      ).toMatchObject({ testStatus: { state: "verified" } });

      // Delivery on/off and changing the settings each reset the result.
      expect((await patch(f, { version: 1, enabled: false })).status).toBe(200);
      expect((await getEmailProvider()).testStatus.state).toBe("stale");
      expect(
        (
          await patch(f, {
            version: 2,
            enabled: true,
            config: { ...plain, fromAddress: "other@example.test" },
          })
        ).status,
      ).toBe(200);
      expect((await getEmailProvider()).testStatus).toEqual({
        state: "stale",
        testedAt: null,
        smtpCode: null,
        category: null,
      });
      // The stored status never reaches the transport: mail still resolves.
      expect((await providerRuntime.resolveRuntimeSmtp())?.from).toBe(
        "other@example.test",
      );
    } finally {
      await receiver.close();
    }
  });
  it("saves Amazon SES settings only when the connection is the region's, and never takes them from the client", async () => {
    const f = await administrator();
    const ses = {
      provider: "ses",
      region: "eu-west-1",
      host: "email-smtp.eu-west-1.amazonaws.com",
      port: 587,
      secure: false,
      requireTLS: true,
      username: "synthetic-ses-user",
      fromAddress: "sender@example.test",
      replyTo: null,
    };
    for (const bad of [
      { ...ses, host: "smtp.example.test" },
      { ...ses, port: 465 },
      { ...ses, secure: true },
      { ...ses, requireTLS: false },
      { ...ses, region: null },
      { ...ses, region: "af-south-1" },
    ])
      expect(
        (
          await patch(f, {
            version: 0,
            enabled: true,
            config: bad,
            password: "synthetic-ses-secret",
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await patch(f, {
          version: 0,
          enabled: true,
          config: ses,
          password: "synthetic-ses-secret",
        })
      ).status,
    ).toBe(200);
    expect(await getEmailProvider()).toMatchObject({
      version: 1,
      config: { provider: "ses", region: "eu-west-1" },
    });
    expect((await providerRuntime.resolveRuntimeSmtp())?.options).toMatchObject(
      {
        host: "email-smtp.eu-west-1.amazonaws.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "synthetic-ses-user", pass: "synthetic-ses-secret" },
      },
    );
  });
  it("requires the administrator's second factor to save, bound to exactly that write, and spends it once", async () => {
    const f = await administrator();
    const body = {
      version: 0,
      enabled: true,
      config,
      password: "synthetic-first-secret",
    };
    // No proof, a made-up proof, and a proof minted for a different write are all refused.
    expect((await patch(f, body, null)).status).toBe(403);
    expect((await patch(f, body, "x".repeat(43))).status).toBe(403);
    const other = await proofFor(f, {
      ...body,
      password: "synthetic-other-secret",
    });
    expect(other).toBeDefined();
    expect((await patch(f, body, other)).status).toBe(403);
    const proofRow = async (proof: string | undefined) => {
      if (!proof) throw new Error("Fixture proof missing");
      return requireRow(
        await db
          .select()
          .from(schema.stepUpConfirmationTable)
          .where(
            eq(
              schema.stepUpConfirmationTable.tokenHash,
              createHash("sha256")
                .update(Buffer.from(proof, "base64url"))
                .digest(),
            ),
          ),
        "notification provider proof",
      );
    };
    expect((await proofRow(other)).state).toBe("issued");
    const hostSwap = await proofFor(f, {
      ...body,
      config: { ...config, host: "evil.example.test" },
    });
    expect((await patch(f, body, hostSwap)).status).toBe(403);
    expect((await proofRow(hostSwap)).state).toBe("issued");
    expect(
      await db
        .select()
        .from(schema.instancePluginConfigTable)
        .where(eq(schema.instancePluginConfigTable.pluginId, "notify.email")),
    ).toHaveLength(0);

    const token = await proofFor(f, body);
    expect(token).toBeDefined();
    expect((await patch(f, body, token)).status).toBe(200);
    // New challenges invalidate prior proofs for this operation by marking them consumed.
    // Check this exact token and the spend audit to distinguish execution from invalidation.
    expect((await proofRow(token)).state).toBe("consumed");
    const spends = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_consumed"));
    expect(spends).toHaveLength(1);
    expect((await providerRow()).configVersion).toBe(1);
    expect((await patch(f, { ...body, version: 1 }, token)).status).toBe(403);
    expect((await providerRow()).configVersion).toBe(1);
    const audit = serializeAuditRows(
      await db.select().from(schema.auditLogTable),
    );
    for (const secret of [PASSWORD, body.password, config.username])
      expect(audit).not.toContain(secret);
  });
  it("keeps the proof unspent when the save is refused for a stale version", async () => {
    const f = await administrator();
    expect((await patch(f, { version: 0, enabled: false })).status).toBe(200);
    const token = await proofFor(f, { version: 0, enabled: true });
    expect((await patch(f, { version: 0, enabled: true }, token)).status).toBe(
      409,
    );
    // Only the first (successful) save spent a proof; the refused one left its proof issued.
    const proofs = await db.select().from(schema.stepUpConfirmationTable);
    expect(proofs.filter((row) => row.state === "consumed")).toHaveLength(1);
    expect(proofs.some((row) => row.state === "issued")).toBe(true);
  });
  it("does not need a second factor to send a test message", async () => {
    const f = await administrator();
    const response = await testRequest(f, {
      version: 0,
      config: { ...config, host: "127.0.0.1", username: null },
    });
    expect(response.status).toBe(200);
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
      const response = await testRequest(f, {
        version: 0,
        config: { ...config, username: null },
      });
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
        saveProvider({ version: 0, enabled: false }, f.actor),
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
