"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOlympiaAccountAction, type AccountActionState } from "@/actions/olympia/accounts.actions";
import { toast } from "sonner";

export type OlympiaAccount = {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isParticipant: boolean;
  isParticipantActive: boolean;
  contestantCode: string | null;
  emailConfirmedAt: string | null;
  createdAt: string;
};

const initialState: AccountActionState = { error: null, success: null };

export function EditAccountDialog({ account }: { account: OlympiaAccount }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const close = () => { setOpen(false); setNonce((value) => value + 1); };
  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setNonce((n) => n + 1); }}>
      <DialogTrigger asChild><Button variant="ghost" size="sm" aria-label="Chỉnh sửa"><Edit className="h-4 w-4" /><span className="sr-only">Chỉnh sửa</span></Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Chỉnh sửa tài khoản Olympia</DialogTitle><DialogDescription>Email không thể thay đổi tại đây.</DialogDescription></DialogHeader>
        <EditAccountForm key={nonce} account={account} onDone={close} />
      </DialogContent>
    </Dialog>
  );
}

function EditAccountForm({ account, onDone }: { account: OlympiaAccount; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateOlympiaAccountAction, initialState);
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
      <input type="hidden" name="userId" value={account.userId} />
      <div className="space-y-2"><Label>Email</Label><p className="text-sm text-muted-foreground">{account.email}</p></div>
      <div className="space-y-2"><Label htmlFor="displayName">Tên hiển thị</Label><Input id="displayName" name="displayName" defaultValue={account.displayName} required disabled={pending} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAdmin" value="true" defaultChecked={account.isAdmin} disabled={pending} /> Admin</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isParticipant" value="true" defaultChecked={account.isParticipant} disabled={pending} /> Thí sinh</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isParticipantActive" value="true" defaultChecked={account.isParticipantActive} disabled={pending} /> Participant đang hoạt động</label>
      <div className="space-y-2"><Label htmlFor="contestantCode">Mã thí sinh</Label><Input id="contestantCode" name="contestantCode" defaultValue={account.contestantCode ?? ""} disabled={pending} /></div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone} disabled={pending}>Hủy</Button><Button type="submit" disabled={pending}>{pending ? "Đang cập nhật…" : "Cập nhật"}</Button></div>
    </form>
  );
}
