import { relations } from "drizzle-orm";
import {
  accountTable,
  activityTable,
  apikeyTable,
  assetTable,
  columnTable,
  commentTable,
  externalLinkTable,
  invitationTable,
  labelTable,
  membershipTable,
  notificationTable,
  organisationQuotaTable,
  organisationTable,
  personTable,
  projectSlugClaimTable,
  projectTable,
  roleTable,
  sessionTable,
  stateTable,
  stateTemplateTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  verificationTable,
  watcherTable,
  workflowRuleTable,
  workItemKeyAliasTable,
  workItemKeyClaimTable,
  workItemTable,
  workItemTypeTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "./schema";

export const userTableRelations = relations(userTable, ({ many, one }) => ({
  sessions: many(sessionTable),
  accounts: many(accountTable),
  teamMembers: many(teamMemberTable),
  workspaceMemberships: many(workspaceUserTable),
  assignedTasks: many(taskTable),
  timeEntries: many(timeEntryTable),
  activities: many(activityTable),
  comments: many(commentTable),
  assets: many(assetTable),
  notifications: many(notificationTable),
  notificationPreference: one(userNotificationPreferenceTable),
  notificationWorkspaceRules: many(userNotificationWorkspaceRuleTable),
  sentInvitations: many(invitationTable),
  apikeys: many(apikeyTable),
}));

export const sessionTableRelations = relations(sessionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [sessionTable.userId],
    references: [userTable.id],
  }),
}));

export const accountTableRelations = relations(accountTable, ({ one }) => ({
  user: one(userTable, {
    fields: [accountTable.userId],
    references: [userTable.id],
  }),
}));

export const verificationTableRelations = relations(
  verificationTable,
  () => ({}),
);

export const workspaceTableRelations = relations(
  workspaceTable,
  ({ many }) => ({
    teams: many(teamTable),
    members: many(workspaceUserTable),
    projects: many(projectTable),
    assets: many(assetTable),
    invitations: many(invitationTable),
    notificationWorkspaceRules: many(userNotificationWorkspaceRuleTable),
  }),
);

export const workspaceUserTableRelations = relations(
  workspaceUserTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [workspaceUserTable.workspaceId],
      references: [workspaceTable.id],
    }),
    user: one(userTable, {
      fields: [workspaceUserTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const projectTableRelations = relations(
  projectTable,
  ({ one, many }) => ({
    workspace: one(workspaceTable, {
      fields: [projectTable.workspaceId],
      references: [workspaceTable.id],
    }),
    tasks: many(taskTable),
    assets: many(assetTable),
    columns: many(columnTable),
    workflowRules: many(workflowRuleTable),
    notificationWorkspaceProjects: many(userNotificationWorkspaceProjectTable),
  }),
);

// #261 F1's delta-confirmation (D1) -- query-API sugar only, not backed by a real FK (see
// `projectSlugClaimTable`'s own schema.ts comment for why that table carries no
// `.references()` back to `project.id`, mirroring `workItemKeyClaimTable`'s identical
// reasoning below).
export const projectSlugClaimTableRelations = relations(
  projectSlugClaimTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [projectSlugClaimTable.projectId],
      references: [projectTable.id],
    }),
  }),
);

export const columnTableRelations = relations(columnTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [columnTable.projectId],
    references: [projectTable.id],
  }),
  tasks: many(taskTable),
  workflowRules: many(workflowRuleTable),
}));

export const workflowRuleTableRelations = relations(
  workflowRuleTable,
  ({ one }) => ({
    project: one(projectTable, {
      fields: [workflowRuleTable.projectId],
      references: [projectTable.id],
    }),
    column: one(columnTable, {
      fields: [workflowRuleTable.columnId],
      references: [columnTable.id],
    }),
  }),
);

export const taskTableRelations = relations(taskTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [taskTable.projectId],
    references: [projectTable.id],
  }),
  assignee: one(userTable, {
    fields: [taskTable.userId],
    references: [userTable.id],
  }),
  column: one(columnTable, {
    fields: [taskTable.columnId],
    references: [columnTable.id],
  }),
  timeEntries: many(timeEntryTable),
  activities: many(activityTable),
  comments: many(commentTable),
  assets: many(assetTable),
  labels: many(labelTable),
  externalLinks: many(externalLinkTable),
  sourceRelations: many(taskRelationTable, { relationName: "sourceTask" }),
  targetRelations: many(taskRelationTable, { relationName: "targetTask" }),
  remindersSent: many(taskReminderSentTable),
}));

export const timeEntryTableRelations = relations(timeEntryTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [timeEntryTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [timeEntryTable.userId],
    references: [userTable.id],
  }),
}));

export const activityTableRelations = relations(activityTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [activityTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [activityTable.userId],
    references: [userTable.id],
  }),
}));

export const assetTableRelations = relations(assetTable, ({ one }) => ({
  workspace: one(workspaceTable, {
    fields: [assetTable.workspaceId],
    references: [workspaceTable.id],
  }),
  project: one(projectTable, {
    fields: [assetTable.projectId],
    references: [projectTable.id],
  }),
  task: one(taskTable, {
    fields: [assetTable.taskId],
    references: [taskTable.id],
  }),
  activity: one(activityTable, {
    fields: [assetTable.activityId],
    references: [activityTable.id],
  }),
  creator: one(userTable, {
    fields: [assetTable.createdBy],
    references: [userTable.id],
  }),
}));

export const labelTableRelations = relations(labelTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [labelTable.taskId],
    references: [taskTable.id],
  }),
}));

export const notificationTableRelations = relations(
  notificationTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [notificationTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const userNotificationPreferenceTableRelations = relations(
  userNotificationPreferenceTable,
  ({ one }) => ({
    user: one(userTable, {
      fields: [userNotificationPreferenceTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const userNotificationWorkspaceRuleTableRelations = relations(
  userNotificationWorkspaceRuleTable,
  ({ one, many }) => ({
    user: one(userTable, {
      fields: [userNotificationWorkspaceRuleTable.userId],
      references: [userTable.id],
    }),
    workspace: one(workspaceTable, {
      fields: [userNotificationWorkspaceRuleTable.workspaceId],
      references: [workspaceTable.id],
    }),
    selectedProjects: many(userNotificationWorkspaceProjectTable),
  }),
);

export const userNotificationWorkspaceProjectTableRelations = relations(
  userNotificationWorkspaceProjectTable,
  ({ one }) => ({
    workspaceRule: one(userNotificationWorkspaceRuleTable, {
      fields: [
        userNotificationWorkspaceProjectTable.workspaceId,
        userNotificationWorkspaceProjectTable.workspaceRuleId,
      ],
      references: [
        userNotificationWorkspaceRuleTable.workspaceId,
        userNotificationWorkspaceRuleTable.id,
      ],
    }),
    project: one(projectTable, {
      fields: [
        userNotificationWorkspaceProjectTable.workspaceId,
        userNotificationWorkspaceProjectTable.projectId,
      ],
      references: [projectTable.workspaceId, projectTable.id],
    }),
  }),
);

export const teamTableRelations = relations(teamTable, ({ one, many }) => ({
  workspace: one(workspaceTable, {
    fields: [teamTable.workspaceId],
    references: [workspaceTable.id],
  }),
  teamMembers: many(teamMemberTable),
}));

export const teamMemberTableRelations = relations(
  teamMemberTable,
  ({ one }) => ({
    team: one(teamTable, {
      fields: [teamMemberTable.teamId],
      references: [teamTable.id],
    }),
    user: one(userTable, {
      fields: [teamMemberTable.userId],
      references: [userTable.id],
    }),
  }),
);

export const invitationTableRelations = relations(
  invitationTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [invitationTable.workspaceId],
      references: [workspaceTable.id],
    }),
    inviter: one(userTable, {
      fields: [invitationTable.inviterId],
      references: [userTable.id],
    }),
  }),
);

export const workspaceRoleTableRelations = relations(
  workspaceRoleTable,
  ({ one }) => ({
    workspace: one(workspaceTable, {
      fields: [workspaceRoleTable.workspaceId],
      references: [workspaceTable.id],
    }),
  }),
);

export const apikeyTableRelations = relations(apikeyTable, ({ one }) => ({
  user: one(userTable, {
    fields: [apikeyTable.referenceId],
    references: [userTable.id],
  }),
}));

export const taskRelationTableRelations = relations(
  taskRelationTable,
  ({ one }) => ({
    sourceTask: one(taskTable, {
      fields: [taskRelationTable.sourceTaskId],
      references: [taskTable.id],
      relationName: "sourceTask",
    }),
    targetTask: one(taskTable, {
      fields: [taskRelationTable.targetTaskId],
      references: [taskTable.id],
      relationName: "targetTask",
    }),
  }),
);

export const externalLinkTableRelations = relations(
  externalLinkTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [externalLinkTable.taskId],
      references: [taskTable.id],
    }),
  }),
);

export const taskReminderSentTableRelations = relations(
  taskReminderSentTable,
  ({ one }) => ({
    task: one(taskTable, {
      fields: [taskReminderSentTable.taskId],
      references: [taskTable.id],
    }),
  }),
);

export const commentTableRelations = relations(commentTable, ({ one }) => ({
  task: one(taskTable, {
    fields: [commentTable.taskId],
    references: [taskTable.id],
  }),
  user: one(userTable, {
    fields: [commentTable.userId],
    references: [userTable.id],
  }),
}));

// P1 foundational identity schema (data-model.md §2) -- see schema.ts for the full note.

export const organisationTableRelations = relations(
  organisationTable,
  ({ one, many }) => ({
    quota: one(organisationQuotaTable),
    persons: many(personTable),
  }),
);

export const personTableRelations = relations(personTable, ({ one, many }) => ({
  user: one(userTable, {
    fields: [personTable.userId],
    references: [userTable.id],
  }),
  organisation: one(organisationTable, {
    fields: [personTable.organisationId],
    references: [organisationTable.id],
  }),
  memberships: many(membershipTable),
}));

export const organisationQuotaTableRelations = relations(
  organisationQuotaTable,
  ({ one }) => ({
    organisation: one(organisationTable, {
      fields: [organisationQuotaTable.organisationId],
      references: [organisationTable.id],
    }),
    updatedByPerson: one(personTable, {
      fields: [organisationQuotaTable.updatedBy],
      references: [personTable.id],
    }),
  }),
);

export const roleTableRelations = relations(roleTable, ({ one, many }) => ({
  workspace: one(workspaceTable, {
    fields: [roleTable.workspaceId],
    references: [workspaceTable.id],
  }),
  memberships: many(membershipTable),
}));

export const membershipTableRelations = relations(
  membershipTable,
  ({ one }) => ({
    person: one(personTable, {
      fields: [membershipTable.personId],
      references: [personTable.id],
    }),
    role: one(roleTable, {
      fields: [membershipTable.roleId],
      references: [roleTable.id],
    }),
  }),
);

export const workItemTypeTableRelations = relations(
  workItemTypeTable,
  ({ one, many }) => ({
    workspace: one(workspaceTable, {
      fields: [workItemTypeTable.workspaceId],
      references: [workspaceTable.id],
    }),
    workItems: many(workItemTable),
  }),
);

export const stateTemplateTableRelations = relations(
  stateTemplateTable,
  ({ one, many }) => ({
    workspace: one(workspaceTable, {
      fields: [stateTemplateTable.workspaceId],
      references: [workspaceTable.id],
    }),
    states: many(stateTable),
  }),
);

export const stateTableRelations = relations(stateTable, ({ one, many }) => ({
  project: one(projectTable, {
    fields: [stateTable.projectId],
    references: [projectTable.id],
  }),
  stateTemplate: one(stateTemplateTable, {
    fields: [stateTable.stateTemplateId],
    references: [stateTemplateTable.id],
  }),
  workItems: many(workItemTable),
}));

export const workItemTableRelations = relations(
  workItemTable,
  ({ one, many }) => ({
    project: one(projectTable, {
      fields: [workItemTable.projectId],
      references: [projectTable.id],
    }),
    type: one(workItemTypeTable, {
      fields: [workItemTable.typeId],
      references: [workItemTypeTable.id],
    }),
    state: one(stateTable, {
      fields: [workItemTable.stateId],
      references: [stateTable.id],
    }),
    assignee: one(personTable, {
      fields: [workItemTable.assigneeId],
      references: [personTable.id],
    }),
    requester: one(personTable, {
      fields: [workItemTable.requesterId],
      references: [personTable.id],
    }),
    parent: one(workItemTable, {
      fields: [workItemTable.parentId],
      references: [workItemTable.id],
      relationName: "workItemParent",
    }),
    children: many(workItemTable, { relationName: "workItemParent" }),
    keyAliases: many(workItemKeyAliasTable),
    watchers: many(watcherTable),
  }),
);

export const workItemKeyAliasTableRelations = relations(
  workItemKeyAliasTable,
  ({ one }) => ({
    workItem: one(workItemTable, {
      fields: [workItemKeyAliasTable.workItemId],
      references: [workItemTable.id],
    }),
  }),
);

// #191 O2 -- query-API sugar only, not backed by a real FK (see
// `workItemKeyClaimTable`'s own schema.ts comment for why that table carries no
// `.references()` back to `work_item.id`).
export const workItemKeyClaimTableRelations = relations(
  workItemKeyClaimTable,
  ({ one }) => ({
    workItem: one(workItemTable, {
      fields: [workItemKeyClaimTable.workItemId],
      references: [workItemTable.id],
    }),
  }),
);

export const watcherTableRelations = relations(watcherTable, ({ one }) => ({
  workItem: one(workItemTable, {
    fields: [watcherTable.workItemId],
    references: [workItemTable.id],
  }),
  person: one(personTable, {
    fields: [watcherTable.personId],
    references: [personTable.id],
  }),
}));
