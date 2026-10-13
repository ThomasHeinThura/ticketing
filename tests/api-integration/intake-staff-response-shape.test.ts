/** Staff intake responses carry only their declared fields. The triage queue, submission
 * detail, accept, duplicate, decline, clarify, claim and request-type version responses used
 * to return stored person, organisation, submission, message, work-item and version rows,
 * and the portal reply returned the stored message row with an undeclared `submissionId`. */
import { beforeEach, describe, expect, it } from "vitest";
import { portalRequest } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  seedIntake,
  sortedKeys,
  staffRequest,
  submitAs,
} from "./helpers/intake-http";

const MESSAGE_KEYS = ["actorType", "authorId", "body", "createdAt", "id"];
const WORK_ITEM_KEYS = ["id", "key", "projectId", "title", "typeId"];
const VERSION_KEYS = [
  "autoAccept",
  "createdAt",
  "defaultAssigneeId",
  "defaultProjectId",
  "formSchema",
  "id",
  "number",
  "slaPolicyId",
  "workItemTypeId",
];

describe("staff intake responses expose only declared fields", () => {
  beforeEach(async () => resetTestDatabase());

  it("queue and detail", async () => {
    const s = await seedIntake("staff-shape-read");
    const ref = await submitAs(s, s.customer);

    const list = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions?workspaceId=${s.t.workspaceId}`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const queue = (await list.json()) as {
      submissions: Array<Record<string, unknown>>;
    };
    expect(sortedKeys(queue)).toEqual(["meta", "page", "submissions"]);
    const row = queue.submissions[0] as Record<string, Record<string, unknown>>;
    expect(sortedKeys(row)).toEqual([
      "organisation",
      "ref",
      "requestType",
      "requester",
      "submission",
      "summary",
    ]);
    expect(sortedKeys(row.submission)).toEqual([
      "claimedAt",
      "claimedBy",
      "createdAt",
      "customerVisibility",
      "id",
      "number",
      "state",
    ]);
    expect(sortedKeys(row.requestType)).toEqual(["id", "key", "name"]);
    expect(sortedKeys(row.requester)).toEqual(["displayName", "id"]);
    expect(sortedKeys(row.organisation)).toEqual(["id", "name"]);

    const detail = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${ref}`,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    const body = (await detail.json()) as Record<
      string,
      Record<string, unknown> | Array<Record<string, unknown>>
    >;
    expect(sortedKeys(body)).toEqual([
      "messages",
      "ref",
      "requestType",
      "submission",
      "version",
    ]);
    expect(sortedKeys(body.submission)).toEqual([
      "claimedAt",
      "claimedBy",
      "createdAt",
      "customerVisibility",
      "formData",
      "id",
      "number",
      "state",
      "updatedAt",
      "version",
      "workItemId",
    ]);
    expect(sortedKeys(body.requestType)).toEqual(["id", "key", "name"]);
    expect(sortedKeys(body.version)).toEqual(VERSION_KEYS);
  });

  it("claim, clarify, reply, accept, duplicate and decline", async () => {
    const s = await seedIntake("staff-shape-write");
    const accepted = await submitAs(s, s.customer, "Accept me");
    const duplicated = await submitAs(s, s.customer, "Duplicate me");
    const declined = await submitAs(s, s.customer, "Decline me");

    const claim = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${accepted}/claim`,
      { method: "POST" },
    );
    expect(claim.status, await claim.clone().text()).toBe(200);
    expect(sortedKeys(await claim.json())).toEqual([
      "claimedAt",
      "claimedBy",
      "id",
      "ref",
      "state",
    ]);

    const clarify = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${accepted}/messages`,
      { method: "POST", body: { body: "Which browser?" } },
    );
    expect(clarify.status, await clarify.clone().text()).toBe(200);
    const clarified = (await clarify.json()) as Record<string, unknown>;
    expect(sortedKeys(clarified)).toEqual(["id", "message", "ref", "state"]);
    expect(sortedKeys(clarified.message)).toEqual(MESSAGE_KEYS);

    const reply = await portalRequest(
      s.t,
      s.customer,
      `/api/portal/submissions/${accepted}/messages`,
      { method: "POST", body: { body: "Firefox" } },
    );
    expect(reply.status, await reply.clone().text()).toBe(200);
    const replied = (await reply.json()) as Record<string, unknown>;
    expect(sortedKeys(replied)).toEqual(["id", "message", "ref", "state"]);
    expect(sortedKeys(replied.message)).toEqual(MESSAGE_KEYS);

    const accept = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${accepted}/accept`,
      {
        method: "POST",
        body: { projectId: s.t.project.id, workItemTypeId: s.t.type.id },
      },
    );
    expect(accept.status, await accept.clone().text()).toBe(200);
    const acceptedBody = (await accept.json()) as Record<string, unknown>;
    expect(sortedKeys(acceptedBody)).toEqual(["ref", "state", "workItem"]);
    expect(sortedKeys(acceptedBody.workItem)).toEqual(WORK_ITEM_KEYS);
    const workItemId = (acceptedBody.workItem as { id: string }).id;

    const duplicate = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${duplicated}/duplicate`,
      { method: "POST", body: { workItemId } },
    );
    expect(duplicate.status, await duplicate.clone().text()).toBe(200);
    const duplicateBody = (await duplicate.json()) as Record<string, unknown>;
    expect(sortedKeys(duplicateBody)).toEqual(["ref", "state", "workItem"]);
    expect(sortedKeys(duplicateBody.workItem)).toEqual(WORK_ITEM_KEYS);

    const decline = await staffRequest(
      s.t,
      s.t.requester,
      `/api/submissions/${declined}/decline`,
      { method: "POST", body: { reason: "Out of scope" } },
    );
    expect(decline.status, await decline.clone().text()).toBe(200);
    const declineBody = (await decline.json()) as Record<string, unknown>;
    expect(sortedKeys(declineBody)).toEqual([
      "message",
      "reason",
      "ref",
      "state",
    ]);
    expect(sortedKeys(declineBody.message)).toEqual(MESSAGE_KEYS);
  });

  it("request-type detail and publish return declared version fields", async () => {
    const s = await seedIntake("staff-shape-rt");
    const detail = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}`,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    const body = (await detail.json()) as {
      versions: Array<Record<string, unknown>>;
    };
    expect(body.versions).toHaveLength(1);
    expect(sortedKeys(body.versions[0])).toEqual(VERSION_KEYS);

    const publish = await staffRequest(
      s.t,
      s.t.requester,
      `/api/request-types/${s.requestType.id}/publish`,
      { method: "POST" },
    );
    expect(publish.status, await publish.clone().text()).toBe(200);
    const published = (await publish.json()) as Record<string, unknown>;
    expect(sortedKeys(published)).toEqual(["requestType", "version"]);
    expect(sortedKeys(published.version)).toEqual(VERSION_KEYS);
  });
});
