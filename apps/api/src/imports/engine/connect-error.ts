import { HTTPException } from "hono/http-exception";
import { CONNECT_FAILURE_REASONS, type ConnectFailureReason } from "./adapter";

/** Only this closed set is safe to expose to the import wizard. */
export class ImportConnectError extends HTTPException {
  readonly reason: ConnectFailureReason;
  constructor(reason: ConnectFailureReason | undefined) {
    const safe =
      reason && (CONNECT_FAILURE_REASONS as readonly string[]).includes(reason)
        ? reason
        : "source_error";
    super(502, { message: "Source connection failed" });
    this.reason = safe;
  }
}
