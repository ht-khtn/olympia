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
          <DialogDescription>
            Thí sinh dùng email Olympia sẽ được tạo trực tiếp; tài khoản khác vẫn nhận lời mời qua email.
          </DialogDescription>
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
    if (!state.credentials) onDone();
  }, [onDone, router, state.credentials, state.error, state.success]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="email">Email nội bộ</Label><Input id="email" name="email" type="email" required placeholder="ma-thi-sinh@olympia.nvh.edu.vn" disabled={pending} /><p className="text-xs text-muted-foreground">Email @olympia.nvh.edu.vn được tạo trực tiếp, không gửi thư xác nhận.</p></div>
      <div className="space-y-2"><Label htmlFor="displayName">Họ tên</Label><Input id="displayName" name="displayName" required disabled={pending} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isParticipant" value="true" defaultChecked disabled={pending} /> Thí sinh</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAdmin" value="true" disabled={pending} /> Admin</label>
      <div className="space-y-2"><Label htmlFor="contestantCode">Mã thí sinh</Label><Input id="contestantCode" name="contestantCode" placeholder="VD: THI001" disabled={pending} /><p className="text-xs text-muted-foreground">Bắt buộc khi chọn Thí sinh.</p></div>
      <PasswordField pending={pending} />
      {state.credentials ? <CredentialsResult credentials={state.credentials} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Đóng</Button>
        {!state.credentials ? <Button type="submit" disabled={pending}>{pending ? "Đang xử lý…" : "Tạo tài khoản"}</Button> : null}
      </div>
    </form>
  );
}

function PasswordField({ pending }: { pending: boolean }) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  const generate = () => {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    setValue(Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 16));
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="password">Mật khẩu ban đầu</Label>
      <div className="flex gap-2">
        <Input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          minLength={8}
          placeholder="Bắt buộc với thí sinh Olympia"
          disabled={pending}
        />
        <Button type="button" variant="outline" onClick={() => setVisible((current) => !current)} disabled={pending}>
          {visible ? "Ẩn" : "Hiện"}
        </Button>
        <Button type="button" variant="outline" onClick={generate} disabled={pending}>Sinh</Button>
      </div>
    </div>
  );
}

function CredentialsResult({
  credentials,
}: {
  credentials: { email: string; password: string };
}) {
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success("Đã sao chép.");
  };

  return (
    <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
      <p className="font-medium">Thông tin bàn giao (chỉ hiển thị lần này)</p>
      <div className="flex items-center justify-between gap-2"><span>Email: {credentials.email}</span><Button type="button" variant="outline" size="sm" onClick={() => copy(credentials.email)}>Sao chép</Button></div>
      <div className="flex items-center justify-between gap-2"><span>Mật khẩu: {credentials.password}</span><Button type="button" variant="outline" size="sm" onClick={() => copy(credentials.password)}>Sao chép</Button></div>
      <p className="text-xs text-muted-foreground">Đóng cửa sổ sẽ xóa thông tin này khỏi giao diện.</p>
    </div>
  );
}
