import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDisplayNamesForUserIds } from "@/lib/olympia-display-names";
import type {
  AnswerRow,
  BuzzerEventRow,
  GameSessionPayload,
  LiveSessionRow,
  MatchRow,
  PlayerRow,
  RoundQuestionRow,
  ScoreRow,
  StarUseRow,
} from "@/types/olympia/game";

const sessionSelect =
  "id, match_id, status, join_code, question_state, current_round_id, current_round_type, current_round_question_id, timer_deadline, requires_player_password, buzzer_enabled, show_scoreboard_overlay, show_answers_overlay, guest_media_control";
const questionSelect =
  "id, match_round_id, question_set_item_id, order_index, target_player_id, meta, question_text, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count, match_rounds!inner(match_id, round_type)";

type GuestQuestionRow = RoundQuestionRow & {
  match_rounds?: { match_id?: string | null; round_type?: string | null } | null;
};

function redactQuestion(
  question: GuestQuestionRow,
  visible: boolean
): RoundQuestionRow {
  if (visible) {
    return {
      id: question.id,
      match_round_id: question.match_round_id,
      question_set_item_id: question.question_set_item_id,
      order_index: question.order_index,
      target_player_id: question.target_player_id,
      meta: question.meta,
      question_text: question.question_text ?? null,
      answer_text: null,
      note: null,
      image_path: question.image_path,
      audio_path: question.audio_path,
      image_external_url: question.image_external_url,
      audio_external_url: question.audio_external_url,
      media_path: question.media_path,
      letter_count: question.letter_count,
    };
  }

  return {
    id: question.id,
    match_round_id: question.match_round_id,
    question_set_item_id: question.question_set_item_id,
    order_index: question.order_index,
    target_player_id: question.target_player_id,
    meta: question.meta,
    question_text: null,
    answer_text: null,
    note: null,
    image_path: null,
    audio_path: null,
    image_external_url: null,
    audio_external_url: null,
    media_path: null,
    letter_count: question.letter_count,
  };
}

export async function getGuestSnapshot(
  client: SupabaseClient,
  sessionId: string
): Promise<GameSessionPayload | null> {
  const olympia = client.schema("olympia");
  const { data: rawSession, error: sessionError } = await olympia
    .from("live_sessions")
    .select(sessionSelect)
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw new Error("Không thể tải phiên Olympia.");
  if (!rawSession) return null;

  const session = rawSession as LiveSessionRow;
  const [{ data: rawMatch, error: matchError }, { data: rawPlayers, error: playersError }, { data: rawScores, error: scoresError }] =
    await Promise.all([
      olympia.from("matches").select("id, name, status, scheduled_at").eq("id", session.match_id).maybeSingle(),
      olympia
        .from("match_players")
        .select("id, match_id, participant_id, seat_index, display_name, is_disqualified_obstacle")
        .eq("match_id", session.match_id)
        .order("seat_index", { ascending: true }),
      olympia.from("match_scores").select("id, match_id, player_id, round_type, points").eq("match_id", session.match_id),
    ]);

  if (matchError || playersError || scoresError) throw new Error("Không thể tải dữ liệu phiên Olympia.");
  if (!rawMatch) return null;

  const match = rawMatch as MatchRow;
  const playersWithIds = (rawPlayers ?? []) as PlayerRow[];
  const names = await resolveDisplayNamesForUserIds(
    client,
    playersWithIds.map((player) => player.participant_id)
  );
  const players = playersWithIds.map(({ participant_id: _participantId, ...player }) => ({
    ...player,
    display_name:
      player.display_name ??
      (typeof _participantId === "string" ? names.get(_participantId) ?? null : null),
  })) as PlayerRow[];

  const currentQuestionId = session.current_round_question_id;
  const [{ data: rawQuestion, error: questionError }, { data: rawBuzzerEvents, error: buzzerError }, { data: rawStarUses, error: starError }] =
    await Promise.all([
      currentQuestionId
        ? olympia
            .from("round_questions")
            .select(questionSelect)
            .eq("id", currentQuestionId)
            .eq("match_rounds.match_id", session.match_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      currentQuestionId
        ? olympia
            .from("buzzer_events")
            .select("id, match_id, round_question_id, player_id, event_type, result, occurred_at")
            .eq("match_id", session.match_id)
            .eq("round_question_id", currentQuestionId)
            .order("occurred_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      olympia
        .from("star_uses")
        .select("id, match_id, round_question_id, player_id, outcome, declared_at")
        .eq("match_id", session.match_id),
    ]);

  if (questionError || buzzerError || starError) throw new Error("Không thể tải dữ liệu câu hỏi Olympia.");

  const questionVisible = session.question_state !== "hidden";
  const roundQuestions = rawQuestion
    ? [redactQuestion(rawQuestion as GuestQuestionRow, questionVisible)]
    : [];
  const published =
    session.show_answers_overlay === true ||
    session.question_state === "answer_revealed" ||
    session.question_state === "completed";

  let answers: AnswerRow[] = [];
  if (published && currentQuestionId) {
    const { data: rawAnswers, error: answersError } = await olympia
      .from("answers")
      .select(
        "id, match_id, match_round_id, round_question_id, player_id, answer_text, is_correct, points_awarded, response_time_ms, submitted_at"
      )
      .eq("match_id", session.match_id)
      .eq("round_question_id", currentQuestionId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    if (answersError) throw new Error("Không thể tải đáp án đã công bố.");
    answers = (rawAnswers ?? []) as AnswerRow[];
  }

  return {
    session,
    match,
    players,
    scores: (rawScores ?? []) as ScoreRow[],
    roundQuestions,
    buzzerEvents: (rawBuzzerEvents ?? []) as BuzzerEventRow[],
    answers,
    starUses: (rawStarUses ?? []) as StarUseRow[],
    obstacle: null,
    obstacleTiles: [],
    obstacleGuesses: [],
    serverTimestamp: new Date().toISOString(),
    viewerUserId: null,
  };
}
