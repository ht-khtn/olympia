"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetOlympiaAccountPasswordAction, type AccountActionState } from "@/actions/olympia/accounts.actions";
import { toast } from "sonner";
import type { OlympiaAccount } from "./EditAccountDialog";

const initialState: AccountActionState = { error: null, success: null };

export function ResetPasswordDialog({ account }: { account: OlympiaAccount }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const close = () => { setOpen(false); setNonce((value) => value + 1); };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setNonce((value) => value + 1); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Đặt lại mật khẩu">
          <KeyRound className="h-4 w-4" /><span className="sr-only">Đặt lại mật khẩu</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Đặt lại mật khẩu</DialogTitle>
          <DialogDescription>Đặt mật khẩu mới cho {account.email}. Mật khẩu chỉ hiển thị một lần sau khi hoàn tất.</DialogDescription>
        </DialogHeader>
        <ResetPasswordForm key={nonce} account={account} onDone={close} />
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordForm({ account, onDone }: { account: OlympiaAccount; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(resetOlympiaAccountPasswordAction, initialState);
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState("");
  const lastMessage = useRef<string | null>(null);

  useEffect(() => {
    const message = state.error ?? state.success;
    if (!message || lastMessage.current === message) return;
    lastMessage.current = message;
    if (state.error) {
      toast.error(message);
      return;
    }
    toast.success(message);
    router.refresh();
  }, [router, state.error, state.success]);

  const generate = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    setPassword(Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 16));
    setVisible(true);
  };

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={account.userId} />
      <div className="space-y-2">
        <Label htmlFor={`reset-password-${account.userId}`}>Mật khẩu mới</Label>
        <div className="flex gap-2">
          <Input
            id={`reset-password-${account.userId}`}
            name="password"
            type={visible ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            maxLength={128}
            required
            disabled={pending || Boolean(state.credentials)}
          />
          <Button type="button" variant="outline" onClick={() => setVisible((value) => !value)} disabled={pending || Boolean(state.credentials)}>
            {visible ? "Ẩn" : "Hiện"}
          </Button>
          <Button type="button" variant="outline" onClick={generate} disabled={pending || Boolean(state.credentials)}>Sinh</Button>
        </div>
      </div>
      {state.credentials ? (
        <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium">Mật khẩu mới (chỉ hiển thị lần này)</p>
          <p className="break-all font-mono">{state.credentials.password}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(state.credentials?.password ?? "")}>Sao chép</Button>
          <p className="text-xs text-muted-foreground">Đóng cửa sổ sẽ xóa mật khẩu khỏi giao diện.</p>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Đóng</Button>
        {!state.credentials ? <Button type="submit" disabled={pending}>{pending ? "Đang cập nhật…" : "Đặt lại mật khẩu"}</Button> : null}
      </div>
    </form>
  );
}
