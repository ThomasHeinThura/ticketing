import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  isoDay,
  recordServerDate,
  resetServerClock,
  serverInstant,
  serverNow,
  useServerToday,
} from "./server-clock";

const withDate = (date: string | null) => ({
  headers: { get: (name: string) => (name === "date" ? date : null) },
});

afterEach(() => resetServerClock());

describe("server clock", () => {
  it("parses the HTTP Date header and ignores unreadable values", () => {
    expect(serverInstant("Wed, 21 Oct 2026 12:00:00 GMT")).toBe(
      Date.parse("2026-10-21T12:00:00.000Z"),
    );
    expect(serverInstant(null)).toBeNull();
    expect(serverInstant("soon")).toBeNull();
  });

  it("follows the server's clock once a response carried it, not the browser's", () => {
    const browser = Date.parse("2031-01-01T00:00:00.000Z");
    expect(serverNow(browser)).toBe(browser);
    recordServerDate(withDate("Wed, 21 Oct 2026 12:00:00 GMT"), browser);
    expect(serverNow(browser)).toBe(Date.parse("2026-10-21T12:00:00.000Z"));
    expect(serverNow(browser + 60_000)).toBe(
      Date.parse("2026-10-21T12:01:00.000Z"),
    );
    // A response without a readable Date (cross-origin) keeps what was learnt.
    recordServerDate(withDate(null), browser);
    expect(serverNow(browser)).toBe(Date.parse("2026-10-21T12:00:00.000Z"));
  });

  it("re-renders today when the server clock is first learnt", () => {
    const { result } = renderHook(() => useServerToday());
    const server = new Date(2026, 9, 21, 12, 0, 0);
    act(() => {
      recordServerDate(withDate(server.toUTCString()));
    });
    expect(isoDay(result.current)).toBe("2026-10-21");
  });
});
