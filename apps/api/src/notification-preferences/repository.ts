import { and, asc, eq, inArray, or } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { reachableWorkspacePredicate } from "../utils/workspace-access-middleware";

export async function findWorkspaceMembership(
  userId: string,
  workspaceId: string,
) {
  const [membership] = await db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        eq(workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return membership;
}

export async function listSelectedProjects(
  workspaceId: string,
  selectedProjectIds: string[],
) {
  return await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(projectTable.id, selectedProjectIds),
      ),
    );
}

export async function findNotificationPreference(userId: string) {
  return await db.query.userNotificationPreferenceTable.findFirst({
    where: eq(userNotificationPreferenceTable.userId, userId),
  });
}

export async function getReachableWorkspaceRules(userId: string) {
  return await db
    .select({
      rule: userNotificationWorkspaceRuleTable,
      workspaceName: workspaceTable.name,
    })
    .from(userNotificationWorkspaceRuleTable)
    .innerJoin(
      workspaceTable,
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceTable.id),
    )
    .where(
      and(
        eq(userNotificationWorkspaceRuleTable.userId, userId),
        reachableWorkspacePredicate(workspaceTable.id, userId),
      ),
    )
    .orderBy(asc(userNotificationWorkspaceRuleTable.createdAt));
}

export async function getSelectedWorkspaceProjects(workspaceRuleIds: string[]) {
  return await db
    .select({
      workspaceRuleId: userNotificationWorkspaceProjectTable.workspaceRuleId,
      projectId: userNotificationWorkspaceProjectTable.projectId,
    })
    .from(userNotificationWorkspaceProjectTable)
    .where(
      inArray(
        userNotificationWorkspaceProjectTable.workspaceRuleId,
        workspaceRuleIds,
      ),
    );
}

export async function updateNotificationPreference(
  userId: string,
  data: typeof userNotificationPreferenceTable.$inferInsert,
  updatedAt: Date,
) {
  await db
    .update(userNotificationPreferenceTable)
    .set({
      ...data,
      updatedAt,
    })
    .where(eq(userNotificationPreferenceTable.userId, userId));
}

export async function insertNotificationPreference(
  data: typeof userNotificationPreferenceTable.$inferInsert,
) {
  await db.insert(userNotificationPreferenceTable).values(data);
}

export async function updateActiveWorkspaceRules(
  userId: string,
  updates: Partial<typeof userNotificationWorkspaceRuleTable.$inferInsert>,
  updatedAt: Date,
) {
  await db
    .update(userNotificationWorkspaceRuleTable)
    .set({
      ...updates,
      updatedAt,
    })
    .where(
      and(
        eq(userNotificationWorkspaceRuleTable.userId, userId),
        eq(userNotificationWorkspaceRuleTable.isActive, true),
        or(
          eq(userNotificationWorkspaceRuleTable.emailEnabled, true),
          eq(userNotificationWorkspaceRuleTable.ntfyEnabled, true),
          eq(userNotificationWorkspaceRuleTable.gotifyEnabled, true),
          eq(userNotificationWorkspaceRuleTable.webhookEnabled, true),
        ),
      ),
    );
}

export async function findWorkspaceRule(userId: string, workspaceId: string) {
  return await db.query.userNotificationWorkspaceRuleTable.findFirst({
    where: and(
      eq(userNotificationWorkspaceRuleTable.userId, userId),
      eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceId),
    ),
  });
}

export async function updateWorkspaceRule(
  ruleId: string,
  input: Pick<
    typeof userNotificationWorkspaceRuleTable.$inferInsert,
    | "isActive"
    | "emailEnabled"
    | "ntfyEnabled"
    | "gotifyEnabled"
    | "webhookEnabled"
    | "projectMode"
  >,
  updatedAt: Date,
) {
  await db
    .update(userNotificationWorkspaceRuleTable)
    .set({
      isActive: input.isActive,
      emailEnabled: input.emailEnabled,
      ntfyEnabled: input.ntfyEnabled,
      gotifyEnabled: input.gotifyEnabled,
      webhookEnabled: input.webhookEnabled,
      projectMode: input.projectMode,
      updatedAt,
    })
    .where(eq(userNotificationWorkspaceRuleTable.id, ruleId));
}

export async function insertWorkspaceRule(
  userId: string,
  workspaceId: string,
  input: Pick<
    typeof userNotificationWorkspaceRuleTable.$inferInsert,
    | "isActive"
    | "emailEnabled"
    | "ntfyEnabled"
    | "gotifyEnabled"
    | "webhookEnabled"
    | "projectMode"
  >,
) {
  const [createdRule] = await db
    .insert(userNotificationWorkspaceRuleTable)
    .values({
      userId,
      workspaceId,
      isActive: input.isActive,
      emailEnabled: input.emailEnabled,
      ntfyEnabled: input.ntfyEnabled,
      gotifyEnabled: input.gotifyEnabled,
      webhookEnabled: input.webhookEnabled,
      projectMode: input.projectMode,
    })
    .returning({ id: userNotificationWorkspaceRuleTable.id });
  return createdRule?.id;
}

export async function deleteWorkspaceProjectsForRule(workspaceRuleId: string) {
  await db
    .delete(userNotificationWorkspaceProjectTable)
    .where(
      eq(
        userNotificationWorkspaceProjectTable.workspaceRuleId,
        workspaceRuleId,
      ),
    );
}

export async function insertWorkspaceRuleProjects(
  workspaceId: string,
  workspaceRuleId: string,
  projectIds: string[],
) {
  await db.insert(userNotificationWorkspaceProjectTable).values(
    projectIds.map((projectId) => ({
      workspaceId,
      workspaceRuleId,
      projectId,
    })),
  );
}

export async function deleteWorkspaceRuleById(ruleId: string) {
  await db
    .delete(userNotificationWorkspaceRuleTable)
    .where(eq(userNotificationWorkspaceRuleTable.id, ruleId));
}
