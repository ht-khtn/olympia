"use server";

import { revalidatePath } from "next/cache";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";
import {
  parseQuestionSetWorkbook,
  type ParsedQuestionSetItem,
  type ParsedQuestionSetWorkbook,
} from "@/lib/olympia/question-set-workbook";

const MAX_WORKBOOK_SIZE = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERNS = [
  /^(?:KD[1-4]-[1-6]|DKA-(?:[1-9]|1[0-5]))$/,
  /^(?:VCNV-[1-4]|VCNV-OTT|CNV)$/,
  /^TT[1-4]$/,
  /^VD-(?:20|30)\.(?:[1-9]|10)$/,
  /^CHP-[1-3]$/,
];

export type QuestionSetItem = {
  id: string;
  code: string;
  category: string | null;
  question_text: string | null;
  answer_text: string;
  note: string | null;
  media_path: string | null;
  media_url: string | null;
  letter_count: number | null;
  order_index: number;
};

export type ParseQuestionSetResult = ParsedQuestionSetWorkbook;

function isValidCode(code: string): boolean {
  return CODE_PATTERNS.some((pattern) => pattern.test(code));
}

function validateParsedItems(items: ParsedQuestionSetItem[]): void {
  const codes = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.code !== "string" || typeof item.answer_text !== "string" || !item.answer_text.trim()) {
      throw new Error("Payload câu hỏi không hợp lệ: CODE và ANSWER là bắt buộc.");
    }
    const code = item.code.trim().toUpperCase();
    const sheetPattern = item.sheet === "VCNV"
      ? /^(?:VCNV-[1-4]|VCNV-OTT|CNV)$/
      : item.sheet === "TANG_TOC"
        ? /^TT[1-4]$/
        : item.sheet === "VE_DICH"
          ? /^VD-(?:20|30)\.(?:[1-9]|10)$/
          : item.sheet === "CAU_HOI_PHU"
            ? /^CHP-[1-3]$/
            : /^(?:KD[1-4]-[1-6]|DKA-(?:[1-9]|1[0-5]))$/;
    if (code !== item.code || !isValidCode(code) || !sheetPattern.test(code)) {
      throw new Error(`CODE ${code} không thuộc sheet ${item.sheet}.`);
    }
    if (codes.has(code)) throw new Error(`CODE trùng: ${code}.`);
    if (item.question_text !== null && typeof item.question_text !== "string") {
      throw new Error(`question_text không hợp lệ cho ${code}.`);
    }
    if (item.letter_count !== null && (!Number.isInteger(item.letter_count) || item.letter_count <= 0)) {
      throw new Error(`letter_count không hợp lệ cho ${code}.`);
    }
    codes.add(code);
  }
}

export async function parseQuestionSetWorkbookAction(formData: FormData): Promise<ParseQuestionSetResult> {
  await requireOlympiaAdminContext();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Thiếu file workbook.");
  if (file.size > MAX_WORKBOOK_SIZE) throw new Error("Workbook vượt quá giới hạn 5 MiB.");
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Chỉ chấp nhận file .xlsx.");
  return parseQuestionSetWorkbook(await file.arrayBuffer());
}

function parseJson<T>(value: FormDataEntryValue | null, label: string): T {
  if (typeof value !== "string") throw new Error(`Thiếu ${label}.`);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} không hợp lệ.`);
  }
}

async function removeUploadedObjects(
  admin: ReturnType<typeof getOlympiaAdminClient>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from("olympia-assets").remove(paths);
  if (error) console.error("[createQuestionSetFromWorkbookAction] Storage cleanup failed:", error);
}

export async function createQuestionSetFromWorkbookAction(formData: FormData): Promise<{ success: string }> {
  await requireOlympiaAdminContext();
  const questionSetId = String(formData.get("questionSetId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const filename = String(formData.get("filename") ?? "").trim();
  if (!UUID_PATTERN.test(questionSetId)) throw new Error("questionSetId không hợp lệ.");
  if (!name) throw new Error("Tên bộ đề không được để trống.");
  if (!filename.toLowerCase().endsWith(".xlsx")) throw new Error("Tên workbook không hợp lệ.");
  const items = parseJson<ParsedQuestionSetItem[]>(formData.get("items"), "items");
  const mediaPaths = parseJson<string[]>(formData.get("mediaPaths"), "mediaPaths");
  if (!Array.isArray(items) || !Array.isArray(mediaPaths)) throw new Error("Payload import không hợp lệ.");
  validateParsedItems(items);

  const prefix = `question-sets/${questionSetId}/`;
  const validPaths = new Set<string>();
  for (const path of mediaPaths) {
    if (typeof path !== "string" || !path.startsWith(prefix) || path.slice(prefix.length).includes("/")) {
      throw new Error("Media path không thuộc question-set hiện tại.");
    }
    validPaths.add(path);
  }

  const admin = getOlympiaAdminClient();
  const storage = admin.storage.from("olympia-assets");
  const { data: objects, error: listError } = await storage.list(`question-sets/${questionSetId}`);
  if (listError) throw listError;
  const existingPaths = new Set((objects ?? []).map((object) => `${prefix}${object.name}`));
  for (const path of validPaths) {
    if (!existingPaths.has(path)) throw new Error(`Không tìm thấy media đã upload: ${path.slice(prefix.length)}.`);
  }
  const referencedPaths = new Map<string, string>();
  for (const path of validPaths) referencedPaths.set(path.slice(prefix.length).toLowerCase(), path);

  const olympia = admin.schema("olympia");
  let inserted = false;
  try {
    const { error: setError } = await olympia.from("question_sets").insert({
      id: questionSetId,
      name,
      original_filename: filename,
    });
    if (setError) throw setError;
    inserted = true;
    const rows = items.map((item) => {
      const mediaPath = item.media_filename
        ? referencedPaths.get(item.media_filename.toLowerCase()) ?? null
        : null;
      if (item.media_filename && !mediaPath) throw new Error(`Thiếu media: ${item.media_filename}.`);
      return {
        question_set_id: questionSetId,
        code: item.code,
        category: item.category,
        question_text: item.question_text,
        answer_text: item.answer_text,
        note: item.note,
        media_path: mediaPath,
        letter_count: item.letter_count,
        order_index: item.order_index,
      };
    });
    const { error: itemsError } = await olympia.from("question_set_items").insert(rows);
    if (itemsError) throw itemsError;
  } catch (error) {
    if (inserted) {
      const { error: itemCleanupError } = await olympia.from("question_set_items")
        .delete().eq("question_set_id", questionSetId);
      if (itemCleanupError) console.error("[createQuestionSetFromWorkbookAction] Item cleanup failed:", itemCleanupError);
      const { error: cleanupError } = await olympia.from("question_sets").delete().eq("id", questionSetId);
      if (cleanupError) console.error("[createQuestionSetFromWorkbookAction] Database cleanup failed:", cleanupError);
    }
    await removeUploadedObjects(admin, Array.from(validPaths));
    throw error;
  }

  revalidatePath("/olympia/admin/question-bank");
  return { success: "Đã import bộ đề thành công." };
}

export async function getQuestionSetItems(questionSetId: string): Promise<QuestionSetItem[]> {
  await requireOlympiaAdminContext();
  if (!UUID_PATTERN.test(questionSetId)) throw new Error("questionSetId không hợp lệ.");
  const admin = getOlympiaAdminClient();
  const { data, error } = await admin
    .schema("olympia")
    .from("question_set_items")
    .select("id, code, category, question_text, answer_text, note, media_path, letter_count, order_index")
    .eq("question_set_id", questionSetId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return Promise.all((data ?? []).map(async (item) => {
    let mediaUrl: string | null = null;
    if (item.media_path) {
      const signed = await admin.storage.from("olympia-assets").createSignedUrl(item.media_path, 60 * 30);
      if (signed.error) throw signed.error;
      mediaUrl = signed.data.signedUrl;
    }
    return {
      id: item.id,
      code: item.code,
      category: item.category,
      question_text: item.question_text,
      answer_text: item.answer_text,
      note: item.note,
      media_path: item.media_path,
      media_url: mediaUrl,
      letter_count: item.letter_count,
      order_index: item.order_index,
    };
  }));
}

export type DeleteQuestionSetState = { error: string | null; success: string | null };

export async function deleteQuestionSetAction(
  _: DeleteQuestionSetState,
  formData: FormData,
): Promise<DeleteQuestionSetState> {
  try {
    await requireOlympiaAdminContext();
    const questionSetId = String(formData.get("questionSetId") ?? "").trim();
    if (!UUID_PATTERN.test(questionSetId)) return { error: "questionSetId không hợp lệ.", success: null };
    const olympia = getOlympiaAdminClient().schema("olympia");
    const { data: itemRows, error: itemError } = await olympia
      .from("question_set_items").select("id").eq("question_set_id", questionSetId);
    if (itemError) throw itemError;
    const itemIds = (itemRows ?? []).map((row) => row.id);
    if (itemIds.length > 0) {
      const { count, error } = await olympia.from("round_questions")
        .select("id", { count: "exact", head: true }).in("question_set_item_id", itemIds);
      if (error) throw error;
      if ((count ?? 0) > 0) return { error: "Không thể xoá bộ đề vì đã được sử dụng trong một trận.", success: null };
    }
    const { count, error: assignedError } = await olympia.from("match_question_sets")
      .select("question_set_id", { count: "exact", head: true }).eq("question_set_id", questionSetId);
    if (assignedError) throw assignedError;
    if ((count ?? 0) > 0) return { error: "Không thể xoá bộ đề vì đang được gán cho một trận.", success: null };
    const { error } = await olympia.from("question_sets").delete().eq("id", questionSetId);
    if (error) throw error;
    revalidatePath("/olympia/admin/question-bank");
    revalidatePath("/olympia/admin/matches");
    revalidatePath("/olympia/admin");
    return { error: null, success: "Đã xoá bộ đề." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Không thể xoá bộ đề.", success: null };
  }
}
