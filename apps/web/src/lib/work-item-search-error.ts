/**
 * Which documented refusal a work-item search status is (api-design.md, Work-item search v1):
 * `400` a malformed filter, `403` a field the caller may not read, `422` a recognised field
 * that is not available yet. Callers map the kind to their own translated message; the
 * server's text is never shown. Anything else is a failure, not a refusal.
 */
export type WorkItemSearchRefusal = "invalid" | "forbidden" | "unavailable";

export function workItemSearchRefusal(
  status: number,
): WorkItemSearchRefusal | undefined {
  return status === 400
    ? "invalid"
    : status === 403
      ? "forbidden"
      : status === 422
        ? "unavailable"
        : undefined;
}

export function workItemSearchErrorMessage(
  status: number,
  t: (key: string) => string,
): string | undefined {
  const kind = workItemSearchRefusal(status);
  return kind ? t(`workItems:filter.errors.${kind}`) : undefined;
}
