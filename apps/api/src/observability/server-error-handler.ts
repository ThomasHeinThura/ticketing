import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
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
  const message =
    err instanceof HTTPException &&
    status === 503 &&
    err.message === "factor_policy_unavailable"
      ? "factor_policy_unavailable"
      : "Internal Server Error";
  return c.json({ message, requestId }, status as 500);
}
