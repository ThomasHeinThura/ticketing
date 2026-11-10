import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPortalDownloadV2,
  verifyPortalDownloadV2,
} from "../../../apps/api/src/storage/filesystem";

afterEach(() => vi.useRealTimers());

describe("portal download token", () => {
  it("binds scope, reference, attachment, person and expiry without exposing the object key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const input = {
      scope: "request" as const,
      ref: "CASE-42",
      id: "attachment-1",
      personId: "person-1",
      apiBaseUrl: "https://portal.example.test/api",
    };
    const url = new URL(createPortalDownloadV2(input));
    expect(url.origin).toBe("https://portal.example.test");
    expect(url.pathname).toBe("/api/storage/portal-download");
    expect(url.searchParams.has("key")).toBe(false);
    const signed = {
      scope: input.scope,
      ref: url.searchParams.get("ref") ?? "",
      id: url.searchParams.get("id") ?? "",
      personId: input.personId,
      expires: url.searchParams.get("expires") ?? "",
      token: url.searchParams.get("token") ?? "",
    };
    expect(verifyPortalDownloadV2(signed)).toBe(true);
    expect(verifyPortalDownloadV2({ ...signed, scope: "submission" })).toBe(
      false,
    );
    expect(verifyPortalDownloadV2({ ...signed, ref: "CASE-43" })).toBe(false);
    expect(verifyPortalDownloadV2({ ...signed, id: "attachment-2" })).toBe(
      false,
    );
    expect(verifyPortalDownloadV2({ ...signed, personId: "person-2" })).toBe(
      false,
    );
    expect(
      verifyPortalDownloadV2({
        ...signed,
        expires: String(Number(signed.expires) + 1),
      }),
    ).toBe(false);
    expect(verifyPortalDownloadV2({ ...signed, token: "invalid" })).toBe(false);
    vi.setSystemTime(Number(signed.expires) * 1000);
    expect(verifyPortalDownloadV2(signed)).toBe(false);
  });
});
