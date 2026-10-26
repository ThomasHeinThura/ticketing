import { describe, expect, it } from "vitest";
import {
  parseNotificationCopyDescriptor,
  renderNotificationCopyDescriptor,
  withNotificationCopyDescriptor,
  withoutNotificationCopyDescriptor,
} from "../../../apps/api/src/terminology/notification-copy";

describe("versioned system notification copy", () => {
  it("renders only typed term segments and preserves literal text verbatim", async () => {
    const descriptor = parseNotificationCopyDescriptor({
      version: 1,
      title: [
        { kind: "term", termKey: "request", count: 1 },
        { kind: "text", text: " updated" },
      ],
      body: [
        { kind: "text", text: "Literal $t(term:customer.request) " },
        { kind: "term", termKey: "request", count: 1 },
      ],
    });
    expect(descriptor).not.toBeNull();
    const rendered = await renderNotificationCopyDescriptor(
      descriptor!,
      async (key, count) => `${key}-${count}`,
    );
    expect(rendered).toEqual({
      title: "request-1 updated",
      body: "Literal $t(term:customer.request) request-1",
    });
  });

  it("rejects malformed descriptors and strips metadata from public event data", () => {
    expect(
      parseNotificationCopyDescriptor({
        version: 1,
        title: [{ kind: "term", termKey: "request", count: -1 }],
        body: [{ kind: "text", text: "body" }],
      }),
    ).toBeNull();
    const descriptor = {
      version: 1 as const,
      title: [{ kind: "term" as const, termKey: "request" as const, count: 1 }],
      body: [{ kind: "text" as const, text: "safe" }],
    };
    const data = withNotificationCopyDescriptor(
      { publicValue: "kept" },
      descriptor,
    );
    expect(withoutNotificationCopyDescriptor(data)).toEqual({
      publicValue: "kept",
    });
  });
});
