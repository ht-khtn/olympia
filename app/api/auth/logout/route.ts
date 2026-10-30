import { NextResponse } from "next/server";
import getSupabaseServer from "@/lib/supabase-server";

export async function POST() {
  try {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const runtime = "nodejs";
