import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it } from "vitest";
import { IdentityQueryProvider, retireIdentity } from "./identity-boundary";

it("retires both manual write methods while letting the new identity write", () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IdentityQueryProvider client={client}>{children}</IdentityQueryProvider>
  );
  const { result } = renderHook(() => useQueryClient(), { wrapper });
  const previous = result.current;
  act(() => retireIdentity(client));
  const current = result.current;
  current.setQueryData(["shared", 1], "B");
  previous.setQueryData(["shared", 1], "A");
  previous.setQueriesData({ queryKey: ["shared"] }, "A");
  expect(client.getQueryData(["shared", 1])).toBe("B");
  current.setQueriesData({ queryKey: ["shared"] }, "B updated");
  expect(client.getQueryData(["shared", 1])).toBe("B updated");
});
