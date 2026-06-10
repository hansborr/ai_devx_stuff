export type CsvObject = Readonly<Record<string, string>>;

type CsvState = {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
  sawCell: boolean;
};

export function parseCsvObjects(csv: string): CsvObject[] {
  const rows = parseCsvRows(csv).filter((row) => row.some((field) => field.length > 0));
  const header = rows[0];
  if (header === undefined) return [];
  return rows.slice(1).map((row) => csvObject(header, row));
}

function csvObject(header: readonly string[], row: readonly string[]): CsvObject {
  const item: Record<string, string> = {};
  for (let index = 0; index < header.length; index += 1) {
    const key = header[index];
    if (key === undefined || key.length === 0) continue;
    item[key] = row[index] ?? "";
  }
  return item;
}

function parseCsvRows(csv: string): string[][] {
  const state: CsvState = {
    rows: [],
    row: [],
    field: "",
    inQuotes: false,
    sawCell: false,
  };
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === undefined) continue;
    state.sawCell = true;
    index += state.inQuotes
      ? consumeQuoted(state, csv, index, char)
      : consumeUnquoted(state, csv, index, char);
  }
  finishCsv(state, csv);
  return state.rows;
}

function consumeQuoted(state: CsvState, csv: string, index: number, char: string): number {
  if (char !== '"') {
    state.field += char;
    return 0;
  }
  if (csv[index + 1] === '"') {
    state.field += '"';
    return 1;
  }
  state.inQuotes = false;
  return 0;
}

function consumeUnquoted(state: CsvState, csv: string, index: number, char: string): number {
  if (char === '"') {
    state.inQuotes = true;
    return 0;
  }
  if (char === ",") {
    endField(state);
    return 0;
  }
  if (char === "\n" || char === "\r") {
    endRecord(state);
    return char === "\r" && csv[index + 1] === "\n" ? 1 : 0;
  }
  state.field += char;
  return 0;
}

function endField(state: CsvState): void {
  state.row.push(state.field);
  state.field = "";
}

function endRecord(state: CsvState): void {
  endField(state);
  state.rows.push(state.row);
  state.row = [];
}

function finishCsv(state: CsvState, csv: string): void {
  if (!state.sawCell) return;
  if (state.field.length === 0 && state.row.length === 0 && csv.endsWith("\n")) return;
  endRecord(state);
}
