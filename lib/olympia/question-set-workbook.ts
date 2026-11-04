import ExcelJS from "exceljs";

export const QUESTION_SET_SHEETS = [
  "DOC_TRUOC",
  "KD_CA_NHAN",
  "KD_CHUNG",
  "VCNV",
  "TANG_TOC",
  "VE_DICH",
  "CAU_HOI_PHU",
] as const;

export type QuestionSetSheet = (typeof QUESTION_SET_SHEETS)[number];

export type ParsedQuestionSetItem = {
  code: string;
  sheet: Exclude<QuestionSetSheet, "DOC_TRUOC">;
  category: string | null;
  question_text: string | null;
  answer_text: string;
  note: string | null;
  media_filename: string | null;
  letter_count: number | null;
  order_index: number;
};

export type MediaRequirement = {
  code: string;
  sheet: Exclude<QuestionSetSheet, "DOC_TRUOC">;
  filename: string;
};

export type SkippedQuestion = {
  sheet: QuestionSetSheet;
  row: number;
  code: string | null;
  reason: string;
};

export type ParsedQuestionSetWorkbook = {
  items: ParsedQuestionSetItem[];
  skipped: SkippedQuestion[];
  warnings: string[];
  mediaRequirements: MediaRequirement[];
};

const CODE_PATTERNS: Record<Exclude<QuestionSetSheet, "DOC_TRUOC">, RegExp> = {
  KD_CA_NHAN: /^(?:KD[1-4]-[1-6]|DKA-(?:[1-9]|1[0-5]))$/,
  KD_CHUNG: /^(?:KD[1-4]-[1-6]|DKA-(?:[1-9]|1[0-5]))$/,
  VCNV: /^(?:VCNV-[1-4]|VCNV-OTT|CNV)$/,
  TANG_TOC: /^TT[1-4]$/,
  VE_DICH: /^VD-(?:20|30)\.(?:[1-9]|10)$/,
  CAU_HOI_PHU: /^CHP-[1-3]$/,
};

const MEDIA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "mp3", "wav", "ogg", "m4a",
  "mp4", "webm", "mov", "m4v",
]);

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["code", "ma", "ma vi tri"],
  order: ["order", "thu tu", "thu tu vi tri", "thu tu trong nhom"],
  position: ["position", "vi tri"],
  category: ["category", "linh vuc"],
  question: ["question", "cau hoi", "cau hoi / goi y", "cau hoi goi y"],
  answer: ["answer", "đáp án", "đáp án *", "dap an"],
  note: ["note", "ghi chu", "ghi chu cho mc"],
  media: ["media", "media filename", "media_filename", "ten file media", "tep media"],
  letter_count: ["letter_count", "letter count", "so chu"],
  duration: ["duration", "thoi luong", "thoi gian", "thoi gian giay"],
  point: ["point", "points", "diem"],
};

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim();
  }
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readCell(row: ExcelJS.Row, index: number): string {
  return text(row.getCell(index).value);
}

function readOptionalCell(row: ExcelJS.Row, index: number | undefined): string {
  return index === undefined ? "" : readCell(row, index);
}

/**
 * ExcelJS/JSZip đọc được Uint8Array, còn File.arrayBuffer() có thể đi kèm
 * vùng nhớ backing không phù hợp với generic Buffer của Node typings. Sao
 * chép dữ liệu vào Uint8Array độc lập trước khi parse workbook.xml.
 */
function toLoadBuffer(buffer: ArrayBuffer | Uint8Array | Buffer): Uint8Array<ArrayBuffer> {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

function validateMediaFilename(raw: string, code: string): string {
  const filename = raw.trim();
  if (!filename) return "";
  if (filename.includes("/") || filename.includes("\\") || filename.includes("://")) {
    throw new Error(`Media của ${code} phải là filename, không phải URL hoặc đường dẫn.`);
  }
  const match = /^([^./]+)\.([a-z0-9]+)$/i.exec(filename);
  if (!match || match[1]!.toUpperCase() !== code || !MEDIA_EXTENSIONS.has(match[2]!.toLowerCase())) {
    throw new Error(`Media của ${code} phải có dạng ${code}.extension hợp lệ.`);
  }
  return filename;
}

function computedLetterCount(answer: string): number {
  return Array.from(answer).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function findHeaderIndexes(sheet: ExcelJS.Worksheet, required: string[]): Map<string, number> {
  const indexes = new Map<string, number>();
  const rawHeaders: string[] = [];
  const recognizedHeaders: string[] = [];
  sheet.getRow(4).eachCell((cell, index) => {
    const rawHeader = text(cell.value);
    const header = normalizeHeader(rawHeader);
    if (rawHeader) rawHeaders.push(rawHeader);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias) === header)) {
        indexes.set(key, index);
        recognizedHeaders.push(`${rawHeader} -> ${key}`);
        break;
      }
    }
  });
  for (const key of required) {
    if (!indexes.has(key)) {
      throw new Error(
        `Sheet ${sheet.name} thiếu header ${key} ở hàng 4. ` +
        `Header gốc: [${rawHeaders.join(", ")}]. ` +
        `Header parser nhận diện: [${recognizedHeaders.join(", ")}].`,
      );
    }
  }
  return indexes;
}

function requireHeader(
  headers: Map<string, number>,
  sheetName: string,
  ...keys: string[]
): number {
  const index = keys.map((key) => headers.get(key)).find((value): value is number => value !== undefined);
  if (index === undefined) throw new Error(`Sheet ${sheetName} thiếu header ${keys.join(" hoặc ")} ở hàng 4.`);
  return index;
}

export async function parseQuestionSetWorkbook(
  buffer: ArrayBuffer | Uint8Array | Buffer,
): Promise<ParsedQuestionSetWorkbook> {
  const workbook = new ExcelJS.Workbook();
  const loadBuffer = toLoadBuffer(buffer);
  await workbook.xlsx.load(loadBuffer);
  const actualNames = new Set(workbook.worksheets.map((sheet) => sheet.name));
  const missingSheets = QUESTION_SET_SHEETS.filter((name) => !actualNames.has(name));
  if (missingSheets.length > 0) throw new Error(`Workbook thiếu sheet: ${missingSheets.join(", ")}.`);

  const items: ParsedQuestionSetItem[] = [];
  const skipped: SkippedQuestion[] = [];
  const codes = new Set<string>();
  const mediaRequirements: MediaRequirement[] = [];
  const warnings: string[] = [];

  for (const sheetName of QUESTION_SET_SHEETS) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) throw new Error(`Không đọc được sheet ${sheetName}.`);
    if (sheetName === "DOC_TRUOC") {
      if (sheet.getRow(4).cellCount === 0) throw new Error("Sheet DOC_TRUOC thiếu header ở hàng 4.");
      continue;
    }
    const requiredHeaders = sheetName === "VCNV"
      ? ["code", "category", "question", "answer", "letter_count", "media"]
      : sheetName === "TANG_TOC"
        ? ["code", "category", "question", "answer", "note", "duration", "media"]
        : sheetName === "VE_DICH"
          ? ["code", "category", "question", "answer", "note", "point", "media"]
          : ["code", "category", "question", "answer", "note", "media"];
    const headers = findHeaderIndexes(sheet, requiredHeaders);
    requireHeader(headers, sheetName, "position", "order");

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 5) return;
      const codeRaw = readCell(row, headers.get("code")!);
      const answer = readCell(row, headers.get("answer")!);
      const question = readCell(row, headers.get("question")!);
      const mediaRaw = readCell(row, headers.get("media")!);
      if (!codeRaw && !answer && !question && !mediaRaw) return;
      const code = codeRaw.toUpperCase();
      if (!answer) {
        skipped.push({ sheet: sheetName, row: rowNumber, code: code || null, reason: "ANSWER trống." });
        return;
      }
      if (!CODE_PATTERNS[sheetName].test(code)) {
        throw new Error(`CODE ${code || "(trống)"} không hợp lệ cho sheet ${sheetName}, hàng ${rowNumber}.`);
      }
      if (codes.has(code)) throw new Error(`CODE trùng: ${code}.`);

      const note = readOptionalCell(row, headers.get("note"));
      const letterRaw = headers.has("letter_count") ? readCell(row, headers.get("letter_count")!) : "";
      let letterCount: number | null = null;
      if (sheetName === "VCNV") {
        if (letterRaw) {
          if (!/^[1-9]\d*$/.test(letterRaw)) throw new Error(`letter_count của ${code} phải là số nguyên dương.`);
          letterCount = Number(letterRaw);
        } else {
          letterCount = computedLetterCount(answer);
        }
      }
      const media = mediaRaw ? validateMediaFilename(mediaRaw, code) : null;
      const item: ParsedQuestionSetItem = {
        code,
        sheet: sheetName,
        category: readOptionalCell(row, headers.get("category")) || null,
        question_text: question || null,
        answer_text: answer,
        note: note || null,
        media_filename: media || null,
        letter_count: letterCount,
        order_index: items.length,
      };
      codes.add(code);
      items.push(item);
      if (media) mediaRequirements.push({ code, sheet: sheetName, filename: media });
    });
  }
  if (items.length === 0) warnings.push("Workbook không có câu hỏi hợp lệ.");
  return { items, skipped, warnings, mediaRequirements };
}

export function extractRequiredAssetBasenames(items: ParsedQuestionSetItem[]): string[] {
  return Array.from(new Set(items.flatMap((item) => item.media_filename ? [item.media_filename] : [])));
}
