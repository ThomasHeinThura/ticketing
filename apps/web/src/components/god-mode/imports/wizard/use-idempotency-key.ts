import { useCallback, useRef } from "react";
import { newIdempotencyKey } from "@/fetchers/god-mode/imports";

/**
 * One `Idempotency-Key` per distinct request: an exact retry (same `fingerprint`) reuses the key,
 * so the server replays instead of repeating; a changed request, or one made after `reset()`
 * (call it on success), gets a new key.
 */
export function useIdempotencyKey() {
  const current = useRef<{ fingerprint: string; key: string } | null>(null);
  const keyFor = useCallback((fingerprint: string) => {
    if (current.current?.fingerprint !== fingerprint)
      current.current = { fingerprint, key: newIdempotencyKey() };
    return current.current.key;
  }, []);
  const reset = useCallback(() => {
    current.current = null;
  }, []);
  return { keyFor, reset };
}
