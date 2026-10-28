import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type { WorkItemSearchColumn, WorkItemSort } from "@/lib/routes";
import type {
  WorkItem,
  WorkItemCustomFieldColumn,
  WorkItemCustomFieldPerson,
} from "@/types/work-item";

export type QueueVisibility = "private" | "team";
export type IntakeQueueVersions = { submission: number; workItem: number };
export type IntakeQueueSummary = {
  id: string;
  workspaceId: string;
  name: string;
  visibility: QueueVisibility;
  sharedWithTeamId: string | null;
  versions: IntakeQueueVersions;
};
export type IntakeQueue = IntakeQueueSummary & {
  createdBy: string;
  submissionView: { id: string; query: unknown; updatedAt: string };
  workItemView: { id: string; query: unknown; updatedAt: string };
};
export type QueueSubmissionRow = {
  ref: string;
  summary: string;
  submission: {
    id: string;
    number: number;
    state: string;
    customerVisibility: string;
    claimedBy: string | null;
    claimedAt: string | null;
    createdAt: string;
  };
  requestType: { id: string; key: string; name: string };
  requester: { id: string; displayName: string | null };
  organisation: { id: string; name: string };
  suggestedDuplicates?: Array<{
    id: string;
    key: string;
    title: string;
    score: number;
  }>;
};
export type IntakeQueueRun = {
  queue: {
    id: string;
    name: string;
    visibility: QueueVisibility;
    versions: IntakeQueueVersions;
  };
  submissions: {
    submissions: QueueSubmissionRow[];
    page: { nextCursor: string | null; hasMore: boolean };
    meta: { total: number };
  };
  workItems: {
    data: WorkItem[];
    page: { nextCursor: string | null; hasMore: boolean };
    meta: { total: number };
    customFieldColumns?: WorkItemCustomFieldColumn[];
    customFieldPeople?: WorkItemCustomFieldPerson[];
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to load intake queue"),
    );
  return (await response.json()) as T;
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

export function listIntakeQueues(workspaceId: string) {
  return request<IntakeQueueSummary[]>(
    `intake/queues?${queryString({ workspaceId })}`,
  );
}

export function getIntakeQueue(input: { id: string; workspaceId: string }) {
  return request<IntakeQueue>(
    `intake/queues/${encodeURIComponent(input.id)}?${queryString({ workspaceId: input.workspaceId })}`,
  );
}

export function createIntakeQueue(input: {
  workspaceId: string;
  name: string;
  visibility: QueueVisibility;
  sharedWithTeamId?: string;
  submissionQuery: Record<string, unknown>;
  workItemQuery: Record<string, unknown>;
}) {
  return request<IntakeQueue>("intake/queues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateIntakeQueue(input: {
  id: string;
  workspaceId: string;
  expectedVersions: IntakeQueueVersions;
  name?: string;
  visibility?: QueueVisibility;
  sharedWithTeamId?: string | null;
  submissionQuery?: Record<string, unknown>;
  workItemQuery?: Record<string, unknown>;
}) {
  const { id, ...body } = input;
  return request<IntakeQueue>(`intake/queues/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runIntakeQueue(input: {
  id: string;
  workspaceId: string;
  limit?: number;
  submissionCursor?: string;
  workItemCursor?: string;
  state?: string;
  requestTypeKey?: string;
  assignee?: "claimed" | "unclaimed";
  olderThanDays?: number;
  workItemFilter?: string;
  workItemSorts?: WorkItemSort[];
  workItemColumns?: WorkItemSearchColumn[];
}) {
  const { id, workItemSorts, workItemColumns, ...query } = input;
  const params = {
    ...query,
    ...(workItemSorts ? { workItemSorts: JSON.stringify(workItemSorts) } : {}),
    ...(workItemColumns ? { workItemColumns: workItemColumns.join(",") } : {}),
  };
  return request<IntakeQueueRun>(
    `intake/queues/${encodeURIComponent(id)}/run?${queryString(params)}`,
  );
}
