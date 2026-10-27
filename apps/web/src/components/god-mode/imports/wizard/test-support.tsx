import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  EngineRun,
  ImportDryRunReport,
  ImportMapping,
  MappingEntry,
} from "@/fetchers/god-mode/imports";
import { translate } from "@/test/en-translation";

/** `useTranslation` backed by the real en-US catalogue, so a missing key fails the test. */
export function i18nMock() {
  return {
    useTranslation: (ns?: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(
          key.includes(":") ? key : `${ns ?? "common"}:${key}`,
          options,
        ),
    }),
  };
}

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return {
    ...result,
    client,
    /** Re-renders with the same query client (a step receiving a newer polled run). */
    rerender: (next: ReactElement) =>
      result.rerender(
        <QueryClientProvider client={client}>{next}</QueryClientProvider>,
      ),
  };
}

/** A background setup step as the engine DTO reports it. */
export function setupJob(
  overrides: Partial<NonNullable<EngineRun["job"]>> = {},
): NonNullable<EngineRun["job"]> {
  return {
    kind: "discover",
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    heartbeatAt: null,
    pagesRead: 0,
    recordsProcessed: 0,
    totalRecords: null,
    failure: null,
    ...overrides,
  };
}

export function engineRun(overrides: Partial<EngineRun> = {}): EngineRun {
  return {
    id: "run-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    pluginId: "import.jira",
    sourceRef: "Support migration",
    sourceConnectionId: "source-1",
    state: "queued",
    phase: "dry_run_ready",
    pausedReason: null,
    version: 4,
    mappingVersion: 3,
    stats: {},
    cursor: null,
    job: null,
    dryRun: {
      digest: "a".repeat(64),
      mappingVersion: 3,
      total: 100,
      writes: 90,
      at: "2026-10-26T10:00:00.000Z",
    },
    approval: {
      required: false,
      approved: false,
      digest: null,
      totalCount: null,
      mappingVersion: null,
      pendingActionId: null,
    },
    createdAt: "2026-10-26T09:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    ...overrides,
  };
}

export const completeness = (
  overrides: Partial<ImportMapping["completeness"]> = {},
): ImportMapping["completeness"] => ({
  complete: true,
  total: 0,
  unmapped: 0,
  proposed: 0,
  confirmed: 0,
  ignored: 0,
  blocking: [],
  stateGroups: {
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
  },
  ...overrides,
});

export function mappingOf(
  entries: MappingEntry[],
  mappingVersion = 3,
): ImportMapping {
  const open = entries.filter((e) => e.status !== "confirmed").length;
  return {
    runId: "run-1",
    mappingVersion,
    entries,
    completeness: completeness({ complete: open === 0, total: entries.length }),
    discovery: null,
  };
}

export function dryRunReport(
  overrides: Partial<ImportDryRunReport> = {},
): ImportDryRunReport {
  return {
    digest: "b".repeat(64),
    mappingVersion: 3,
    complete: true,
    generatedAt: "2026-10-26T10:00:00.000Z",
    counts: {
      created: 70,
      updated: 20,
      skipped: 8,
      rejected: 2,
      processed: 100,
    },
    writes: 90,
    byType: {
      issue: {
        created: 70,
        updated: 20,
        skipped: 8,
        rejected: 2,
        processed: 100,
      },
    },
    rejectionCodes: { invalid_target_record: 2 },
    losses: [
      {
        sourceType: "issue",
        code: "rich_text_lossy",
        detailCode: "table",
        count: 12,
      },
    ],
    lossRecords: 12,
    cycleBreaks: 0,
    samples: { rejects: [], losses: [] },
    completeness: completeness(),
    approvalRequired: false,
    ...overrides,
  };
}
