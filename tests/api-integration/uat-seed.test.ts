import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { can, reaches } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { UAT_ACCOUNTS } from "../../apps/api/scripts/seed-uat-users";
import {
  G1_AUTOMATIONS,
  G1_PENDING_CUSTOMER,
  G1_PROJECT_IDS,
  G1_SERVICE_STATES,
} from "../../apps/api/scripts/uat-seed-plan";
import {
  approvalCandidates,
  approvalRequestContext,
} from "../../apps/api/src/approval/authoring-service";
import { resolveApprovalIdentity } from "../../apps/api/src/approval/repository";
import {
  auth,
  portalAuth,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import { finalizeVerifiedFirstUserSetup } from "../../apps/api/src/auth/repository";
import { validateRuleDefinition } from "../../apps/api/src/automation/validation";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { automationTable } from "../../apps/api/src/database/schema";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

const execute = promisify(execFile);
let directory: string;
let first: { stdout: string; stderr: string };
async function snapshot() {
  const tables = (
    await db.execute<{ name: string }>(
      sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    )
  ).rows;
  const result: Record<string, string[]> = {};
  for (const { name } of tables)
    result[name] = (
      await db.execute<{ row: string }>(
        sql`select row_to_json(t)::text as row from ${sql.identifier(name)} t`,
      )
    ).rows
      .map((r) => r.row)
      .sort();
  return result;
}
async function run(args?: string[], env?: NodeJS.ProcessEnv) {
  return execute(
    "pnpm",
    [
      "exec",
      "tsx",
      "../../scripts/seed-uat.mjs",
      ...(args ?? [
        "--uat",
        "--credentials-file",
        path.join(directory, "credentials.json"),
      ]),
    ],
    {
      cwd: `${import.meta.dirname}/../../apps/api`,
      env: {
        ...process.env,
        TASKDESK_STORAGE_FILESYSTEM_ROOT: path.join(directory, "storage"),
        ...env,
      },
      timeout: 120000,
    },
  );
}
afterAll(async () => {
  await getDatabasePool().end();
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("clean-install seed on a disposable migrated database", () => {
  it("requires completed setup and seeds once", async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    directory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-g1-credentials-"),
    );
    await mkdir(path.join(directory, "storage"), { mode: 0o700 });
    await expect(run()).rejects.toThrow(/Complete first-administrator setup/);
    await db.transaction(async (tx) => {
      const org = await ensureInternalOrganisation(tx);
      await tx.insert(schema.userTable).values({
        id: "g1-first-admin",
        name: "First administrator",
        email: "first-admin@example.test",
        role: "admin",
        emailVerified: true,
        twoFactorEnabled: true,
      });
      await tx.insert(schema.personTable).values({
        id: "g1-first-admin-person",
        userId: "g1-first-admin",
        organisationId: org.id,
        side: "staff",
      });
      await tx.insert(schema.twoFactorTable).values({
        id: "g1-first-admin-factor",
        userId: "g1-first-admin",
        secret: randomBytes(32).toString("hex"),
        backupCodes: randomBytes(32).toString("hex"),
        verified: true,
      });
      await finalizeVerifiedFirstUserSetup(tx, "g1-first-admin");
      // Operator-configured password login; the seed must not change auth settings.
      await tx.insert(schema.instancePluginConfigTable).values({
        id: "g1-password-plugin",
        pluginId: "auth.password",
        instanceKey: "default",
        displayName: "Password",
        enabled: true,
        config: {},
        scope: "instance",
        portalScope: "both",
        configVersion: 1,
      });
    });
    const marker = await db.select().from(schema.instanceSettingTable);
    first = await run();
    expect(await db.select().from(schema.instanceSettingTable)).toEqual(marker);
  });

  it("creates the journeys and grants exact reach", async () => {
    const projects = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.workspaceId, "uat-ws"));
    expect(projects).toHaveLength(4);
    for (const project of projects)
      expect(project.managerId).toBe("uat-person-manager");
    expect(projects.find((p) => p.id === "uat-proj-support")?.kind).toBe(
      "managed_service",
    );
    const expected: Record<string, string[]> = {
      owner: [...G1_PROJECT_IDS],
      admin: [...G1_PROJECT_IDS],
      manager: [...G1_PROJECT_IDS],
      lead: ["uat-proj-support", "uat-proj-itops", "uat-proj-web"],
      agent1: ["uat-proj-support", "uat-proj-itops", "uat-proj-web"],
      agent2: [...G1_PROJECT_IDS],
      viewer: ["uat-proj-web"],
    };
    for (const [key, ids] of Object.entries(expected)) {
      const identity = await resolveIdentity({
        userId: `uat-user-${key}`,
        credential: "session",
      });
      expect(identity).toBeTruthy();
      if (!identity) throw new Error("Missing staff identity");
      expect(
        projects
          .filter((p) =>
            reaches(identity, {
              projectId: p.id,
              workspaceId: p.workspaceId,
              organisationId: p.organisationId,
              ownerTeamId: p.ownerTeamId,
            }),
          )
          .map((p) => p.id)
          .sort(),
      ).toEqual([...ids].sort());
    }
    for (const [key, ids] of Object.entries({
      contoso1: ["uat-proj-support"],
      contoso2: ["uat-proj-contoso-managed"],
      contoso3: ["uat-proj-support", "uat-proj-contoso-managed"],
      fabrikam1: ["uat-proj-web"],
    })) {
      const rows = await db
        .select()
        .from(schema.customerProjectAccessTable)
        .where(
          eq(schema.customerProjectAccessTable.personId, `uat-person-${key}`),
        );
      expect(rows.map((r) => r.projectId).sort()).toEqual(ids.sort());
      expect(rows.every((r) => r.grantedBy === "uat-person-owner")).toBe(true);
      const identity = await resolveIdentity({
        userId: `uat-user-${key}`,
        credential: "session",
      });
      if (!identity) throw new Error("Missing customer identity");
      expect(
        projects
          .filter((p) =>
            reaches(identity, {
              projectId: p.id,
              workspaceId: p.workspaceId,
              organisationId: p.organisationId,
              ownerTeamId: p.ownerTeamId,
            }),
          )
          .map((p) => p.id)
          .sort(),
      ).toEqual([...ids].sort());
    }
    const [invitation] = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.email, G1_PENDING_CUSTOMER.email));
    expect(invitation?.status).toBe("pending");
    expect(invitation?.validatedProjectIds?.sort()).toEqual(
      [...G1_PENDING_CUSTOMER.projectIds].sort(),
    );
    const states = await db
      .select({ name: schema.stateTemplateTable.name })
      .from(schema.stateTable)
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTable.stateTemplateId, schema.stateTemplateTable.id),
      )
      .where(eq(schema.stateTable.projectId, "uat-proj-support"))
      .orderBy(schema.stateTable.position);
    expect(states.map((s) => s.name)).toEqual(
      G1_SERVICE_STATES.map((s) => s.name),
    );
    const approvals = await db
      .select()
      .from(schema.approvalTable)
      .where(
        and(
          eq(schema.approvalTable.workspaceId, "uat-ws"),
          eq(schema.approvalTable.state, "pending"),
        ),
      );
    expect(approvals).toHaveLength(1);
    for (const target of G1_AUTOMATIONS) {
      const validated = validateRuleDefinition(target.definition);
      const rows = await db
        .select()
        .from(automationTable)
        .where(eq(automationTable.name, target.name));
      if (validated.ok) expect(rows[0]?.enabled).toBe(true);
      else {
        expect(
          validated.problems.every(
            (p) =>
              p.code === "unavailable" ||
              (p.path === "conditions[1].basis" &&
                "scheduleCron" in target.definition),
          ),
        ).toBe(true);
        expect(rows).toEqual([]);
        expect(first.stdout).toContain(
          `Skipped automation "${target.name}": missing ${target.requires}.`,
        );
      }
    }
    for (const [table, id] of Object.entries({
      cycle: "uat-cycle",
      module: "uat-module",
      milestone: "uat-milestone",
      prerequisite: "uat-prerequisite",
      stakeholder: "uat-stakeholder",
      document_link: "uat-document-link",
      saved_view: "uat-saved-view",
      dashboard: "uat-dashboard",
      dashboard_widget: "uat-dashboard-widget",
      time_entry: "uat-time-entry",
      budget: "uat-budget",
      announcement: "uat-announcement",
      attachment: "uat-attachment",
      custom_field: "uat-custom-field",
      webhook: "uat-webhook",
      report_export: "uat-report-export",
    })) {
      const result = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where id = ${id}`,
      );
      expect(result.rows[0]?.n, table).toBe(1);
    }
    const [change] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, "uat-wi-sup-11"));
    const [changeState] = await db
      .select()
      .from(schema.stateTable)
      .where(eq(schema.stateTable.id, change?.stateId ?? ""));
    const [transition] = await db
      .select()
      .from(schema.workflowTransitionTable)
      .where(
        eq(schema.workflowTransitionTable.id, approvals[0]?.transitionId ?? ""),
      );
    expect(transition?.fromStateTemplateId).toBe(changeState?.stateTemplateId);
    const [triage] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .where(
        and(
          eq(schema.requestTypeTable.workspaceId, "uat-ws"),
          eq(schema.submissionTable.state, "new"),
        ),
      );
    expect(triage?.n).toBeGreaterThan(0);
  });

  it("writes nothing and preserves all password hashes on rerun", async () => {
    const before = await snapshot();
    const rerun = await run();
    const credentials = JSON.parse(
      await readFile(path.join(directory, "credentials.json"), "utf8"),
    );
    for (const account of credentials.accounts)
      expect(rerun.stdout + rerun.stderr).not.toContain(account.password);
    expect(await snapshot()).toEqual(before);
  });
  it("retains role authority and CAB candidates", async () => {
    const owner = await resolveIdentity({
      userId: "uat-user-owner",
      credential: "session",
    });
    const member = await resolveIdentity({
      userId: "uat-user-agent1",
      credential: "session",
    });
    const viewer = await resolveIdentity({
      userId: "uat-user-viewer",
      credential: "session",
    });
    if (!owner || !member || !viewer) throw new Error("Missing role fixture");
    expect(
      can(owner, "workspace:manage_members", "workspace", {
        workspaceId: "uat-ws",
      }),
    ).toBe(true);
    const target = {
      workItemId: "uat-wi-web-3",
      workItemProjectId: "uat-proj-web",
      workspaceId: "uat-ws",
    };
    expect(can(member, "work_item:update", "work_item", target)).toBe(true);
    expect(can(viewer, "work_item:update", "work_item", target)).toBe(false);
    expect(can(viewer, "work_item:read", "work_item", target)).toBe(true);
    const identity = await resolveApprovalIdentity("uat-user-agent1");
    expect(
      (await approvalRequestContext(identity, "SUP-11")).context,
    ).toMatchObject({ enabled: true, canRequestCab: true });
    expect(
      (
        await approvalCandidates(identity, "SUP-11", {
          kind: "cab",
          q: "",
          limit: 25,
        })
      ).data.map((r) => r.id),
    ).toContain("uat-person-lead");
  });

  it("writes the product creation audit rows and admin grant provenance", async () => {
    for (const kind of [
      "cycle",
      "module",
      "custom_field_section",
      "custom_field",
      "time_activity",
      "time_entry",
      "budget",
      "dashboard",
      "saved_view",
      "document_link",
      "webhook",
      "announcement",
    ]) {
      const rows = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.workspaceId, "uat-ws"),
            eq(schema.auditLogTable.action, `${kind}.created`),
          ),
        );
      expect(rows.length, kind).toBeGreaterThan(0);
    }
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "approval.requested")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.eventId, "uat-approval-requested")),
    ).toHaveLength(1);
    const grants = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.directOrigin, "admin"));
    expect(grants.length).toBeGreaterThan(0);
    expect(
      grants.every((g) => g.grantedByPersonId === "uat-person-owner"),
    ).toBe(true);
    expect(
      await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.id, "uat-staff-invite-owner")),
    ).toEqual([]);
  });

  it("refuses unsafe inputs before connecting or writing", async () => {
    const credentials = path.join(directory, "credentials.json");
    await expect(run(["--credentials-file", credentials])).rejects.toThrow(
      /--uat/,
    );
    await expect(
      run(undefined, {
        TASKDESK_DATABASE_URL:
          "postgresql://invalid:invalid@127.0.0.1:1/taskdesk_browser_journey_1022_test",
      }),
    ).rejects.toThrow(/protected|live/i);
    await expect(
      run(undefined, {
        TASKDESK_DATABASE_URL:
          "postgresql://invalid:invalid@127.0.0.1:62870/unused_test",
      }),
    ).rejects.toThrow(/protected|62870/i);
    await expect(
      run([
        "--uat",
        "--credentials-file",
        path.resolve(import.meta.dirname, "../../unsafe-credentials.json"),
      ]),
    ).rejects.toThrow(/outside/i);
    await chmod(credentials, 0o644);
    try {
      await expect(run()).rejects.toThrow(/0600/);
    } finally {
      await chmod(credentials, 0o600);
    }
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
  });

  it("refuses existing accounts without credentials and conflicts without any writes", async () => {
    const before = await snapshot();
    await expect(
      run([
        "--uat",
        "--credentials-file",
        path.join(directory, "missing.json"),
      ]),
    ).rejects.toThrow(/accounts already exist/i);
    expect(await snapshot()).toEqual(before);
    await db
      .update(schema.projectTable)
      .set({ slug: "CONFLICT" })
      .where(eq(schema.projectTable.id, "uat-proj-web"));
    const conflicting = await snapshot();
    try {
      await expect(run()).rejects.toThrow(/conflict/i);
      expect(await snapshot()).toEqual(conflicting);
    } finally {
      await db
        .update(schema.projectTable)
        .set({ slug: "WEB" })
        .where(eq(schema.projectTable.id, "uat-proj-web"));
    }
  });

  it("every generated password signs in through the real authentication handler and is never logged", async () => {
    const credentials: { accounts: { email: string; password: string }[] } =
      JSON.parse(
        await readFile(path.join(directory, "credentials.json"), "utf8"),
      );
    expect(credentials.accounts).toHaveLength(UAT_ACCOUNTS.length);
    await reloadAuthConfiguration();
    // The auth handler receives the internal client-ip header after proxy normalization.
    for (const [index, account] of credentials.accounts.entries()) {
      expect(first.stdout + first.stderr).not.toContain(account.password);
      const side = UAT_ACCOUNTS.find((a) => a.email === account.email)?.side;
      const handler = side === "customer" ? portalAuth : auth;
      const origin =
        side === "customer"
          ? process.env.TASKDESK_PORTAL_URL
          : process.env.TASKDESK_AGENT_URL;
      const response = await handler.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-taskdesk-client-ip": `198.51.100.${index + 1}`,
          },
          body: JSON.stringify({
            email: account.email,
            password: account.password,
          }),
        }),
      );
      expect(response.status, account.email).toBe(200);
    }
  });
});
