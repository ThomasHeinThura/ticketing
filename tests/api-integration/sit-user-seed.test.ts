import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  seedSitApprovalDemoFlag,
  seedSitLabelCatalogue,
} from "../../apps/api/scripts/seed-sit-users";
import {
  approvalCandidates,
  approvalRequestContext,
} from "../../apps/api/src/approval/authoring-service";
import {
  hasApprovalCapability,
  hasWorkItemReach,
  isCabTeamMember,
  loadApprovalTargetByKey,
  resolveApprovalIdentity,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { listWorkItemLabels } from "../../apps/api/src/work-item/labels-repository";
import { resetTestDatabase } from "./helpers/database";

let credentialsDirectory: string;
let credentialsFile: string;

const execute = promisify(execFile);
const apiRoot = fileURLToPath(new URL("../../apps/api/", import.meta.url));

function runSeed(args: string[]) {
  return execute(
    "pnpm",
    ["exec", "tsx", "../../scripts/seed-sit-users.mjs", ...args],
    {
      cwd: apiRoot,
      env: { ...process.env },
      timeout: 60_000,
    },
  );
}

async function submissions() {
  return db
    .select()
    .from(schema.submissionTable)
    .orderBy(asc(schema.submissionTable.number));
}

describe("local SIT seed uses real intake and preserves walkthrough progress", () => {
  beforeAll(async () => {
    await resetTestDatabase();
    credentialsDirectory = await mkdtemp(
      path.join(os.tmpdir(), "taskdesk-seed-credentials-"),
    );
    credentialsFile = path.join(credentialsDirectory, "accounts.json");
  });
  afterAll(async () => {
    await resetTestDatabase();
    await rm(credentialsDirectory, { recursive: true, force: true });
  });

  it("requires explicit SIT opt-in before writing accounts or submissions", async () => {
    await expect(runSeed([])).rejects.toThrow();
    expect(await submissions()).toEqual([]);
    const users = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable);
    expect(users).toEqual([]);
  });

  it("seeds two published forms and real submissions, then preserves their identity and state", async () => {
    await runSeed(["--sit", "--credentials-file", credentialsFile]);
    expect((await stat(credentialsFile)).mode & 0o077).toBe(0);
    const firstCredentials = await readFile(credentialsFile, "utf8");
    expect(JSON.parse(firstCredentials).accounts).toHaveLength(4);
    const first = await submissions();
    expect(first).toHaveLength(2);
    const firstSubmission = first[0];
    if (!firstSubmission) throw new Error("SIT submission was not seeded");
    expect(first.map((row) => row.customerVisibility).sort()).toEqual([
      "organisation",
      "private",
    ]);
    expect(
      first.every((row) => row.state === "new" && row.submittedAt !== null),
    ).toBe(true);
    const types = await db.select().from(schema.requestTypeTable);
    expect(types).toHaveLength(2);
    expect(types.every((row) => row.published && row.customerVisible)).toBe(
      true,
    );
    const versions = await db
      .select({ id: schema.requestTypeVersionTable.id })
      .from(schema.requestTypeVersionTable);
    expect(
      first.every((row) =>
        versions.some((version) => version.id === row.requestTypeVersionId),
      ),
    ).toBe(true);

    const examples = await db
      .select()
      .from(schema.workItemTable)
      .orderBy(asc(schema.workItemTable.number));
    expect(examples).toHaveLength(7);
    const change = examples.find((item) => item.key === "HELP-4");
    const child = examples.find((item) => item.key === "HELP-5");
    if (!change || !child)
      throw new Error("SIT journey examples were not seeded");
    expect(child.parentId).toBe(change.id);
    expect(new Set(examples.slice(3).map((item) => item.stateId)).size).toBe(4);
    expect(
      examples
        .slice(3)
        .every(
          (item) =>
            item.assigneeId &&
            item.requesterId &&
            item.startDate &&
            item.dueDate &&
            item.startDate < item.dueDate,
        ),
    ).toBe(true);
    const relations = await db.select().from(schema.workItemRelationTable);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      sourceId: change.id,
      targetId: examples.find((item) => item.key === "HELP-7")?.id,
      type: "blocks",
    });
    const labels = await db
      .select()
      .from(schema.labelTable)
      .orderBy(schema.labelTable.id);
    expect(labels).toHaveLength(4);
    expect(
      labels.every(
        (label) =>
          label.workspaceId === change.workspaceId && label.taskId === null,
      ),
    ).toBe(true);
    expect(
      labels
        .filter((label) => label.projectId === null)
        .map((label) => label.name)
        .sort(),
    ).toEqual(["Access", "Incident"]);
    expect(
      labels
        .filter((label) => label.projectId === change.projectId)
        .map((label) => label.name)
        .sort(),
    ).toEqual(["Change window", "Customer follow-up"]);
    const labelLinks = await db.select().from(schema.workItemLabelTable);
    expect(labelLinks).toHaveLength(10);
    expect(new Set(labelLinks.map((link) => link.workItemId)).size).toBe(7);
    expect(
      (await listWorkItemLabels(change.key, change.workspaceId))
        .filter((label) => label.assigned)
        .map((label) => label.name)
        .sort(),
    ).toEqual(["Change window", "Customer follow-up"]);
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, change.id));
    expect(comments.map((row) => row.visibility).sort()).toEqual([
      "internal",
      "public",
    ]);
    const [commentAuthor] = await db
      .select({ id: schema.userTable.id, name: schema.userTable.name })
      .from(schema.userTable)
      .where(eq(schema.userTable.email, "agent@taskdesk.local"));
    if (!commentAuthor) throw new Error("Seeded comment author is missing");
    expect(
      comments.every((comment) => comment.authorId === commentAuthor.id),
    ).toBe(true);
    expect(
      comments.every(
        (comment) =>
          comment.createdAt.getTime() <= Date.now() &&
          comment.createdAt.getTime() >= Date.now() - 60_000,
      ),
    ).toBe(true);
    const [approverUser] = await db
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(eq(schema.userTable.email, "lead@taskdesk.local"));
    if (!approverUser) throw new Error("Seeded approver user is missing");
    const approverIdentity = await resolveApprovalIdentity(approverUser.id);
    const requesterIdentity = await resolveApprovalIdentity(commentAuthor.id);
    const authoring = await approvalRequestContext(
      requesterIdentity,
      change.key,
    );
    expect(authoring.context).toMatchObject({
      enabled: true,
      canRequestCustomer: true,
      canRequestCab: true,
    });
    expect(authoring.context.transitions.map((row) => row.id).sort()).toEqual([
      "sit-maintenance-approve",
      "sit-maintenance-started-completed",
    ]);
    const candidateApprovers = await approvalCandidates(
      requesterIdentity,
      change.key,
      { kind: "cab", q: "", limit: 25 },
    );
    expect(candidateApprovers.data.map((row) => row.id)).toContain(
      approverIdentity.personId,
    );
    const [changeType] = await db
      .select()
      .from(schema.workItemTypeTable)
      .where(eq(schema.workItemTypeTable.id, change.typeId));
    expect(changeType).toMatchObject({
      isChange: true,
      workflowId: "sit-maintenance-workflow",
    });
    const [activeWorkflow] = await db
      .select()
      .from(schema.workflowTable)
      .where(eq(schema.workflowTable.id, "sit-maintenance-workflow"));
    expect(activeWorkflow?.activeVersionId).toBe("sit-maintenance-workflow-1");

    const target = await loadApprovalTargetByKey(approverIdentity, change.key);
    expect(await hasWorkItemReach(approverIdentity, target)).toBe(true);
    expect(
      hasApprovalCapability(approverIdentity, "approval:decide_cab", target),
    ).toBe(true);
    expect(
      await isCabTeamMember(
        approverIdentity,
        approverUser.id,
        change.workspaceId,
        change.id,
      ),
    ).toBe(true);
    expect(approverIdentity.reach.kind).not.toBe("all");
    expect(change.slaPolicyVersionId).toBeTruthy();
    const goals = await db
      .select()
      .from(schema.slaGoalTable)
      .where(
        eq(
          schema.slaGoalTable.versionId,
          change.slaPolicyVersionId ?? "missing",
        ),
      );
    expect([...new Set(goals.map((goal) => goal.metric))].sort()).toEqual([
      "first_response",
      "resolution",
    ]);
    const approvals = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.workItemId, change.id));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.state).toBe("pending");
    expect(approvals[0]?.kind).toBe("cab");
    expect(approvals[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const editedDate = new Date("2026-11-17T09:00:00Z");
    await db
      .update(schema.workItemTable)
      .set({
        title: "Walkthrough change retained",
        dueDate: editedDate,
        assigneeId: null,
        stateId: child.stateId,
      })
      .where(eq(schema.workItemTable.id, change.id));
    await db
      .update(schema.commentTable)
      .set({ body: { type: "doc", content: [] }, editedAt: new Date() })
      .where(eq(schema.commentTable.id, comments[0]?.id ?? "missing"));
    await db
      .update(schema.approvalTable)
      .set({
        state: "approved",
        decidedAt: new Date(),
        decisionNote: "Walkthrough approval retained",
      })
      .where(eq(schema.approvalTable.id, approvals[0]?.id ?? "missing"));

    await db
      .update(schema.submissionTable)
      .set({ state: "clarifying" })
      .where(eq(schema.submissionTable.id, firstSubmission.id));
    await db
      .update(schema.projectFeatureFlagTable)
      .set({ enabled: false, version: 2 })
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, change.projectId),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    // Real walkthrough edits and an additional customer-defined label survive repeat seeds.
    await db
      .update(schema.labelTable)
      .set({ name: "Custom access classification", color: "pink" })
      .where(eq(schema.labelTable.id, "sit-label-access"));
    await db
      .delete(schema.workItemLabelTable)
      .where(
        and(
          eq(schema.workItemLabelTable.workItemId, "sit-wi-help-2"),
          eq(schema.workItemLabelTable.labelId, "sit-label-access"),
        ),
      );
    await db.insert(schema.labelTable).values({
      id: "walkthrough-label",
      workspaceId: change.workspaceId,
      projectId: change.projectId,
      name: "Walkthrough retained",
      color: "green",
    });
    await db
      .insert(schema.workItemLabelTable)
      .values({ workItemId: change.id, labelId: "walkthrough-label" });
    const editedLabels = await db
      .select()
      .from(schema.labelTable)
      .orderBy(schema.labelTable.id);
    const editedLabelLinks = await db
      .select()
      .from(schema.workItemLabelTable)
      .orderBy(
        schema.workItemLabelTable.workItemId,
        schema.workItemLabelTable.labelId,
      );
    await runSeed(["--sit", "--credentials-file", credentialsFile]);
    expect(await readFile(credentialsFile, "utf8")).toBe(firstCredentials);
    expect(
      await db.select().from(schema.labelTable).orderBy(schema.labelTable.id),
    ).toEqual(editedLabels);
    expect(
      await db
        .select()
        .from(schema.workItemLabelTable)
        .orderBy(
          schema.workItemLabelTable.workItemId,
          schema.workItemLabelTable.labelId,
        ),
    ).toEqual(editedLabelLinks);
    const second = await submissions();
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second[0]?.state).toBe("clarifying");
    expect(await db.select().from(schema.requestTypeVersionTable)).toHaveLength(
      2,
    );
    const [retained] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, change.id));
    expect(retained?.title).toBe("Walkthrough change retained");
    expect(retained?.dueDate).toEqual(editedDate);
    expect(retained?.assigneeId).toBeNull();
    expect(retained?.stateId).toBe(child.stateId);
    const [retainedApproval] = await db
      .select()
      .from(schema.approvalTable)
      .where(eq(schema.approvalTable.id, approvals[0]?.id ?? "missing"));
    expect(retainedApproval?.state).toBe("approved");
    expect(
      (await approvalRequestContext(requesterIdentity, change.key)).context
        .enabled,
    ).toBe(false);
    const [retainedFlag] = await db
      .select()
      .from(schema.projectFeatureFlagTable)
      .where(
        and(
          eq(schema.projectFeatureFlagTable.projectId, change.projectId),
          eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    expect(retainedFlag).toMatchObject({ enabled: false, version: 2 });

    expect(retainedApproval?.decisionNote).toBe(
      "Walkthrough approval retained",
    );
    const retainedRelations = await db
      .select()
      .from(schema.workItemRelationTable);
    expect(retainedRelations).toHaveLength(1);
    expect(retainedRelations[0]?.id).toBe(relations[0]?.id);
    expect(await db.select().from(schema.commentTable)).toHaveLength(2);
    const [retainedComment] = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, comments[0]?.id ?? "missing"));
    expect(retainedComment?.body).toEqual({ type: "doc", content: [] });
    expect(await db.select().from(schema.workItemTable)).toHaveLength(7);
    expect(await db.select().from(schema.approvalTable)).toHaveLength(1);
    const users = await db
      .select({ email: schema.userTable.email })
      .from(schema.userTable);
    expect(users.map((user) => user.email).sort()).toEqual([
      "admin@taskdesk.local",
      "agent@taskdesk.local",
      "customer@acme.example",
      "lead@taskdesk.local",
    ]);
  });
  it("preserves explicit workspace and locked instance denials without touching users or sessions", async () => {
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.slug, "HELP"));
    if (!project) throw new Error("Seeded HELP project missing");
    const userIds = (
      await db.select({ id: schema.userTable.id }).from(schema.userTable)
    )
      .map((row) => row.id)
      .sort();
    const sessionUserId = userIds[0];
    if (!sessionUserId) throw new Error("Seeded session user missing");
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: "seed-flag-existing-session",
      token: "isolated-seed-flag-session",
      userId: sessionUserId,
      portal: "agent",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 3600000),
    });
    const sessionIds = (
      await db.select({ id: schema.sessionTable.id }).from(schema.sessionTable)
    )
      .map((row) => row.id)
      .sort();
    const projectFlag = and(
      eq(schema.projectFeatureFlagTable.projectId, project.id),
      eq(schema.projectFeatureFlagTable.featureKey, "feature.approvals"),
    );
    await db.delete(schema.projectFeatureFlagTable).where(projectFlag);
    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: project.workspaceId,
      featureKey: "feature.approvals",
      enabled: false,
    });
    await db.transaction((tx) =>
      seedSitApprovalDemoFlag(tx, project.workspaceId, project.id, new Date()),
    );
    expect(
      await db.select().from(schema.projectFeatureFlagTable).where(projectFlag),
    ).toEqual([]);
    await db
      .delete(schema.workspaceFeatureFlagTable)
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, project.workspaceId),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.approvals"),
        ),
      );
    await db.insert(schema.instanceFeatureFlagTable).values({
      featureKey: "feature.approvals",
      enabled: false,
      locked: true,
    });
    await db.transaction((tx) =>
      seedSitApprovalDemoFlag(tx, project.workspaceId, project.id, new Date()),
    );
    expect(
      await db.select().from(schema.projectFeatureFlagTable).where(projectFlag),
    ).toEqual([]);
    await db
      .update(schema.instanceFeatureFlagTable)
      .set({ locked: false })
      .where(
        eq(schema.instanceFeatureFlagTable.featureKey, "feature.approvals"),
      );
    await db.transaction((tx) =>
      seedSitApprovalDemoFlag(tx, project.workspaceId, project.id, new Date()),
    );
    expect(
      await db.select().from(schema.projectFeatureFlagTable).where(projectFlag),
    ).toMatchObject([{ enabled: true }]);
    expect(
      (await db.select({ id: schema.userTable.id }).from(schema.userTable))
        .map((row) => row.id)
        .sort(),
    ).toEqual(userIds);
    expect(
      (
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(sessionIds);
  });
  it("narrow catalogue repair is idempotent, scoped, and never touches account/session/item records", async () => {
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.slug, "HELP"));
    if (!project) throw new Error("SIT project missing");
    const snapshot = async () => ({
      users: await db
        .select()
        .from(schema.userTable)
        .orderBy(schema.userTable.id),
      sessions: await db
        .select()
        .from(schema.sessionTable)
        .orderBy(schema.sessionTable.id),
      items: await db
        .select()
        .from(schema.workItemTable)
        .orderBy(schema.workItemTable.id),
      labels: await db
        .select()
        .from(schema.labelTable)
        .orderBy(schema.labelTable.id),
      links: await db
        .select()
        .from(schema.workItemLabelTable)
        .orderBy(
          schema.workItemLabelTable.workItemId,
          schema.workItemLabelTable.labelId,
        ),
      tasks: await db
        .select()
        .from(schema.taskTable)
        .orderBy(schema.taskTable.id),
    });
    await db
      .delete(schema.labelTable)
      .where(
        inArray(schema.labelTable.id, [
          "sit-label-access",
          "sit-label-incident",
          "sit-label-help-change",
          "sit-label-help-customer",
        ]),
      );
    const before = await snapshot();
    const results = await Promise.all(
      [1, 2].map(() =>
        db.transaction((tx) =>
          seedSitLabelCatalogue(
            tx,
            project.workspaceId,
            project.id,
            new Date(),
          ),
        ),
      ),
    );
    expect(
      results.sort(
        (left, right) => right.definitionsInserted - left.definitionsInserted,
      ),
    ).toEqual([
      { definitionsInserted: 4, linksInserted: 10 },
      { definitionsInserted: 0, linksInserted: 0 },
    ]);
    const repaired = await snapshot();
    expect(repaired.users).toEqual(before.users);
    expect(repaired.sessions).toEqual(before.sessions);
    expect(repaired.items).toEqual(before.items);
    expect(repaired.tasks).toEqual(before.tasks);
    expect(repaired.labels).toHaveLength(before.labels.length + 4);
    expect(repaired.labels).toEqual(expect.arrayContaining(before.labels));
    expect(repaired.links).toHaveLength(before.links.length + 10);
    expect(repaired.links).toEqual(expect.arrayContaining(before.links));
    expect(
      await db.transaction((tx) =>
        seedSitLabelCatalogue(tx, project.workspaceId, project.id, new Date()),
      ),
    ).toEqual({ definitionsInserted: 0, linksInserted: 0 });
    expect(await snapshot()).toEqual(repaired);
    await expect(
      db.transaction((tx) =>
        seedSitLabelCatalogue(tx, "foreign-workspace", project.id, new Date()),
      ),
    ).rejects.toThrow("seven original HELP examples");
    expect(await snapshot()).toEqual(repaired);
  });
  it("refuses an existing configured catalogue name instead of adopting or overwriting it", async () => {
    const [project] = await db
      .select()
      .from(schema.projectTable)
      .where(eq(schema.projectTable.slug, "HELP"));
    if (!project) throw new Error("SIT project missing");
    await db
      .delete(schema.labelTable)
      .where(eq(schema.labelTable.id, "sit-label-incident"));
    await db.insert(schema.labelTable).values({
      id: "customer-incident-definition",
      workspaceId: project.workspaceId,
      name: "Incident",
      color: "orange",
    });
    const before = await db
      .select()
      .from(schema.labelTable)
      .orderBy(schema.labelTable.id);
    await expect(
      db.transaction((tx) =>
        seedSitLabelCatalogue(tx, project.workspaceId, project.id, new Date()),
      ),
    ).rejects.toThrow("collides with configured catalogue data");
    expect(
      await db.select().from(schema.labelTable).orderBy(schema.labelTable.id),
    ).toEqual(before);
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.id, "sit-label-incident")),
    ).toEqual([]);
  });
});
