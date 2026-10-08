import { describe, expect, it } from "vitest";
import { parseNativeMentionPersonIds } from "../../apps/api/src/utils/parse-native-mentions";
import {
  commentMentionCandidatesQuery,
  commentMentionPreflightBody,
} from "../../apps/api/src/work-item/schema";

describe("CA-12 native comment mentions", () => {
  it("reads unique person ids only from taskdeskMention nodes", () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "taskdeskMention", attrs: { id: "person-1", label: "A" } },
            { type: "text", text: " @person-2" },
            {
              type: "taskdeskMention",
              attrs: { id: "person-1", label: "Again" },
            },
          ],
        },
        { type: "taskdeskMention", attrs: { id: "person-2" } },
      ],
      attrs: { id: "person-3" },
    };

    expect(parseNativeMentionPersonIds(body)).toEqual(["person-1", "person-2"]);
  });

  it("bounds preflight input and requires an explicit comment visibility", () => {
    expect(
      commentMentionPreflightBody.safeParse({
        personIds: ["person-1"],
        visibility: "public",
      }).success,
    ).toBe(true);
    expect(
      commentMentionPreflightBody.safeParse({
        personIds: ["person-1"],
        visibility: "private",
      }).success,
    ).toBe(false);
    expect(commentMentionCandidatesQuery.safeParse({}).success).toBe(false);
  });

  it("ignores malformed mention nodes, labels and markdown-like text", () => {
    expect(
      parseNativeMentionPersonIds({
        type: "doc",
        content: [
          { type: "taskdeskMention", attrs: { label: "No id" } },
          { type: "taskdeskMention", attrs: { id: "" } },
          { type: "text", text: '<taskdesk-mention id="person-1">' },
        ],
      }),
    ).toEqual([]);
    expect(parseNativeMentionPersonIds("@person-1")).toEqual([]);
  });
});
