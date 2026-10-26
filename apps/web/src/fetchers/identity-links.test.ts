import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.apiFetch }));

import {
  confirmIdentityLink,
  getIdentityLinkIntent,
  getIdentityLinks,
  startIdentityLink,
} from "./identity-links";

const intentId = "a".repeat(43);

beforeEach(() => mocks.apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("identity link fetchers", () => {
  it("loads the current provider and available link targets", async () => {
    const payload = {
      source: { connectionId: "source-1", displayName: "Work SSO" },
      targets: [
        {
          connectionId: "target-1",
          displayName: "Secondary SSO",
          linked: false,
        },
      ],
    };
    mocks.apiFetch.mockResolvedValue(Response.json(payload));

    await expect(getIdentityLinks()).resolves.toEqual(payload);
    const [url, options] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(url).pathname).toBe("/api/me/identity-links");
    expect(options).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
  });

  it("starts provider verification with an encoded target and empty body", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json({ authorizationUrl: "https://idp.example.test/authorize" }),
    );

    await expect(startIdentityLink("target/id")).resolves.toEqual({
      authorizationUrl: "https://idp.example.test/authorize",
    });
    const [url, options] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(new URL(url).pathname).toBe(
      "/api/me/identity-links/target%2Fid/start",
    );
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(options.body).toBeUndefined();
  });

  it("reads and confirms only a bounded opaque intent without a request body", async () => {
    const intent = {
      intentId,
      sourceDisplayName: "Work SSO",
      targetDisplayName: "Secondary SSO",
      accountLabel: "alex@example.test",
      displayName: "Alex Example",
      expiresAt: "2026-10-26T12:00:00.000Z",
    };
    mocks.apiFetch
      .mockResolvedValueOnce(Response.json(intent))
      .mockResolvedValueOnce(
        Response.json({ linked: true, alreadyLinked: false }),
      );

    await expect(getIdentityLinkIntent(intentId)).resolves.toEqual(intent);
    await expect(confirmIdentityLink(intentId)).resolves.toEqual({
      linked: true,
      alreadyLinked: false,
    });
    const [, readOptions] = mocks.apiFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const [confirmUrl, confirmOptions] = mocks.apiFetch.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(readOptions).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
    expect(new URL(confirmUrl).pathname).toBe(
      `/api/me/identity-links/intents/${intentId}/confirm`,
    );
    expect(confirmOptions).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    expect(confirmOptions.body).toBeUndefined();
  });

  it("rejects malformed intent identifiers before making a request", async () => {
    await expect(getIdentityLinkIntent("too-short")).rejects.toMatchObject({
      status: 400,
    });
    await expect(confirmIdentityLink("too-short")).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});
