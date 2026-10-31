import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { can, reaches } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  UAT_ACCOUNTS,
  UAT_WORKSPACE_ID,
} from "../../apps/api/scripts/seed-uat-users";
import {
  approvalCandidates,
  approvalRequestContext,
} from "../../apps/api/src/approval/authoring-service";
import {
  hasApprovalCapability,
  isCabTeamMember,
  loadApprovalTargetByKey,
  resolveApprovalIdentity,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { kbArticleTable } from "../../apps/api/src/database/schema-p5-kb";
import { projectPageTable } from "../../apps/api/src/database/schema-p5-pages";
import { listOwnSubmissions } from "../../apps/api/src/intake/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";

const execute = promisify(execFile);
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  compare(password: string, hash: string): Promise<boolean>;
};
const apiRoot = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

let directory: string;
let sitCredentials: string;
let uatCredentials: string;

function run(script: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return execute("pnpm", ["exec", "tsx", `../../scripts/${script}`, ...args], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
}

/** Every public table as a sorted multiset of its rows, so any write anywhere is visible. */
async function snapshot() {
  const tables = (
    await db.execute<{ name: string }>(
      sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
  ).rows.map((row) => row.name);
  const result: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = await db.execute<{ row: string }>(
      sql`SELECT row_to_json(t)::text AS row FROM ${sql.identifier(table)} t`,
    );
    result[table] = rows.rows.map((row) => row.row).sort();
  }
  return result;
}

function missingRows(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
) {
  const missing: string[] = [];
  for (const [table, rows] of Object.entries(before)) {
    const remaining = new Map<string, number>();
    for (const row of after[table] ?? [])
      remaining.set(row, (remaining.get(row) ?? 0) + 1);
    for (const row of rows) {
      const count = remaining.get(row) ?? 0;
      if (count === 0) missing.push(`${table}: ${row.slice(0, 200)}`);
      else remaining.set(row, count - 1);
    }
  }
  return missing;
}

async function identityFor(email: string) {
  const [user] = await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email));
  if (!user) throw new Error(`Missing user ${email}`);
  const identity = await resolveIdentity({
    userId: user.id,
    credential: "session",
  });
  if (!identity) throw new Error(`No identity for ${email}`);
  return { userId: user.id, identity };
}

function accountByKey(key: string) {
  const account = UAT_ACCOUNTS.find((row) => row.id === `uat-user-${key}`);
  if (!account) throw new Error(`Missing UAT account ${key}`);
  return account;
}

async function projectFacts(id: string) {
  const [project] = await db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, id));
  if (!project) throw new Error(`Missing project ${id}`);
  return {
    projectId: project.id,
    workspaceId: project.workspaceId,
    organisationId: project.organisationId,
  };
}

describe("UAT seed is strictly additive on top of the SIT seed", () => {
  let sitSnapshot: Record<string, string[]>;
  let firstRun: Record<string, string[]>;

  beforeAll(async () => {
    await resetTestDatabase({ defaultOffFeatures: false });
    directory = await mkdtemp(path.join(os.tmpdir(), "taskdesk-uat-seed-"));
    sitCredentials = path.join(directory, "sit.json");
    uatCredentials = path.join(directory, "uat.json");
    await run("seed-sit-users.mjs", [
      "--sit",
      "--credentials-file",
      sitCredentials,
    ]);
    sitSnapshot = await snapshot();
  }, 180_000);

  afterAll(async () => {
    await resetTestDatabase();
    await rm(directory, { recursive: true, force: true });
  });

  it("refuses without --uat, on the live database name, and for a credentials file inside the repository", async () => {
    await expect(
      run("seed-uat.mjs", ["--credentials-file", uatCredentials]),
    ).rejects.toThrow(/requires --uat/);
    await expect(
      run("seed-uat.mjs", ["--uat", "--credentials-file", uatCredentials], {
        // A closed port: the guard must refuse before any connection is attempted.
        TASKDESK_DATABASE_URL:
          "postgresql://nobody:nothing@127.0.0.1:9/taskdesk_browser_journey_1022_test",
      }),
    ).rejects.toThrow(/live database and must never be seeded/);
    await expect(
      run("seed-uat.mjs", [
        "--uat",
        "--credentials-file",
        path.join(repoRoot, "uat-credentials.json"),
      ]),
    ).rejects.toThrow(/outside the source checkout/);
    await expect(stat(uatCredentials)).rejects.toThrow();
    await expect(
      stat(path.join(repoRoot, "uat-credentials.json")),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(sitSnapshot);
  }, 180_000);

  it("adds the UAT workspace without changing any SIT row, and a rerun changes nothing", async () => {
    await run("seed-uat.mjs", ["--uat", "--credentials-file", uatCredentials]);
    expect((await stat(uatCredentials)).mode & 0o077).toBe(0);
    firstRun = await snapshot();
    expect(missingRows(sitSnapshot, firstRun)).toEqual([]);
    expect(
      (firstRun.work_item?.length ?? 0) - (sitSnapshot.work_item?.length ?? 0),
    ).toBeGreaterThanOrEqual(40);

    const credentials = await readFile(uatCredentials, "utf8");
    const { stdout } = await run("seed-uat.mjs", [
      "--uat",
      "--credentials-file",
      uatCredentials,
    ]);
    for (const account of JSON.parse(credentials).accounts)
      expect(stdout).not.toContain(account.password);
    expect(await readFile(uatCredentials, "utf8")).toBe(credentials);
    expect(stdout).toContain("UAT seed complete: workspace uat-ws");
    expect(stdout).toContain(
      "Local factor (MFA) policy: optional. No MFA enrolment is required at first sign-in",
    );
    const secondRun = await snapshot();
    expect(missingRows(firstRun, secondRun)).toEqual([]);
    expect(secondRun).toEqual(firstRun);
  }, 240_000);

  it("refuses a conflicting uat- row without writing anything", async () => {
    await db
      .update(schema.projectTable)
      .set({ slug: "SUPX" })
      .where(eq(schema.projectTable.id, "uat-proj-support"));
    const before = await snapshot();
    await expect(
      run("seed-uat.mjs", ["--uat", "--credentials-file", uatCredentials]),
    ).rejects.toThrow(/conflicts with the UAT fixture/);
    expect(await snapshot()).toEqual(before);
    await db
      .update(schema.projectTable)
      .set({ slug: "SUP" })
      .where(eq(schema.projectTable.id, "uat-proj-support"));

    // A conflict found late inside the seed transaction rolls back the rows it had already
    // re-added earlier in that transaction (here, a removed workspace flag).
    const flagRow = and(
      eq(schema.workspaceFeatureFlagTable.workspaceId, UAT_WORKSPACE_ID),
      eq(schema.workspaceFeatureFlagTable.featureKey, "feature.dev_links"),
    );
    const [removedFlag] = await db
      .delete(schema.workspaceFeatureFlagTable)
      .where(flagRow)
      .returning();
    await db
      .update(schema.approvalTable)
      .set({ kind: "customer" })
      .where(eq(schema.approvalTable.id, "uat-approval-sup-11"));
    const beforeLate = await snapshot();
    await expect(
      run("seed-uat.mjs", ["--uat", "--credentials-file", uatCredentials]),
    ).rejects.toThrow(/approval \(uat-approval-sup-11\) conflicts/);
    expect(await snapshot()).toEqual(beforeLate);
    if (removedFlag)
      await db.insert(schema.workspaceFeatureFlagTable).values(removedFlag);
    await db
      .update(schema.approvalTable)
      .set({ kind: "cab" })
      .where(eq(schema.approvalTable.id, "uat-approval-sup-11"));
  }, 180_000);

  it("every account can sign in with the password in the credentials file", async () => {
    const { accounts } = JSON.parse(await readFile(uatCredentials, "utf8"));
    expect(accounts).toHaveLength(UAT_ACCOUNTS.length);
    for (const row of accounts) {
      expect(Object.keys(row).sort()).toEqual([
        "email",
        "name",
        "password",
        "role",
      ]);
      const [user] = await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, row.email));
      expect(user).toMatchObject({ emailVerified: true, banned: false });
      const [credential] = await db
        .select({ password: schema.accountTable.password })
        .from(schema.accountTable)
        .where(
          and(
            eq(schema.accountTable.userId, user?.id ?? ""),
            eq(schema.accountTable.providerId, "credential"),
          ),
        );
      expect(
        await bcrypt.compare(row.password, credential?.password ?? ""),
      ).toBe(true);
    }
  });

  it("gives each role the intended membership and authority", async () => {
    const owner = await identityFor(accountByKey("owner").email);
    const admin = await identityFor(accountByKey("admin").email);
    const lead = await identityFor(accountByKey("lead").email);
    const agent = await identityFor(accountByKey("agent1").email);
    const viewer = await identityFor(accountByKey("viewer").email);
    const godmode = await identityFor(accountByKey("godmode").email);
    const support = await projectFacts("uat-proj-support");
    const workspaceTarget = { workspaceId: UAT_WORKSPACE_ID };

    expect(godmode.identity.reach.kind).toBe("all");
    expect(owner.identity.reach.kind).not.toBe("all");
    for (const staff of [owner, admin, lead, agent, viewer])
      expect(reaches(staff.identity, support)).toBe(true);
    expect(
      owner.identity.memberships.some(
        (row) =>
          row.scope === "workspace" &&
          row.scopeId === UAT_WORKSPACE_ID &&
          row.seesAll,
      ),
    ).toBe(true);
    expect(
      admin.identity.memberships.some(
        (row) =>
          row.scope === "workspace" &&
          row.scopeId === UAT_WORKSPACE_ID &&
          row.seesAll,
      ),
    ).toBe(true);
    const workspaceRole = (identity: typeof owner.identity) =>
      identity.authority.find(
        (grant) =>
          grant.scope === "workspace" && grant.scopeId === UAT_WORKSPACE_ID,
      )?.roleKey;
    expect(workspaceRole(owner.identity)).toBe("owner");
    expect(workspaceRole(admin.identity)).toBe("admin");
    expect(workspaceRole(lead.identity)).toBe("lead");
    expect(workspaceRole(agent.identity)).toBe("member");
    expect(workspaceRole(viewer.identity)).toBe("viewer");
    expect(workspaceRole(godmode.identity)).toBeUndefined();
    expect(
      can(
        owner.identity,
        "workspace:manage_members",
        "workspace",
        workspaceTarget,
      ),
    ).toBe(true);
    const itemTarget = {
      workItemId: "uat-wi-sup-1",
      workItemProjectId: "uat-proj-support",
      workspaceId: UAT_WORKSPACE_ID,
    };
    expect(
      can(agent.identity, "work_item:update", "work_item", itemTarget),
    ).toBe(true);
    expect(
      can(viewer.identity, "work_item:update", "work_item", itemTarget),
    ).toBe(false);
    expect(
      can(viewer.identity, "work_item:read", "work_item", itemTarget),
    ).toBe(true);

    // The pending change approval waits for the lead, who is a CAB approver.
    const leadApproval = await resolveApprovalIdentity(lead.userId);
    const agentApproval = await resolveApprovalIdentity(agent.userId);
    const target = await loadApprovalTargetByKey(leadApproval, "SUP-11");
    expect(
      hasApprovalCapability(leadApproval, "approval:decide_cab", target),
    ).toBe(true);
    expect(
      await isCabTeamMember(
        leadApproval,
        lead.userId,
        UAT_WORKSPACE_ID,
        "uat-wi-sup-11",
      ),
    ).toBe(true);
    const authoring = await approvalRequestContext(agentApproval, "SUP-11");
    expect(authoring.context).toMatchObject({
      enabled: true,
      canRequestCab: true,
    });
    const candidates = await approvalCandidates(agentApproval, "SUP-11", {
      kind: "cab",
      q: "",
      limit: 25,
    });
    expect(candidates.data.map((row) => row.id)).toContain(
      leadApproval.personId,
    );
    const [approval] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.workItemId, "uat-wi-sup-11"));
    expect(approval).toMatchObject({
      state: "pending",
      approverId: leadApproval.personId,
    });
    // The approval must stay decidable for the whole UAT window. The seed sets
    // createdAt four hours before its own clock, so recover the seed's now.
    const seedNow = (approval?.createdAt.getTime() ?? 0) + 4 * 3_600_000;
    expect(approval?.expiresAt.getTime()).toBeGreaterThanOrEqual(
      seedNow + 14 * 86_400_000,
    );
    expect(approval?.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 14 * 86_400_000,
    );
  });

  it("keeps Contoso and Fabrikam customers apart under the permission layer", async () => {
    const contoso = await identityFor(accountByKey("contoso1").email);
    const contoso2 = await identityFor(accountByKey("contoso2").email);
    const fabrikam = await identityFor(accountByKey("fabrikam1").email);
    const support = await projectFacts("uat-proj-support");
    const web = await projectFacts("uat-proj-web");
    const ops = await projectFacts("uat-proj-itops");

    expect(contoso.identity.reach).toEqual({
      kind: "organisation",
      ids: ["uat-org-contoso"],
    });
    expect(reaches(contoso.identity, support)).toBe(true);
    expect(reaches(contoso.identity, web)).toBe(false);
    expect(reaches(contoso.identity, ops)).toBe(false);
    expect(reaches(fabrikam.identity, web)).toBe(true);
    expect(reaches(fabrikam.identity, support)).toBe(false);
    expect(reaches(fabrikam.identity, ops)).toBe(false);

    const contosoView = await listOwnSubmissions(contoso.userId);
    const contoso2View = await listOwnSubmissions(contoso2.userId);
    const fabrikamView = await listOwnSubmissions(fabrikam.userId);
    const organisations = async (ids: string[]) =>
      (
        await db
          .select({ organisationId: schema.submissionTable.organisationId })
          .from(schema.submissionTable)
          .where(sql`${schema.submissionTable.id} IN ${ids}`)
      ).map((row) => row.organisationId);
    expect(contosoView.submissions.length).toBeGreaterThan(0);
    expect(fabrikamView.submissions.length).toBe(3);
    expect(
      new Set(
        await organisations(
          contosoView.submissions.map((row) => row.submission.id),
        ),
      ),
    ).toEqual(new Set(["uat-org-contoso"]));
    expect(
      new Set(
        await organisations(
          fabrikamView.submissions.map((row) => row.submission.id),
        ),
      ),
    ).toEqual(new Set(["uat-org-fabrikam"]));
    // A colleague's private request stays private inside the same organisation.
    const privateOfContoso2 = await db
      .select({ id: schema.submissionTable.id })
      .from(schema.submissionTable)
      .where(
        and(
          eq(schema.submissionTable.requesterId, "uat-person-contoso2"),
          eq(schema.submissionTable.customerVisibility, "private"),
        ),
      );
    expect(privateOfContoso2.length).toBeGreaterThan(0);
    for (const row of privateOfContoso2) {
      expect(
        contosoView.submissions.map((item) => item.submission.id),
      ).not.toContain(row.id);
      expect(
        contoso2View.submissions.map((item) => item.submission.id),
      ).toContain(row.id);
    }
  });

  it("seeds the UAT content: projects, states, SLA, flags, KB, Pages and holidays", async () => {
    const items = await db
      .select({
        key: schema.workItemTable.key,
        parentId: schema.workItemTable.parentId,
        dueDate: schema.workItemTable.dueDate,
        group: schema.stateTemplateTable.group,
        slaPolicyVersionId: schema.workItemTable.slaPolicyVersionId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.stateTable,
        eq(schema.stateTable.id, schema.workItemTable.stateId),
      )
      .innerJoin(
        schema.stateTemplateTable,
        eq(schema.stateTemplateTable.id, schema.stateTable.stateTemplateId),
      )
      .where(eq(schema.workItemTable.workspaceId, UAT_WORKSPACE_ID));
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(new Set(items.map((row) => row.group))).toEqual(
      new Set(["backlog", "unstarted", "started", "completed", "cancelled"]),
    );
    expect(items.filter((row) => row.parentId).length).toBeGreaterThan(5);
    expect(items.some((row) => row.slaPolicyVersionId)).toBe(true);
    const now = Date.now();
    expect(
      items.some(
        (row) =>
          row.dueDate &&
          row.dueDate.getTime() < now &&
          !["completed", "cancelled"].includes(row.group),
      ),
    ).toBe(true);
    // Accepted portal requests were numbered after the seeded items.
    expect(items.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        "SUP-15",
        "SUP-16",
        "SUP-17",
        "WEB-14",
        "WEB-15",
      ]),
    );

    const flags = await db
      .select()
      .from(schema.workspaceFeatureFlagTable)
      .where(
        eq(schema.workspaceFeatureFlagTable.workspaceId, UAT_WORKSPACE_ID),
      );
    expect(flags.every((row) => row.enabled)).toBe(true);
    expect(flags.map((row) => row.featureKey)).toEqual(
      expect.arrayContaining([
        "feature.intake",
        "feature.customer_portal",
        "feature.pages",
        "feature.sla",
        "feature.approvals",
        "feature.calendar",
        "feature.timeline",
        "feature.knowledge_base",
      ]),
    );
    const instanceFlags = await db
      .select()
      .from(schema.instanceFeatureFlagTable);
    expect(instanceFlags).toEqual([]);

    const articles = await db
      .select()
      .from(kbArticleTable)
      .where(eq(kbArticleTable.workspaceId, UAT_WORKSPACE_ID));
    expect(articles.length).toBeGreaterThanOrEqual(4);
    expect(articles.every((row) => row.state === "published")).toBe(true);
    // Comment authors are person ids, as the real comment writer stores them.
    const comments = await db
      .select({
        id: schema.commentTable.id,
        authorId: schema.commentTable.authorId,
        personId: schema.personTable.id,
      })
      .from(schema.commentTable)
      .leftJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.commentTable.authorId),
      )
      .where(sql`${schema.commentTable.id} LIKE 'uat-%'`);
    expect(comments.length).toBeGreaterThanOrEqual(11);
    expect(comments.filter((row) => row.personId === null)).toEqual([]);

    const pages = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.workspaceId, UAT_WORKSPACE_ID));
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.every((row) => row.bodyText.length > 50)).toBe(true);

    const types = await db
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.workspaceId, UAT_WORKSPACE_ID));
    expect(types.map((row) => row.name).sort()).toEqual([
      "Access request",
      "Change request",
      "General question",
      "Report a problem",
    ]);
    expect(types.every((row) => row.published && row.customerVisible)).toBe(
      true,
    );
    const [calendar] = await db
      .select()
      .from(schema.serviceCalendarTable)
      .where(eq(schema.serviceCalendarTable.id, "uat-calendar-business"));
    expect((calendar?.holidays ?? []) as unknown[]).toHaveLength(6);
    const [policy] = await db
      .select()
      .from(schema.slaPolicyTable)
      .where(eq(schema.slaPolicyTable.id, "uat-sla-policy"));
    expect(policy?.activeVersionId).toBe("uat-sla-policy-v1");
  });
});
