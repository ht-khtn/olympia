"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirmation) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }

    setPending(true);
    try {
      const supabase = await getSupabase();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setSuccess(true);
      setTimeout(() => router.replace("/olympia"), 500);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Không thể cập nhật mật khẩu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle>Thiết lập mật khẩu Olympia</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="password">Mật khẩu mới</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending || success} required /></div>
          <div className="space-y-2"><Label htmlFor="confirmation">Xác nhận mật khẩu</Label><Input id="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending || success} required /></div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {success ? <p role="status" className="text-sm text-green-700">Đã cập nhật mật khẩu. Đang chuyển đến Olympia…</p> : null}
          <Button type="submit" disabled={pending || success}>{pending ? "Đang lưu…" : "Lưu mật khẩu"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
