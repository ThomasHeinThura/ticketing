/**
 * Jira Service Management specifics on top of the Jira adapter core.
 *
 *  - The request type (not the issue type) is the `type` facet: it is what the service desk
 *    customer chose and what staff triage by.
 *  - Comment visibility is read by the core (`jsdPublic: false` or any restricted visibility is
 *    `internal`); internal notes are reported apart from public ones and never merged.
 *  - SLAs, approvals, organisations, request participants and queue membership are not imported:
 *    they are reported as fixed loss codes, and their custom fields are kept out of the plain
 *    custom-field mapping.
 */
import type { LossInput } from "../../engine/adapter";
import {
  asArray,
  asObject,
  asString,
  type IssueFlavor,
} from "../jira/normalize";

const isEmptyValue = (value: unknown) =>
  value === null ||
  value === undefined ||
  (Array.isArray(value) && value.length === 0);

export const jsmFlavor: IssueFlavor = {
  inspect({ fields, names }) {
    const excludedFields = new Set<string>();
    const losses: LossInput[] = [{ code: "queue_not_imported" }];
    let typeName: string | undefined;
    const add = (code: string, detailCode?: string) => {
      if (!losses.some((l) => l.code === code && l.detailCode === detailCode))
        losses.push(detailCode ? { code, detailCode } : { code });
    };

    for (const [id, value] of Object.entries(fields)) {
      if (!id.startsWith("customfield_") || isEmptyValue(value)) continue;
      const name = names.get(id)?.toLowerCase();
      const object = asObject(value);

      const requestType = asString(asObject(object?.requestType)?.name);
      if (requestType) {
        typeName ??= requestType;
        excludedFields.add(id);
        continue;
      }
      if (object && ("ongoingCycle" in object || "completedCycles" in object)) {
        excludedFields.add(id);
        add("sla_not_imported");
        continue;
      }
      const items = asArray(value).map(asObject);
      if (
        name === "approvals" ||
        (items.length > 0 &&
          items.every(
            (item) => item && ("finalDecision" in item || "approvers" in item),
          ))
      ) {
        excludedFields.add(id);
        add("approval_not_imported");
        continue;
      }
      if (name === "organizations") {
        excludedFields.add(id);
        add("organization_not_imported");
        continue;
      }
      if (name === "request participants") {
        excludedFields.add(id);
        add("request_participant_not_imported");
      }
    }
    return { typeName, excludedFields, losses };
  },
};
