import { redirect } from "next/navigation";
import getSupabaseServer from "@/lib/supabase-server";
import SetPasswordForm from "@/components/auth/SetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Thiết lập mật khẩu — Olympia",
};

export default async function SetPasswordPage() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=auth_required");

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <SetPasswordForm />
    </main>
  );
}
