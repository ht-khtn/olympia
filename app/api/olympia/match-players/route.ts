import { resolveDisplayNamesForUserIds } from "@/lib/olympia-display-names";
import { getServerAuthContext } from "@/lib/server-auth";
import { ensureOlympiaAdminAccess } from "@/lib/olympia-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const playerAssignmentSchema = z.object({
  participantId: z.string().uuid("Thí sinh không hợp lệ"),
  seatIndex: z.coerce.number().int().min(1).max(4),
});

const bodySchema = z.object({
  matchId: z.string().min(1, "Thiếu matchId"),
  players: z.array(playerAssignmentSchema).min(1, "Cần thêm ít nhất một thí sinh").max(4),
}).or(z.object({
  matchId: z.string().min(1, "Thiếu matchId"),
  participantId: z.string().uuid("Thí sinh không hợp lệ"),
  seatIndex: z.coerce.number().int().min(1).max(4),
}).transform(({ matchId, participantId, seatIndex }) => ({
  matchId,
  players: [{ participantId, seatIndex }],
})));

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveMatchId(supabaseClient: SupabaseClient, raw: string): Promise<string | null> {
  // raw có thể là match UUID, live_sessions.id hoặc join_code.
  const olympia = supabaseClient.schema("olympia");
  if (isUuid(raw)) {
    const { data: matchDirect, error: matchDirectError } = await olympia
      .from("matches")
      .select("id")
      .eq("id", raw)
      .maybeSingle();
    if (matchDirectError) throw matchDirectError;
    if (matchDirect?.id) return matchDirect.id;

    const { data: sessionByIdOrJoin, error: sessionByIdOrJoinError } = await olympia
      .from("live_sessions")
      .select("match_id")
      .or(`id.eq.${raw},join_code.eq.${raw}`)
      .maybeSingle();
    if (sessionByIdOrJoinError) throw sessionByIdOrJoinError;
    return (sessionByIdOrJoin as { match_id?: string | null } | null)?.match_id ?? null;
  }

  const { data: sessionByJoin, error: sessionByJoinError } = await olympia
    .from("live_sessions")
    .select("match_id")
    .eq("join_code", raw)
    .maybeSingle();
  if (sessionByJoinError) throw sessionByJoinError;
  return (sessionByJoin as { match_id?: string | null } | null)?.match_id ?? null;
}

export async function POST(request: NextRequest) {
  try {
    await ensureOlympiaAdminAccess();
    const { supabase } = await getServerAuthContext();
    const olympia = supabase.schema("olympia");

    const rawBody: unknown = await request.json();
    const parsedBody = bodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
        { status: 400 }
      );
    }

    const { matchId: matchIdRaw, players } = parsedBody.data;
    const matchId = await resolveMatchId(supabase, matchIdRaw);
    if (!matchId) {
      return NextResponse.json(
        { error: "Không tìm thấy trận (matchId/join_code không hợp lệ)" },
        { status: 404 }
      );
    }

    const participantIds = players.map((player) => player.participantId);
    const seatIndexes = players.map((player) => player.seatIndex);
    if (new Set(participantIds).size !== participantIds.length) {
      return NextResponse.json({ error: "Không được chọn trùng thí sinh" }, { status: 400 });
    }
    if (new Set(seatIndexes).size !== seatIndexes.length) {
      return NextResponse.json({ error: "Không được chọn trùng ghế" }, { status: 400 });
    }

    const { data: existingPlayers, error: existingPlayersError } = await olympia
      .from("match_players")
      .select("id")
      .eq("match_id", matchId)
      .in("seat_index", seatIndexes);
    if (existingPlayersError) throw existingPlayersError;
    if (existingPlayers && existingPlayers.length > 0) {
      return NextResponse.json({ error: "Một hoặc nhiều ghế đã có thí sinh" }, { status: 409 });
    }

    const { data: existingAssignments, error: existingAssignmentsError } = await olympia
      .from("match_players")
      .select("id")
      .eq("match_id", matchId)
      .in("participant_id", participantIds);
    if (existingAssignmentsError) throw existingAssignmentsError;
    if (existingAssignments && existingAssignments.length > 0) {
      return NextResponse.json({ error: "Một hoặc nhiều thí sinh đã được gán vào trận" }, { status: 409 });
    }

    const { data: participants, error: participantsError } = await olympia
      .from("participants")
      .select("user_id")
      .in("user_id", participantIds)
      .eq("is_active", true);
    if (participantsError) throw participantsError;
    if (!participants || participants.length !== participantIds.length) {
      return NextResponse.json({ error: "Một hoặc nhiều thí sinh không hợp lệ hoặc đã ngừng hoạt động" }, { status: 400 });
    }

    const nameMap = await resolveDisplayNamesForUserIds(supabase, participantIds);
    const rows = players.map((player) => ({
      match_id: matchId,
      participant_id: player.participantId,
      seat_index: player.seatIndex,
      display_name: nameMap.get(player.participantId) ?? null,
    }));
    const { data, error } = await olympia
      .from("match_players")
      .insert(rows)
      .select();

    if (error) {
      console.error("[POST /api/olympia/match-players]", error);
      return NextResponse.json(
        { error: error.message || "Không thể thêm thí sinh" },
        { status: 500 }
      );
    }

    return NextResponse.json({ players: data }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/olympia/match-players]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 }
    );
  }
}
