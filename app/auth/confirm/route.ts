import { NextResponse } from "next/server";
import getSupabaseServer from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const loginUrl = new URL("/login", url.origin);

  if (!tokenHash || type !== "invite") {
    loginUrl.searchParams.set("error", "invite_invalid");
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "invite",
    });
    if (error) throw error;
    return NextResponse.redirect(new URL("/set-password", url.origin));
  } catch {
    loginUrl.searchParams.set("error", "invite_failed");
    return NextResponse.redirect(loginUrl);
  }
}
