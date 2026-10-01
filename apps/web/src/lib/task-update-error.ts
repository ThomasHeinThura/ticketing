import { HttpError } from "./http-error";

/** A full-task update failure already surfaced by useUpdateTask's toast. */
export class TaskUpdateError extends HttpError {
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(status, message);
    this.name = "TaskUpdateError";
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
