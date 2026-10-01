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
    nodeIds.size === nodes.length &&
    nodes.every(
      (node) =>
        Number.isInteger(node.id) &&
        node.id > 0 &&
        node.callFrame !== null &&
        typeof node.callFrame === "object" &&
        (node.children === undefined ||
          (Array.isArray(node.children) &&
            node.children.every((child) => nodeIds.has(child)))),
    );
  const validSamples =
    Array.isArray(samples) &&
    samples.length > 0 &&
    Array.isArray(deltas) &&
    deltas.length === samples.length &&
    samples.every((sample) => nodeIds.has(sample)) &&
    deltas.every((delta) => Number.isFinite(delta));
  const validProfileTiming =
    Number.isFinite(profile?.startTime) &&
    Number.isFinite(profile?.endTime) &&
    profile.endTime > profile.startTime;
  let sampleTime = profile?.startTime;
  const reconstructedSampleTimes = Array.isArray(deltas)
    ? deltas.map((delta) => {
        sampleTime += delta;
        return sampleTime;
      })
    : [];
  const validSampleTiming =
    validProfileTiming &&
    reconstructedSampleTimes.length === samples?.length &&
    reconstructedSampleTimes.every(
      (timestamp) =>
        Number.isFinite(timestamp) &&
        timestamp >= profile.startTime &&
        timestamp <= profile.endTime,
    );
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
    !validSampleTiming ||
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

export function rewriteHostedProfileOrigin(source) {
  const canonicalOrigin = "http://127.0.0.1:4178";
  const diagnosticOrigin = "http://127.0.0.1:4179";
  const occurrences = source.split(canonicalOrigin).length - 1;
  if (occurrences !== 3) {
    throw new Error(
      `Expected exactly 3 canonical preview origins in copied benchmark; found ${occurrences}`,
    );
  }
  const rewritten = source.replaceAll(canonicalOrigin, diagnosticOrigin);
  if (rewritten.includes(canonicalOrigin) || occurrences !== 3) {
    throw new Error("Hosted profile origin rewrite was incomplete");
  }
  return rewritten;
}

export function parseCandidateSha(args) {
  const arg = args.find((value) => value.startsWith("--candidate-sha="));
  if (!arg) return null;
  const value = arg.slice("--candidate-sha=".length);
  if (value === "") return null;
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(
      "--candidate-sha must be an empty value or a 40-character Git SHA",
    );
  }
  return value;
}
