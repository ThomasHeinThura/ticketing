import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { expect, it } from "vitest";
import db, {
  closeMigrationPool,
  getDatabasePool,
  schema,
} from "../../apps/api/src/database";
import { projectMembershipKeys } from "../../apps/api/src/identity/repository";
import { createApp } from "../../apps/api/src/index";
import { insertAdminProjectGrant } from "../../apps/api/src/project/members/roster.repository";
import { cleanAttachment } from "../../apps/api/src/scheduler/attachment-cleanup";
import { mockAuthenticatedSession } from "./helpers/auth";
import { ensureTestDatabaseMigrated } from "./helpers/database";
import { assertDisposableTestDatabaseUrl } from "./helpers/disposable-database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const bytes = Buffer.from("%PDF-1.7 D6 controlled attachment bytes\n");
type Manifest = {
  owner: string;
  database: string;
  userId: string;
  attachmentId: string;
  objectKey: string;
  sha256: string;
};

function safeFailure(error: unknown) {
  const item =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const names = [
    "Error",
    "AssertionError",
    "TypeError",
    "DatabaseError",
    "PostgresError",
  ];
  const errorClass =
    typeof item.name === "string" && names.includes(item.name)
      ? item.name
      : "Other";
  const cause =
    typeof item.cause === "object" && item.cause !== null
      ? (item.cause as Record<string, unknown>)
      : {};
  const code = typeof item.code === "string" ? item.code : cause.code;
  const sqlState =
    typeof code === "string" &&
    /^(?:[0-9]{2}|[A-Z][0-9]|XX)[0-9A-Z]{3}$/.test(code)
      ? code
      : undefined;
  const scalar = (v: unknown) =>
    typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))
      ? v
      : undefined;
  return {
    errorClass,
    sqlState,
    reason:
      typeof item.message === "string" &&
      item.message.startsWith(
        "Applied membership cutover has an incomplete grant projection:",
      )
        ? "membership_projection_incomplete"
        : undefined,
    expected: scalar(item.expected),
    received: scalar(item.actual),
  };
}

it("performs exactly one root-owned D6 fixture phase", async () => {
  let admitted = false;
  let failed = false;
  let diagnosticPath = "";
  let diagnosticPhase = "";
  let currentStage = "scope";
  let currentExpected: number | boolean | undefined;
  let currentReceived: number | boolean | undefined;
  const mark = async (
    stage: string,
    expected?: number | boolean,
    received?: number | boolean,
  ) => {
    currentStage = stage;
    currentExpected = expected;
    currentReceived = received;
    if (diagnosticPath)
      await writeFile(
        diagnosticPath,
        JSON.stringify({ phase: diagnosticPhase, stage, expected, received }),
        { mode: 0o600 },
      ).catch(() => {});
  };
  try {
    const phase = process.env.D6_PHASE;
    const owner = process.env.D6_OWNER ?? "";
    const manifestPath = process.env.D6_MANIFEST ?? "";
    const root = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT ?? "";
    const rawUrl = process.env.TASKDESK_DATABASE_URL ?? "";
    if (
      !/^[a-f0-9]{12}$/.test(owner) ||
      !["seed-initial", "seed-next", "delete-gc"].includes(phase ?? "") ||
      !path.isAbsolute(manifestPath) ||
      !path.isAbsolute(root)
    )
      throw new Error("invalid D6 scope");
    const url = new URL(rawUrl);
    const database = assertDisposableTestDatabaseUrl(rawUrl);
    if (
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      ["62870", "62871", "5432"].includes(url.port) ||
      database !== `taskdesk_d6_${owner}_test`
    )
      throw new Error("database is not the owned D6 target");
    const parent = await stat(path.dirname(manifestPath));
    if (
      !parent.isDirectory() ||
      (parent.mode & 0o077) !== 0 ||
      parent.uid !== process.getuid?.()
    )
      throw new Error("manifest directory must be private");
    const ownershipPath = path.join(
      path.dirname(manifestPath),
      "ownership.json",
    );
    const ownershipStat = await lstat(ownershipPath);
    if (
      !ownershipStat.isFile() ||
      (ownershipStat.mode & 0o077) !== 0 ||
      ownershipStat.uid !== process.getuid?.()
    )
      throw new Error("ownership manifest must be private");
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8")) as {
      owner: string;
      database: string;
      port: number;
      storageRoot: string;
    };
    if (
      ownership.owner !== owner ||
      ownership.database !== database ||
      String(ownership.port) !== url.port ||
      ownership.storageRoot !== root
    )
      throw new Error("ownership manifest mismatch");
    diagnosticPath = path.join(
      path.dirname(manifestPath),
      `${phase}.diagnostic.json`,
    );
    diagnosticPhase = phase ?? "";
    await mark("admitted");
    admitted = true;
    if (phase === "seed-initial") {
      await mark("empty-check");
      const existing = await getDatabasePool().query(
        "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')",
      );
      if (existing.rows[0]?.n !== 0)
        throw new Error("initial D6 database is not empty");
    }
    await mark("migration-start");
    await ensureTestDatabaseMigrated();
    await mark("migration-complete");
    if (phase !== "delete-gc") {
      const member = await createWorkspaceMember({ role: "member" });
      const project = (
        await createProjectFixture({ workspaceId: member.workspace.id })
      ).project;
      const person = requireRow(
        await db
          .select()
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, member.user.id)),
        "person",
      );
      const grantor = await createWorkspaceMember({ role: "admin" });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: member.workspace.id,
        userId: grantor.user.id,
        role: "admin",
        joinedAt: new Date(),
      });
      const grantorPerson = requireRow(
        await db
          .select()
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, grantor.user.id)),
        "grantor",
      );
      const role = requireRow(
        await db
          .insert(schema.roleTable)
          .values({
            scope: "project",
            workspaceId: project.workspaceId,
            key: `project-fixture-${randomUUID()}`,
            name: "Integration project role",
            rank: 1,
            capabilities: [
              "project:read",
              "work_item:read",
              "work_item:update",
              "attachment:delete_own",
              "attachment:delete_any",
            ],
          })
          .returning(),
        "project role",
      );
      await mark("grant-projection-start");
      await db.transaction(async (tx) => {
        await insertAdminProjectGrant(tx, {
          personId: person.id,
          projectId: project.id,
          roleId: role.id,
          grantedByPersonId: grantorPerson.id,
        });
        await projectMembershipKeys(tx, [
          { personId: person.id, scope: "project", scopeId: project.id },
        ]);
      });
      const projection = await db
        .select({ id: schema.membershipTable.id })
        .from(schema.membershipTable)
        .innerJoin(
          schema.membershipGrantTable,
          and(
            eq(
              schema.membershipGrantTable.membershipId,
              schema.membershipTable.id,
            ),
            eq(
              schema.membershipGrantTable.personId,
              schema.membershipTable.personId,
            ),
            eq(schema.membershipGrantTable.scope, schema.membershipTable.scope),
            eq(
              schema.membershipGrantTable.scopeId,
              schema.membershipTable.scopeId,
            ),
            eq(
              schema.membershipGrantTable.roleId,
              schema.membershipTable.roleId,
            ),
            eq(
              schema.membershipGrantTable.seesAll,
              schema.membershipTable.seesAll,
            ),
            isNull(schema.membershipGrantTable.revokedAt),
          ),
        )
        .where(
          and(
            eq(schema.membershipTable.personId, person.id),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, project.id),
          ),
        );
      await mark("grant-projection-result", 1, projection.length);
      expect(projection).toHaveLength(1);
      await db.insert(schema.sessionTable).values({
        id: `session-${member.user.id}`,
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const type = requireRow(
        await db
          .insert(schema.workItemTypeTable)
          .values({
            workspaceId: member.workspace.id,
            key: `d6-${randomUUID()}`,
            name: "Task",
            category: "delivery",
          })
          .returning(),
        "type",
      );
      const template = requireRow(
        await db
          .insert(schema.stateTemplateTable)
          .values({
            workspaceId: member.workspace.id,
            key: `d6-${randomUUID()}`,
            name: "To Do",
            group: "unstarted",
          })
          .returning(),
        "template",
      );
      const state = requireRow(
        await db
          .insert(schema.stateTable)
          .values({
            projectId: project.id,
            stateTemplateId: template.id,
            isDefault: true,
          })
          .returning(),
        "state",
      );
      const item = requireRow(
        await db
          .insert(schema.workItemTable)
          .values({
            projectId: project.id,
            workspaceId: member.workspace.id,
            typeId: type.id,
            number: 1,
            key: `${project.slug}-1`,
            title: "D6 fixture",
            stateId: state.id,
          })
          .returning(),
        "item",
      );
      const objectKey = `files/${randomUUID()}`;
      const attachment = requireRow(
        await db
          .insert(schema.attachmentTable)
          .values({
            workspaceId: item.workspaceId,
            workItemId: item.id,
            uploadedBy: person.id,
            objectKey,
            filename: "Evidence.pdf",
            mimeType: "application/pdf",
            size: bytes.length,
            state: "ready",
            customerVisible: false,
          })
          .returning(),
        "attachment",
      );
      await mkdir(path.dirname(path.join(root, objectKey)), {
        recursive: true,
      });
      await writeFile(path.join(root, objectKey), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      const record: Manifest = {
        owner,
        database,
        userId: member.user.id,
        attachmentId: attachment.id,
        objectKey,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
      await writeFile(manifestPath, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
    } else {
      await mark("manifest-read");
      const st = await lstat(manifestPath);
      if ((st.mode & 0o077) !== 0 || !st.isFile())
        throw new Error("manifest must be private");
      const record = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as Manifest;
      if (
        record.owner !== owner ||
        record.database !== database ||
        !/^files\/[a-f0-9-]+$/.test(record.objectKey)
      )
        throw new Error("manifest target mismatch");
      await mark("user-lookup");
      const user = requireRow(
        await db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.id, record.userId)),
        "user",
      );
      await mark("attachment-lookup");
      const row = requireRow(
        await db
          .select()
          .from(schema.attachmentTable)
          .where(eq(schema.attachmentTable.id, record.attachmentId)),
        "attachment",
      );
      await mark("attachment-verify");
      if (row.objectKey !== record.objectKey || row.state !== "ready")
        throw new Error("attachment mismatch");
      expect(
        createHash("sha256")
          .update(await readFile(path.join(root, record.objectKey)))
          .digest("hex"),
      ).toBe(record.sha256);
      await mark("session-mock");
      mockAuthenticatedSession(user);
      await mark("app-create");
      const { app } = createApp();
      await mark("delete-request");
      const response = await app.request(
        `/api/attachments/${record.attachmentId}`,
        { method: "DELETE" },
      );
      await mark("delete-response", 202, response.status);
      expect(response.status).toBe(202);
      const action = (await response.json()) as { pendingActionId: string };
      await mark("approval-request");
      const approval = await app.request(
        `/api/me/pending-actions/${action.pendingActionId}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      await mark("approval-response", 200, approval.status);
      expect(approval.status).toBe(200);
      await mark("deleted-row-lookup");
      const deleted = requireRow(
        await db
          .select()
          .from(schema.attachmentTable)
          .where(eq(schema.attachmentTable.id, record.attachmentId)),
        "deleted attachment",
      );
      expect(deleted.state).toBe("deleted");
      await mark("retention-check");
      const retained = await cleanAttachment(record.attachmentId, "deleted");
      await mark("retention-result", false, retained);
      expect(retained).toBe(false);
      expect(
        createHash("sha256")
          .update(await readFile(path.join(root, record.objectKey)))
          .digest("hex"),
      ).toBe(record.sha256);
      await mark("aging-start");
      await db
        .update(schema.attachmentTable)
        .set({ deletedAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(eq(schema.attachmentTable.id, record.attachmentId));
      await mark("gc-start");
      const collected = await cleanAttachment(record.attachmentId, "deleted");
      await mark("gc-result", true, collected);
      expect(collected).toBe(true);
      await expect(
        readFile(path.join(root, record.objectKey)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await mark("row-count");
      const remaining = await db
        .select()
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, record.attachmentId));
      await mark("row-count-result", 0, remaining.length);
      expect(remaining).toHaveLength(0);
    }
    await mark("phase-complete");
  } catch (error) {
    failed = true;
    const safe = safeFailure(error);
    if (diagnosticPath)
      await writeFile(
        diagnosticPath,
        JSON.stringify({
          phase: diagnosticPhase,
          stage: currentStage,
          ...safe,
          expected: safe.expected ?? currentExpected,
          received: safe.received ?? currentReceived,
        }),
        { mode: 0o600 },
      ).catch(() => {});
    throw error;
  } finally {
    if (!failed) await mark("pool-close");
    try {
      if (admitted) await getDatabasePool().end();
    } finally {
      await closeMigrationPool();
    }
    if (!failed) await mark("pool-closed");
  }
});
