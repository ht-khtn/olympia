import { NextResponse, type NextRequest } from "next/server";
import { issueOlympiaGrant } from "@/lib/olympia/session-grants";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string; joinCode?: string };
    const sessionId = body.sessionId?.trim();
    const joinCode = body.joinCode?.trim().toUpperCase();
    if (!sessionId || !joinCode) {
      return NextResponse.json({ error: "Thiếu sessionId hoặc joinCode." }, { status: 400, headers: noStoreHeaders });
    }

    const { data: session, error } = await getOlympiaAdminClient()
      .schema("olympia")
      .from("live_sessions")
      .select("id, join_code")
      .eq("id", sessionId)
      .eq("join_code", joinCode)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Không thể xác thực phiên Olympia." }, { status: 500, headers: noStoreHeaders });
    if (!session) return NextResponse.json({ error: "Phiên Olympia không hợp lệ." }, { status: 403, headers: noStoreHeaders });

    await issueOlympiaGrant({ sessionId, scope: "guest" });
    return NextResponse.json({ authorized: true }, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể cấp quyền Guest.";
    return NextResponse.json({ error: message }, { status: 500, headers: noStoreHeaders });
  }
}
