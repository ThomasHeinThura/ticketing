import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function isBelow(breakpoint: number) {
  return typeof window !== "undefined" && window.innerWidth < breakpoint;
}

export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  // Read the viewport on the first render, so a narrow screen never paints the wide layout
  // for a frame before the effect runs.
  const [isMobile, setIsMobile] = React.useState(() => isBelow(breakpoint));

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return isMobile;
}
