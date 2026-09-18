import { createId } from "@paralleldrive/cuid2";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const userTable = pgTable("user", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  locale: text("locale"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date" }),
});

export const sessionTable = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeTeamId: text("active_team_id"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const accountTable = pgTable(
  "account",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const userAvatarTable = pgTable(
  "user_avatar",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique("user_avatar_user_id_unique")
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("user_avatar_userId_idx").on(table.userId)],
);

export const verificationTable = pgTable(
  "verification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const workspaceTable = pgTable("workspace", {
  id: text("id")
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull(),
});

export const workspaceUserTable = pgTable(
  "workspace_member",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
      }),
    role: text("role").default("member").notNull(),
    joinedAt: timestamp("joined_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("workspace_member_workspaceId_idx").on(table.workspaceId),
    index("workspace_member_userId_idx").on(table.userId),
  ],
);

export const teamTable = pgTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(
      () => /* @__PURE__ */ new Date(),
    ),
  },
  (table) => [index("team_workspaceId_idx").on(table.workspaceId)],
);

export const teamMemberTable = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teamTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("teamMember_teamId_idx").on(table.teamId),
    index("teamMember_userId_idx").on(table.userId),
  ],
);

export const invitationTable = pgTable(
  "invitation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    teamId: text("team_id"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_workspaceId_idx").on(table.workspaceId),
    index("invitation_email_idx").on(table.email),
    index("invitation_inviterId_idx").on(table.inviterId),
  ],
);

export const workspaceRoleTable = pgTable(
  "workspace_role",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: text("role").notNull(),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workspace_role_workspaceId_idx").on(table.workspaceId),
    index("workspace_role_role_idx").on(table.role),
  ],
);

export const projectTable = pgTable(
  "project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    slug: text("slug").notNull(),
    icon: text("icon").default("Layout"),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    // #187: soft delete. `deletedAt`/`purgeAfter` mirror `organisationTable`'s own pair
    // (PR #179) -- nullable, no default, set together by the delete route
    // (`purgeAfter` = delete time + 30 days, `docs/03-features/projects-and-engagements.md`
    // PR-16). Independent of `archivedAt`: archiving does not start this timer, and a
    // project need not be archived before it can be deleted. Nothing purges on
    // `purgeAfter` yet -- that job is #198, tracked separately, same as the still-unbuilt
    // purge for `organisationTable`'s columns.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    purgeAfter: timestamp("purge_after", { mode: "date" }),
    lastTaskNumber: integer("last_task_number").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    unique("project_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("project_workspaceId_position_idx").on(
      table.workspaceId,
      table.position,
    ),
  ],
);

export const columnTable = pgTable(
  "column",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    position: integer("position").notNull().default(0),
    icon: text("icon"),
    color: text("color"),
    isFinal: boolean("is_final").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("column_projectId_idx").on(table.projectId)],
);

export const workflowRuleTable = pgTable(
  "workflow_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    integrationType: text("integration_type").notNull(),
    eventType: text("event_type").notNull(),
    columnId: text("column_id")
      .notNull()
      .references(() => columnTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("workflow_rule_projectId_idx").on(table.projectId),
    index("workflow_rule_columnId_idx").on(table.columnId),
  ],
);

export const taskTable = pgTable(
  "task",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    position: integer("position").default(0),
    number: integer("number").default(1),
    userId: text("assignee_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("to-do"),
    columnId: text("column_id").references(() => columnTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    priority: text("priority").default("low").notNull(),
    startDate: timestamp("start_date", { mode: "date" }),
    dueDate: timestamp("due_date", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    index("task_dueDate_idx").on(table.dueDate),
    index("task_assigneeId_idx").on(table.userId),
    index("task_columnId_idx").on(table.columnId),
    unique("task_project_number_unique").on(table.projectId, table.number),
  ],
);

export const jobLeaseTable = pgTable("job_lease", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
});

export const taskReminderSentTable = pgTable(
  "task_reminder_sent",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    reminderType: text("reminder_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_reminder_sent_taskId_idx").on(table.taskId),
    unique("task_reminder_sent_task_type_unique").on(
      table.taskId,
      table.reminderType,
    ),
  ],
);

export const timeEntryTable = pgTable(
  "time_entry",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    description: text("description"),
    startTime: timestamp("start_time", { mode: "date" }).notNull(),
    endTime: timestamp("end_time", { mode: "date" }),
    duration: integer("duration").default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("time_entry_taskId_idx").on(table.taskId),
    index("time_entry_userId_idx").on(table.userId),
  ],
);

export const activityTable = pgTable(
  "activity",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text("type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    content: text("content"),
    eventData: jsonb("event_data"),
    externalUserName: text("external_user_name"),
    externalUserAvatar: text("external_user_avatar"),
    externalSource: text("external_source"),
    externalUrl: text("external_url"),
  },
  (table) => [
    index("activity_task_id_idx").on(table.taskId),
    index("activity_userId_idx").on(table.userId),
    unique("activity_task_external_source_external_url_unique").on(
      table.taskId,
      table.externalSource,
      table.externalUrl,
    ),
  ],
);

export const assetTable = pgTable(
  "asset",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    activityId: text("activity_id").references(() => activityTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    objectKey: text("object_key").notNull().unique(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    kind: text("kind").notNull().default("image"),
    surface: text("surface").notNull().default("description"),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("asset_workspaceId_idx").on(table.workspaceId),
    index("asset_projectId_idx").on(table.projectId),
    index("asset_taskId_idx").on(table.taskId),
    index("asset_activityId_idx").on(table.activityId),
    index("asset_createdBy_idx").on(table.createdBy),
  ],
);

export const labelTable = pgTable(
  "label",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("label_task_id_idx").on(table.taskId),
    index("label_workspace_id_idx").on(table.workspaceId),
    unique("label_task_name_unique").on(table.taskId, table.name),
    uniqueIndex("label_workspace_name_unique")
      .on(table.workspaceId, table.name)
      .where(sql`${table.taskId} is null`),
  ],
);

export const notificationTable = pgTable(
  "notification",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text("title"),
    content: text("content"),
    type: text("type").notNull().default("info"),
    eventData: jsonb("event_data"),
    isRead: boolean("is_read").default(false),
    resourceId: text("resource_id"),
    resourceType: text("resource_type"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("notification_userId_idx").on(table.userId)],
);

export const userNotificationPreferenceTable = pgTable(
  "user_notification_preference",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    ntfyServerUrl: text("ntfy_server_url"),
    ntfyTopic: text("ntfy_topic"),
    ntfyToken: text("ntfy_token"),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    gotifyServerUrl: text("gotify_server_url"),
    gotifyToken: text("gotify_token"),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecret: text("webhook_secret"),
    taskAssignmentEnabled: boolean("task_assignment_enabled")
      .default(true)
      .notNull(),
    taskCommentEnabled: boolean("task_comment_enabled").default(true).notNull(),
    taskStatusChangeEnabled: boolean("task_status_change_enabled")
      .default(true)
      .notNull(),
    dueDateReminderEnabled: boolean("due_date_reminder_enabled")
      .default(true)
      .notNull(),
    dueDateReminderLeadTimeMinutes: integer(
      "due_date_reminder_lead_time_minutes",
    )
      .default(1440)
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
);

export const userNotificationWorkspaceRuleTable = pgTable(
  "user_notification_workspace_rule",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    isActive: boolean("is_active").default(true).notNull(),
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    ntfyEnabled: boolean("ntfy_enabled").default(false).notNull(),
    gotifyEnabled: boolean("gotify_enabled").default(false).notNull(),
    webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
    projectMode: text("project_mode").default("all").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_notification_workspace_rule_userId_idx").on(table.userId),
    index("user_notification_workspace_rule_workspaceId_idx").on(
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_user_workspace_unique").on(
      table.userId,
      table.workspaceId,
    ),
    unique("user_notification_workspace_rule_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
  ],
);

export const userNotificationWorkspaceProjectTable = pgTable(
  "user_notification_workspace_project",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceRuleId: text("workspace_rule_id").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.workspaceRuleId],
      foreignColumns: [
        userNotificationWorkspaceRuleTable.workspaceId,
        userNotificationWorkspaceRuleTable.id,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("user_notification_workspace_project_ruleId_idx").on(
      table.workspaceRuleId,
    ),
    index("user_notification_workspace_project_projectId_idx").on(
      table.projectId,
    ),
    index("user_notification_workspace_project_workspaceId_projectId_idx").on(
      table.workspaceId,
      table.projectId,
    ),
    index("unwp_workspaceId_workspaceRuleId_idx").on(
      table.workspaceId,
      table.workspaceRuleId,
    ),
    unique("user_notification_workspace_project_rule_project_unique").on(
      table.workspaceRuleId,
      table.projectId,
    ),
  ],
);

export const externalLinkTable = pgTable(
  "external_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    resourceType: text("resource_type").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("external_link_taskId_idx").on(table.taskId),
    index("external_link_externalId_idx").on(table.externalId),
    index("external_link_resourceType_idx").on(table.resourceType),
  ],
);

export const commentTable = pgTable(
  "comment",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_task_idx").on(table.taskId),
    index("comment_user_idx").on(table.userId),
  ],
);

export const taskRelationTable = pgTable(
  "task_relation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    sourceTaskId: text("source_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    targetTaskId: text("target_task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("task_relation_source_idx").on(table.sourceTaskId),
    index("task_relation_target_idx").on(table.targetTaskId),
  ],
);

export const apikeyTable = pgTable(
  "apikey",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    key: text("key").notNull(),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { mode: "date" }),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { mode: "date" }),
    expiresAt: timestamp("expires_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_key_idx").on(table.key),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_userId_idx").on(table.userId),
  ],
);

// P1 foundational identity schema (`data-model.md` §2: organisation, organisation_quota,
// person, membership, role) — decision log 2026-09-16 "P1's foundational identity schema".
// Purely additive: new tables only, ahead of #23/#25, which both need `person` to exist.
// Deliberately NOT wired to any route/policy/resolveIdentity yet (out of scope here), and
// deliberately NOT reconciling `workspace`/`team`/`invitation`/`workspace_role` with this
// shape (#173, tracked separately).

export const organisationTable = pgTable(
  "organisation",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    isInternal: boolean("is_internal").default(false).notNull(),
    domain: text("domain").array(),
    active: boolean("active").default(true).notNull(),
    portalAccess: boolean("portal_access").default(true).notNull(),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    purgeAfter: timestamp("purge_after", { mode: "date" }),
    defaultCustomerVisibility: text("default_customer_visibility")
      .default("organisation")
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // multi-tenancy.md: "Exactly one organisation is marked `is_internal`" — a partial
    // unique index enforces at most one; the seed is what makes it exactly one.
    uniqueIndex("organisation_is_internal_unique")
      .on(table.isInternal)
      .where(sql`${table.isInternal} = true`),
  ],
);

// data-model.md §2: "An **open** row (`lifted_at is null`) suspends `audit-purge`, the
// soft-delete purge in `session-cleanup`, `attachment-gc` and every hard delete for that
// scope." `data-protection.md` § Legal hold is the operator-facing account of the same
// thing (the God Mode *Place on hold* action).
//
// Read today, by `apps/api/src/scheduler/session-cleanup.ts`; not yet written, because
// placing a hold is specified as audited (`legal_hold.placed` / `legal_hold.lifted`) and
// this repository has no audit-log write path yet -- there is no `audit_log` table and no
// appender anywhere in `apps/api`. The table lands first so the purge is correct by
// construction rather than being patched to honour holds later; placing and lifting follow
// the audit-log writer (issue #37's remaining scope), tracked on #198. A hold inserted
// directly by SQL is already honoured, which is what its integration test does.
//
// Columns are exactly `data-model.md` §2's list for this table. That list does not name
// `created_at`/`updated_at`, which the same document's Conventions section asks of tables
// generally, so the two readings disagree and this follows the per-table one: it is the more
// specific statement, and do-not 11 makes `data-model.md` the authority for a table's columns.
// `placed_at`/`lifted_at` are the timestamps that carry meaning here (`lifted_at IS NULL` is
// what "open" means). Recorded as a choice rather than left as an unexplained omission — an
// independent review of #208 asked, and the document does not settle it.
export const legalHoldTable = pgTable(
  "legal_hold",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    // `organisation` | `person` -- a CHECK rather than free text, per data-model.md's
    // "never free text" convention for closed vocabularies. Restricted here and nowhere
    // else, because both the purge and (later) the placement route branch on it.
    scope: text("scope").notNull(),
    // The `organisation.id` or `person.id` the hold applies to. Deliberately NOT a foreign
    // key: one column cannot reference two tables, and data-model.md specifies a single
    // polymorphic `scope_id`. The purge resolves it per scope, and a scope_id naming a row
    // that no longer exists simply matches nothing.
    scopeId: text("scope_id").notNull(),
    // The acting user's id. Not yet an FK to `person`: `resolveIdentity` -- the thing that
    // turns a session into a person -- does not exist in `apps/api` yet, so there is no
    // reliable person id to store at the point this is written.
    placedBy: text("placed_by").notNull(),
    placedAt: timestamp("placed_at", { mode: "date" }).defaultNow().notNull(),
    reason: text("reason").notNull(),
    liftedBy: text("lifted_by"),
    liftedAt: timestamp("lifted_at", { mode: "date" }),
  },
  (table) => [
    // data-model.md § Indexing: "create unique index on legal_hold (scope, scope_id) where
    // lifted_at is null" -- at most one OPEN hold per scope. Lifting and re-placing is
    // therefore always possible; two simultaneous open holds on one scope never are.
    uniqueIndex("legal_hold_scope_scope_id_open_unique")
      .on(table.scope, table.scopeId)
      .where(sql`${table.liftedAt} is null`),
    check(
      "legal_hold_scope_check",
      sql`${table.scope} in ('organisation', 'person')`,
    ),
  ],
);

export const personTable = pgTable(
  "person",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    // Nullable: a placeholder person (import-created, no login) has none yet, and a
    // person whose user account is later hard-deleted through the elevated
    // erasure/anonymisation process (auth-and-identity.md) keeps their authored history
    // with this column nulled rather than the row disappearing.
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    // "person.organisation_id is fixed at creation and never changes" (data-model.md §2) --
    // an application-level invariant (no route/mutation exists to change it, out of scope
    // here); cascade on delete because a person only ever exists in the context of its
    // organisation, the same as every other organisation-scoped row security-model.md's
    // "Organisation hard delete purges" list names.
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisationTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    side: text("side").notNull(),
    jobTitle: text("job_title"),
    active: boolean("active").default(true).notNull(),
    isPlaceholder: boolean("is_placeholder").default(false).notNull(),
    locale: text("locale"),
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    quietHoursTimezone: text("quiet_hours_timezone"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("person_userId_idx").on(table.userId),
    index("person_organisationId_idx").on(table.organisationId),
    // Global, not scoped per organisation: one `user_id` may back at most one `person`
    // row anywhere. multi-tenancy.md names two `person` rows reachable from the same
    // login as the exact ambiguity this schema exists to prevent -- resolveIdentity
    // (auth-and-identity.md) is keyed and cached by `user_id` and returns a single
    // `personId`/`organisationId`/`side`, so a second row behind the same `user_id` would
    // resolve arbitrarily. A person who genuinely needs both a staff and a customer
    // identity gets two separate `user` rows (multi-tenancy.md's "two person rows, never
    // linked"), not two `person` rows sharing one `user_id`. This does not conflict with
    // data-model.md's "two person rows in different organisations may carry the same
    // address" -- that sentence is about the `user.email` attribute being shared across
    // two DIFFERENT `user` rows, not about one `user_id` appearing in two `person` rows.
    uniqueIndex("person_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
  ],
);

export const organisationQuotaTable = pgTable(
  "organisation_quota",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    organisationId: text("organisation_id")
      .notNull()
      .unique("organisation_quota_organisation_id_unique")
      .references(() => organisationTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    maxProjects: integer("max_projects").default(200).notNull(),
    maxWorkItems: integer("max_work_items").default(500_000).notNull(),
    // 20 GiB in bytes exceeds Postgres `integer`'s ~2.1B range, hence bigint.
    maxStorageBytes: bigint("max_storage_bytes", { mode: "number" })
      .default(21_474_836_480)
      .notNull(),
    maxPortalUsers: integer("max_portal_users").default(500).notNull(),
    maxApiRequestsPerMinute: integer("max_api_requests_per_minute")
      .default(600)
      .notNull(),
    maxWebhooks: integer("max_webhooks").default(10).notNull(),
    // Nullable, set-null on delete: who last changed the limits is bookkeeping, never a
    // reason to block deleting that person.
    updatedBy: text("updated_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("organisation_quota_organisationId_idx").on(table.organisationId),
  ],
);

export const roleTable = pgTable(
  "role",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    scope: text("scope").notNull(),
    // Null when scope is `instance` or `organisation`; set when scope is `workspace` or
    // `project` (a project lives inside a workspace, so a project-scoped role definition
    // is still anchored to one workspace).
    workspaceId: text("workspace_id").references(() => workspaceTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    rank: integer("rank").notNull(),
    capabilities: jsonb("capabilities").notNull().default(sql`'[]'::jsonb`),
    isSystem: boolean("is_system").default(false).notNull(),
    isEditable: boolean("is_editable").default(true).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("role_workspaceId_idx").on(table.workspaceId),
    // data-model.md §2: "key ... unique per (scope, workspace_id)". A plain
    // `unique(scope, workspace_id, key)` would NOT actually enforce this for
    // `instance`/`organisation`-scoped roles: standard SQL unique constraints treat two
    // NULL `workspace_id`s as distinct, so two `instance`-scoped roles could otherwise
    // collide on the same `key` undetected. `coalesce` to a sentinel no real CUID2 id can
    // ever equal closes that gap -- confirmed by a regression test that a plain composite
    // unique constraint does not (found while writing this PR's own tests).
    uniqueIndex("role_scope_workspace_key_unique").on(
      table.scope,
      sql`coalesce(${table.workspaceId}, '')`,
      table.key,
    ),
  ],
);

export const membershipTable = pgTable(
  "membership",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => personTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    scope: text("scope").notNull(),
    // Polymorphic: an organisation.id, workspace.id or project.id depending on `scope`.
    // No DB-level FK is possible across three target tables, so this is a plain column,
    // the same shape as `legal_hold.scope_id` elsewhere in data-model.md §2.
    scopeId: text("scope_id").notNull(),
    roleId: text("role_id")
      .notNull()
      .references(() => roleTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    seesAll: boolean("sees_all").default(false).notNull(),
    // Records the ancestor project a membership was inherited from (OpenProject's model).
    // Not a DB FK: data-model.md does not state which table this points at closely enough
    // to constrain it, and getting that wrong would be worse than leaving it unconstrained.
    inheritedFrom: text("inherited_from"),
    // `scim_group_member.id` when SCIM group sync created this membership. Not a DB FK:
    // `scim_group_member` is P3 SCIM-provisioning scope and does not exist yet.
    derivedFrom: text("derived_from"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("membership_roleId_idx").on(table.roleId),
    // data-model.md's Indexing section names exactly this composite --
    // `create index on membership (person_id, scope, scope_id);` -- as the shape
    // `resolveIdentity` actually queries by (fetch this person's memberships, then narrow
    // by scope). It leading-prefix-covers the old person-id-only lookup, so that index is
    // dropped as redundant; `membership_scope_scopeId_idx` is kept alongside it because it
    // serves the reverse lookup (all memberships for a scope/scope_id, independent of
    // person) that this composite's column order can't serve.
    index("membership_personId_scope_scopeId_idx").on(
      table.personId,
      table.scope,
      table.scopeId,
    ),
    index("membership_scope_scopeId_idx").on(table.scope, table.scopeId),
  ],
);

// ── #23's first slice: work_item, work_item_type, state_template, state, ──────────
// work_item_key_alias, watcher (data-model.md §3-§4, decision log 2026-09-17 "#23's
// first slice is narrower than 'all of #23'"). Purely additive: references nothing in
// kaneo's original taskTable/columnTable, and nothing references these tables yet --
// no route, no controller, no policy, no MCP tool. `taskTable`/`columnTable` and their
// routes are completely untouched by this change.

export const workItemTypeTable = pgTable(
  "work_item_type",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    icon: text("icon"),
    category: text("category").notNull(),
    // `workflow` and `sla_policy` (data-model.md §6/§7) are P2/P5 scope and do not exist
    // in this schema yet -- plain nullable columns, NO foreign key constraint, until
    // those tables land. Add the real `.references()` in the PR that creates them.
    workflowId: text("workflow_id"),
    slaPolicyId: text("sla_policy_id"),
    isEpic: boolean("is_epic").default(false).notNull(),
    isChange: boolean("is_change").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("work_item_type_workspaceId_idx").on(table.workspaceId),
    // Not explicitly stated as unique in data-model.md's abbreviated column list --
    // inferred from this codebase's existing key-uniqueness convention
    // (`workspace.slug`, PR #179's `role.key` per (scope, workspace_id)). Flagged as a
    // judgment call in the PR body.
    uniqueIndex("work_item_type_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    // #189 S7 -- `data-model.md` §4 states `category` (`service`|`delivery`) verbatim,
    // and the document's Conventions section requires "Enumerations are Postgres enums or
    // `CHECK` constraints, never free text". A `CHECK`, not a Postgres enum type, so every
    // vocabulary this migration constrains uses one mechanism.
    check(
      "work_item_type_category_allowed",
      sql`${table.category} in ('service', 'delivery')`,
    ),
  ],
);

export const stateTemplateTable = pgTable(
  "state_template",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    // data-model.md §3: "`group` is a SQL reserved word and is written `"group"` in the
    // DDL." Drizzle already double-quotes every identifier it generates, so the column
    // name alone (matching the spec's literal name) is enough -- no extra escaping.
    group: text("group").notNull(),
    colour: text("colour"),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("state_template_workspaceId_idx").on(table.workspaceId),
    uniqueIndex("state_template_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    // #189 S7 -- `data-model.md` §3 states the five `group` values verbatim and calls
    // them "the only fixed lifecycle vocabulary" (ADR 0011). Kept in ADR 0011's own
    // order. `group` is a SQL reserved word; Drizzle already double-quotes every
    // identifier it emits, so the literal column name is enough.
    check(
      "state_template_group_allowed",
      sql`${table.group} in ('backlog', 'unstarted', 'started', 'completed', 'cancelled')`,
    ),
  ],
);

export const stateTable = pgTable(
  "state",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    // References the EXISTING, native `projectTable` above (kaneo's original table,
    // already reused by the P1 identity/workspace work -- not a new table this PR adds).
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // data-model.md §3: "`ON DELETE RESTRICT`" explicitly -- a template with any `state`
    // row pointing at it is never deleted.
    stateTemplateId: text("state_template_id")
      .notNull()
      .references(() => stateTemplateTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    position: integer("position").notNull().default(0),
    isDefault: boolean("is_default").default(false).notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("state_projectId_idx").on(table.projectId),
    index("state_stateTemplateId_idx").on(table.stateTemplateId),
    // #186 S2: the composite-FK target `work_item` uses below to pin its own
    // `state_id` to a `state` row that shares its `project_id` -- the same
    // `(scope_id, id)` composite-unique technique `project` already exposes for
    // `user_notification_workspace_project`'s FK. `id` alone is already a PK/unique,
    // but Postgres requires an explicit unique constraint on the exact column pair a
    // composite FK targets, so this is added even though it looks redundant.
    unique("state_project_id_id_unique").on(table.projectId, table.id),
    // #189 S9 -- at most one default `state` per project. Partial unique index, not a
    // plain unique constraint, because it must apply only to the `is_default` rows
    // (`legal_hold`'s `(scope, scope_id) where lifted_at is null` is this codebase's
    // existing precedent for the shape).
    //
    // Authorised by the singular definite: `projects-and-engagements.md` `PR-17` — a
    // project's states have "their own order and default" — and `work-items.md` `WI-4`,
    // "Initial state is the project's own default state (`state.is_default`)". A
    // project's default for new work items is one row, not a set.
    //
    // Judgment call, and the strongest one in this migration: `data-model.md` §3 lists
    // `is_default` as a column without stating the at-most-one invariant itself, and
    // this index is deliberately NOT scoped to `archived_at is null`. Archiving a state
    // is "removing" it (ADR 0011), and a removed state cannot be the initial state a
    // new work item gets (`WI-4`), so the index requires the write path to clear or
    // re-nominate `is_default` when it archives the state that holds it, rather than
    // leaving a dangling default behind. Flagged in the PR body so a reviewer can weigh
    // it against the narrower `and archived_at is null` form.
    uniqueIndex("state_project_default_unique")
      .on(table.projectId)
      .where(sql`${table.isDefault}`),
  ],
);

// #191 O2 (Opus review of #186's own S5 fix) -- replaces the hand-written
// `work_item_key_alias_reject_live_collision` TRIGGER entirely. That trigger did a plain
// `SELECT ... WHERE key = NEW.old_key` EXISTS check with no lock: two ordinary concurrent
// transactions (T1 inserts `work_item.key = 'X'`, uncommitted; T2 inserts
// `work_item_key_alias.old_key = 'X'` before T1 commits) both passed the check and both
// committed -- proven live under plain READ COMMITTED, and Opus additionally proved
// SERIALIZABLE does not save it either (only one rw-antidependency edge exists, so
// Postgres's SSI has no dangerous structure to detect). A check-then-act trigger against
// another table's data can never be race-free no matter what SELECT it runs; only a real
// index can be.
//
// DESIGN: `work_item.key` and `work_item_key_alias.old_key` draw from two independent
// namespaces today, which is the root cause -- a plain UNIQUE index on either column only
// sees its own table. This table is the ONE shared home both namespaces route through, so
// Postgres's own real UNIQUE/PRIMARY KEY index -- atomic and race-free by construction, no
// application-level lock required -- is what actually enforces cross-table uniqueness:
//
//   - `key` is the PRIMARY KEY: a string is claimed here EXACTLY ONCE, ever, for the life
//     of the system. Claims are never released and never reassigned, even after the work
//     item that claimed one is deleted -- a key that has ever been live, or ever become an
//     alias, can never be reused by anyone else. This is deliberately stricter than "unique
//     at every instant": it is what closes the ALREADY-KNOWN, separately-flagged reverse
//     direction gap too (#186's own "Not done", Opus's O4) as a side effect of the same
//     mechanism, not a second fix -- a work item that reuses a retired key would need a
//     second claim row for the same `key` value, which the PRIMARY KEY simply refuses.
//   - `work_item_id` records WHICH work item originally claimed a key. Combined with the
//     `unique(key, work_item_id)` target below, this is what lets `work_item_key_alias`
//     reference a claim WITHOUT being able to reference someone else's: the composite FK
//     `work_item_key_alias(old_key, work_item_id) -> work_item_key_claim(key, work_item_id)`
//     (below) only ever matches a row where THIS SAME work_item_id is the one on record as
//     having claimed that exact key. An alias trying to claim `old_key = 'X'` while 'X' is
//     still a DIFFERENT work item's live key -- the exact scenario #186 S5 and this table
//     exist to prevent -- has no matching `(key, work_item_id)` row to reference (the only
//     row for `key = 'X'` names the OTHER work item), so the FK rejects it outright, with
//     no race window at all: existence is checked against a row that must already be
//     committed, not raced against one that might not be yet.
//
// POPULATING a claim row is the one piece that still needs code beyond a plain FK
// reference (Postgres has no way to declare "insert into this OTHER table too, but only
// once, as part of validating this row") -- `work_item`'s own hand-written trigger below
// does exactly that, and ONLY that: it performs the actual claiming INSERT directly, with
// no preceding SELECT/EXISTS check of its own, so the claim table's real PRIMARY KEY is
// still the sole arbiter of any conflict (a colliding claim insert fails with a genuine
// Postgres `unique_violation`, atomically, however many transactions race for it
// simultaneously). This is NOT the check-then-act shape the old trigger had: there is no
// check step to race against. `work_item_key_alias` gets no trigger at all -- an alias
// never mints a NEW claim, it only ever references one that must already exist from when
// its `old_key` value was originally live as SOME work item's `work_item.key` (see the
// `oldKey` column comment below).
//
// #191 N1/N2 (latent findings from the delta-confirmation pass on this same PR, closed
// here): the claiming INSERT is `ON CONFLICT ("key", work_item_id) DO NOTHING`, so
// re-inserting the EXACT SAME (key, work_item_id) pair a previous trigger run already
// committed is a no-op, not a `unique_violation` -- a conflict on `key` ALONE against a
// DIFFERENT work_item_id is a different unique index and still fails, unchanged.
//   - N2: `BEFORE ... UPDATE OF "key"` fires whenever `key` is MENTIONED in `SET`, not
//     when its value changes -- an ordinary whole-row ORM update that re-sends `key`'s
//     own current value used to re-trip this trigger's unconditional insert and fail
//     outright. Now it no-ops.
//   - N1: if the caller's own `INSERT ... ON CONFLICT DO NOTHING` on `work_item` (already
//     used elsewhere in this codebase) skips a row AFTER this BEFORE trigger already ran,
//     the claim it inserted is not rolled back by that skip -- see the migration SQL for
//     the exact mechanism. That claim permanently squats its key string either way (by
//     design: this table never un-claims anything), but before this clause even the
//     work_item_id it names could never legitimately claim that same key later, because
//     doing so would re-trip the identical unconditional insert. With this clause, that
//     one work_item_id can still take it later; a different one still can't.
export const workItemKeyClaimTable = pgTable(
  "work_item_key_claim",
  {
    key: text("key").primaryKey(),
    // Deliberately NO `.references()` here. A real FK back to `work_item.id` would make
    // this table and `work_item` reference each other in both directions (`work_item.key`
    // -> this table, this table.`work_item_id` -> `work_item.id`), and -- because every
    // `work_item` unconditionally gets a claim row via the trigger below the moment it is
    // created -- an `ON DELETE RESTRICT` here would make EVERY work item permanently
    // un-hard-deletable (you could never delete the claim first, since `work_item.key`
    // still points at it; you could never delete the work item first if this FK also
    // pointed back with RESTRICT). `ON DELETE CASCADE` would silently free a key for reuse
    // the instant its work item is hard-deleted -- exactly the "forever claimed" guarantee
    // above says this table must NOT do. So: no FK. `work_item_id` here is populated only
    // by the trigger below (always a real, just-validated work_item.id at insert time),
    // and its accuracy is not load-bearing after that -- the actual uniqueness guarantee
    // is `key`'s PRIMARY KEY, not this column. A hard-deleted work item simply leaves its
    // claim rows in place, permanently retiring those key strings -- consistent with this
    // table's whole reason for existing.
    workItemId: text("work_item_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // FK target for both `work_item(key, id)` and `work_item_key_alias(old_key,
    // work_item_id)` below. Logically implied by `key`'s own PRIMARY KEY, but Postgres
    // requires an explicit unique constraint on the EXACT column tuple a composite FK
    // targets (the same reason `state_project_id_id_unique`/`work_item_project_id_id_unique`
    // above exist alongside their tables' own single-column PKs).
    unique("work_item_key_claim_key_work_item_id_unique").on(
      table.key,
      table.workItemId,
    ),
    index("work_item_key_claim_workItemId_idx").on(table.workItemId),
  ],
);

export const workItemTable = pgTable(
  "work_item",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // Judgment call: RESTRICT, not stated explicitly in data-model.md §4. Matches this
    // schema's existing "a referenced entity in active use cannot vanish out from under
    // its dependents" pattern (`state.state_template_id`, `membership.role_id`) -- a
    // work item type cannot be deleted while items of that type still exist. Flagged in
    // the PR body.
    //
    // #186 S2, deliberately NOT closed at the DB level here (see the PR body's "Not
    // done" for the full reasoning): nothing pins this `type_id` to a `work_item_type`
    // row in the SAME workspace as this item's own `project_id`. Unlike `state_id`/
    // `parent_id` below, `work_item` carries no `workspace_id` of its own -- only
    // `project_id`, one hop away from `project.workspace_id` -- and data-model.md §4
    // does not list a `workspace_id` column on `work_item`. A composite FK (a
    // declarative constraint) can only compare columns that live directly on the two
    // tables it joins; there is no direct column pair here for one to check.
    //
    // Denormalising a redundant `work_item.workspace_id` column (kept in sync via the
    // same double-composite-FK technique `state`/`parent_id` use below) is ONE DB-level
    // option, but -- corrected per #191's independent review, which found the original
    // wording here overstated -- it is not the only one: a `BEFORE INSERT OR UPDATE OF
    // type_id, project_id` trigger on `work_item` (the same class of hand-written,
    // cross-table check this file already uses elsewhere for #186 S5, before #191's own
    // review replaced THAT one with a real constraint for race-freedom reasons that do
    // not obviously apply here the same way) could also close this at the DB level with
    // no schema change. Both were considered; neither is adopted here. This is a real
    // schema-shape decision -- which mechanism, if either, is worth its cost against a
    // gap that #191's Opus review confirms is the MORE security-relevant half of #186 S2
    // (it crosses a tenant/workspace boundary, where `state_id`/`parent_id` only cross a
    // project boundary within one workspace) -- bigger than what a three-finding
    // integrity fix should decide unilaterally, and belongs in the decision log before
    // #23's write path lands, not silently in this comment. Left, for now, as an
    // accepted gap requiring an application-level check (validate
    // `work_item_type.workspace_id = project.workspace_id` at write time), which is
    // real but weaker than a DB-level guarantee: it is not enforced against direct SQL,
    // a bulk import, or any future write path that forgets to call it.
    typeId: text("type_id")
      .notNull()
      .references(() => workItemTypeTable.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    number: integer("number").notNull(),
    // Stored once at insert from `{project.key}-{number}`, never regenerated for the
    // same project (data-model.md §4). A cross-project move re-keys the item -- the old
    // value moves to `work_item_key_alias` -- so `key` DOES change over the item's
    // lifetime under that one condition, which is exactly why a global unique index is
    // needed here (not stated as its own line in data-model.md's "## Indexing" list,
    // which only names `(project_id, number)` -- but `project.key` is already unique per
    // instance and `number` is unique per project, so `key` composes to a globally
    // unique value; the alias mechanism depends on that holding at every instant).
    // Judgment call, flagged in the PR body.
    //
    // #191 O2: also composite-FK'd to `work_item_key_claim(key, work_item_id)` below (see
    // that table's own comment for the full design) -- every value this column ever holds
    // must be claimed, exactly once and forever, in that shared registry, which is what
    // makes this column's uniqueness hold against `work_item_key_alias.old_key` too, not
    // just against itself.
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: jsonb("description"),
    // data-model.md §4: "`ON DELETE RESTRICT` -- states are archived, never deleted out
    // from under an item."
    //
    // #186 S2: no plain `.references()` here -- deliberately. A single-column FK to
    // `state.id` alone would let this item's `state_id` point at a `state` row that
    // belongs to a DIFFERENT project than this item's own `project_id` (proven live by
    // the Opus review of PR #185). The composite `foreignKey()` in this table's extra
    // config below (`(project_id, state_id) -> state(project_id, id)`, the same
    // `user_notification_workspace_project` technique this codebase already uses for
    // pinning one row's FK target to the caller's own scope) both enforces existence
    // AND pins the state to this item's own project, so a second, narrower
    // single-column FK on top of it would be redundant, matching the precedent (which
    // gives its own scoped columns no separate single-column FK either).
    stateId: text("state_id").notNull(),
    priority: text("priority"),
    // data-model.md §4: "`ON DELETE RESTRICT` -- people are deactivated, never deleted."
    assigneeId: text("assignee_id").references(() => personTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    // Judgment call: also RESTRICT, not spelled out in data-model.md §4. The same
    // "people are deactivated, never deleted" rule applies regardless of which role a
    // person occupies on a work item; RESTRICT keeps who filed an item from silently
    // disappearing (SET NULL was considered and rejected -- that would erase audit-
    // relevant history without an explicit decision, unlike the always-available
    // reassignment path RESTRICT forces instead). Flagged in the PR body.
    requesterId: text("requester_id").references(() => personTable.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    // Judgment call: RESTRICT, not spelled out in data-model.md §4 either. Consistent
    // with the same "a referenced row cannot vanish out from under its dependents"
    // pattern used throughout this schema -- CASCADE would silently delete a
    // potentially large, unbounded subtree of children; SET NULL would silently break
    // the parent/child relationship with no signal. Work items are soft-deleted via
    // `deleted_at` in normal operation, so a real SQL DELETE here should be rare and
    // deliberate -- RESTRICT forces that to be an explicit choice (re-parent or delete
    // children first). Flagged in the PR body.
    //
    // #186 S2: no plain self-referencing `.references()` here either -- deliberately,
    // same reasoning as `state_id` above. A single-column self-FK to `work_item.id`
    // alone would let a work item's `parent_id` point at a work item in a DIFFERENT
    // project (proven live by the Opus review). The composite self-referencing
    // `foreignKey()` below (`(project_id, parent_id) -> work_item(project_id, id)`)
    // pins the parent to the SAME project as the child and subsumes plain existence,
    // so a redundant single-column FK is not added on top of it.
    //
    // #188 -- neither the FK above nor anything else here stops a work item from being
    // made its own ancestor. Two distinct guards close this, at two different
    // granularities a single mechanism cannot cover:
    //
    //   1. Direct self-parent (`parent_id = id` on THIS row) -- `work_item_parent_not_self`
    //      CHECK below. A real, atomic, race-free Postgres CHECK constraint: both columns
    //      it compares live on the one row being written, which is exactly the case a
    //      Postgres CHECK CAN express (CHECK constraints cannot reference other rows).
    //
    //   2. A multi-row cycle (A's parent is B, B's parent is A; or any longer loop) is
    //      NOT expressible as a CHECK or a plain FK -- it requires walking potentially
    //      many rows. Closed by `work_item_reject_parent_cycle`, a hand-written
    //      `BEFORE INSERT OR UPDATE OF parent_id` trigger (migration SQL; see that
    //      trigger's own comment there for the full design) that walks from the proposed
    //      new parent upward and rejects if the walk ever reaches `NEW.id`.
    //
    //   RACE ANALYSIS (matching #191 O2's rigor, since a naive check-then-act trigger is
    //   exactly the shape that broke there): a NAIVE, unlocked chain walk here (plain
    //   `SELECT`, no lock, considered and rejected) would have a REAL race a single-row
    //   check does not -- two concurrent transactions each changing a DIFFERENT row's
    //   `parent_id` (T1: A's parent := B; T2, concurrently: B's parent := A) could each
    //   read the OTHER row's pre-transaction `parent_id` under plain MVCC (neither
    //   transaction's own row lock protects a row it only READS), each conclude "no cycle
    //   from what I can see," and both commit -- producing the cycle A<->B neither one
    //   individually created. This is CLOSED, not merely reduced in probability, by the
    //   trigger actually shipped here taking a `SELECT ... FOR NO KEY UPDATE` row lock on
    //   every ancestor it visits during the walk (not just a plain SELECT): a concurrent
    //   transaction that is itself changing one of those ancestors' own `parent_id`
    //   already holds that row's lock for its own UPDATE's duration, so the walk blocks
    //   on it instead of reading a stale, about-to-change value -- it sees either that
    //   transaction's fully-committed result or, if that transaction rolls back, the true
    //   unchanged value, never a value mid-flight. Proven by a live concurrent
    //   reproduction of exactly this two-row swap in
    //   `work-item-parent-cycle-guard.test.ts`, run under plain READ COMMITTED (no
    //   reliance on the application choosing a stronger isolation level), confirming the
    //   swap is rejected rather than silently forming a cycle. An n-way concurrent
    //   attempt to close a longer cycle this way is closed the same way at each pairwise
    //   step -- and, on the interleavings where every leg ends up mutually waiting on the
    //   next before any of them can commit, becomes a genuine wait-for cycle among the
    //   transactions themselves, which Postgres's own deadlock detector resolves by
    //   aborting exactly one of them -- breaking the attempted cycle by construction, not
    //   by chance. Both outcomes (an explicit cycle rejection once a leg observes a real
    //   committed edge, and a deadlock-detector abort when a full mutual wait forms) are
    //   exercised live by the 3-way ring reproduction in the same test file. This closes
    //   the race under Postgres's DEFAULT isolation (READ COMMITTED); it does not depend
    //   on the application choosing SERIALIZABLE (the two-transaction swap above IS the
    //   classic write-skew pattern SERIALIZABLE's SSI would also catch, but #191 O2
    //   already established that this codebase does not lean on isolation-level choice
    //   for an integrity guarantee, and a longer, 3+-row
    //   cycle attempt is not obviously reducible to the two-transaction pivot SSI is
    //   proven to detect -- explicit locking during the walk is the mechanism actually
    //   relied on here, verified directly rather than assumed from isolation level).
    //
    //   #195 OS1/OS2 (mandatory Opus review) -- two non-blocking refinements to the walk,
    //   both proven live and both covered by regression tests in
    //   `work-item-parent-cycle-guard.test.ts`: (1) the lock is `FOR NO KEY UPDATE`, not
    //   `FOR UPDATE` -- strictly sufficient for the race analysis above (nothing here
    //   relies on excluding `FOR KEY SHARE`), and unlike `FOR UPDATE`, it does not
    //   conflict with the `FOR KEY SHARE` an unrelated foreign key check takes
    //   against one of these ancestors (e.g. a new `watcher` row), so that unrelated work
    //   no longer blocks for the reparent's duration. (2) the trigger now returns
    //   immediately, before the walk, when `TG_OP = 'UPDATE'` and `NEW.parent_id IS NOT
    //   DISTINCT FROM OLD.parent_id` -- the same fix #191 N2 made on the sibling
    //   `work_item_claim_key` trigger, needed because Postgres fires `UPDATE OF
    //   parent_id` on column MENTION, not value change, so an ordinary whole-row ORM
    //   update would otherwise re-run the full locking walk for a write that never
    //   touches `parent_id`.
    parentId: text("parent_id"),
    // `service` (data-model.md §7) is P5/later scope and does not exist yet -- plain
    // nullable column, NO foreign key constraint, until it lands.
    serviceId: text("service_id"),
    startDate: timestamp("start_date", { mode: "date" }),
    dueDate: timestamp("due_date", { mode: "date" }),
    // data-model.md §4: `numeric(20,10)`, for fractional manual reordering.
    position: numeric("position", { precision: 20, scale: 10 })
      .notNull()
      .default("0"),
    // `estimate_point`, `cycle`, `module` (data-model.md §8/§9) are P5/later scope and do
    // not exist yet -- plain nullable columns, NO foreign key constraint, until they
    // land.
    estimatePointId: text("estimate_point_id"),
    cycleId: text("cycle_id"),
    moduleId: text("module_id"),
    slaStartedAt: timestamp("sla_started_at", { mode: "date" }),
    firstResponseAt: timestamp("first_response_at", { mode: "date" }),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
    // #186 S1: NOT NULL DEFAULT 'private' -- the safe default, matching
    // `organisation.default_customer_visibility`'s own `NOT NULL DEFAULT 'organisation'`
    // pattern (PR #179). Nullable/no-default here meant a naive "hide private items"
    // filter (`customer_visibility IS DISTINCT FROM 'private'`) failed OPEN on NULL or
    // any garbage string -- an item became visible to a customer by accident, not by
    // choice. No existing rows to backfill: this table has never shipped with data.
    customerVisibility: text("customer_visibility")
      .default("private")
      .notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    // data-model.md's convention: "Optimistic concurrency via `version integer not null
    // default 1` on every table two people plausibly edit at once" -- `work_item` is
    // marked **v** in data-model.md §4.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // "## Indexing": create index on work_item (project_id, state_id, position);
    index("work_item_projectId_stateId_position_idx").on(
      table.projectId,
      table.stateId,
      table.position,
    ),
    // "## Indexing": create unique index on work_item (project_id, number);
    uniqueIndex("work_item_project_number_unique").on(
      table.projectId,
      table.number,
    ),
    // "## Indexing": create index on work_item (assignee_id) where archived_at is null
    // and deleted_at is null;
    index("work_item_assigneeId_idx")
      .on(table.assigneeId)
      .where(sql`${table.archivedAt} is null and ${table.deletedAt} is null`),
    // "## Indexing": create index on work_item (due_date) where resolved_at is null;
    index("work_item_dueDate_idx")
      .on(table.dueDate)
      .where(sql`${table.resolvedAt} is null`),
    // Global key uniqueness -- see the `key` column comment above.
    uniqueIndex("work_item_key_unique").on(table.key),
    index("work_item_typeId_idx").on(table.typeId),
    index("work_item_stateId_idx").on(table.stateId),
    index("work_item_requesterId_idx").on(table.requesterId),
    index("work_item_parentId_idx").on(table.parentId),
    // Deliberately NOT added here: the "## Indexing" GIN trigram title index and the
    // generated `search_vector` column (`create extension pg_trgm`, `... using gin
    // (title gin_trgm_ops)`, the `tsvector generated always as (...) stored` column) --
    // full-text search is a separate P1 core work item (search), not part of #23's
    // first-slice schema. Add these when that work lands.

    // #186 S2 -- composite-FK target for the self-referencing `parent_id` composite FK
    // below, same `(scope_id, id)` technique as `state_project_id_id_unique` above and
    // `project_workspace_id_id_unique` (PR #179's `user_notification_workspace_project`
    // precedent).
    unique("work_item_project_id_id_unique").on(table.projectId, table.id),
    // #186 S2 -- pins `state_id` to a `state` row that shares THIS item's own
    // `project_id`, closing the cross-project state leakage the Opus review proved
    // live (a plain single-column FK on `state_id` cannot see `work_item.project_id`
    // at all, so it could never have caught this).
    //
    // #191 O1 (Opus review of #186's own S2 fix): `onUpdate` is `"no action"`, NOT
    // `"cascade"` -- deliberately different from the single-column FK this replaced.
    // That FK's `ON UPDATE CASCADE` cascaded on `state.id`, which never changes, so the
    // keyword was inert. THIS FK's referenced column set includes `state.project_id`,
    // which is mutable, so the same keyword now means something else entirely: `UPDATE
    // state SET project_id = <a different workspace's project>` would cascade-rewrite
    // `work_item.project_id` too, silently moving a work item across a workspace
    // boundary with no check of its own -- proven live by the Opus review (two work
    // items moved to a different workspace's project as a side effect of a single
    // `UPDATE state` statement, still carrying their original workspace's
    // `work_item_type`). `"no action"` means that `UPDATE` is rejected outright instead
    // (verified live: `update or delete on table "state" violates foreign key
    // constraint ... still referenced from table "work_item"`) -- a state's project is
    // not something this data model has an operation for changing out from under its
    // work items, so refusing it is correct, not merely safe.
    foreignKey({
      columns: [table.projectId, table.stateId],
      foreignColumns: [stateTable.projectId, stateTable.id],
    })
      .onDelete("restrict")
      .onUpdate("no action"),
    // #186 S2 -- pins `parent_id` to a work item that shares THIS item's own
    // `project_id`, closing the cross-project parent leakage the Opus review proved
    // live. Self-referencing composite FK: `table` here is the fully-resolved column
    // proxy (this extra-config callback runs after every column above it is defined),
    // so no `AnyPgColumn` lazy-callback workaround is needed the way the old inline
    // single-column self-FK required.
    //
    // #191 O1: `onUpdate` is `"no action"` for the identical reason as `state_id`
    // above -- this FK's referenced column set also includes a mutable scoping column
    // (`work_item.project_id`, this table's own), so `"cascade"` here would let
    // re-projecting a PARENT work item silently drag every child across a project (and
    // potentially a workspace) boundary too. Opus's own probe found this direction
    // self-limiting in practice (a parent's `project_id` UPDATE trips over the
    // children's OWN `state_id` FK first, since a moved child would then reference a
    // state outside its new project) but flagged the resulting error as confusing
    // rather than correct-by-design; `"no action"` here makes the rejection direct and
    // attributable to the actual constraint being violated, not a side effect of a
    // different one.
    foreignKey({
      columns: [table.projectId, table.parentId],
      foreignColumns: [table.projectId, table.id],
    })
      .onDelete("restrict")
      .onUpdate("no action"),
    // #188 -- direct self-parenting (`parent_id = id`), case 1 of the two guards
    // described on the `parentId` column above. `IS DISTINCT FROM` (not `<>`) so a NULL
    // `parent_id` (a root item, the common case) is never compared against `id` at all --
    // `NULL IS DISTINCT FROM 'x'` is TRUE, i.e. "not the same value," which is exactly
    // "no self-parent problem here." A plain `<>` would evaluate to NULL (neither true
    // nor false) whenever `parent_id IS NULL`, and Postgres treats a NULL CHECK result as
    // PASSING -- so `<>` would happen to work here too, but `IS DISTINCT FROM` says so
    // directly instead of relying on that NULL-handling subtlety. Case 2 (a multi-row
    // cycle) is NOT expressible here -- a CHECK constraint can only compare columns on
    // the row being written, never walk to another row -- and is closed instead by the
    // `work_item_reject_parent_cycle` trigger (hand-written SQL in the migration).
    check(
      "work_item_parent_not_self",
      sql`${table.parentId} is distinct from ${table.id}`,
    ),
    // #191 O2 -- the claim-table FK described on `work_item_key_claim` above and the
    // `key` column comment. `onUpdate("no action")`: claim rows are never updated in
    // place (see that table's comment), so this never actually fires, but the O1
    // lesson applies on principle -- never default a composite FK involving an
    // identity-like column to `"cascade"` without a specific reason. `onDelete
    // "restrict"`: a claim row cannot be deleted while a work item's live `key` still
    // points at it (in practice this never fires either, since nothing deletes a claim
    // row directly -- see that table's own comment on why it carries no FK back to
    // `work_item.id`).
    foreignKey({
      columns: [table.key, table.id],
      foreignColumns: [
        workItemKeyClaimTable.key,
        workItemKeyClaimTable.workItemId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("no action"),
    // #189 S7 -- `data-model.md` Conventions: "Enumerations are Postgres enums or `CHECK`
    // constraints, never free text. **Priority** is the ordered enum
    // `low < medium < high < urgent` -- ordering is load-bearing for the customer
    // escalate-only rule and for every importer's mapping."
    //
    // The column is nullable (`text("priority")`, no default), and this CHECK keeps it
    // so: `NULL in (...)` evaluates to NULL, and Postgres treats a NULL CHECK result as
    // passing. Any non-NULL value, however, must be one of the four.
    check(
      "work_item_priority_allowed",
      sql`${table.priority} in ('low', 'medium', 'high', 'urgent')`,
    ),
    // #189 S7 -- `data-model.md` §4 states `customer_visibility`
    // (`private`|`organisation`) verbatim. The column is NOT NULL DEFAULT 'private'
    // (#186 S1); this closes the other half of that finding -- a garbage string used to
    // pass the NOT NULL check and read as neither `private` nor `organisation`.
    check(
      "work_item_customer_visibility_allowed",
      sql`${table.customerVisibility} in ('private', 'organisation')`,
    ),
    // #189 S9 -- `position numeric(20,10)` accepted `NaN`, which Postgres sorts greater
    // than every non-NaN value, so one bad row would head every `ORDER BY position desc`
    // and tail every `ORDER BY position asc` for ever.
    //
    // NOT the `CHECK (position = position)` the issue suggested: that is an IEEE-754
    // trick and does not work here. Postgres deviates from IEEE for `numeric` precisely
    // to keep `NaN` usable in tree indexes -- `SELECT 'NaN'::numeric = 'NaN'::numeric`
    // returns TRUE (verified live against the project's PostgreSQL 18), so a
    // self-comparison CHECK accepts `NaN` and constrains nothing. The comparison that
    // does reject it is `<> 'NaN'::numeric`.
    check(
      "work_item_position_not_nan",
      sql`${table.position} <> 'NaN'::numeric`,
    ),
    // #189 S9 -- `number` was a bare `integer NOT NULL` with no positivity constraint,
    // and no trigger assigns it yet (`work_item.key`'s assignment trigger is #23's later
    // work; nothing in the schema computes `number` today), so a direct insert could
    // write `0` or a negative. `data-model.md` §4 / `work-items.md` `WI-2`: "`number`
    // comes from `project.last_work_item_number` incremented". No column of that name
    // exists yet -- the live column is `project.last_task_number`
    // (`lastTaskNumber: integer("last_task_number").notNull().default(0)`), inherited
    // from kaneo and still named for the v1 concept; #23 owns introducing the v2 name
    // and the assignment. Either way the first assignment is 1. The rendered key is
    // `{project.key}-{number}`, which must never be `...-0` or `...--1`.
    check("work_item_number_positive", sql`${table.number} > 0`),
  ],
);

export const workItemKeyAliasTable = pgTable(
  "work_item_key_alias",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    // Must be unique globally, same reasoning as `work_item.key` above: the redirect
    // this table implements only works if an old key unambiguously resolves to one
    // work item. Not spelled out as "unique" in data-model.md §4's abbreviated column
    // list -- judgment call, flagged in the PR body.
    //
    // #186 S5 / #191 O2: uniqueness within THIS table is not the whole story -- without
    // more, `old_key` and `work_item.key` are independent namespaces, so an alias could
    // be created whose value collides with a currently-live `work_item.key` (proven
    // live by the original #185 Opus review). #186's first attempt at closing this used
    // a hand-written trigger doing a plain `EXISTS` check against `work_item`; a
    // follow-up review (#191) proved that check-then-act shape has an unlocked
    // TOCTOU race that holds even under SERIALIZABLE isolation, and replaced it with
    // the composite FK below, into the shared `work_item_key_claim` registry (see that
    // table's own comment for the full design) -- a real UNIQUE/PRIMARY KEY index,
    // race-free by construction, rather than a trigger racing against another table's
    // uncommitted writes.
    oldKey: text("old_key").notNull(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItemTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("work_item_key_alias_oldKey_unique").on(table.oldKey),
    index("work_item_key_alias_workItemId_idx").on(table.workItemId),
    // #191 O2 -- `old_key` may only reference a claim ALREADY on record as having been
    // claimed by THIS SAME `work_item_id`. An alias attempting to retire a key that is
    // still a DIFFERENT work item's live key (the exact #186 S5 scenario) has no
    // matching `(key, work_item_id)` row to reference -- the only claim row for that
    // key names the other work item -- so this FK rejects it outright, with no
    // trigger, no lock, and no race window: the composite FK is checked against a
    // committed row that must already exist, never against one raced into existing.
    foreignKey({
      columns: [table.oldKey, table.workItemId],
      foreignColumns: [
        workItemKeyClaimTable.key,
        workItemKeyClaimTable.workItemId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("no action"),
  ],
);

export const watcherTable = pgTable(
  "watcher",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItemTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    // A person watching a work item is a subscription, not authored history -- cascade
    // on person delete (matching `membership.person_id`'s convention), unlike
    // `work_item.assignee_id`/`requester_id`'s RESTRICT above.
    personId: text("person_id")
      .notNull()
      .references(() => personTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    source: text("source").notNull(),
    muted: boolean("muted").default(false).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // A person watches a work item at most once -- not spelled out in data-model.md §4,
    // but obviously required to prevent duplicate watch rows. Judgment call, flagged in
    // the PR body.
    uniqueIndex("watcher_workItemId_personId_unique").on(
      table.workItemId,
      table.personId,
    ),
    index("watcher_personId_idx").on(table.personId),
    // #189 S7 -- `data-model.md` §4 states `source` (`explicit`|`implicit`) verbatim.
    check(
      "watcher_source_allowed",
      sql`${table.source} in ('explicit', 'implicit')`,
    ),
  ],
);

// Auth-schema compatible aliases in schema.ts
export const user = userTable;
export const session = sessionTable;
export const account = accountTable;
export const verification = verificationTable;
export const workspace = workspaceTable;
export const team = teamTable;
export const teamMember = teamMemberTable;
export const workspace_member = workspaceUserTable;
export const invitation = invitationTable;
export const organizationRole = workspaceRoleTable;
export const apikey = apikeyTable;

// Auth-schema compatible relation exports in schema.ts
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  teamMembers: many(teamMember),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  teams: many(team),
  workspace_members: many(workspace_member),
  invitations: many(invitation),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [team.workspaceId],
    references: [workspace.id],
  }),
  teamMembers: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, {
    fields: [teamMember.teamId],
    references: [team.id],
  }),
  user: one(user, {
    fields: [teamMember.userId],
    references: [user.id],
  }),
}));

export const workspace_memberRelations = relations(
  workspace_member,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspace_member.workspaceId],
      references: [workspace.id],
    }),
    user: one(user, {
      fields: [workspace_member.userId],
      references: [user.id],
    }),
  }),
);

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invitation.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const organizationRoleRelations = relations(
  organizationRole,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [organizationRole.workspaceId],
      references: [workspace.id],
    }),
  }),
);
