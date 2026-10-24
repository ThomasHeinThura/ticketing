import { localMinutes } from "../../../apps/api/src/notification/quiet-hours";

/** A quiet-hours window from one hour before to one hour after `at`, in `timeZone`. */
export function quietWindowAround(at: Date, timeZone: string) {
  const clock = (offsetMinutes: number) => {
    const minutes =
      (((localMinutes(at, timeZone) + offsetMinutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  return { quietHoursStart: clock(-60), quietHoursEnd: clock(60) };
}
