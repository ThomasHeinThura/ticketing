const DEFAULT_REQUEST_LIMIT = 2_048;
const DEFAULT_EVENT_LIMIT = 250_000;

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function timestampState(event, key) {
  if (!Object.hasOwn(event, key)) return { state: "missing", value: undefined };
  const value = event[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    return { state: "invalid", value: undefined };
  return { state: "valid", value };
}

export function createColdRequestLifecycle({
  maxRequests = DEFAULT_REQUEST_LIMIT,
  maxEvents = DEFAULT_EVENT_LIMIT,
} = {}) {
  const requests = new Map();
  const anomalies = {
    unexpectedSameIdReplacement: 0,
    duplicateTerminal: 0,
  };
  let requestOverflow = false;
  let anomalyOverflow = false;
  let protocolIntegrityFailure = false;

  function incrementAnomaly(name) {
    if (anomalies[name] >= maxEvents) {
      anomalyOverflow = true;
      protocolIntegrityFailure = true;
      return;
    }
    anomalies[name] += 1;
    if (anomalies[name] >= maxEvents) {
      anomalyOverflow = true;
      protocolIntegrityFailure = true;
    }
  }

  function requestWillBeSent(eventValue, data) {
    const event = asRecord(eventValue);
    const requestId = event?.requestId;
    if (typeof requestId !== "string") return false;
    if (requests.size >= maxRequests) {
      requestOverflow = true;
      return false;
    }

    const prior = requests.get(requestId);
    const redirectResponse = asRecord(event.redirectResponse);
    const replacedAfterRedirect = Boolean(prior && redirectResponse);
    if (prior && !redirectResponse) {
      incrementAnomaly("unexpectedSameIdReplacement");
      protocolIntegrityFailure = true;
    }

    const start = timestampState(event, "timestamp");
    requests.set(requestId, {
      ...data,
      startClock: start.state,
      terminalClock: "not-seen",
      startTimestamp: start.value,
      endTimestamp: undefined,
      responseSeen: false,
      failed: false,
      replacedAfterRedirect,
    });
    return true;
  }

  function responseReceived(eventValue, data) {
    const event = asRecord(eventValue);
    const request =
      typeof event?.requestId === "string"
        ? requests.get(event.requestId)
        : undefined;
    if (!request) return false;
    request.responseSeen = true;
    if (data && typeof data === "object") Object.assign(request, data);
    return true;
  }

  function update(eventValue, data) {
    const event = asRecord(eventValue);
    const request =
      typeof event?.requestId === "string"
        ? requests.get(event.requestId)
        : undefined;
    if (!request) {
      protocolIntegrityFailure = true;
      return false;
    }
    if (data && typeof data === "object") Object.assign(request, data);
    return true;
  }

  function terminal(eventValue, failed) {
    const event = asRecord(eventValue);
    const request =
      typeof event?.requestId === "string"
        ? requests.get(event.requestId)
        : undefined;
    if (!request) {
      protocolIntegrityFailure = true;
      return false;
    }
    if (request.terminalClock !== "not-seen") {
      incrementAnomaly("duplicateTerminal");
      protocolIntegrityFailure = true;
      return false;
    }
    const end = timestampState(event, "timestamp");
    request.terminalClock = end.state;
    request.endTimestamp = end.value;
    request.failed = failed;
    return true;
  }

  function snapshot() {
    const entries = [...requests.entries()].map(([requestId, request]) => ({
      requestId,
      ...request,
    }));
    const trackedRequests = entries.length;
    const incomplete = entries.filter(
      (request) =>
        request.startClock !== "valid" || request.terminalClock !== "valid",
    );
    const networkClockState = {
      invalidStart: entries.filter((request) => request.startClock !== "valid")
        .length,
      terminalNotSeen: entries.filter(
        (request) => request.terminalClock === "not-seen",
      ).length,
      invalidTerminal: entries.filter(
        (request) =>
          request.terminalClock === "missing" ||
          request.terminalClock === "invalid",
      ).length,
      notSeenAfterResponse: entries.filter(
        (request) =>
          request.terminalClock === "not-seen" && request.responseSeen,
      ).length,
      incompleteAfterRedirect: incomplete.filter(
        (request) => request.replacedAfterRedirect,
      ).length,
      unexpectedSameIdReplacement: anomalies.unexpectedSameIdReplacement,
      duplicateTerminal: anomalies.duplicateTerminal,
    };
    const immutableEntries = entries.map((request) => Object.freeze(request));
    return Object.freeze({
      requests: Object.freeze(immutableEntries),
      trackedRequests,
      incompleteTrackedRequests: incomplete.length,
      networkClockState: Object.freeze(networkClockState),
      requestOverflow,
      anomalyOverflow,
      protocolIntegrityFailure,
    });
  }

  return Object.freeze({
    requestWillBeSent,
    responseReceived,
    update,
    loadingFinished: (event) => terminal(event, false),
    loadingFailed: (event) => terminal(event, true),
    snapshot,
  });
}
