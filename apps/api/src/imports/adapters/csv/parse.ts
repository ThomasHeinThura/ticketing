/**
 * Hand-written RFC 4180 CSV parser (P6 Lane C1). No dependency.
 *
 * Handles quoted fields, escaped quotes (""), CRLF / LF / CR record separators, embedded newlines
 * and delimiters inside quotes, a UTF-8 BOM, a header row and a configurable delimiter
 * (',' ';' or tab; `auto` picks the most frequent one in the header line).
 *
 * Nothing is silently coerced. Every deviation becomes an `issue` with a fixed lower_snake code.
 * `fatal` issues stop the whole file (the adapter refuses it); the rest are row-level and are
 * turned into loss rows by the adapter.
 */

export type CsvDelimiter = "," | ";" | "\t";

export const CSV_LIMITS = {
  /** UTF-8 bytes of the whole file. */
  maxBytes: 5 * 1024 * 1024,
  /** Data rows (header excluded). */
  maxRows: 50_000,
  maxColumns: 200,
  /** Characters per cell; longer cells are truncated and reported. */
  maxFieldLength: 32_768,
} as const;

export type CsvParseOptions = {
  delimiter?: CsvDelimiter | "auto";
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  maxFieldLength?: number;
};

export type CsvFatalCode =
  | "file_too_large"
  | "empty_file"
  | "no_header"
  | "too_many_rows"
  | "too_many_columns"
  | "unterminated_quote";

export type CsvRowIssueCode =
  | "field_truncated"
  | "stray_quote"
  | "row_column_count_mismatch";

export type CsvRow = {
  /** 1-based physical line the record starts on. */
  line: number;
  /** Exactly `header.length` cells (padded or cut; see `issues`). */
  cells: string[];
  issues: CsvRowIssueCode[];
};

export type CsvParseResult = {
  delimiter: CsvDelimiter;
  header: string[];
  /** Header names that repeat an earlier one (their columns are ignored). */
  duplicateHeaders: string[];
  rows: CsvRow[];
  fatal: CsvFatalCode | null;
};

const EMPTY = (
  fatal: CsvFatalCode,
  delimiter: CsvDelimiter = ",",
): CsvParseResult => ({
  delimiter,
  header: [],
  duplicateHeaders: [],
  rows: [],
  fatal,
});

export function normalizeDelimiter(value: unknown): CsvDelimiter | "auto" {
  if (value === ";" || value === "semicolon") return ";";
  if (value === "\t" || value === "tab") return "\t";
  if (value === "," || value === "comma") return ",";
  return "auto";
}

function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n" || ch === "\r") break;
      if (ch === "," || ch === ";" || ch === "\t") counts[ch] += 1;
    }
  }
  let best: CsvDelimiter = ",";
  for (const candidate of [";", "\t"] as const)
    if (counts[candidate] > counts[best]) best = candidate;
  return best;
}

type RawRecord = { line: number; cells: string[]; flags: Set<CsvRowIssueCode> };

export function parseCsv(
  input: string,
  options: CsvParseOptions = {},
): CsvParseResult {
  const maxBytes = options.maxBytes ?? CSV_LIMITS.maxBytes;
  const maxRows = options.maxRows ?? CSV_LIMITS.maxRows;
  const maxColumns = options.maxColumns ?? CSV_LIMITS.maxColumns;
  const maxField = options.maxFieldLength ?? CSV_LIMITS.maxFieldLength;

  // Cheap upper bound first (UTF-8 is at most 3 bytes per UTF-16 unit), exact count only if close.
  if (input.length > maxBytes || Buffer.byteLength(input, "utf8") > maxBytes)
    return EMPTY("file_too_large");
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trim() === "") return EMPTY("empty_file");

  const delimiter =
    !options.delimiter || options.delimiter === "auto"
      ? detectDelimiter(text)
      : options.delimiter;

  const records: RawRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let flags = new Set<CsvRowIssueCode>();
  let inQuotes = false;
  /** True once a closing quote ended the quoted part of the current field. */
  let afterQuote = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    if (field.length > maxField) {
      field = field.slice(0, maxField);
      flags.add("field_truncated");
    }
    cells.push(field);
    field = "";
    fieldStarted = false;
    afterQuote = false;
  };
  const endRecord = () => {
    endField();
    const blank = cells.length === 1 && cells[0]?.trim() === "";
    if (!blank) records.push({ line: recordLine, cells, flags });
    cells = [];
    flags = new Set();
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (!fieldStarted && field === "") {
        inQuotes = true;
        fieldStarted = true;
      } else {
        // A quote inside an unquoted field or after a closing quote is kept literally.
        field += ch;
        flags.add("stray_quote");
      }
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (afterQuote) flags.add("stray_quote");
    fieldStarted = true;
    field += ch;
  }
  if (inQuotes) return EMPTY("unterminated_quote", delimiter);
  if (field !== "" || cells.length > 0 || fieldStarted) endRecord();

  const headerRecord = records.shift();
  if (!headerRecord) return EMPTY("no_header", delimiter);
  const header = headerRecord.cells.map((cell) => cell.trim());
  if (header.length > maxColumns) return EMPTY("too_many_columns", delimiter);
  if (records.length > maxRows) return EMPTY("too_many_rows", delimiter);

  const seen = new Set<string>();
  const duplicateHeaders: string[] = [];
  for (const name of header) {
    const key = name.toLowerCase();
    if (name !== "" && seen.has(key)) duplicateHeaders.push(name);
    seen.add(key);
  }

  const rows: CsvRow[] = records.map((record) => {
    const issues = new Set(record.flags);
    let row = record.cells;
    if (row.length !== header.length) {
      issues.add("row_column_count_mismatch");
      row =
        row.length > header.length
          ? row.slice(0, header.length)
          : [...row, ...Array<string>(header.length - row.length).fill("")];
    }
    return { line: record.line, cells: row, issues: [...issues] };
  });
  return { delimiter, header, duplicateHeaders, rows, fatal: null };
}
