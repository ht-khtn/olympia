import { createClient } from "@supabase/supabase-js";
import getSupabaseServer from "@/lib/supabase-server";

type ChangePasswordBody = {
  currentPassword?: string;
  newPassword?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChangePasswordBody;
    const currentPassword = body.currentPassword?.trim();
    const newPassword = body.newPassword;

    if (!currentPassword || !newPassword) {
      return Response.json({ error: "Vui lòng điền đầy đủ thông tin" }, { status: 400 });
    }

    const supabase = await getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return Response.json({ error: "Không được xác thực" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase not configured on server");
    }

    const verificationClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await verificationClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      return Response.json({ error: "Mật khẩu hiện tại không chính xác" }, { status: 401 });
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi máy chủ";
    return Response.json({ error: message }, { status: 500 });
  }
}
