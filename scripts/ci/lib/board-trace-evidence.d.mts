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

export function resolveOwnedTraceDirectory(rawPath: string): Promise<string>;

export function requireCpuParentGraph(
  profile: Record<string, unknown>,
): ReturnType<typeof summarizeCpuProfile>;
