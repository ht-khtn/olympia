"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOlympiaAccountAction, type AccountActionState } from "@/actions/olympia/accounts.actions";
import { toast } from "sonner";

const initialState: AccountActionState = { error: null, success: null };

export function CreateAccountDialog() {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const handleDone = () => { setOpen(false); setNonce((value) => value + 1); };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setNonce((n) => n + 1); }}>
      <DialogTrigger asChild><Button size="sm">Thêm tài khoản</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm tài khoản Olympia</DialogTitle>
          <DialogDescription>Gửi lời mời tài khoản thí sinh hoặc admin qua email.</DialogDescription>
        </DialogHeader>
        <CreateAccountForm key={nonce} onDone={handleDone} />
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createOlympiaAccountAction, initialState);
  const lastMessage = useRef<string | null>(null);

  useEffect(() => {
    const message = state.error ?? state.success;
    if (!message || lastMessage.current === message) return;
    lastMessage.current = message;
    if (state.error) { toast.error(message); return; }
    toast.success(message);
    router.refresh();
    onDone();
  }, [onDone, router, state.error, state.success]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor="displayName">Tên hiển thị</Label><Input id="displayName" name="displayName" required disabled={pending} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isParticipant" value="true" defaultChecked disabled={pending} /> Thí sinh</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAdmin" value="true" disabled={pending} /> Admin</label>
      <div className="space-y-2"><Label htmlFor="contestantCode">Mã thí sinh</Label><Input id="contestantCode" name="contestantCode" placeholder="VD: THI001" disabled={pending} /><p className="text-xs text-muted-foreground">Bắt buộc khi chọn Thí sinh.</p></div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone} disabled={pending}>Hủy</Button><Button type="submit" disabled={pending}>{pending ? "Đang gửi…" : "Gửi lời mời"}</Button></div>
    </form>
  );
}
