import { describe, expect, it } from "vitest";
import { httpErrorFromResponse } from "./http-error";

describe("httpErrorFromResponse", () => {
  const id = "a".repeat(32);
  it("takes the 5xx reference from the header or JSON body", async () => {
    const header = new Response(JSON.stringify({ message: "failed" }), {
      status: 500,
      headers: { "x-taskdesk-request-id": id },
    });
    const body = new Response(
      JSON.stringify({ message: "failed", requestId: id }),
      { status: 503 },
    );
    expect((await httpErrorFromResponse(header, "fallback")).requestId).toBe(
      id,
    );
    expect((await httpErrorFromResponse(body, "fallback")).requestId).toBe(id);
  });
  it("does not expose a reference on a 4xx", async () => {
    const response = new Response("Forbidden", {
      status: 403,
      headers: { "x-taskdesk-request-id": id },
    });
    const error = await httpErrorFromResponse(response, "fallback");
    expect(error.message).toBe("Forbidden");
    expect(error.requestId).toBeUndefined();
  });
});
