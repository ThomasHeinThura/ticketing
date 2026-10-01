/**
 * @param {{cpuProfile?: {nodes?: Array<{id?: number, children?: number[], callFrame?: unknown}>, samples?: number[], timeDeltas?: number[], startTime?: number, endTime?: number}, traceEvents?: Array<{name?: string, cat?: string, ph?: string, ts?: number}>, counts?: {cpuProfileNodes?: number, cpuSamples?: number, timeDeltas?: number, timelineEvents?: number}, tracingComplete?: {dataLossOccurred?: boolean}}} payload
 * @param {string} path
 */
export function assertHostedCaptureComplete(payload, path) {
  const profile = payload.cpuProfile;
  const nodes = profile?.nodes;
  const samples = profile?.samples;
  const deltas = profile?.timeDeltas;
  const nodeIds = new Set(nodes?.map((node) => node.id));
  const validNodes =
    Array.isArray(nodes) &&
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        Number.isInteger(node.id) &&
        node.id > 0 &&
        node.callFrame !== null &&
        typeof node.callFrame === "object" &&
        (node.children ?? []).every((child) => nodeIds.has(child)),
    );
  const validSamples =
    Array.isArray(samples) &&
    samples.length > 0 &&
    Array.isArray(deltas) &&
    deltas.length === samples.length &&
    samples.every((sample) => nodeIds.has(sample)) &&
    deltas.every((delta) => Number.isFinite(delta) && delta > 0);
  const validProfileTiming =
    Number.isFinite(profile?.startTime) &&
    Number.isFinite(profile?.endTime) &&
    profile.endTime > profile.startTime;
  const timelineEvents = payload.traceEvents;
  const hasTimelineData =
    Array.isArray(timelineEvents) &&
    timelineEvents.some(
      (event) =>
        typeof event.name === "string" &&
        typeof event.cat === "string" &&
        event.cat.split(",").includes("devtools.timeline") &&
        ["X", "B", "E"].includes(event.ph) &&
        Number.isFinite(event.ts),
    );
  if (
    !validNodes ||
    !validSamples ||
    !validProfileTiming ||
    !hasTimelineData ||
    payload.counts?.cpuProfileNodes !== nodes?.length ||
    payload.counts?.cpuSamples !== samples?.length ||
    payload.counts?.timeDeltas !== deltas?.length ||
    payload.counts?.timelineEvents !== timelineEvents?.length ||
    payload.tracingComplete?.dataLossOccurred !== false
  ) {
    throw new Error(
      `Incomplete or malformed hosted profile; raw payload was saved to ${path}`,
    );
  }
}
