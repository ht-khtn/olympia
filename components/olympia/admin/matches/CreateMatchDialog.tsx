'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createMatchAction, type ActionState } from '@/app/(olympia)/olympia/actions'
import { toast } from 'sonner'

const initialState: ActionState = { error: null, success: null }

type TournamentOption = { id: string; name: string }

type Props = {
  tournaments: TournamentOption[]
}

export function CreateMatchDialog({ tournaments }: Props) {
  const [open, setOpen] = useState(false)
  const [nonce, setNonce] = useState(0)

  const handleOpenChange = (value: boolean) => {
    setOpen(value)
    if (!value) setNonce((n) => n + 1)
  }

  const handleDone = () => {
    setOpen(false)
    setNonce((n) => n + 1)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Tạo trận mới</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo trận Olympia</DialogTitle>
          <DialogDescription>
            Bắt đầu bằng thông tin trận. Sau khi lưu, bạn sẽ được đưa tới trang chuẩn bị để chọn bộ đề,
            gán 4 thí sinh, kiểm tra vòng và mở phòng.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
          {['Thông tin trận', 'Bộ câu hỏi', 'Thí sinh & ghế', 'Mở phòng'].map((step, index) => (
            <div key={step} className="space-y-1">
              <span className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                index === 0 ? 'bg-primary text-primary-foreground' : 'bg-white text-muted-foreground'
              }`}>
                {index + 1}
              </span>
              <p className={index === 0 ? 'font-medium text-slate-900' : 'text-muted-foreground'}>{step}</p>
            </div>
          ))}
        </div>
        <CreateMatchForm key={nonce} tournaments={tournaments} onDone={handleDone} />
      </DialogContent>
    </Dialog>
  )
}

function CreateMatchForm({ tournaments, onDone }: { tournaments: TournamentOption[]; onDone: () => void }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(createMatchAction, initialState)
  const lastToastRef = useRef<string | null>(null)

  useEffect(() => {
    const message = state.error ?? state.success
    if (!message) return
    if (lastToastRef.current === message) return
    lastToastRef.current = message

    if (state.error) {
      toast.error(message)
      return
    }

    toast.success(message)
    try {
      router.refresh()
    } catch {
      // ignore
    }
    onDone()
  }, [onDone, router, state.error, state.success])

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Tên trận</Label>
        <Input id="name" name="name" placeholder="VD: Tuần 05 - Bảng A" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tournamentId">Thuộc giải</Label>
        <select id="tournamentId" name="tournamentId" className="w-full rounded-md border px-3 py-2 text-sm">
          <option value="">-- Chưa gán --</option>
          {tournaments.map((tournament) => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="scheduledAt">Thời gian dự kiến</Label>
        <Input id="scheduledAt" name="scheduledAt" type="datetime-local" />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Hủy
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu trận'}
        </Button>
      </div>
    </form>
  )
}
