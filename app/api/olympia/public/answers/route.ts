import { NextResponse, type NextRequest } from "next/server";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

type AnswerResponse = {
  id: string;
  match_id: string;
  match_round_id: string | null;
  round_question_id: string;
  player_id: string;
  answer_text: string | null;
  is_correct: boolean | null;
  points_awarded: number | null;
  response_time_ms: number | null;
  submitted_at: string;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const roundQuestionId = url.searchParams.get("roundQuestionId");
  if (!sessionId || !roundQuestionId) {
    return NextResponse.json({ error: "Thiếu sessionId hoặc roundQuestionId." }, { status: 400 });
  }

  try {
    const olympia = getOlympiaAdminClient().schema("olympia");
    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, match_id, question_state, show_answers_overlay, current_round_question_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
    if (!session || session.current_round_question_id !== roundQuestionId) {
      return NextResponse.json({ error: "Câu hỏi không thuộc phiên live." }, { status: 403 });
    }

    const published =
      session.show_answers_overlay === true ||
      session.question_state === "answer_revealed" ||
      session.question_state === "completed";
    if (!published) return NextResponse.json({ answers: [] }, { status: 200 });

    const { data, error } = await olympia
      .from("answers")
      .select(
        "id, match_id, match_round_id, round_question_id, player_id, answer_text, is_correct, points_awarded, response_time_ms, submitted_at"
      )
      .eq("match_id", session.match_id)
      .eq("round_question_id", roundQuestionId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ answers: (data as AnswerResponse[] | null) ?? [] }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể lấy đáp án đã công bố.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
