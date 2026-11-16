import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importSourceConnectionTable } from "../../../apps/api/src/database/schema-imports";
import {
  registerImportAdapter,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  clearFakeFixtures,
  createFakeAdapter,
} from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import * as auditFailureNotifier from "../../../apps/api/src/instance/observability/audit-failure-notifier";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  call,
  engineFixture,
  post,
  registerFake,
  req,
  setFakeFixture,
} from "./engine-helpers";

async function dropSourceAuditFailureTrigger() {
  await db.execute(
    sql`DROP TRIGGER IF EXISTS import_source_fail_audit ON audit_log; DROP FUNCTION IF EXISTS import_source_fail_audit();`,
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase();
  await dropSourceAuditFailureTrigger();
});

afterEach(async () => {
  vi.restoreAllMocks();
  unregisterImportAdapter("import.mcp");
  clearFakeFixtures();
  await dropSourceAuditFailureTrigger();
});

const csvOf = (targetBytes: number) => {
  const rows = ["external_id,title,description"];
  let size = rows[0]?.length ?? 0;
  for (let i = 1; size < targetBytes; i += 1) {
    const row = `${i},"Title with ""quotes"" ${i}","line one\nline two, ""q"" ${"p".repeat(70)}"`;
    rows.push(row);
    size += row.length + 1;
  }
  return rows.join("\n");
};

describe("import source connections", () => {
  it("accepts a CSV near the documented 5 MiB inline size, with quotes and newlines, and never echoes it back", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const csvText = csvOf(5 * 1024 * 1024 - 4096);
    expect(Buffer.byteLength(csvText)).toBeLessThanOrEqual(5 * 1024 * 1024);
    const body = JSON.stringify({
      workspaceId: f.workspace.id,
      pluginId: "import.csv",
      name: "big.csv",
      config: { csvText },
    });
    // JSON escaping inflates the body well past the file size; it must still be accepted.
    expect(Buffer.byteLength(body)).toBeGreaterThan(Buffer.byteLength(csvText));
    const created = await req(app, f.key, "/api/import-sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body,
    });
    expect(created.status, (await created.clone().text()).slice(0, 200)).toBe(
      200,
    );
    const source = await created.json();
    expect(source.config.csvText).toBeUndefined();
    expect(source.inline.csvText.bytes).toBe(Buffer.byteLength(csvText));
    const listed = await call(
      app,
      f.key,
      `/api/import-sources?workspaceId=${f.workspace.id}`,
      undefined,
      200,
    );
    expect(JSON.stringify(listed)).not.toContain("Title with");
    expect(listed.sources[0].inline.csvText.bytes).toBe(
      Buffer.byteLength(csvText),
    );
  });

  it("refuses an oversize body with 413 on this route only", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(app, f.key, "/api/import-sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        workspaceId: f.workspace.id,
        pluginId: "import.csv",
        name: "huge.csv",
        config: { csvText: "a".repeat(21 * 1024 * 1024) },
      }),
    });
    expect(response.status).toBe(413);
  });

  it("reports a fixed reason code when the source cannot be connected", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const create = (pluginId: string, name: string, config: unknown) =>
      req(
        app,
        f.key,
        "/api/import-sources",
        post({ workspaceId: f.workspace.id, pluginId, name, config }),
      );
    const tooLarge = await create("import.csv", "large", {
      csvText: `external_id,title\n${"x".repeat(5 * 1024 * 1024 + 10)}`,
    });
    expect(tooLarge.status).toBe(502);
    expect(await tooLarge.json()).toMatchObject({ reason: "file_too_large" });
    const noTitle = await create("import.csv", "notitle", {
      csvText: "external_id,state\n1,Open",
    });
    expect(await noTitle.json()).toMatchObject({
      reason: "missing_required_column",
    });
    const badExport = await create("import.jira", "badexport", {
      mode: "export",
      exportText: "{not json",
    });
    expect(await badExport.json()).toMatchObject({ reason: "invalid_export" });
    const goodExport = await create("import.jira", "goodexport", {
      mode: "export",
      exportText: JSON.stringify({ issues: [] }),
    });
    expect(goodExport.status).toBe(200);
  });

  it("records source creation audit metadata without leaking credentials or config URLs (#916)", async () => {
    registerFake(2);
    setFakeFixture("audited-source", { records: [] });
    const f = await engineFixture();
    const { app } = createApp();
    const res = await req(app, f.key, "/api/import-sources", {
      ...post({
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        name: "Acme Jira",
        config: {
          fixture: "audited-source",
          baseUrl: "https://acme.atlassian.net",
        },
        credential: "super-secret-jira-token",
      }),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "audit-source-916",
        "user-agent": "taskdesk-engine-test",
        "x-request-id": "trace-import-source-916",
      },
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      id: string;
      hasCredential: boolean;
    };
    expect(created.hasCredential).toBe(true);

    const [stored] = await db
      .select()
      .from(importSourceConnectionTable)
      .where(eq(importSourceConnectionTable.id, created.id));
    expect(stored?.credentialCiphertext).toBeTruthy();

    const auditRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityType, "import_source_connection"),
          eq(schema.auditLogTable.entityId, created.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: "plugin.changed",
      actorId: f.user.id,
      actorType: "api_key",
      apiKeyId: f.keyId,
      impersonatorId: null,
      userAgent: "taskdesk-engine-test",
      traceId: "trace-import-source-916",
      workspaceId: f.workspace.id,
      entityType: "import_source_connection",
      entityId: created.id,
      before: null,
      after: {
        operation: "source_created",
        section: "imports",
        sourceId: created.id,
        pluginId: "import.mcp",
        name: "Acme Jira",
        changedKeys: [
          "pluginId",
          "name",
          "config.baseUrl",
          "config.fixture",
          "credential",
        ],
        origin: "mcp",
      },
    });
    const serialised = JSON.stringify(auditRows[0], (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialised).not.toContain("super-secret-jira-token");
    expect(serialised).not.toContain("https://acme.atlassian.net");
    expect(serialised).not.toContain(stored?.credentialCiphertext ?? "none");
  });

  it("authorizes instance admin and workspace read before calling adapter.connect", async () => {
    const adapter = createFakeAdapter("import.mcp", 2);
    const connectSpy = vi.spyOn(adapter, "connect");
    registerImportAdapter("import.mcp", () => adapter);
    const f = await engineFixture();
    const { workspace: foreignWorkspace } = await createWorkspaceMember({
      role: "owner",
    });
    const { user: nonAdmin, workspace: ownedWorkspace } =
      await createWorkspaceMember({ role: "owner" });
    const nonAdminKey = await createPersonalApiKey(
      { userId: nonAdmin.id },
      { name: "non admin key", capabilities: ["instance:admin"], isMcp: true },
    );
    const { app } = createApp();

    // Non-admin is rejected (403) at the instance-admin guard before adapter.connect.
    const nonAdminRes = await req(
      app,
      nonAdminKey.key,
      "/api/import-sources",
      post({
        workspaceId: ownedWorkspace.id,
        pluginId: "import.mcp",
        name: "Unauthorized Source",
        config: { fixture: "never-called" },
      }),
    );
    expect(nonAdminRes.status).toBe(403);
    expect(connectSpy).not.toHaveBeenCalled();

    // Instance admin without workspace read access is rejected (403) inside createSourceConnection
    // before adapter.connect runs any external connection probe.
    const foreignRes = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: foreignWorkspace.id,
        pluginId: "import.mcp",
        name: "Cross-workspace Source",
        config: { fixture: "never-called" },
      }),
    );
    expect(foreignRes.status).toBe(403);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("keeps source creation committed and alerts instance admins when audit append fails (#916)", async () => {
    registerFake(2);
    setFakeFixture("audit-fail-source", { records: [] });
    const f = await engineFixture();
    const { app } = createApp();
    const notifySpy = vi
      .spyOn(auditFailureNotifier, "notifyCurrentInstanceAdminsOfAuditFailure")
      .mockResolvedValue(undefined);
    await db.execute(
      sql.raw(`
        CREATE FUNCTION import_source_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.entity_type = 'import_source_connection' THEN
            RAISE EXCEPTION 'simulated import source audit failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER import_source_fail_audit BEFORE INSERT ON audit_log
          FOR EACH ROW EXECUTE FUNCTION import_source_fail_audit();
      `),
    );

    const created = await call(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        name: "Resilient Source",
        config: { fixture: "audit-fail-source" },
        credential: "secret-during-audit-failure",
      }),
      200,
    );
    expect(created.hasCredential).toBe(true);
    expect(notifySpy).toHaveBeenCalledWith("mutation");
    const rows = await db
      .select()
      .from(importSourceConnectionTable)
      .where(eq(importSourceConnectionTable.id, created.id));
    expect(rows).toHaveLength(1);
  });
});
