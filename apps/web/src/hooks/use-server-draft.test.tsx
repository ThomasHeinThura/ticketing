import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useServerDraft } from "./use-server-draft";

type Server = { name: string; version: number };
const toDraft = (server: Server) => ({ name: server.name });

describe("useServerDraft", () => {
  it("follows the server while the draft is pristine", () => {
    const { result, rerender } = renderHook(
      ({ server }) => useServerDraft(server, toDraft),
      { initialProps: { server: { name: "a", version: 1 } } },
    );
    rerender({ server: { name: "b", version: 2 } });
    expect(result.current.draft).toEqual({ name: "b" });
    expect(result.current.base.version).toBe(2);
  });

  it("keeps edits and the original base when the server moves under a dirty draft", () => {
    const { result, rerender } = renderHook(
      ({ server }) => useServerDraft(server, toDraft),
      { initialProps: { server: { name: "a", version: 1 } } },
    );
    act(() => result.current.setDraft({ name: "mine" }));
    rerender({ server: { name: "theirs", version: 2 } });
    expect(result.current.draft).toEqual({ name: "mine" });
    // The save is still checked against version 1, so the API reports a conflict.
    expect(result.current.base.version).toBe(1);
    expect(result.current.dirty).toBe(true);
  });

  it("reset discards edits and then adopts the next server snapshot", () => {
    const { result, rerender } = renderHook(
      ({ server }) => useServerDraft(server, toDraft),
      { initialProps: { server: { name: "a", version: 1 } } },
    );
    act(() => result.current.setDraft({ name: "mine" }));
    rerender({ server: { name: "theirs", version: 2 } });
    act(() => result.current.reset());
    expect(result.current.draft).toEqual({ name: "theirs" });
    expect(result.current.base.version).toBe(2);
    expect(result.current.dirty).toBe(false);
  });
});
