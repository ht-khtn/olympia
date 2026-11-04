import { NextResponse } from "next/server";
import { z } from "zod";

import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";
import { issueOlympiaGrant } from "@/lib/olympia/session-grants";
import { getServerAuthContext } from "@/lib/server-auth";

const schema = z.object({
  joinCode: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const { authUid, appUserId } = await getServerAuthContext();
    if (!authUid) {
      return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập để tham gia phòng." }, { status: 401 });
    }
    if (!appUserId) {
      return NextResponse.json({ ok: false, error: "Tài khoản chưa có hồ sơ thí sinh hợp lệ." }, { status: 403 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Mã phòng không hợp lệ." }, { status: 400 });
    }

    const joinCode = parsed.data.joinCode.trim().toUpperCase();
    if (!joinCode) {
      return NextResponse.json({ ok: false, error: "Mã phòng không hợp lệ." }, { status: 400 });
    }

    const olympia = getOlympiaAdminClient().schema("olympia");
    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, match_id, status")
      .eq("join_code", joinCode)
      .maybeSingle();

    if (sessionError) {
      return NextResponse.json({ ok: false, error: sessionError.message }, { status: 500 });
    }
    if (!session) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy phòng với mã này." }, { status: 404 });
    }
    if (session.status === "ended") {
      return NextResponse.json({ ok: false, error: "Phòng thi đã kết thúc." }, { status: 403 });
    }
    if (!session.match_id) {
      return NextResponse.json({ ok: false, error: "Phòng chưa liên kết với trận thi." }, { status: 403 });
    }

    const { data: membership, error: membershipError } = await olympia
      .from("match_players")
      .select("id")
      .eq("match_id", session.match_id)
      .eq("participant_id", appUserId)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json({ ok: false, error: membershipError.message }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json({ ok: false, error: "Tài khoản không thuộc phòng thi này." }, { status: 403 });
    }

    await issueOlympiaGrant({ sessionId: session.id, scope: "player", userId: appUserId });
    return NextResponse.json({ ok: true, message: "Đã xác thực quyền thí sinh." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không thể xác thực quyền thí sinh." },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";
