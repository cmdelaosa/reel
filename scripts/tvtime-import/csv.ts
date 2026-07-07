import { readFileSync } from "node:fs";

/** Minimal RFC-4180-ish CSV reader: handles quoted fields, embedded commas,
 *  escaped quotes ("") and \r\n. Good enough for TV Time's GDPR export. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by the \n branch
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

/** Read a CSV file into header-keyed records. */
export function readTable(path: string): Table {
  const grid = parseCsv(readFileSync(path, "utf8"));
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((h) => h.trim());
  const rows = grid.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = (cells[i] ?? "").trim()));
    return rec;
  });
  return { headers, rows };
}

/** Fail loudly if the columns we rely on aren't present — surfaces a mismatch
 *  between our assumed schema and the actual export instead of silently
 *  producing empty/garbage data. */
export function requireColumns(table: Table, file: string, cols: string[]): void {
  const missing = cols.filter((c) => !table.headers.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `${file}: missing expected column(s) [${missing.join(", ")}]. ` +
        `Actual headers: [${table.headers.join(", ")}]. ` +
        `Fix the COLUMNS map in index.ts to match this export.`,
    );
  }
}
