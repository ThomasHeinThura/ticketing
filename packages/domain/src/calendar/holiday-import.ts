import type { Holiday } from "./types.js";

export const HOLIDAY_IMPORT_LIMITS = {
  bytes: 256 * 1024,
  events: 1000,
  lineBytes: 8 * 1024,
  nameCharacters: 120,
  eventDays: 366,
} as const;

export class HolidayImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HolidayImportError";
  }
}

type Property = { name: string; params: Map<string, string>; value: string };
type EventValue = {
  uid?: string;
  stamp?: string;
  start?: string;
  end?: string;
  summary?: string;
};

function fail(message: string): never {
  throw new HolidayImportError(message);
}

function daysInMonth(year: number, month: number) {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function ordinal(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return fail(`Invalid calendar date ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    year > 9998 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  )
    return fail(`Invalid or out-of-range calendar date ${date}`);
  const prior = year - 1;
  let value =
    prior * 365 +
    Math.floor(prior / 4) -
    Math.floor(prior / 100) +
    Math.floor(prior / 400);
  for (let m = 1; m < month; m++) value += daysInMonth(year, m);
  return value + day;
}

function isoDate(value: string): string {
  if (!/^\d{8}$/.test(value))
    return fail("Date values must use RFC 5545 DATE form YYYYMMDD");
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseProperty(line: string): Property {
  const colon = line.indexOf(":");
  if (colon <= 0)
    return fail("Malformed content line: missing property/value separator");
  const head = line.slice(0, colon).split(";");
  const name = head.shift()?.toUpperCase();
  if (!name || !/^[A-Z0-9-]+$/.test(name))
    return fail("Malformed property name");
  const params = new Map<string, string>();
  for (const token of head) {
    const equals = token.indexOf("=");
    if (equals <= 0) return fail(`Malformed ${name} parameter`);
    const key = token.slice(0, equals).toUpperCase();
    const val = token.slice(equals + 1).toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(key) || !val || params.has(key))
      return fail(`Malformed ${name} parameter`);
    params.set(key, val);
  }
  return { name, params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  let result = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\") {
      const escaped = value[++i];
      if (escaped === "n" || escaped === "N") result += "\n";
      else if (escaped === "," || escaped === ";" || escaped === "\\")
        result += escaped;
      else return fail("Text values contain an invalid RFC 5545 text escape");
    } else {
      if (char === "," || char === ";")
        return fail(
          "SUMMARY commas and semicolons must use RFC 5545 text escapes",
        );
      const code = char?.codePointAt(0) ?? 0;
      if (code < 32 || code === 127)
        return fail("Text values contain an unescaped control character");
      result += char;
    }
  }
  return result.normalize("NFC").trim();
}

function readDate(
  property: Property | undefined,
  key: string,
  required: boolean,
): string | undefined {
  if (!property) {
    if (required) return fail(`${key} is required`);
    return undefined;
  }
  if (property.params.size !== 1 || property.params.get("VALUE") !== "DATE")
    return fail(`${key} must use VALUE=DATE and may not include TZID`);
  const date = isoDate(property.value);
  ordinal(date);
  return date;
}

function dateBefore(date: string): string {
  ordinal(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return fail("DTEND falls outside supported calendar date bounds");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (day > 1)
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day - 1).padStart(2, "0")}`;
  if (month > 1) {
    const priorMonth = month - 1;
    return `${String(year).padStart(4, "0")}-${String(priorMonth).padStart(2, "0")}-${String(daysInMonth(year, priorMonth)).padStart(2, "0")}`;
  }
  if (year === 1)
    return fail("DTEND falls outside supported calendar date bounds");
  return `${String(year - 1).padStart(4, "0")}-12-31`;
}

function validateStamp(value: string | undefined): void {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value))
    fail("DTSTAMP is required and must be a UTC DATE-TIME");
  ordinal(isoDate(value.slice(0, 8)));
  const hour = Number(value.slice(9, 11));
  const minute = Number(value.slice(11, 13));
  const second = Number(value.slice(13, 15));
  if (hour > 23 || minute > 59 || second > 60)
    fail("DTSTAMP contains an invalid time");
}

function eventToHoliday(event: EventValue, index: number): Holiday {
  const uidHasControl = event.uid
    ? [...event.uid].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code <= 31 || code === 127;
      })
    : false;
  if (!event.uid || event.uid.trim().length === 0 || uidHasControl)
    return fail(
      `VEVENT ${index}: UID is required and must be a valid non-empty identifier`,
    );
  unescapeText(event.uid);
  validateStamp(event.stamp);
  if (!event.start) return fail(`VEVENT ${index}: DTSTART is required`);
  if (!event.end) {
    const name = event.summary;
    if (name && [...name].length > HOLIDAY_IMPORT_LIMITS.nameCharacters)
      return fail(`VEVENT ${index}: SUMMARY exceeds 120 characters`);
    return name ? { date: event.start, name } : { date: event.start };
  }
  const end = event.end;
  const span = ordinal(end) - ordinal(event.start);
  if (span < 1) return fail(`VEVENT ${index}: DTEND must be after DTSTART`);
  if (span > HOLIDAY_IMPORT_LIMITS.eventDays)
    return fail(`VEVENT ${index}: event exceeds 366 covered dates`);
  const name = event.summary;
  if (name && [...name].length > HOLIDAY_IMPORT_LIMITS.nameCharacters)
    return fail(`VEVENT ${index}: SUMMARY exceeds 120 characters`);
  return name
    ? span === 1
      ? { date: event.start, name }
      : { from: event.start, to: dateBefore(end), name }
    : span === 1
      ? { date: event.start }
      : { from: event.start, to: dateBefore(end) };
}

export function parseHolidayIcs(ics: string): Holiday[] {
  const bytes = new TextEncoder().encode(ics);
  if (bytes.byteLength > HOLIDAY_IMPORT_LIMITS.bytes)
    return fail("Calendar file exceeds the 256 KiB limit");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Calendar file is not valid UTF-8");
  }
  if (/(^|[^\r])\n|\r(?!\n)/.test(ics))
    return fail("iCalendar content lines must use RFC 5545 CRLF endings");
  const lines: string[] = [];
  for (const line of ics.split("\r\n")) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (lines.length === 0)
        return fail("Content line continuation has no preceding line");
      lines[lines.length - 1] += line.slice(1);
    } else lines.push(line);
  }
  if (
    lines.some(
      (line) =>
        new TextEncoder().encode(line).byteLength >
        HOLIDAY_IMPORT_LIMITS.lineBytes,
    )
  )
    return fail("Unfolded content line exceeds the 8 KiB limit");
  const input = lines.filter(
    (line, index) => !(index === lines.length - 1 && line === ""),
  );
  if (input[0] !== "BEGIN:VCALENDAR" || input.at(-1) !== "END:VCALENDAR")
    return fail("Expected a complete VCALENDAR component");
  let component: "calendar" | "event" | null = "calendar";
  let version = false;
  let prodid = false;
  const calendarFields = new Set<string>();
  let current: EventValue | null = null;
  let eventCount = 0;
  const holidays: Holiday[] = [];
  for (const line of input.slice(1, -1)) {
    const property = parseProperty(line);
    if (property.name === "BEGIN") {
      if (
        property.params.size ||
        component !== "calendar" ||
        property.value !== "VEVENT" ||
        current
      )
        return fail(
          "Only flat VEVENT components are supported inside VCALENDAR",
        );
      component = "event";
      current = {};
      if (++eventCount > HOLIDAY_IMPORT_LIMITS.events)
        return fail("Calendar file exceeds the 1,000 event limit");
      continue;
    }
    if (property.name === "END") {
      if (
        property.params.size ||
        property.value !== "VEVENT" ||
        component !== "event" ||
        !current
      )
        return fail("Malformed or unsupported component ending");
      holidays.push(eventToHoliday(current, eventCount));
      current = null;
      component = "calendar";
      continue;
    }
    if (!component) return fail("Calendar property appears outside VCALENDAR");
    if (component === "calendar") {
      if (
        !["VERSION", "PRODID", "CALSCALE"].includes(property.name) ||
        calendarFields.has(property.name) ||
        property.params.size
      )
        return fail(
          `Unsupported or duplicate VCALENDAR property ${property.name}`,
        );
      calendarFields.add(property.name);
      if (property.name === "VERSION") version = property.value === "2.0";
      if (property.name === "PRODID")
        prodid = unescapeText(property.value).length > 0;
      if (property.name === "CALSCALE" && property.value !== "GREGORIAN")
        return fail("Only GREGORIAN CALSCALE is supported");
      continue;
    }
    if (!current) return fail("Malformed VEVENT");
    if (
      !["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY"].includes(property.name)
    )
      return fail(`Unsupported VEVENT property ${property.name}`);
    const key = (
      {
        UID: "uid",
        DTSTAMP: "stamp",
        DTSTART: "start",
        DTEND: "end",
        SUMMARY: "summary",
      } as const
    )[property.name as "UID" | "DTSTAMP" | "DTSTART" | "DTEND" | "SUMMARY"];
    if (current[key] !== undefined)
      return fail(`VEVENT ${eventCount}: duplicate ${property.name}`);
    if (property.name === "DTSTART" || property.name === "DTEND")
      current[key] = readDate(
        property,
        property.name,
        property.name === "DTSTART",
      );
    else {
      if (property.params.size)
        return fail(`${property.name} does not accept parameters`);
      current[key] =
        property.name === "SUMMARY"
          ? unescapeText(property.value)
          : property.value;
    }
  }
  if (component !== "calendar" || current)
    return fail("VCALENDAR contains an unclosed component");
  if (!version) return fail("VCALENDAR VERSION:2.0 is required");
  if (!prodid) return fail("VCALENDAR PRODID is required");
  if (holidays.length === 0)
    return fail("Calendar file must contain at least one VEVENT");
  return holidays;
}

export function holidayImportIdentity(holiday: Holiday): string {
  const name = (holiday.name ?? "").normalize("NFC").trim();
  if ("recurs" in holiday)
    return JSON.stringify(["annual", holiday.month, holiday.day, name]);
  if ("from" in holiday)
    return JSON.stringify(["range", holiday.from, holiday.to, name]);
  return JSON.stringify(["date", holiday.date, name]);
}
