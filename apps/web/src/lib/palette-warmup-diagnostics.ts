/** Passive, value-free phase evidence for cold command-palette failures. */
export function markPaletteWarmup(phase: string): void {
  if (
    typeof performance !== "undefined" &&
    typeof performance.mark === "function"
  ) {
    performance.mark(`taskdesk.palette.${phase}`);
  }
}
