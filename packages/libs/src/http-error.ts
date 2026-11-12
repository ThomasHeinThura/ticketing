/** HTTP failures retain a server-owned reference only for server errors. */
export class HttpError extends Error {
  readonly status: number;
  readonly requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (status >= 500 && requestId && /^[0-9a-f]{32}$/.test(requestId))
      this.requestId = requestId;
  }
}
