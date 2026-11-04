"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteOlympiaAccountAction, type AccountDeleteState } from "@/actions/olympia/accounts.actions";
import { toast } from "sonner";
import type { OlympiaAccount } from "./EditAccountDialog";

const initialState: AccountDeleteState = { error: null, success: null };

export function DeleteAccountDialog({ account, disabled }: { account: OlympiaAccount; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const close = () => { setOpen(false); setNonce((value) => value + 1); };

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setNonce((value) => value + 1); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Xóa tài khoản" disabled={disabled}>
          <Trash2 className="h-4 w-4 text-destructive" /><span className="sr-only">Xóa tài khoản</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Xóa tài khoản</DialogTitle>
          <DialogDescription>
            Tài khoản <strong>{account.displayName || account.email}</strong> ({account.email}) sẽ được kiểm tra dữ liệu liên quan.
            Tài khoản có lịch sử thi đấu sẽ được ngừng hoạt động thay vì xóa.
          </DialogDescription>
        </DialogHeader>
        <DeleteAccountForm key={nonce} account={account} onDone={close} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteAccountForm({ account, onDone }: { account: OlympiaAccount; onDone: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(deleteOlympiaAccountAction, initialState);
  const [confirmed, setConfirmed] = useState(false);
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
    onDone();
  }, [onDone, router, state.error, state.success]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={account.userId} />
      <input type="hidden" name="confirm" value={confirmed ? "true" : "false"} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} />
        <span>Tôi hiểu rằng tài khoản có thể bị xóa vĩnh viễn; dữ liệu lịch sử được bảo toàn và tài khoản có lịch sử sẽ chỉ bị ngừng hoạt động.</span>
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Hủy</Button>
        <Button type="submit" variant="destructive" disabled={pending || !confirmed}>{pending ? "Đang kiểm tra…" : "Xác nhận"}</Button>
      </div>
    </form>
  );
}
