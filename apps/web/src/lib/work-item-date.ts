/** Calendar-day edits retain an existing UTC time; new dates use UTC midnight. */
export function dayToIso(day: Date | undefined, original: string | null) {
  if (!day) return null;
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  const timeOfDay = original?.slice(10) || "T00:00:00.000Z";
  return `${y}-${m}-${d}${timeOfDay}`;
}

export function isoToDay(value: string | null) {
  if (!value) return undefined;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
