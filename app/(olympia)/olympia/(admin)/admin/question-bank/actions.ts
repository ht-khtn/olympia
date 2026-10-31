"use server";

import { revalidatePath } from "next/cache";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

export type DeleteQuestionSetState = { error: string | null; success: string | null };

export type QuestionSetItem = {
  id: string;
  code: string;
  category: string | null;
  question_text: string;
  answer_text: string;
  note: string | null;
  submitted_by: string | null;
  source: string | null;
  image_url: string | null;
  audio_url: string | null;
  order_index: number;
};

export async function getQuestionSetItems(questionSetId: string): Promise<QuestionSetItem[]> {
  try {
    await requireOlympiaAdminContext();
    const admin = getOlympiaAdminClient();
    const olympia = admin.schema("olympia");
    const { data, error } = await olympia
      .from("question_set_items")
      .select(
        "id, code, category, question_text, answer_text, note, submitted_by, source, image_path, audio_path, image_external_url, audio_external_url, order_index"
      )
      .eq("question_set_id", questionSetId)
      .order("order_index", { ascending: true });

    if (error) throw error;

    return Promise.all(
      (data ?? []).map(async (item) => {
        const signed = await Promise.all(
          [item.image_path, item.audio_path].map(async (path) => {
            if (!path) return null;
            const result = await admin.storage.from("olympia-assets").createSignedUrl(path, 60 * 30);
            if (result.error) throw result.error;
            return result.data.signedUrl;
          })
        );
        return {
          id: item.id,
          code: item.code,
          category: item.category,
          question_text: item.question_text,
          answer_text: item.answer_text,
          note: item.note,
          submitted_by: item.submitted_by,
          source: item.source,
          image_url: signed[0] ?? item.image_external_url ?? null,
          audio_url: signed[1] ?? item.audio_external_url ?? null,
          order_index: item.order_index,
        };
      })
    );
  } catch (error) {
    console.error("[getQuestionSetItems] Error:", error);
    return [];
  }
}

export async function deleteQuestionSetAction(
  _: DeleteQuestionSetState,
  formData: FormData
): Promise<DeleteQuestionSetState> {
  try {
    await requireOlympiaAdminContext();
    const olympia = getOlympiaAdminClient().schema("olympia");
    const questionSetId = String(formData.get("questionSetId") ?? "").trim();
    if (!questionSetId) return { error: "Thiếu questionSetId.", success: null };

    const { data: itemRows, error: itemsError } = await olympia
      .from("question_set_items")
      .select("id")
      .eq("question_set_id", questionSetId);
    if (itemsError) return { error: itemsError.message, success: null };

    const itemIds = (itemRows ?? []).map((row) => row.id);
    if (itemIds.length > 0) {
      const { data: usedRows, error: usedError } = await olympia
        .from("round_questions")
        .select("id")
        .in("question_set_item_id", itemIds)
        .limit(1);
      if (usedError) return { error: usedError.message, success: null };
      if ((usedRows?.length ?? 0) > 0) {
        return { error: "Không thể xoá bộ đề vì đã được sử dụng trong một trận.", success: null };
      }
    }

    const { data: assignedRows, error: assignedError } = await olympia
      .from("match_question_sets")
      .select("id")
      .eq("question_set_id", questionSetId)
      .limit(1);
    if (assignedError) return { error: assignedError.message, success: null };
    if ((assignedRows?.length ?? 0) > 0) {
      return { error: "Không thể xoá bộ đề vì đang được gán cho một trận.", success: null };
    }

    const { error: deleteError } = await olympia.from("question_sets").delete().eq("id", questionSetId);
    if (deleteError) return { error: deleteError.message, success: null };

    revalidatePath("/olympia/admin/question-bank");
    revalidatePath("/olympia/admin/matches");
    revalidatePath("/olympia/admin");
    return { error: null, success: "Đã xoá bộ đề." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Không thể xoá bộ đề.", success: null };
  }
}
