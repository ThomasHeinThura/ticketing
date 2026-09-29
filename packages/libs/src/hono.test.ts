import { describe, expect, it } from "vitest";
import { withTaskDeskRequestHeaders } from "./hono";

describe("withTaskDeskRequestHeaders", () => {
  it("preserves Hono Headers objects and adds TaskDesk headers", () => {
    const init = withTaskDeskRequestHeaders(
      { headers: new Headers({ "If-Match": '"4"', "X-Custom": "kept" }) },
      "window-1",
    );
    const headers = new Headers(init.headers);

    expect(headers.get("if-match")).toBe('"4"');
    expect(headers.get("x-custom")).toBe("kept");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-taskdesk-window-id")).toBe("window-1");
    expect(init.credentials).toBe("include");
  });
});
