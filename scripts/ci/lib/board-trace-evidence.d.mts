export type ChromeTraceEvent = {
  name: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
};

export function summarizeLayoutEvents(events: ChromeTraceEvent[]): Array<{
  name: string;
  category?: string;
  phase?: string;
  timestampMicroseconds?: number;
  durationMicroseconds: number;
  processId?: number;
  threadId?: number;
}>;

export function summarizeCpuProfile(profile: Record<string, unknown>): {
  nodeCount: number;
  parentEdgeCount: number;
  sampleCount: number;
  nodes: Array<Record<string, unknown>>;
  samples: unknown[];
  timeDeltas: unknown[];
  startTime?: number;
  endTime?: number;
};

export function assetMapPathFromScriptUrl(
  scriptUrl: string,
  baseUrl: string,
  assetsDirectory: string,
): string | null;

export function readSafeSourceMap(
  mapPath: string,
  assetsDirectory: string,
): Promise<{
  contents: Buffer;
  sha256: string;
  sources: string[];
  sourceCount: number;
}>;

export type EvidenceOwnership = {
  runnerTemp: string;
  runId: string;
  runSha: string;
  repo: string;
  sourceName: "accepted-f10" | "current-10034";
};

export function resolveOwnedTraceDirectory(
  rawPath: string,
  ownership: EvidenceOwnership,
): Promise<string>;

export function requireCpuParentGraph(
  profile: Record<string, unknown>,
): ReturnType<typeof summarizeCpuProfile>;

export function withCdpTraceLifecycle<T>(
  session: {
    send(command: string, params?: Record<string, unknown>): Promise<unknown>;
    once(event: string, listener: (value: unknown) => void): unknown;
    detach(): Promise<void>;
  },
  captureBody: () => Promise<T>,
): Promise<{
  result: T;
  profile: Record<string, unknown>;
  traceCompletion: unknown;
}>;
