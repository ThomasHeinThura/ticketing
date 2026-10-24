import type { DatedHoliday } from "../calendar/types.js";

/**
 * Country holiday presets (`CAL-10`, `CAL-11`). Computed from public statutory rules (fixed
 * dates, Easter-relative dates, nth-weekday rules and the usual weekend substitutions), bundled
 * with the release, no external call. A starting point, never authority: the administrator
 * confirms every date. Lunar, Islamic, regional and one-off proclaimed holidays are deliberately
 * NOT generated; each preset lists what it leaves out in `notIncluded`.
 */
export const HOLIDAY_PRESET_DATASET_VERSION = "2026.10.1" as const;

export interface HolidayPresetInfo {
  country: string;
  name: string;
  notIncluded: string;
}

type Ymd = { y: number; m: number; d: number };

function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date: Ymd, days: number): Ymd {
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return {
    y: next.getUTCFullYear(),
    m: next.getUTCMonth() + 1,
    d: next.getUTCDate(),
  };
}

function iso(date: Ymd): string {
  return `${String(date.y).padStart(4, "0")}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

/** Western (Gregorian) Easter Sunday, Meeus/Jones/Butcher algorithm. */
export function easterSunday(year: number): Ymd {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}

/** The `n`th (1-based) given weekday (0 = Sunday) of a month. */
function nthWeekday(y: number, m: number, weekday: number, n: number): Ymd {
  const first = dayOfWeek(y, m, 1);
  const offset = (weekday - first + 7) % 7;
  return { y, m, d: 1 + offset + (n - 1) * 7 };
}

/** The last given weekday of a month. */
function lastWeekday(y: number, m: number, weekday: number): Ymd {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (dayOfWeek(y, m, lastDay) - weekday + 7) % 7;
  return { y, m, d: lastDay - offset };
}

/** The given weekday on or before a date. */
function weekdayOnOrBefore(date: Ymd, weekday: number): Ymd {
  const back = (dayOfWeek(date.y, date.m, date.d) - weekday + 7) % 7;
  return addDays(date, -back);
}

type Rule = { name: string; at: (year: number) => Ymd };

const fixed = (name: string, m: number, d: number): Rule => ({
  name,
  at: (y) => ({ y, m, d }),
});
const easter = (name: string, offset: number): Rule => ({
  name,
  at: (y) => addDays(easterSunday(y), offset),
});
const nth = (name: string, m: number, weekday: number, n: number): Rule => ({
  name,
  at: (y) => nthWeekday(y, m, weekday, n),
});
const last = (name: string, m: number, weekday: number): Rule => ({
  name,
  at: (y) => lastWeekday(y, m, weekday),
});
/** Saturday moves to Friday, Sunday to Monday (US federal observance). */
const observedUs = (name: string, m: number, d: number): Rule => ({
  name,
  at: (y) => {
    const dow = dayOfWeek(y, m, d);
    if (dow === 6) return addDays({ y, m, d }, -1);
    if (dow === 0) return addDays({ y, m, d }, 1);
    return { y, m, d };
  },
});
/** Saturday or Sunday moves to the next Monday (UK/CA/AU style substitute day). */
const nextMonday = (name: string, m: number, d: number): Rule => ({
  name,
  at: (y) => {
    const dow = dayOfWeek(y, m, d);
    if (dow === 6) return addDays({ y, m, d }, 2);
    if (dow === 0) return addDays({ y, m, d }, 1);
    return { y, m, d };
  },
});

/** Only a Sunday moves, to the Monday (Singapore, Canada Day). */
const sundayToMonday = (name: string, m: number, d: number): Rule => ({
  name,
  at: (y) => (dayOfWeek(y, m, d) === 0 ? addDays({ y, m, d }, 1) : { y, m, d }),
});

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const FRIDAY = 5;

/** UK Christmas and Boxing Day substitutes: both move off a weekend onto the next free weekdays. */
const gbChristmas: Rule = {
  name: "Christmas Day",
  at: (y) => {
    const dow = dayOfWeek(y, 12, 25);
    if (dow === 6) return { y, m: 12, d: 27 };
    if (dow === SUNDAY) return { y, m: 12, d: 27 };
    return { y, m: 12, d: 25 };
  },
};
const gbBoxingDay: Rule = {
  name: "Boxing Day",
  at: (y) => {
    const dow = dayOfWeek(y, 12, 26);
    if (dow === 6) return { y, m: 12, d: 28 };
    if (dow === SUNDAY) return { y, m: 12, d: 28 };
    return { y, m: 12, d: 26 };
  },
};

interface Preset extends HolidayPresetInfo {
  rules: Rule[];
}

const PRESETS: Preset[] = [
  {
    country: "US",
    name: "United States (federal)",
    notIncluded: "State and local holidays; Inauguration Day.",
    rules: [
      observedUs("New Year's Day", 1, 1),
      nth("Martin Luther King Jr. Day", 1, MONDAY, 3),
      nth("Washington's Birthday", 2, MONDAY, 3),
      last("Memorial Day", 5, MONDAY),
      observedUs("Juneteenth", 6, 19),
      observedUs("Independence Day", 7, 4),
      nth("Labor Day", 9, MONDAY, 1),
      nth("Columbus Day", 10, MONDAY, 2),
      observedUs("Veterans Day", 11, 11),
      nth("Thanksgiving Day", 11, THURSDAY, 4),
      observedUs("Christmas Day", 12, 25),
    ],
  },
  {
    country: "GB",
    name: "United Kingdom (England and Wales)",
    notIncluded:
      "Scotland and Northern Ireland differences; one-off royal and jubilee holidays.",
    rules: [
      nextMonday("New Year's Day", 1, 1),
      easter("Good Friday", -2),
      easter("Easter Monday", 1),
      nth("Early May bank holiday", 5, MONDAY, 1),
      last("Spring bank holiday", 5, MONDAY),
      last("Summer bank holiday", 8, MONDAY),
      gbChristmas,
      gbBoxingDay,
    ],
  },
  {
    country: "IE",
    name: "Ireland",
    notIncluded: "One-off proclaimed holidays.",
    rules: [
      fixed("New Year's Day", 1, 1),
      {
        name: "St Brigid's Day",
        at: (y) =>
          dayOfWeek(y, 2, 1) === FRIDAY
            ? { y, m: 2, d: 1 }
            : nthWeekday(y, 2, MONDAY, 1),
      },
      fixed("St Patrick's Day", 3, 17),
      easter("Easter Monday", 1),
      nth("May bank holiday", 5, MONDAY, 1),
      nth("June bank holiday", 6, MONDAY, 1),
      nth("August bank holiday", 8, MONDAY, 1),
      last("October bank holiday", 10, MONDAY),
      fixed("Christmas Day", 12, 25),
      fixed("St Stephen's Day", 12, 26),
    ],
  },
  {
    country: "CA",
    name: "Canada (federal)",
    notIncluded:
      "Provincial and territorial holidays (Family Day, Civic Holiday, Easter Monday in some provinces).",
    rules: [
      sundayToMonday("New Year's Day", 1, 1),
      easter("Good Friday", -2),
      {
        name: "Victoria Day",
        at: (y) => weekdayOnOrBefore({ y, m: 5, d: 24 }, MONDAY),
      },
      sundayToMonday("Canada Day", 7, 1),
      nth("Labour Day", 9, MONDAY, 1),
      fixed("National Day for Truth and Reconciliation", 9, 30),
      nth("Thanksgiving", 10, MONDAY, 2),
      fixed("Remembrance Day", 11, 11),
      gbChristmas,
      gbBoxingDay,
    ],
  },
  {
    country: "AU",
    name: "Australia (national)",
    notIncluded:
      "State and territory holidays, the King's Birthday and Easter Saturday/Sunday, which differ by state.",
    rules: [
      nextMonday("New Year's Day", 1, 1),
      nextMonday("Australia Day", 1, 26),
      easter("Good Friday", -2),
      easter("Easter Monday", 1),
      fixed("Anzac Day", 4, 25),
      gbChristmas,
      gbBoxingDay,
    ],
  },
  {
    country: "DE",
    name: "Germany (nationwide)",
    notIncluded:
      "State-specific holidays (Epiphany, Corpus Christi, Reformation Day, All Saints, Day of Prayer and Repentance).",
    rules: [
      fixed("Neujahr", 1, 1),
      easter("Karfreitag", -2),
      easter("Ostermontag", 1),
      fixed("Tag der Arbeit", 5, 1),
      easter("Christi Himmelfahrt", 39),
      easter("Pfingstmontag", 50),
      fixed("Tag der Deutschen Einheit", 10, 3),
      fixed("Erster Weihnachtstag", 12, 25),
      fixed("Zweiter Weihnachtstag", 12, 26),
    ],
  },
  {
    country: "FR",
    name: "France",
    notIncluded: "Regional (Alsace-Moselle) and overseas holidays.",
    rules: [
      fixed("Jour de l'An", 1, 1),
      easter("Lundi de Pâques", 1),
      fixed("Fête du Travail", 5, 1),
      fixed("Victoire 1945", 5, 8),
      easter("Ascension", 39),
      easter("Lundi de Pentecôte", 50),
      fixed("Fête nationale", 7, 14),
      fixed("Assomption", 8, 15),
      fixed("Toussaint", 11, 1),
      fixed("Armistice 1918", 11, 11),
      fixed("Noël", 12, 25),
    ],
  },
  {
    country: "SG",
    name: "Singapore (fixed-date holidays only)",
    notIncluded:
      "Chinese New Year, Hari Raya Puasa, Hari Raya Haji, Vesak Day and Deepavali: these follow lunar or religious calendars and are announced each year, so enter them manually.",
    rules: [
      sundayToMonday("New Year's Day", 1, 1),
      easter("Good Friday", -2),
      sundayToMonday("Labour Day", 5, 1),
      sundayToMonday("National Day", 8, 9),
      sundayToMonday("Christmas Day", 12, 25),
    ],
  },
];

export function listHolidayPresets(): HolidayPresetInfo[] {
  return PRESETS.map(({ country, name, notIncluded }) => ({
    country,
    name,
    notIncluded,
  }));
}

export function isHolidayPresetCountry(country: string): boolean {
  return PRESETS.some((preset) => preset.country === country);
}

/**
 * The preset's holidays for one year as dated holidays, sorted by date. Returns `null` for an
 * unknown country. Two rules never land on the same date within a preset except where the
 * statute does (the later name is kept alongside the earlier one).
 */
export function generateHolidayPreset(
  country: string,
  year: number,
): DatedHoliday[] | null {
  const preset = PRESETS.find((candidate) => candidate.country === country);
  if (!preset || !Number.isInteger(year) || year < 1900 || year > 2200)
    return null;
  const byDate = new Map<string, string[]>();
  for (const rule of preset.rules) {
    const date = iso(rule.at(year));
    const names = byDate.get(date) ?? [];
    names.push(rule.name);
    byDate.set(date, names);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({ date, name: names.join(" / ") }));
}
