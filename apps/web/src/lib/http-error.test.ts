import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  httpErrorFromResponse,
  localizedAdminErrorMessage,
} from "./http-error";

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
  it("keeps a fallback key separate from a server reference", async () => {
    const key = "settings:client.failure";
    const error = await httpErrorFromResponse(
      new Response(JSON.stringify({ requestId: id, message: "private" }), {
        status: 500,
      }),
      "fallback",
      key,
    );
    expect(error).toMatchObject({ requestId: id, fallbackKey: key });
    expect(
      localizedAdminErrorMessage(
        error,
        (value) => `translated:${value}`,
        "generic",
      ),
    ).toBe(`translated:${key}`);
    expect(
      new HttpError(500, "failure", undefined, { fallbackKey: key }).requestId,
    ).toBeUndefined();
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

describe("unauthorized navigation", () => {
  it.each([
    [
      "portal",
      "/projects/ACME",
      "?project=ACME",
      "#details",
      "/sign-in?redirect=%2Fprojects%2FACME%3Fproject%3DACME%23details",
    ],
    [
      "agent",
      "/agent/projects/ACME",
      "?view=board",
      "#card",
      "/auth/sign-in?redirect=%2Fagent%2Fprojects%2FACME%3Fview%3Dboard%23card",
    ],
    [
      "agent",
      "/god-mode/users",
      "?q=one",
      "#row",
      "/auth/sign-in?redirect=%2Fgod-mode%2Fusers%3Fq%3Done%23row",
    ],
  ])(
    "uses the %s application sign-in for %s",
    async (mode, pathname, search, hash, target) => {
      const replace = vi.fn();
      vi.stubEnv("MODE", mode);
      vi.stubGlobal("window", {
        location: { pathname, search, hash, replace },
      });
      try {
        const { handleUnauthorized } = await import("./http-error");
        handleUnauthorized();
        expect(replace).toHaveBeenCalledExactlyOnceWith(target);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    },
  );
});
