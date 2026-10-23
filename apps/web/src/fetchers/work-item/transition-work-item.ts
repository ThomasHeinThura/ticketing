import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { WorkItemTransitionBlockedError } from "@/lib/work-item-transition-reasons";

export default async function transitionWorkItem(input: {
  key: string;
  toStateTemplateId: string;
  note?: string;
}) {
  const response = await client["work-items"][":key"].transition.$post({
    param: { key: input.key },
    json: {
      toStateTemplateId: input.toStateTemplateId,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  if (!response.ok) {
    if (response.status === 422) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        /* A malformed refusal stays generic. */
      }
      const reasons =
        body && typeof body === "object" && "blockedBy" in body
          ? body.blockedBy
          : undefined;
      if (
        Array.isArray(reasons) &&
        reasons.length > 0 &&
        reasons.length <= 32
      ) {
        const codes = reasons.map((reason: unknown) =>
          reason &&
          typeof reason === "object" &&
          "reasonCode" in reason &&
          typeof reason.reasonCode === "string" &&
          /^[a-z][a-z0-9_.]{0,127}$/u.test(reason.reasonCode)
            ? reason.reasonCode
            : "unknown",
        );
        throw new WorkItemTransitionBlockedError([...new Set(codes)]);
      }
    }
    throw new HttpError(response.status, "Failed to transition work item");
  }
  return response.json();
}
