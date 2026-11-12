import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { CONNECT_FAILURE_REASONS } from "../imports/engine/adapter";
import { ImportConnectError } from "../imports/engine/connect-error";
import { ensurePolicyRequestId } from "../permissions/shadow-context";
import type { TaskDeskLogEvent } from "./logger";

type ServerErrorLog = (input: {
  requestId: string;
  method: string;
  route?: string;
  status: number;
  errorClass: TaskDeskLogEvent["errorClass"];
  stack?: string;
}) => void;

export function handleServerError(
  err: Error,
  c: Context,
  log: ServerErrorLog,
): Response {
  if (err instanceof HTTPException && err.status < 500)
    return err.getResponse();
  const status = err instanceof HTTPException ? err.status : 500;
  const requestId = ensurePolicyRequestId(c);
  const errorClass =
    err instanceof HTTPException
      ? "HTTPException"
      : err instanceof TypeError
        ? "TypeError"
        : err instanceof RangeError
          ? "RangeError"
          : err.constructor === Error
            ? "Error"
            : "Other";
  let stack: string | undefined;
  try {
    stack = err.stack;
  } catch {
    /* Malformed error objects must not break the error response. */
  }
  log({
    requestId,
    method: c.req.method,
    route: c.req.routePath,
    status,
    errorClass,
    stack,
  });
  if (err instanceof HTTPException) {
    err.getResponse().headers.forEach((value, name) => {
      if (
        !["content-type", "content-length", "x-taskdesk-request-id"].includes(
          name.toLowerCase(),
        )
      )
        c.header(name, value);
    });
  }
  c.header("x-taskdesk-request-id", requestId);
  // These fixed public codes contain no exception details and are retained API contracts.
  const message =
    err instanceof HTTPException &&
    ((status === 503 && err.message === "factor_policy_unavailable") ||
      (status === 500 && err.message === "pending_action_failed"))
      ? err.message
      : "Internal Server Error";
  if (
    err instanceof ImportConnectError &&
    (CONNECT_FAILURE_REASONS as readonly string[]).includes(err.reason)
  ) {
    return c.json(
      { message: "Source connection failed", reason: err.reason, requestId },
      502,
    );
  }
  return c.json({ message, requestId }, status as 500);
}
