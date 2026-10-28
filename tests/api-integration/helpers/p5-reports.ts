import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { mockAuthenticatedSession } from "./auth";
import { createCustomerPrincipal } from "./customer-principal";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./fixtures";
import { setTimeFlags, type TimeWorld, timeWorld } from "./p5-time";

export async function setFeature(
  workspaceId: string,
  key: string,
  enabled: boolean,
) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: key, enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey: key, enabled })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled },
    });
}

export function daysAgo(days: number, from = new Date()) {
  return new Date(from.getTime() - days * 86_400_000);
}

type User = Parameters<typeof mockAuthenticatedSession>[0];

/**
 * The P5 time world (owner, lead, member, viewer, outsider; projects A and B) with reports on, a
 * customer principal bound to project A's organisation, and helpers that write work items with
 * known ages, outcomes and SLA state straight into the tables so every report has a known answer.
 */
export async function reportsWorld(): Promise<ReportsWorld> {
  const w = await timeWorld();
  await setFeature(w.workspaceId, "feature.reports", true);
  await setFeature(w.workspaceId, "feature.knowledge_base", true);
  await setTimeFlags(w.workspaceId);
  const customer = await createCustomerPrincipal();
  await db
    .update(schema.projectTable)
    .set({ organisationId: customer.orgId })
    .where(eq(schema.projectTable.id, w.projectA.id));

  const groups: Record<string, string> = {};
  async function stateFor(projectId: string, group: "completed" | "started") {
    const cacheKey = `${projectId}:${group}`;
    const cached = groups[cacheKey];
    if (cached) return cached;
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: w.workspaceId,
          key: `st-${randomUUID()}`,
          name: group === "completed" ? "Done" : "In progress",
          group,
        })
        .returning(),
      "template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId, stateTemplateId: template.id })
        .returning(),
      "state",
    );
    groups[cacheKey] = state.id;
    return state.id;
  }

  let number = 100;
  async function addItem(input: {
    projectId?: string;
    open?: boolean;
    createdDaysAgo: number;
    resolvedDaysAgo?: number;
    priority?: "low" | "medium" | "high" | "urgent";
    assigneeId?: string;
    sla?: {
      state: "met" | "missed" | "breached" | "at_risk";
      dueDaysAhead?: number;
    };
    title?: string;
  }) {
    number += 1;
    const projectId = input.projectId ?? w.projectA.id;
    const open = input.open ?? input.resolvedDaysAgo === undefined;
    const stateId = await stateFor(projectId, open ? "started" : "completed");
    const item = requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId: w.workspaceId,
          projectId,
          typeId: w.itemA.typeId,
          stateId,
          title: input.title ?? `Report item ${number}`,
          number,
          key: `RPT-${randomUUID().slice(0, 8)}`,
          priority: input.priority ?? null,
          assigneeId: input.assigneeId ?? null,
          createdAt: daysAgo(input.createdDaysAgo),
          updatedAt: daysAgo(input.resolvedDaysAgo ?? 0),
          resolvedAt:
            input.resolvedDaysAgo === undefined
              ? null
              : daysAgo(input.resolvedDaysAgo),
        })
        .returning(),
      "item",
    );
    if (input.sla)
      await db.insert(schema.workItemSlaCacheTable).values({
        workItemId: item.id,
        metric: "resolution",
        state: input.sla.state,
        dueAt: daysAgo(-(input.sla.dueDaysAhead ?? 1)),
        computedAt: new Date(),
      });
    return item;
  }

  async function get(
    user: User,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    mockAuthenticatedSession(user);
    return await w.app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }
  async function report(user: User, key: string, query = "") {
    const response = await get(
      user,
      `/api/reports/${key}?workspaceId=${w.workspaceId}${query}`,
    );
    const text = await response.text();
    let body = {} as ReportBody;
    try {
      body = JSON.parse(text) as ReportBody;
    } catch {
      // A refusal is plain text.
    }
    return { response, body };
  }

  // A second workspace with data of its own, to prove no report reads across tenants.
  const stranger = await createWorkspaceMember({ role: "owner" });
  await setFeature(stranger.workspace.id, "feature.reports", true);
  const { project: strangerProject } = await createProjectFixture({
    workspaceId: stranger.workspace.id,
  });

  return {
    ...w,
    customer,
    stranger,
    strangerProject,
    addItem,
    get,
    report,
  };
}

export type ReportBody = {
  key: string;
  scope: { kind: "all" | "reach"; projectCount: number };
  window: {
    preset: string;
    live: boolean;
    days: number;
    from: string;
    to: string;
  };
  asOf: string;
  filters: Record<string, string>;
  options: Record<string, string>;
  choices: Array<{ key: string; selected: string | null }>;
  metrics: Array<{
    key: string;
    value: number | null;
    n: number;
    needed: number;
    unit: string;
    trend?: { status: string; direction?: string };
  }>;
  chart: null | {
    categories: string[];
    series: Array<{ key: string; values: Array<number | null> }>;
  };
  columns: Array<{ key: string; label: string; kind: string }>;
  rows: Array<Record<string, unknown>>;
  truncated?: boolean;
  empty: null | { reason: string; outsideWindow: number };
  notes: string[];
  costVisible: boolean;
};

export type ReportsWorld = TimeWorld & {
  customer: Awaited<ReturnType<typeof createCustomerPrincipal>>;
  stranger: Awaited<ReturnType<typeof createWorkspaceMember>>;
  strangerProject: Awaited<ReturnType<typeof createProjectFixture>>["project"];
  addItem: (input: {
    projectId?: string;
    open?: boolean;
    createdDaysAgo: number;
    resolvedDaysAgo?: number;
    priority?: "low" | "medium" | "high" | "urgent";
    assigneeId?: string;
    sla?: {
      state: "met" | "missed" | "breached" | "at_risk";
      dueDaysAhead?: number;
    };
    title?: string;
  }) => Promise<typeof schema.workItemTable.$inferSelect>;
  get: (
    user: User,
    path: string,
    init?: { method?: string; body?: unknown },
  ) => Promise<Response>;
  report: (
    user: User,
    key: string,
    query?: string,
  ) => Promise<{ response: Response; body: ReportBody }>;
};
