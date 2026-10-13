import { useLayoutEffect, useRef } from "react";

/** Permanently invalidates async continuations when their routed intent changes or unmounts. */
export function useIntentLifecycle(intent: string, reset: () => void) {
  const generation = useRef(0);
  const previousIntent = useRef(intent);
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useLayoutEffect(() => {
    if (previousIntent.current === intent) return;
    previousIntent.current = intent;
    generation.current += 1;
    resetRef.current();
  });

  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return {
    capture: () => generation.current,
    isCurrent: (captured: number) => generation.current === captured,
  };
}
