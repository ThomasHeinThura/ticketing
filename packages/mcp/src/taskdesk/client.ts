import type { AuthService } from "../auth/auth-service.js";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/**
 * A failed API call. `message` is trusted (path and HTTP status only); `detail` is the
 * server-supplied error text, which can echo user input, so it is carried separately and
 * wrapped as untrusted content at the output boundary (PA-10).
 */
export class TaskDeskApiError extends Error {
  constructor(
    message: string,
    readonly detail: string | null = null,
    /** HTTP status of the failed call; absent for errors raised by the tool itself. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "TaskDeskApiError";
  }
}

export class TaskDeskClient {
  readonly baseUrl: string;
  private readonly auth: AuthService;
  private telemetryInFlight = 0;

  constructor(options: { baseUrl: string; auth: AuthService }) {
    this.baseUrl = options.baseUrl;
    this.auth = options.auth;
  }

  private async authorizedFetch(
    path: string,
    init?: RequestInit,
    didRetry = false,
  ): Promise<Response> {
    const token = await this.auth.getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init?.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const timeoutSignal = AbortSignal.timeout(10_000);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const res = await fetch(url, { ...init, headers, signal });

    // With a static API key there is nothing to refresh, so surface the 401
    // instead of looping back into the interactive device flow.
    if (res.status === 401 && !didRetry && !this.auth.usingApiKey) {
      await this.auth.clearToken();
      return this.authorizedFetch(path, init, true);
    }

    return res;
  }

  async json<T = Json>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authorizedFetch(path, init);
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      let detail: string | null = null;
      if (
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
      ) {
        detail = (body as { message: string }).message;
      } else if (typeof body === "string" && body.length > 0) {
        detail = body.length > 500 ? `${body.slice(0, 500)}…` : body;
      }
      throw new TaskDeskApiError(
        `${path}: HTTP ${res.status}`,
        detail,
        res.status,
      );
    }
    return body as T;
  }

  /** Best-effort bounded client telemetry; failures never affect the tool result. */
  async reportToolInvocation(input: {
    invocationId: string;
    toolName: string;
    durationMs: number;
    outcome: "success" | "error";
  }): Promise<void> {
    if (!this.auth.usingApiKey || this.telemetryInFlight >= 8) return;
    this.telemetryInFlight += 1;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve();
      }, 750);
    });
    const reporting = (async () => {
      try {
        const token = await this.auth.getAccessToken();
        if (controller.signal.aborted) return;
        const headers = new Headers({
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        });
        const response = await fetch(`${this.baseUrl}/api/mcp/tool-reports`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        await response.body?.cancel().catch(() => undefined);
      } catch {
        // Client-reported metrics are optional and contain no execution authority.
      }
    })();
    // Keep the slot until the underlying auth/fetch promise settles. The deadline only
    // detaches the tool call; it must not let permanently hung work evade the cap.
    void reporting.finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
      this.telemetryInFlight -= 1;
    });
    await Promise.race([reporting, timedOut]);
  }
}
