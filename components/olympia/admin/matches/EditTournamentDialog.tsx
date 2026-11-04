'use client'

import { useActionState, useCallback, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Edit } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateTournamentAction, type ActionState } from '@/app/(olympia)/olympia/actions'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const initialState: ActionState = { error: null, success: null }

type EditTournamentDialogProps = {
  tournamentId: string
  currentName: string
  currentStatus?: string | null
  currentStartsAt?: string | null
  currentEndsAt?: string | null
}

export function EditTournamentDialog({
  tournamentId,
  currentName,
  currentStatus,
  currentStartsAt,
  currentEndsAt
}: EditTournamentDialogProps) {
  const [open, setOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const router = useRouter()
  const submitAction = useCallback(async (previousState: ActionState, formData: FormData) => {
    const result = await updateTournamentAction(previousState, formData)
    if (result.error) toast.error(result.error)
    if (result.success) {
      toast.success(result.success)
      setOpen(false)
      router.refresh()
    }
    return result
  }, [router])
  const [, formAction, pending] = useActionState(submitAction, initialState)

  const handleOpenChange = (value: boolean) => {
    setOpen(value)
    if (!value) {
      setNonce((v) => v + 1)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Chỉnh sửa">
          <Edit className="h-4 w-4" />
          <span className="sr-only">Chỉnh sửa</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa giải Olympia</DialogTitle>
          <DialogDescription>Cập nhật thông tin giải đấu.</DialogDescription>
        </DialogHeader>
        <form key={nonce} action={formAction} className="space-y-4">
          <input type="hidden" name="tournamentId" value={tournamentId} />

          <div className="space-y-2">
            <Label htmlFor="name">Tên giải</Label>
            <Input
              id="name"
              name="name"
              defaultValue={currentName}
              required
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startsAt">Ngày bắt đầu</Label>
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={currentStartsAt ? new Date(currentStartsAt).toISOString().slice(0, 16) : ''}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endsAt">Ngày kết thúc</Label>
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={currentEndsAt ? new Date(currentEndsAt).toISOString().slice(0, 16) : ''}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Trạng thái</Label>
            <select
              id="status"
              name="status"
              className="w-full rounded-md border px-3 py-2 text-sm"
              defaultValue={currentStatus ?? 'planned'}
              disabled={pending}
            >
              <option value="planned">Lên lịch</option>
              <option value="active">Đang diễn ra</option>
              <option value="archived">Đã lưu trữ</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Hủy
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Đang cập nhật…' : 'Cập nhật'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
