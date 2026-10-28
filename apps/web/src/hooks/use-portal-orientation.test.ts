import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePortalOrientation } from "./use-portal-orientation";

afterEach(() => localStorage.clear());

describe("usePortalOrientation (CP-14)", () => {
  it("shows once, then stays dismissed for that customer only", () => {
    const first = renderHook(() => usePortalOrientation("customer-a"));
    expect(first.result.current.visible).toBe(true);
    act(() => first.result.current.dismiss());
    expect(first.result.current.visible).toBe(false);

    const again = renderHook(() => usePortalOrientation("customer-a"));
    expect(again.result.current.visible).toBe(false);
    const other = renderHook(() => usePortalOrientation("customer-b"));
    expect(other.result.current.visible).toBe(true);
  });
});
