import { NextResponse, type NextRequest } from "next/server";
import { getGuestSnapshot } from "@/lib/olympia/guest-snapshot";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";
import { hasOlympiaGrant } from "@/lib/olympia/session-grants";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu sessionId." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    if (!(await hasOlympiaGrant({ sessionId, scope: "guest" }))) {
      return NextResponse.json({ error: "Guest chưa được cấp quyền truy cập." }, { status: 401, headers: noStoreHeaders });
    }
    const payload = await getGuestSnapshot(getOlympiaAdminClient(), sessionId);
    if (!payload) return NextResponse.json({ error: "Không tìm thấy phiên Olympia." }, { status: 404, headers: noStoreHeaders });
    return NextResponse.json(payload, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tải snapshot Guest.";
    return NextResponse.json({ error: message }, { status: 500, headers: noStoreHeaders });
  }
}
