import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  identityAdminFailure,
  identityAdminFailureKind,
} from "./identity-admin-error";

const text = (status: number, body: string) =>
  identityAdminFailure(new Response(body, { status }), "failed");
const json = (status: number, body: unknown) =>
  identityAdminFailure(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
    "failed",
  );

describe("identity administration failures", () => {
  it("reads plain-text exception bodies as well as JSON bodies", async () => {
    expect((await text(403, "step_up_unavailable")).kind).toBe("step_up");
    expect((await text(403, "Forbidden")).kind).toBe("denied");
    expect((await text(403, "Session required")).kind).toBe("denied");
    expect((await json(403, { message: "step_up_unavailable" })).kind).toBe(
      "step_up",
    );
  });

  it("distinguishes a version conflict from a duplicate by the reported current version", async () => {
    const conflict = await json(409, {
      type: "about:blank",
      title: "Version conflict",
      status: 409,
      currentVersion: 9,
    });
    expect(conflict.kind).toBe("conflict");
    expect(conflict.currentVersion).toBe(9);
    expect(
      (await json(409, { message: "version_conflict", currentVersion: 3 }))
        .kind,
    ).toBe("conflict");
    expect(
      (await json(409, { message: "version_conflict", version: 4 }))
        .currentVersion,
    ).toBe(4);
    expect(
      (await json(409, { title: "Duplicate group mapping", status: 409 })).kind,
    ).toBe("duplicate");
  });

  it("classifies the remaining statuses and tolerates unreadable bodies", async () => {
    expect((await json(404, { message: "Connection unavailable" })).kind).toBe(
      "not_found",
    );
    expect((await json(422, { title: "Invalid request" })).kind).toBe(
      "invalid",
    );
    expect((await json(429, { message: "step_up_attempt_limit" })).kind).toBe(
      "rate_limited",
    );
    expect((await text(503, "")).kind).toBe("unavailable");
    expect((await text(418, "")).kind).toBe("unknown");
    expect(identityAdminFailureKind(new HttpError(404, "x"))).toBe("not_found");
    expect(identityAdminFailureKind(new Error("network"))).toBe("unknown");
  });

  it("ignores a non-numeric or unsafe version", async () => {
    expect(
      (await json(409, { currentVersion: "9" })).currentVersion,
    ).toBeNull();
  });
});
