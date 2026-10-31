/*
 * Game session hook responsible for syncing live session state.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import getSupabase from "@/lib/supabase";
import type {
  AnswerRow,
  BuzzerEventRow,
  GameSessionPayload,
  RoundQuestionRow,
  ScoreRow,
  StarUseRow,
} from "@/types/olympia/game";
import {
  createInitialGuardState,
  handleRealtimeEvent,
  IGuardState,
  IRealtimeEvent,
} from "@/lib/olympia/realtime-guard";

type UseOlympiaGameStateArgs = {
  sessionId: string;
  initialData: GameSessionPayload;
  viewerMode: "player" | "mc" | "guest";
};

type TimerSnapshot = {
  deadline: string | null;
  remainingMs: number | null;
  isExpired: boolean;
};

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

type BuzzerEvent = BuzzerEventRow & {
  payload?: Record<string, JsonValue> | null;
};

type RealtimeEventPayload = Record<string, JsonValue>;

type RealtimeEventRow = {
  id: string;
  match_id: string;
  session_id: string | null;
  entity: string;
  entity_id: string | null;
  event_type: string;
  payload: RealtimeEventPayload;
  created_at: string;
};

function payloadString(payload: RealtimeEventPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function payloadNumber(payload: RealtimeEventPayload, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadBoolean(payload: RealtimeEventPayload, key: string): boolean | null {
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
}

function payloadObject(
  payload: RealtimeEventPayload,
  key: string
): { [k: string]: JsonValue } | null {
  const value = payload[key];
  if (!value) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  return value as { [k: string]: JsonValue };
}
type VcnvRevealMap = Record<string, boolean>;
type VcnvLockMap = Record<string, boolean>;

const OLYMPIA_CLIENT_TRACE = process.env.NEXT_PUBLIC_OLYMPIA_TRACE === "1";

type OlympiaClientTraceFields = Record<string, string | number | boolean | null>;

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function estimateJsonPayloadBytes<T extends object>(value: T | null): number {
  if (!value) return 0;
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function getReceiveLagMs(commitTimestamp: string | null | undefined): number | null {
  if (!commitTimestamp) return null;
  const commitMs = Date.parse(commitTimestamp);
  if (!Number.isFinite(commitMs)) return null;
  const lag = Date.now() - commitMs;
  return lag >= 0 ? lag : 0;
}

function traceClientReceive(params: { event: string; fields: OlympiaClientTraceFields }): void {
  if (!OLYMPIA_CLIENT_TRACE) return;
  const payload = {
    layer: "client-receive",
    action: "postgres_changes",
    event: params.event,
    ts: new Date().toISOString(),
    payloadBytes: typeof params.fields.payloadBytes === "number" ? params.fields.payloadBytes : 0,
    ...params.fields,
  };
  console.info("[Olympia][Trace]", JSON.stringify(payload));
}

const computeRemaining = (deadline: string | null): TimerSnapshot => {
  if (!deadline) return { deadline: null, remainingMs: null, isExpired: false };
  const target = new Date(deadline).getTime();
  const now = Date.now();
  const remaining = target - now;
  return {
    deadline,
    remainingMs: remaining > 0 ? remaining : 0,
    isExpired: remaining <= 0,
  };
};

export function useOlympiaGameState({ sessionId, initialData, viewerMode }: UseOlympiaGameStateArgs) {
  const [session, setSession] = useState(initialData.session);
  const [scores, setScores] = useState(initialData.scores);
  const [roundQuestions, setRoundQuestions] = useState(initialData.roundQuestions);
  const [answers, setAnswers] = useState<AnswerRow[]>(initialData.answers ?? []);
  const [starUses, setStarUses] = useState<StarUseRow[]>(initialData.starUses ?? []);
  const [players] = useState(initialData.players);
  const [buzzerEvents, setBuzzerEvents] = useState<BuzzerEvent[]>(initialData.buzzerEvents ?? []);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isRealtimeReady, setRealtimeReady] = useState(false);
  const [timer, setTimer] = useState<TimerSnapshot>(() =>
    computeRemaining(initialData.session.timer_deadline)
  );
  const [vcnvRevealByRoundQuestionId, setVcnvRevealByRoundQuestionId] = useState<VcnvRevealMap>({});
  const [vcnvLockedWrongByRoundQuestionId, setVcnvLockedWrongByRoundQuestionId] =
    useState<VcnvLockMap>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabaseRef = useRef<Awaited<ReturnType<typeof getSupabase>> | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const realtimeReadyRef = useRef(false);
  const snapshotInFlightRef = useRef(false);
  const sessionRef = useRef(initialData.session);
  const vcnvTrackedRqIdsRef = useRef<string[]>([]);
  const guardStateRef = useRef<IGuardState>(createInitialGuardState());

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const questionState = session.question_state ?? "hidden";
  const roundType = session.current_round_type ?? "unknown";
  const matchId = initialData.match.id;

  const resolveRoundQuestionCode = useCallback((rq: RoundQuestionRow | null) => {
    if (!rq) return null;
    const meta = rq.meta;
    if (meta && typeof meta === "object") {
      const rec = meta as Record<string, string | number | boolean | null>;
      const raw = rec.code;
      const trimmed = typeof raw === "string" ? raw.trim().toUpperCase() : "";
      if (trimmed) return trimmed;
    }
    return null;
  }, []);

  const computeVcnvRowQuestionIds = useCallback((): string[] => {
    if (roundType !== "vcnv") return [];
    const currentRoundId = sessionRef.current.current_round_id;
    if (!currentRoundId) return [];

    // VCNV: 4 hàng + ô trung tâm (OTT). Mã có thể là OTT hoặc VCNV-OTT tuỳ dữ liệu.
    const wanted = new Set(["VCNV-1", "VCNV-2", "VCNV-3", "VCNV-4", "OTT", "VCNV-OTT"]);
    const rows = (roundQuestions ?? [])
      .filter((rq) => rq.match_round_id === currentRoundId)
      .map((rq) => ({ id: rq.id, code: resolveRoundQuestionCode(rq) }))
      .filter((item): item is { id: string; code: string } => Boolean(item.id && item.code));

    const byCode = new Map<string, string>();
    for (const row of rows) {
      if (wanted.has(row.code) && !byCode.has(row.code)) byCode.set(row.code, row.id);
    }

    return ["VCNV-1", "VCNV-2", "VCNV-3", "VCNV-4", "OTT", "VCNV-OTT"]
      .map((code) => byCode.get(code) ?? null)
      .filter((id): id is string => Boolean(id));
  }, [resolveRoundQuestionCode, roundQuestions, roundType]);

  const fetchVcnvRevealSnapshot = useCallback(
    async (rqIds: string[]) => {
      const canReadAnswer =
        viewerMode === "mc" ||
        (viewerMode === "player" &&
          ["answer_revealed", "completed"].includes(
            sessionRef.current.question_state ?? ""
          ));
      if (!canReadAnswer) {
        setVcnvRevealByRoundQuestionId({});
        setVcnvLockedWrongByRoundQuestionId({});
        return;
      }
      if (rqIds.length === 0) {
        setVcnvRevealByRoundQuestionId({});
        setVcnvLockedWrongByRoundQuestionId({});
        return;
      }
      try {
        // Nếu có câu code = CNV và đã có đáp án đúng, coi như "lật toàn bộ" cho tất cả hàng.
        const currentRoundId = sessionRef.current.current_round_id;
        const cnvRqId =
          roundType === "vcnv" && currentRoundId
            ? ((roundQuestions ?? [])
                .filter((rq) => rq.match_round_id === currentRoundId)
                .map((rq) => ({ id: rq.id, code: resolveRoundQuestionCode(rq) }))
                .find((item) => item.code === "CNV")?.id ?? null)
            : null;

        const idsToQuery = cnvRqId ? Array.from(new Set([...rqIds, cnvRqId])) : rqIds;

        const answerResults = await Promise.all(
          idsToQuery.map(async (roundQuestionId) => {
            const url = new URL("/api/olympia/public/answers", window.location.origin);
            url.searchParams.set("sessionId", sessionId);
            url.searchParams.set("roundQuestionId", roundQuestionId);
            const response = await fetch(url.toString(), { cache: "no-store" });
            if (!response.ok) return [];
            const result = (await response.json()) as {
              answers?: Array<{
                round_question_id: string;
                player_id: string;
                is_correct?: boolean | null;
              }>;
            };
            return result.answers ?? [];
          })
        );
        const data = answerResults.flat();

        const next: VcnvRevealMap = {};
        const nextLocked: VcnvLockMap = {};
        for (const id of rqIds) {
          next[id] = false;
          nextLocked[id] = false;
        }

        const decidedByRqId = new Map<string, Map<string, boolean>>();
        for (const row of (data as Array<{
          round_question_id: string;
          player_id: string;
          is_correct?: boolean | null;
        }> | null) ?? []) {
          const rqId = row.round_question_id;
          const playerId = row.player_id;
          if (!rqId || !playerId) continue;
          if (row.is_correct === null || row.is_correct === undefined) continue;

          const map = decidedByRqId.get(rqId) ?? new Map<string, boolean>();
          map.set(playerId, row.is_correct === true);
          decidedByRqId.set(rqId, map);
        }

        const anyCnvCorrect =
          Boolean(cnvRqId) &&
          Array.from(decidedByRqId.get(cnvRqId as string)?.values() ?? []).some((v) => v === true);

        // Nếu CNV đã đúng, lật tất cả hàng VCNV (re-use cơ chế lật từng hàng, nhưng thêm guard này).
        if (anyCnvCorrect) {
          for (const rqId of rqIds) {
            next[rqId] = true;
            nextLocked[rqId] = false;
          }
          setVcnvRevealByRoundQuestionId(next);
          setVcnvLockedWrongByRoundQuestionId(nextLocked);
          return;
        }

        // Tính số thí sinh chưa bị khóa (không bị disqualified_obstacle)
        const activePlayersCount = players.filter((p) => !p.is_disqualified_obstacle).length;

        for (const rqId of rqIds) {
          const decided = decidedByRqId.get(rqId);
          if (!decided) continue;

          const anyCorrect = Array.from(decided.values()).some((v) => v === true);
          if (anyCorrect) {
            next[rqId] = true;
            continue;
          }

          // Kiểm tra xem tất cả thí sinh chưa bị khóa đã trả lời sai chưa
          const allActiveDecided = activePlayersCount > 0 && decided.size >= activePlayersCount;
          if (allActiveDecided) {
            nextLocked[rqId] = true;
          }
        }

        setVcnvRevealByRoundQuestionId(next);
        setVcnvLockedWrongByRoundQuestionId(nextLocked);
      } catch (err) {
        console.warn("[Olympia] fetch VCNV reveal snapshot failed", err);
      }
    },
    [matchId, players, resolveRoundQuestionCode, roundQuestions, roundType, viewerMode]
  );

  // Khi router.refresh() hoặc server re-render truyền xuống initialData mới,
  // hook phải đồng bộ lại state. Nếu không, UI sẽ chỉ cập nhật khi F5 (reload).
  useEffect(() => {
    queueMicrotask(() => {
      setSession(initialData.session);
      setScores(initialData.scores ?? []);
      setRoundQuestions(initialData.roundQuestions ?? []);
      setAnswers((initialData.answers ?? []) as AnswerRow[]);
      setStarUses((initialData.starUses ?? []) as StarUseRow[]);
      setBuzzerEvents((initialData.buzzerEvents ?? []) as BuzzerEvent[]);
      setTimer(computeRemaining(initialData.session.timer_deadline));
    });
  }, [initialData]);

  useEffect(() => {
    const nextIds = computeVcnvRowQuestionIds();
    vcnvTrackedRqIdsRef.current = nextIds;
    void fetchVcnvRevealSnapshot(nextIds);
  }, [computeVcnvRowQuestionIds, fetchVcnvRevealSnapshot]);

  // Fetch VCNV reveal state khi vào vòng VCNV (ngay cả lúc thoát ra rồi vào lại)
  useEffect(() => {
    if (roundType !== "vcnv") return;
    if (!session.current_round_id) return;

    const fetchVcnvOnRoundChange = async () => {
      const supabase = supabaseRef.current;
      if (!supabase) return;

      try {
        const olympia = supabase.schema("olympia");

        // Lấy tất cả round_questions của vòng VCNV này
        const { data: rqRows, error: rqError } = await olympia
          .from("round_questions")
          .select("id, meta")
          .eq("match_round_id", session.current_round_id);

        if (rqError) {
          console.warn("[Olympia] fetch VCNV questions on round change failed", rqError.message);
          return;
        }

        // Lọc ra các ô VCNV (VCNV-1 đến VCNV-4, OTT/VCNV-OTT)
        const wanted = new Set(["VCNV-1", "VCNV-2", "VCNV-3", "VCNV-4", "OTT", "VCNV-OTT"]);
        const rqIds: string[] = [];

        for (const rq of (rqRows as Array<{
          id: string;
          meta?: Record<string, string | number | boolean | null> | null;
        }> | null) ?? []) {
          let code: string | null = null;

          // Ưu tiên meta.code
          if (rq.meta && typeof rq.meta === "object") {
            const raw = (rq.meta as Record<string, string | number | boolean | null>).code;
            code = typeof raw === "string" ? raw.trim().toUpperCase() : null;
          }

          if (code && wanted.has(code)) {
            rqIds.push(rq.id);
          }
        }

        if (rqIds.length > 0) {
          vcnvTrackedRqIdsRef.current = rqIds;
          await fetchVcnvRevealSnapshot(rqIds);
        }
      } catch (err) {
        console.warn("[Olympia] fetch VCNV on round change failed", err);
      }
    };

    void fetchVcnvOnRoundChange();
  }, [roundType, session.current_round_id, fetchVcnvRevealSnapshot]);

  const fetchAnswersForQuestion = useCallback(async (roundQuestionId: string) => {
    try {
      const canReadAnswers =
        viewerMode === "mc" ||
        (viewerMode === "player" &&
          ["answer_revealed", "completed"].includes(sessionRef.current.question_state ?? ""));
      if (!canReadAnswers) {
        setAnswers([]);
        return;
      }
      const url = new URL(
        viewerMode === "mc" ? "/api/olympia/host/snapshot" : "/api/olympia/public/answers",
        window.location.origin
      );
      if (viewerMode === "mc") {
        url.searchParams.set("matchId", matchId);
      }
      url.searchParams.set("sessionId", sessionId);
      if (viewerMode !== "mc") {
        url.searchParams.set("roundQuestionId", roundQuestionId);
      }
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) return;
      const result = (await response.json()) as { answers?: AnswerRow[] };
      setAnswers(result.answers ?? []);
    } catch (err) {
      console.warn("[Olympia] fetch answers failed", err);
    }
  }, [matchId, sessionId, viewerMode]);

  const refreshCurrentRoundQuestion = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const currentRqId = sessionRef.current.current_round_question_id;
    if (!currentRqId) return;
    if (typeof document !== "undefined" && document.hidden) return;

    try {
      const olympia = supabase.schema("olympia");
      const questionSelect =
        "id, match_round_id, question_set_item_id, order_index, target_player_id, meta, question_text, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count";
      const { data: rawRqRow, error } = await olympia
        .from("round_questions")
        .select(questionSelect)
        .eq("id", currentRqId)
        .maybeSingle();
      const rqRow = rawRqRow as unknown as RoundQuestionRow | null;

      if (error || !rqRow) return;

      setRoundQuestions((prev) => {
        const next = [...prev];
        const idx = next.findIndex((row) => row.id === rqRow.id);
        const normalized: RoundQuestionRow = {
          ...rqRow,
          answer_text: rqRow.answer_text ?? (idx >= 0 ? next[idx]?.answer_text ?? null : null),
        };
        if (idx === -1) next.push(normalized);
        else next[idx] = { ...next[idx], ...normalized };
        return next;
      });
    } catch {
      // im lặng: polling nhẹ, không cần spam log
    }
  }, [viewerMode]);

  const fetchSnapshotOnce = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (snapshotInFlightRef.current) return;
    snapshotInFlightRef.current = true;

    try {
      const olympia = supabase.schema("olympia");

      const { data: nextSession, error: sessionError } = await olympia
        .from("live_sessions")
        .select(
          "id, match_id, status, join_code, question_state, current_round_id, current_round_type, current_round_question_id, timer_deadline, requires_player_password, buzzer_enabled, show_scoreboard_overlay, show_answers_overlay, guest_media_control"
        )
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError) {
        setStatusMessage("Không thể đồng bộ realtime · đang thử lại…");
        return;
      }

      if (nextSession) {
        setSession((prev) => ({ ...prev, ...(nextSession as typeof prev) }));
      }

      const { data: nextScores, error: scoresError } = await olympia
        .from("match_scores")
        .select("id, match_id, player_id, round_type, points")
        .eq("match_id", matchId);
      if (!scoresError && nextScores) {
        setScores(nextScores as ScoreRow[]);
      }

      const currentRqId = (nextSession?.current_round_question_id ??
        sessionRef.current.current_round_question_id) as string | null | undefined;

      // Fetch toàn bộ round_questions để cập nhật target_player_id (khi host chọn thí sinh)
      const { data: allRoundQuestions, error: allRqError } = await olympia
        .from("round_questions")
        .select(
          "id, match_round_id, target_player_id, meta, order_index, question_set_item_id, question_text, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count"
        );
      if (!allRqError && allRoundQuestions) {
        setRoundQuestions((prev) => {
          const incoming = allRoundQuestions as unknown as RoundQuestionRow[];
          if (!Array.isArray(prev) || prev.length === 0) return incoming;
          const byId = new Map(prev.map((r) => [r.id, r]));
          for (const row of incoming) {
            const existing = byId.get(row.id);
            byId.set(row.id, existing ? { ...existing, ...row } : row);
          }
          return Array.from(byId.values());
        });
      }

      if (currentRqId) {
        const canReadAnswer =
          viewerMode === "mc" ||
          (viewerMode === "player" &&
            ["answer_revealed", "completed"].includes(
              sessionRef.current.question_state ?? ""
            ));
        const questionSelect = canReadAnswer
          ? "id, match_round_id, question_set_item_id, order_index, target_player_id, meta, question_text, answer_text, note, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count"
          : "id, match_round_id, question_set_item_id, order_index, target_player_id, meta, question_text, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count";
        const [{ data: rawRqRow }, { data: buzzerRows }] = await Promise.all([
          olympia
            .from("round_questions")
            .select(questionSelect)
            .eq("id", currentRqId)
            .maybeSingle(),
          olympia
            .from("buzzer_events")
            .select("id, match_id, round_question_id, player_id, event_type, result, occurred_at")
            .eq("round_question_id", currentRqId)
            .order("occurred_at", { ascending: false })
            .limit(20),
        ]);
        const rqRow = rawRqRow as unknown as RoundQuestionRow | null;

        if (rqRow) {
          setRoundQuestions((prev) => {
            const next = [...prev];
            const idx = next.findIndex((row) => row.id === rqRow.id);
            const normalized = rqRow as RoundQuestionRow;
            if (idx === -1) next.push(normalized);
            else next[idx] = { ...next[idx], ...normalized };
            return next;
          });
        }

        if (buzzerRows) {
          setBuzzerEvents((buzzerRows as BuzzerEvent[]).slice(0, 20));
        }

        void fetchAnswersForQuestion(currentRqId);
      }

      // Star uses chủ yếu dùng cho vòng về đích.
      const { data: nextStarUses } = await olympia
        .from("star_uses")
        .select("id, match_id, round_question_id, player_id, outcome, declared_at")
        .eq("match_id", matchId);
      if (nextStarUses) {
        setStarUses(nextStarUses as StarUseRow[]);
      }

      setStatusMessage(null);
    } catch (err) {
      console.warn("[Olympia] poll snapshot failed", err);
      setStatusMessage("Không thể đồng bộ realtime · đang thử lại…");
    } finally {
      snapshotInFlightRef.current = false;
    }
  }, [fetchAnswersForQuestion, matchId, sessionId]);

  const refreshFromServer = useCallback(() => {
    setStatusMessage("Đang đồng bộ dữ liệu mới…");
    void fetchSnapshotOnce();
  }, [fetchSnapshotOnce]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setTimer(computeRemaining(session.timer_deadline));
    };
    const rafId = window.requestAnimationFrame(update);
    const intervalId = window.setInterval(update, 500);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearInterval(intervalId);
    };
  }, [session.timer_deadline]);

  useEffect(() => {
    let mounted = true;

    const clearRetryTimer = () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const subscribe = async () => {
      try {
        const supabase = await getSupabase();
        if (!mounted) return;
        supabaseRef.current = supabase;

        clearRetryTimer();
        // Đảm bảo không giữ channel cũ khi subscribe lại.
        if (channelRef.current) {
          try {
            supabase.removeChannel(channelRef.current);
          } catch {
            channelRef.current.unsubscribe();
          }
          channelRef.current = null;
        }

        const channel = supabase.channel(`olympia-game-${sessionId}`).on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "olympia",
            table: "realtime_events",
            filter: `match_id=eq.${matchId}`,
          },
          (payload: RealtimePostgresChangesPayload<RealtimeEventRow>) => {
            const commitTs = payload.commit_timestamp ?? null;
            const receiveLagMs = getReceiveLagMs(commitTs);
            const evt = (payload.new as RealtimeEventRow | null) ?? null;
            traceClientReceive({
              event: `receive:realtime_events:${evt?.entity ?? "unknown"}`,
              fields: {
                sessionId,
                matchId,
                eventType: evt?.event_type ?? null,
                commitTs,
                receiveLagMs,
                payloadBytes: estimateJsonPayloadBytes(evt?.payload ?? null),
              },
            });

            if (!evt) return;

            // --- REALTIME GUARD ---
            const occurredAt = commitTs
              ? new Date(commitTs).getTime()
              : evt.created_at
                ? Date.parse(evt.created_at)
                : Date.now();

            const genericEvent: IRealtimeEvent = {
              id: evt.id,
              intent: "MUTATION",
              target_entity_id: evt.match_id,
              occurred_at: occurredAt,
              payload: evt as unknown as Record<string, unknown>,
            };

            // Ensure scope
            guardStateRef.current.activeEntityId = matchId;

            handleRealtimeEvent(genericEvent, guardStateRef.current, (data) => {
              const evt = data as RealtimeEventRow;
              // Logic below is unchanged, just wrapped
              // evt.match_id check is redundant due to guard but harmless

              if (evt.match_id !== matchId) return;

              if (evt.entity === "live_sessions") {
                if (evt.session_id && evt.session_id !== sessionId) return;

                // Some realtime payloads may use camelCase keys while others use snake_case
                // (depending on how the DB/bridge serializes JSON). Support both.
                const guestMediaControlObj =
                  payloadObject(evt.payload, "guestMediaControl") ??
                  payloadObject(evt.payload, "guest_media_control");
                const guestMediaControl = guestMediaControlObj
                  ? (guestMediaControlObj as GameSessionPayload["session"]["guest_media_control"])
                  : undefined;

                if (guestMediaControl) {
                  try {
                    console.info(
                      "[Olympia][Realtime] guest_media_control payload",
                      guestMediaControl
                    );
                  } catch {
                    /* ignore */
                  }
                }

                setSession((prev) => ({
                  ...prev,
                  status: payloadString(evt.payload, "status") ?? prev.status,
                  join_code: payloadString(evt.payload, "joinCode") ?? prev.join_code,
                  question_state: payloadString(evt.payload, "questionState"),
                  current_round_id: payloadString(evt.payload, "currentRoundId"),
                  current_round_type: payloadString(evt.payload, "currentRoundType"),
                  current_round_question_id: payloadString(evt.payload, "currentRoundQuestionId"),
                  timer_deadline: payloadString(evt.payload, "timerDeadline"),
                  buzzer_enabled:
                    payloadBoolean(evt.payload, "buzzerEnabled") ?? prev.buzzer_enabled,
                  show_scoreboard_overlay:
                    payloadBoolean(evt.payload, "showScoreboardOverlay") ??
                    prev.show_scoreboard_overlay,
                  show_answers_overlay:
                    payloadBoolean(evt.payload, "showAnswersOverlay") ?? prev.show_answers_overlay,
                  guest_media_control: guestMediaControl ?? prev.guest_media_control,
                }));
                return;
              }

              if (evt.entity === "match_scores") {
                const id = payloadString(evt.payload, "id");
                const playerId = payloadString(evt.payload, "playerId");
                const roundTypeValue = payloadString(evt.payload, "roundType");
                const points = payloadNumber(evt.payload, "points");
                if (!id || !playerId) return;

                setScores((prev) => {
                  const next = [...prev];
                  const idx = next.findIndex((row) => (row.id ?? "") === id);
                  if (evt.event_type === "DELETE") {
                    if (idx === -1) return prev;
                    next.splice(idx, 1);
                    return next;
                  }

                  const nextScore: ScoreRow = {
                    id,
                    match_id: matchId,
                    player_id: playerId,
                    round_type: roundTypeValue,
                    points,
                  };
                  if (idx === -1) next.push(nextScore);
                  else next[idx] = { ...next[idx], ...nextScore };
                  return next;
                });
                return;
              }

              if (evt.entity === "star_uses") {
                const id = payloadString(evt.payload, "id");
                const playerId = payloadString(evt.payload, "playerId");
                const roundQuestionId = payloadString(evt.payload, "roundQuestionId");
                const declaredAt = payloadString(evt.payload, "declaredAt");
                if (!id || !playerId || !roundQuestionId) return;
                if (!declaredAt) return;

                const row: StarUseRow = {
                  id,
                  match_id: matchId,
                  player_id: playerId,
                  round_question_id: roundQuestionId,
                  outcome: payloadString(evt.payload, "outcome"),
                  declared_at: declaredAt,
                };

                setStarUses((prev) => {
                  const idx = prev.findIndex(
                    (s) =>
                      s.id === row.id ||
                      (s.round_question_id === row.round_question_id &&
                        s.player_id === row.player_id)
                  );
                  if (evt.event_type === "DELETE") {
                    if (idx === -1) return prev;
                    const next = [...prev];
                    next.splice(idx, 1);
                    return next;
                  }

                  if (idx === -1) return [row, ...prev];
                  const next = [...prev];
                  next[idx] = { ...next[idx], ...row };
                  return next;
                });
                return;
              }

              if (evt.entity === "buzzer_events") {
                const id = payloadString(evt.payload, "id");
                if (!id) return;
                const row: BuzzerEvent = {
                  id,
                  match_id: matchId,
                  round_question_id: payloadString(evt.payload, "roundQuestionId"),
                  player_id: payloadString(evt.payload, "playerId"),
                  event_type: payloadString(evt.payload, "eventType"),
                  result: payloadString(evt.payload, "result"),
                  occurred_at: payloadString(evt.payload, "occurredAt"),
                };

                setBuzzerEvents((prev) => {
                  const idx = prev.findIndex((e) => e.id === row.id);
                  if (evt.event_type === "DELETE") {
                    if (idx === -1) return prev;
                    const next = prev.slice();
                    next.splice(idx, 1);
                    return next;
                  }
                  if (idx === -1) return [row, ...prev].slice(0, 20);
                  const next = prev.slice();
                  next[idx] = { ...next[idx], ...row };
                  return next;
                });
                return;
              }

              if (evt.entity === "answers") {
                const canReadAnswers =
                  viewerMode === "mc" ||
                  (viewerMode === "player" &&
                    ["answer_revealed", "completed"].includes(
                      sessionRef.current.question_state ?? ""
                    ));
                if (!canReadAnswers) return;
                const id = payloadString(evt.payload, "id");
                const roundQuestionId = payloadString(evt.payload, "roundQuestionId");
                const playerId = payloadString(evt.payload, "playerId");
                const submittedAt = payloadString(evt.payload, "submittedAt");
                if (!id || !roundQuestionId || !playerId || !submittedAt) return;

                const row: AnswerRow = {
                  id,
                  match_id: matchId,
                  round_question_id: roundQuestionId,
                  player_id: playerId,
                  answer_text: null,
                  is_correct: null,
                  points_awarded: null,
                  submitted_at: submittedAt,
                  response_time_ms: payloadNumber(evt.payload, "responseTimeMs"),
                };

                const trackedVcnvIds = vcnvTrackedRqIdsRef.current;
                const isTrackedVcnv = trackedVcnvIds.includes(row.round_question_id);
                const currentRqId = sessionRef.current.current_round_question_id;
                const isCurrentQuestion = Boolean(
                  currentRqId && row.round_question_id === currentRqId
                );
                const isVcnvRound = sessionRef.current.current_round_type === "vcnv";

                // Ưu tiên: nếu là câu hiện tại, luôn update answers ngay (đã filter bằng isCurrentQuestion ở dưới)
                // Nếu là VCNV tracked, fetch snapshot để update VCNV reveal/lock state

                if (isTrackedVcnv || isVcnvRound) {
                  const rqIdsToCheck = isTrackedVcnv ? trackedVcnvIds : computeVcnvRowQuestionIds();
                  if (rqIdsToCheck.length > 0) {
                    void fetchVcnvRevealSnapshot(rqIdsToCheck);
                  }
                }

                if (isCurrentQuestion) {
                  void fetchAnswersForQuestion(roundQuestionId);
                }
              }
            });
          }
        );
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setRealtimeReady(true);
            realtimeReadyRef.current = true;
            setStatusMessage(null);
            retryCountRef.current = 0;
            void fetchSnapshotOnce();
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setRealtimeReady(false);
            realtimeReadyRef.current = false;

            const nextCount = Math.min(retryCountRef.current + 1, 6);
            retryCountRef.current = nextCount;
            const delayMs = Math.min(10000, 500 * Math.pow(2, nextCount));
            console.warn("[Olympia] realtime channel status", status, "retry in", delayMs, "ms");
            setStatusMessage("Mất kết nối realtime · đang thử lại…");

            clearRetryTimer();
            retryTimerRef.current = setTimeout(() => {
              if (!mounted) return;
              void subscribe();
            }, delayMs);
          }
        });

        channelRef.current = channel;
      } catch (error) {
        console.error("Olympia game realtime init failed", error);
        setStatusMessage("Không thể kết nối realtime");
      }
    };

    subscribe();

    return () => {
      mounted = false;
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (channelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
      } else if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
    };
  }, [sessionId, matchId, fetchSnapshotOnce, fetchVcnvRevealSnapshot, computeVcnvRowQuestionIds]);

  // Khi host chuyển câu, load lại danh sách đáp án hiện tại (không reload trang).
  useEffect(() => {
    const rqId = session.current_round_question_id;
    if (!rqId) {
      // Tránh setState đồng bộ trong effect (eslint react-hooks/set-state-in-effect)
      queueMicrotask(() => setAnswers([]));
      return;
    }
    // Tránh gọi hàm có setState trực tiếp trong body effect (eslint react-hooks/set-state-in-effect)
    queueMicrotask(() => {
      void fetchAnswersForQuestion(rqId);
    });
  }, [session.current_round_question_id, fetchAnswersForQuestion]);

  // Poll nhẹ để cập nhật target_player_id của câu hiện tại (khi host chọn thí sinh)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const intervalId = window.setInterval(() => {
      void refreshCurrentRoundQuestion();
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshCurrentRoundQuestion]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.hidden) return;
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
      cleanupTimerRef.current = setTimeout(() => {
        refreshFromServer();
      }, 120000);
    };
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
      }
    };
  }, [refreshFromServer]);

  const timerLabel = useMemo(() => {
    if (timer.remainingMs === null) return "Đang chờ host";
    const totalSeconds = Math.max(0, Math.floor(timer.remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, [timer.remainingMs]);

  return {
    match: initialData.match,
    session,
    players,
    scores,
    roundQuestions,
    buzzerEvents,
    answers,
    starUses,
    vcnvRevealByRoundQuestionId,
    vcnvLockedWrongByRoundQuestionId,
    timer,
    timerLabel,
    questionState,
    roundType,
    statusMessage,
    isRealtimeReady,
    viewerUserId: initialData.viewerUserId,
    refreshFromServer,
  };
}
