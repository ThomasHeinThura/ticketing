import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

// The recorder's default writes through the database; these tests inject their own
// recorder, so the database module is replaced to guarantee no connection is made.
vi.mock("../../apps/api/src/database", () => ({ default: {}, schema: {} }));

const {
  failOnExecutorError,
  PENDING_ACTION_EXECUTION_FAILED,
  PendingActionExecutionFailure,
  pendingActionExecutionErrorCode,
  withPendingActionFailureOutcome,
} = await import("../../apps/api/src/pending-action/execution-failure");

const input = {
  id: "pa-1",
  requesterPersonId: "person-1",
  sessionId: "session-1",
  traceId: "trace-1",
};

describe("PA-6 step 5: pending-action execution failure", () => {
  it("reduces an executor error to a closed code without its message", () => {
    const driverError = Object.assign(
      new Error('insert into "work_item" values ($1) params: secret-value'),
      { code: "23503" },
    );
    expect(pendingActionExecutionErrorCode(new Error("boom"))).toBe(
      PENDING_ACTION_EXECUTION_FAILED,
    );
    expect(
      pendingActionExecutionErrorCode(
        new Error("Failed query: secret-value", { cause: driverError }),
      ),
    ).toBe("execution_failed:23503");
    expect(pendingActionExecutionErrorCode({ code: "not a sqlstate" })).toBe(
      PENDING_ACTION_EXECUTION_FAILED,
    );
  });

  it("marks only executor errors as execution failures", async () => {
    const refused = new HTTPException(409, {
      message: "pending_action_target_changed",
    });
    await expect(
      failOnExecutorError(async (value: number) => value * 2)(21),
    ).resolves.toBe(42);
    await expect(
      failOnExecutorError(async () => {
        throw refused;
      })(),
    ).rejects.toBe(refused);
    const failure = await failOnExecutorError(async () => {
      throw new Error("disk full");
    })().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PendingActionExecutionFailure);
    expect(
      (failure as InstanceType<typeof PendingActionExecutionFailure>).code,
    ).toBe(PENDING_ACTION_EXECUTION_FAILED);
    expect((failure as Error).message).not.toContain("disk full");
  });

  it("passes transient SQLSTATEs through as retryable errors so the action stays pending", async () => {
    const record = vi.fn(async () => undefined);
    for (const [code, status, message] of [
      ["40001", 409, "pending_action_retry"],
      ["40P01", 409, "pending_action_retry"],
      ["55P03", 503, "pending_action_busy_retry"],
    ] as const) {
      const driverError = Object.assign(new Error("secret-value"), { code });
      for (const thrown of [
        driverError,
        new Error("Failed query: secret-value", { cause: driverError }),
      ]) {
        const execute = failOnExecutorError(async () => {
          throw thrown;
        });
        const error = await withPendingActionFailureOutcome(
          input,
          () => execute(),
          record,
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(status);
        expect((error as HTTPException).message).toBe(message);
      }
    }
    // Nothing was recorded: no terminal `failed` outcome for a transient conflict.
    expect(record).not.toHaveBeenCalled();
  });

  it("still fails terminally for a non-transient SQLSTATE", async () => {
    const execute = failOnExecutorError(async () => {
      throw Object.assign(new Error("fk"), { code: "23503" });
    });
    const failure = await execute().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PendingActionExecutionFailure);
  });

  it("lets a declared control-flow error keep its meaning", async () => {
    class RetrySignal extends Error {}
    const signal = new RetrySignal("retry");
    await expect(
      failOnExecutorError(
        async () => {
          throw signal;
        },
        { passthrough: (error) => error instanceof RetrySignal },
      )(),
    ).rejects.toBe(signal);
  });

  it("returns the approval result untouched when execution succeeds", async () => {
    const record = vi.fn();
    await expect(
      withPendingActionFailureOutcome(
        input,
        async () => ({ id: "pa-1", state: "executed" }),
        record,
      ),
    ).resolves.toEqual({ id: "pa-1", state: "executed" });
    expect(record).not.toHaveBeenCalled();
  });

  it("does not record a failure for an expected refusal", async () => {
    const record = vi.fn();
    const refused = new HTTPException(400, {
      message: "confirmation_mismatch",
    });
    await expect(
      withPendingActionFailureOutcome(
        input,
        async () => {
          throw refused;
        },
        record,
      ),
    ).rejects.toBe(refused);
    await expect(
      withPendingActionFailureOutcome(
        input,
        async () => {
          throw new Error("raised before the executor ran");
        },
        record,
      ),
    ).rejects.toThrow("raised before the executor ran");
    expect(record).not.toHaveBeenCalled();
  });

  it("fault injection: a throwing executor records the terminal failure and answers 500", async () => {
    const record = vi.fn(async () => undefined);
    const execute = failOnExecutorError(async () => {
      throw Object.assign(new Error("injected fault"), { code: "57014" });
    });
    const error = await withPendingActionFailureOutcome(
      input,
      () => execute(),
      record,
    ).catch((caught: unknown) => caught);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      ...input,
      errorCode: "execution_failed:57014",
    });
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(500);
    expect((error as HTTPException).message).toBe("pending_action_failed");
  });
});
