import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishEventMock } = vi.hoisted(() => ({
  publishEventMock: vi.fn(),
}));

vi.mock("../../apps/api/src/database", () => ({ schema: {} }));
vi.mock("../../apps/api/src/events", () => ({
  publishEvent: publishEventMock,
}));
vi.mock("../../apps/api/src/events/outbox", () => ({
  enqueueOutboxEvent: vi.fn(),
}));

import { notifySubmissionEvent } from "../../apps/api/src/request-type/events";

const submissionEvents = [
  {
    kind: "submission.received",
    payload: {
      ref: "SUB-1",
      requestTypeId: "type-1",
      organisationId: "org-1",
    },
  },
  { kind: "submission.replied", payload: { ref: "SUB-2", by: "customer" } },
  {
    kind: "submission.accepted",
    payload: { ref: "SUB-3", workItemKey: "WI-3" },
  },
  {
    kind: "submission.declined",
    payload: { ref: "SUB-4", reason: "Out of scope" },
  },
  { kind: "submission.withdrawn", payload: { ref: "SUB-5" } },
] satisfies Parameters<typeof notifySubmissionEvent>[0][];

describe("notifySubmissionEvent", () => {
  beforeEach(() => {
    publishEventMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(submissionEvents)(
    "publishes the approved $kind event and exact payload",
    async (event) => {
      await notifySubmissionEvent(event);

      expect(publishEventMock).toHaveBeenCalledExactlyOnceWith(
        event.kind,
        event.payload,
      );
    },
  );

  it("keeps notification failures from rejecting the committed request", async () => {
    const error = new Error("listener unavailable");
    publishEventMock.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifySubmissionEvent({
        kind: "submission.received",
        payload: {
          ref: "SUB-6",
          requestTypeId: "type-6",
          organisationId: "org-6",
        },
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Submission event notification failed; durable event retained",
      { kind: "submission.received", error: "listener unavailable" },
    );
  });

  it("logs a bounded fallback when a thrown value is not an Error", async () => {
    publishEventMock.mockRejectedValueOnce("secret-like thrown value");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifySubmissionEvent({
        kind: "submission.withdrawn",
        payload: { ref: "SUB-7" },
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledExactlyOnceWith(
      "Submission event notification failed; durable event retained",
      { kind: "submission.withdrawn", error: "unknown error" },
    );
  });
});
