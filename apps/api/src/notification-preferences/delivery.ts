import { createHmac } from "node:crypto";
import { sendNotificationEmail } from "@taskdesk/email";
import {
  evaluateQuietHours,
  QUIET_HOURS_EXEMPT_EVENT_KINDS,
} from "../notification/quiet-hours";
import { userCanReachTask } from "../notification/task-reach.repository";
import {
  parseNotificationCopyDescriptor,
  renderNotificationCopyDescriptor,
  withoutNotificationCopyDescriptor,
} from "../terminology/notification-copy";
import {
  requireTerminologyLocale,
  resolveTermForm,
} from "../terminology/service";
import { assertPublicWebhookDestination } from "../utils/assert-public-destination";
import { sendWebhookRequest } from "../webhook/safe-http";
import {
  findDeliveryEventNotification,
  findDeliveryNotification,
  findDeliveryPersonSide,
  findDeliveryPreference,
  findDeliveryQuietHours,
  findDeliveryTaskContext,
  findDeliveryUser,
  findDeliveryWorkspaceContext,
  findDeliveryWorkspaceRule,
  holdDeliveryUntil,
  QUIET_HOURS_HOLD_KEY,
} from "./delivery.repository";
import { decryptSecret } from "./secrets";

const DEFAULT_OUTBOUND_FETCH_TIMEOUT_MS = 15_000;

async function sendWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_OUTBOUND_FETCH_TIMEOUT_MS;
  if (init.method !== "POST") {
    throw new Error("Notification requests must use POST");
  }
  if (typeof init.body !== "string") {
    throw new Error("Notification request body must be a string");
  }
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = init.body;
  const result = await sendWebhookRequest({
    url,
    headers,
    rawBody: body,
    timeoutMs,
  });
  if (result.statusCode === null) {
    throw new Error(result.error ?? "Notification request failed");
  }
  return {
    ok: result.success,
    status: result.statusCode,
    text: async () => result.responseBody ?? "",
  };
}

function redactSensitiveValues(
  value: string,
  sensitiveValues: Array<string | null | undefined>,
): string {
  return sensitiveValues.reduce<string>((redacted, secret) => {
    if (!secret) return redacted;
    const encodedSecret = encodeURIComponent(secret);
    return redacted
      .replaceAll(secret, "[redacted]")
      .replaceAll(encodedSecret, "[redacted]");
  }, value);
}

type ResolvedNotificationContext = {
  workspaceId: string;
  workspaceName: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskUrl: string | null;
};

type DeliveryContent = {
  title: string;
  body: string;
};

function buildTaskUrl(workspaceId: string, projectId: string, taskId: string) {
  const clientUrl = process.env.TASKDESK_AGENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/workspace/${workspaceId}/project/${projectId}/task/${taskId}`;
}

function getStringValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "string" ? value : null;
}

function getNumberValue(
  data: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function formatLeadTime(minutes: number | null) {
  if (!minutes) return "soon";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `in ${minutes} minutes`;
}

export function buildDeliveryContent(notification: {
  type: string;
  content: string | null;
  title: string | null;
  eventData: Record<string, unknown> | null;
}): DeliveryContent {
  if (notification.title && notification.content) {
    return {
      title: notification.title,
      body: notification.content,
    };
  }

  switch (notification.type) {
    case "task_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "New task created",
        body: taskTitle
          ? `A new task was created: ${taskTitle}`
          : "A new task was created in TaskDesk.",
      };
    }
    case "workspace_created": {
      const workspaceName = getStringValue(
        notification.eventData,
        "workspaceName",
      );
      return {
        title: "Workspace created",
        body: workspaceName
          ? `Workspace created: ${workspaceName}`
          : "A new workspace was created in TaskDesk.",
      };
    }
    case "task_status_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const oldStatus = getStringValue(notification.eventData, "oldStatus");
      const newStatus = getStringValue(notification.eventData, "newStatus");
      return {
        title: "Task status changed",
        body:
          taskTitle && oldStatus && newStatus
            ? `${taskTitle} moved from ${oldStatus} to ${newStatus}.`
            : "A task status changed in TaskDesk.",
      };
    }
    case "task_assignee_changed": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task assigned to you",
        body: taskTitle
          ? `You were assigned to ${taskTitle}.`
          : "A task was assigned to you in TaskDesk.",
      };
    }
    case "time_entry_created": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Time entry created",
        body: taskTitle
          ? `A time entry was created for ${taskTitle}.`
          : "A time entry was created in TaskDesk.",
      };
    }
    case "due_date_reminder": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const label = formatLeadTime(
        getNumberValue(notification.eventData, "leadTimeMinutes"),
      );
      return {
        title: "Task due soon",
        body: taskTitle
          ? `"${taskTitle}" is due ${label}.`
          : `A task is due ${label}.`,
      };
    }
    case "task_overdue": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      return {
        title: "Task overdue",
        body: taskTitle
          ? `"${taskTitle}" is past its due date.`
          : "A task is past its due date.",
      };
    }
    case "task_mention": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const mentionerName = getStringValue(
        notification.eventData,
        "mentionerName",
      );
      return {
        title: mentionerName
          ? `${mentionerName} mentioned you`
          : "You were mentioned",
        body: taskTitle
          ? `You were mentioned in ${taskTitle}.`
          : "You were mentioned in a TaskDesk task.",
      };
    }
    case "task_comment": {
      const taskTitle = getStringValue(notification.eventData, "taskTitle");
      const commenterName = getStringValue(
        notification.eventData,
        "commenterName",
      );
      return {
        title: commenterName
          ? `${commenterName} commented on your task`
          : "New task comment",
        body: taskTitle
          ? `A new comment was added to ${taskTitle}.`
          : "A new comment was added to a TaskDesk task.",
      };
    }
    default:
      return {
        title: notification.title ?? "New TaskDesk notification",
        body:
          notification.content ?? "You have a new notification in TaskDesk.",
      };
  }
}

async function resolveNotificationContext(notification: {
  userId: string;
  resourceType: string | null;
  resourceId: string | null;
}): Promise<ResolvedNotificationContext | null> {
  if (!notification.resourceType || !notification.resourceId) {
    return null;
  }

  if (notification.resourceType === "task") {
    if (
      !notification.resourceId ||
      !(await userCanReachTask(notification.userId, notification.resourceId))
    ) {
      return null;
    }
    const [task] = await findDeliveryTaskContext(notification.resourceId);

    if (!task) {
      return null;
    }

    return {
      workspaceId: task.workspaceId,
      workspaceName: task.workspaceName,
      projectId: task.projectId,
      projectName: task.projectName,
      taskId: task.taskId,
      taskTitle: task.taskTitle,
      taskUrl: buildTaskUrl(task.workspaceId, task.projectId, task.taskId),
    };
  }

  if (notification.resourceType === "workspace") {
    const [workspace] = await findDeliveryWorkspaceContext(
      notification.resourceId,
      notification.userId,
    );

    if (!workspace) {
      return null;
    }

    return {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.workspaceName,
      projectId: null,
      projectName: null,
      taskId: null,
      taskTitle: null,
      taskUrl: null,
    };
  }

  return null;
}

async function sendNtfyNotification(input: {
  serverUrl: string;
  topic: string;
  token?: string | null;
  title: string;
  body: string;
  clickUrl?: string | null;
  idempotencyKey?: string;
  canSend?: () => Promise<boolean>;
}) {
  await assertPublicWebhookDestination(input.serverUrl);
  if (input.canSend && !(await input.canSend())) return;

  const response = await sendWithTimeout(
    `${input.serverUrl.replace(/\/+$/, "")}/${encodeURIComponent(input.topic)}`,
    {
      method: "POST",
      headers: {
        ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
        ...(input.clickUrl ? { Click: input.clickUrl } : {}),
        ...(input.idempotencyKey
          ? { "Idempotency-Key": input.idempotencyKey }
          : {}),
        Title: input.title,
      },
      body: input.body,
    },
  );

  if (!response.ok) {
    throw new Error(
      `ntfy delivery failed (${response.status}): ${redactSensitiveValues(
        await response.text(),
        [input.token],
      )}`,
    );
  }
}

async function sendGotifyNotification(input: {
  serverUrl: string;
  token: string;
  title: string;
  body: string;
  clickUrl?: string | null;
  idempotencyKey?: string;
  canSend?: () => Promise<boolean>;
}) {
  await assertPublicWebhookDestination(input.serverUrl);
  if (input.canSend && !(await input.canSend())) return;

  // Gotify expects the app token in the query string; that can surface in logs, proxies, and browser history, so factor this into Gotify placement and log handling.
  const response = await sendWithTimeout(
    `${input.serverUrl.replace(/\/+$/, "")}/message?token=${encodeURIComponent(
      input.token,
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.idempotencyKey
          ? { "Idempotency-Key": input.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({
        title: input.title,
        message: input.body,
        priority: 5,
        extras: input.clickUrl
          ? {
              "client::notification": {
                click: {
                  url: input.clickUrl,
                },
              },
              "client::display": {
                contentType: "text/plain",
              },
            }
          : undefined,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gotify delivery failed (${response.status}): ${redactSensitiveValues(
        await response.text(),
        [input.token],
      )}`,
    );
  }
}

async function sendWebhookNotification(input: {
  webhookUrl: string;
  secret?: string | null;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  canSend?: () => Promise<boolean>;
}) {
  await assertPublicWebhookDestination(input.webhookUrl);
  if (input.canSend && !(await input.canSend())) return;

  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(input.idempotencyKey
      ? { "Idempotency-Key": input.idempotencyKey }
      : {}),
  };

  if (input.secret) {
    headers["X-TaskDesk-Signature"] = createHmac("sha256", input.secret)
      .update(body)
      .digest("hex");
  }

  const response = await sendWithTimeout(input.webhookUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `Webhook delivery failed (${response.status}): ${redactSensitiveValues(
        await response.text(),
        [input.secret],
      )}`,
    );
  }
}

/**
 * `NO-3` for the legacy producers (`task.*` subscribers, due-date reminders): external delivery
 * is held while the recipient is inside their quiet hours and retried when the window ends. The
 * in-app inbox row is already written and is unaffected. Malformed quiet hours fail closed (no
 * external delivery) rather than sending at an unknown hour.
 */
export async function legacyQuietHoursDecision(
  userId: string,
  now: Date,
): Promise<
  { kind: "send" } | { kind: "defer"; until: Date } | { kind: "withhold" }
> {
  const { setting, fallbackTimezone } = await findDeliveryQuietHours(userId);
  const decision = evaluateQuietHours(setting, fallbackTimezone, now);
  if (decision.kind === "quiet")
    return { kind: "defer", until: decision.until };
  if (decision.kind === "unresolved") return { kind: "withhold" };
  return { kind: "send" };
}

export type LegacyNotificationDeliveryOutcome =
  | "delivered"
  | "deferred"
  | "withheld"
  | "skipped"
  | "retry";

/** Sends exactly one inherited notify.* channel for a child-backed event. */
export async function sendLegacyNotificationChannel(input: {
  eventId: string;
  recipientPersonId: string;
  channel: "notify.email" | "notify.webhook" | "notify.ntfy" | "notify.gotify";
  idempotencyKey: string;
  signal: AbortSignal;
  authorize: () => Promise<boolean>;
}): Promise<void> {
  const notification = await findDeliveryEventNotification(
    input.eventId,
    input.recipientPersonId,
  );
  if (!notification) throw new Error("Notification row unavailable");
  const context = await resolveNotificationContext(notification);
  if (!context) throw new Error("Notification task context unavailable");
  const [user] = await findDeliveryUser(notification.userId);
  const preference = await findDeliveryPreference(notification.userId);
  const rule = await findDeliveryWorkspaceRule(
    notification.userId,
    context.workspaceId,
  );
  if (!user || !preference || !rule?.isActive)
    throw new Error("Notification destination unavailable");
  if (
    rule.projectMode === "selected" &&
    (!context.projectId ||
      !rule.selectedProjects.some(
        (project) => project.projectId === context.projectId,
      ))
  )
    throw new Error("Notification project is no longer selected");
  const decrypted = {
    ...preference,
    ntfyToken: decryptSecret(preference.ntfyToken),
    gotifyToken: decryptSecret(preference.gotifyToken),
    webhookSecret: decryptSecret(preference.webhookSecret),
  };
  const eventData =
    notification.eventData &&
    typeof notification.eventData === "object" &&
    !Array.isArray(notification.eventData)
      ? Object.fromEntries(
          Object.entries(notification.eventData).filter(
            ([key]) => key !== QUIET_HOURS_HOLD_KEY,
          ),
        )
      : null;
  const publicEventData = withoutNotificationCopyDescriptor(
    eventData,
  ) as Record<string, unknown> | null;
  const content = buildDeliveryContent({
    type: notification.type,
    title: notification.title,
    content: notification.content,
    eventData: publicEventData,
  });
  const descriptor = parseNotificationCopyDescriptor(eventData?.systemCopy);
  const canSend = async () =>
    !input.signal.aborted && (await input.authorize());
  if (!(await canSend())) throw new Error("Notification eligibility changed");
  let deliveryContent = content;
  if (descriptor && notification.personId) {
    const [recipient] = await findDeliveryPersonSide(notification.personId);
    let locale = "en-US";
    try {
      locale = requireTerminologyLocale(
        user.locale ?? recipient?.locale ?? "en-US",
      );
    } catch {
      // Unknown legacy locale uses the shipped English terminology.
    }
    const rendered = await renderNotificationCopyDescriptor(
      descriptor,
      (termKey, count) =>
        resolveTermForm({
          locale,
          audience: recipient?.side === "customer" ? "customer" : "agent",
          termKey,
          count,
          workspaceId: context.workspaceId,
        }),
    ).catch(() => null);
    if (rendered) deliveryContent = rendered;
  }
  if (input.channel === "notify.email") {
    if (!decrypted.emailEnabled || !rule.emailEnabled || !user.email)
      throw new Error("Notification email destination unavailable");
    const result = await sendNotificationEmail(
      user.email,
      deliveryContent.title,
      {
        title: deliveryContent.title,
        message: deliveryContent.body,
        actionUrl: context.taskUrl,
        actionLabel: context.taskUrl ? "Open in TaskDesk" : undefined,
        locale: user.locale ?? null,
      },
      {
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
        authorize: canSend,
      },
    );
    if (!result.success) throw new Error("Notification email provider failed");
    return;
  }
  if (input.channel === "notify.ntfy") {
    if (
      !decrypted.ntfyEnabled ||
      !decrypted.ntfyServerUrl ||
      !decrypted.ntfyTopic ||
      !rule.ntfyEnabled
    )
      throw new Error("Notification ntfy destination unavailable");
    await sendNtfyNotification({
      serverUrl: decrypted.ntfyServerUrl,
      topic: decrypted.ntfyTopic,
      token: decrypted.ntfyToken,
      title: deliveryContent.title,
      body: deliveryContent.body,
      clickUrl: context.taskUrl,
      idempotencyKey: input.idempotencyKey,
      canSend,
    });
    return;
  }
  if (input.channel === "notify.gotify") {
    if (
      !decrypted.gotifyEnabled ||
      !decrypted.gotifyServerUrl ||
      !decrypted.gotifyToken ||
      !rule.gotifyEnabled
    )
      throw new Error("Notification gotify destination unavailable");
    await sendGotifyNotification({
      serverUrl: decrypted.gotifyServerUrl,
      token: decrypted.gotifyToken,
      title: deliveryContent.title,
      body: deliveryContent.body,
      clickUrl: context.taskUrl,
      idempotencyKey: input.idempotencyKey,
      canSend,
    });
    return;
  }
  if (
    !decrypted.webhookEnabled ||
    !decrypted.webhookUrl ||
    !rule.webhookEnabled
  )
    throw new Error("Notification webhook destination unavailable");
  await sendWebhookNotification({
    webhookUrl: decrypted.webhookUrl,
    secret: decrypted.webhookSecret,
    idempotencyKey: input.idempotencyKey,
    payload: {
      notification: {
        id: notification.id,
        type: notification.type,
        title: deliveryContent.title,
        content: deliveryContent.body,
        createdAt: notification.createdAt,
        eventData: publicEventData,
        resourceId: notification.resourceId,
        resourceType: notification.resourceType,
      },
      workspace: { id: context.workspaceId, name: context.workspaceName },
      project: context.projectId
        ? { id: context.projectId, name: context.projectName }
        : null,
      task: context.taskId
        ? { id: context.taskId, title: context.taskTitle, url: context.taskUrl }
        : null,
      user: { id: notification.userId, email: user.email, name: user.name },
    },
    canSend,
  });
}

export async function deliverNotification(
  notificationId: string,
): Promise<LegacyNotificationDeliveryOutcome> {
  const notification = await findDeliveryNotification(notificationId);

  if (!notification) {
    return "skipped";
  }

  const context = await resolveNotificationContext(notification);
  if (!context) {
    console.info("Notification delivery skipped: unresolved context", {
      notificationId,
      notificationTableId: notification.id,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      reason:
        "resolveNotificationContext returned null (missing resource, deleted task, or unsupported resource type)",
    });
    return "skipped";
  }

  const [user] = await findDeliveryUser(notification.userId);

  if (!user) {
    return "skipped";
  }

  const preference = await findDeliveryPreference(notification.userId);

  if (!preference) {
    return "skipped";
  }

  // SLA breach and approval expiry ignore quiet hours (`NO-3`).
  const exempt =
    notification.kind !== null &&
    notification.kind !== undefined &&
    QUIET_HOURS_EXEMPT_EVENT_KINDS.has(notification.kind);
  const quiet = exempt
    ? ({ kind: "send" } as const)
    : await legacyQuietHoursDecision(notification.userId, new Date());
  if (quiet.kind === "defer") {
    // Durable hold: persisted on the notification row, released by the scheduler once the
    // window ends. An in-process timer would be lost on restart.
    await holdDeliveryUntil(notificationId, quiet.until);
    return "deferred";
  }
  if (quiet.kind === "withhold") {
    console.info("Notification delivery withheld: quiet hours unresolved", {
      notificationId,
    });
    return "withheld";
  }

  const decryptedPreference = {
    ...preference,
    ntfyToken: decryptSecret(preference.ntfyToken),
    gotifyToken: decryptSecret(preference.gotifyToken),
    webhookSecret: decryptSecret(preference.webhookSecret),
  };

  const rule = await findDeliveryWorkspaceRule(
    notification.userId,
    context.workspaceId,
  );

  if (!rule?.isActive) {
    return "skipped";
  }

  if (
    rule.projectMode === "selected" &&
    (!context.projectId ||
      !rule.selectedProjects.some(
        (project) => project.projectId === context.projectId,
      ))
  ) {
    return "skipped";
  }

  if (
    notification.resourceType === "task" &&
    (!notification.resourceId ||
      !(await userCanReachTask(notification.userId, notification.resourceId)))
  ) {
    return "skipped";
  }

  // The durable quiet-hours marker is delivery bookkeeping, never content.
  let publicEventData: Record<string, unknown> | null = null;
  if (
    notification.eventData &&
    typeof notification.eventData === "object" &&
    !Array.isArray(notification.eventData)
  ) {
    const { [QUIET_HOURS_HOLD_KEY]: _held, ...rest } =
      notification.eventData as Record<string, unknown>;
    publicEventData = withoutNotificationCopyDescriptor(rest) as Record<
      string,
      unknown
    >;
  }

  const content = buildDeliveryContent({
    type: notification.type,
    title: notification.title ?? null,
    content: notification.content ?? null,
    eventData: publicEventData,
  });
  const sourceEventData =
    notification.eventData &&
    typeof notification.eventData === "object" &&
    !Array.isArray(notification.eventData)
      ? (notification.eventData as Record<string, unknown>)
      : null;
  const descriptor = parseNotificationCopyDescriptor(
    sourceEventData?.systemCopy,
  );
  let deliveryContent = content;
  if (descriptor && notification.personId) {
    const [recipient] = await findDeliveryPersonSide(notification.personId);
    let locale = "en-US";
    try {
      locale = requireTerminologyLocale(
        user.locale ?? recipient?.locale ?? "en-US",
      );
    } catch {
      // Unknown legacy locale uses the shipped English terminology.
    }
    const rendered = await renderNotificationCopyDescriptor(
      descriptor,
      (termKey, count) =>
        resolveTermForm({
          locale,
          audience: recipient?.side === "customer" ? "customer" : "agent",
          termKey,
          count,
          workspaceId: context.workspaceId,
        }),
    ).catch(() => null);
    if (rendered) deliveryContent = rendered;
  }

  const webhookPayload = {
    notification: {
      id: notification.id,
      type: notification.type,
      title: deliveryContent.title,
      content: deliveryContent.body,
      createdAt: notification.createdAt,
      eventData: publicEventData,
      resourceId: notification.resourceId,
      resourceType: notification.resourceType,
    },
    workspace: {
      id: context.workspaceId,
      name: context.workspaceName,
    },
    project: context.projectId
      ? {
          id: context.projectId,
          name: context.projectName,
        }
      : null,
    task: context.taskId
      ? {
          id: context.taskId,
          title: context.taskTitle,
          url: context.taskUrl,
        }
      : null,
    user: {
      id: notification.userId,
      email: user.email,
      name: user.name,
    },
  };

  const canSendToTask = async () =>
    notification.resourceType !== "task" ||
    (Boolean(notification.resourceId) &&
      (await userCanReachTask(
        notification.userId,
        notification.resourceId as string,
      )));

  const deliveries: Array<Promise<void>> = [];

  if (decryptedPreference.emailEnabled && rule.emailEnabled && user.email) {
    if (await canSendToTask()) {
      deliveries.push(
        sendNotificationEmail(
          user.email,
          deliveryContent.title,
          {
            title: deliveryContent.title,
            message: deliveryContent.body,
            actionUrl: context.taskUrl,
            actionLabel: context.taskUrl ? "Open in TaskDesk" : undefined,
            locale: user.locale ?? null,
          },
          { authorize: canSendToTask },
        ).then(() => undefined),
      );
    }
  }

  if (
    decryptedPreference.ntfyEnabled &&
    decryptedPreference.ntfyServerUrl &&
    decryptedPreference.ntfyTopic &&
    rule.ntfyEnabled
  ) {
    deliveries.push(
      sendNtfyNotification({
        serverUrl: decryptedPreference.ntfyServerUrl,
        topic: decryptedPreference.ntfyTopic,
        token: decryptedPreference.ntfyToken,
        title: deliveryContent.title,
        body: deliveryContent.body,
        clickUrl: context.taskUrl,
        canSend: canSendToTask,
      }),
    );
  }

  if (
    decryptedPreference.gotifyEnabled &&
    decryptedPreference.gotifyServerUrl &&
    decryptedPreference.gotifyToken &&
    rule.gotifyEnabled
  ) {
    deliveries.push(
      sendGotifyNotification({
        serverUrl: decryptedPreference.gotifyServerUrl,
        token: decryptedPreference.gotifyToken,
        title: deliveryContent.title,
        body: deliveryContent.body,
        clickUrl: context.taskUrl,
        canSend: canSendToTask,
      }),
    );
  }

  if (
    decryptedPreference.webhookEnabled &&
    decryptedPreference.webhookUrl &&
    rule.webhookEnabled
  ) {
    deliveries.push(
      sendWebhookNotification({
        webhookUrl: decryptedPreference.webhookUrl,
        secret: decryptedPreference.webhookSecret,
        payload: webhookPayload,
        canSend: canSendToTask,
      }),
    );
  }

  const results = await Promise.allSettled(deliveries);
  let failed = false;
  for (const result of results) {
    if (result.status === "rejected") {
      failed = true;
      console.error("Notification delivery failed", {
        notificationId,
        error: result.reason,
      });
    }
  }
  return failed ? "retry" : "delivered";
}
