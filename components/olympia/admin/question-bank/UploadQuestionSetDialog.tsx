'use client'

import { useMemo, useState } from 'react'
import { Upload } from 'tus-js-client'
import { CheckCircle2, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import getSupabase from '@/lib/supabase'
import { cn } from '@/utils/cn'
import { toast } from 'sonner'
import { parseQuestionSetWorkbookAction, createQuestionSetFromWorkbookAction, type ParseQuestionSetResult } from '@/app/(olympia)/olympia/(admin)/admin/question-bank/actions'

const MAX_FILE_SIZE = 20 * 1024 * 1024
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'video/mp4', 'video/webm', 'video/quicktime'])
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'm4v'])

type Props = { onDone?: () => void }
type Progress = { name: string; value: number }

function validMedia(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSIONS.has(extension) && (file.type === '' || MIME_TYPES.has(file.type))
}

export function UploadQuestionSetDialog({ onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [xlsx, setXlsx] = useState<File | null>(null)
  const [preview, setPreview] = useState<ParseQuestionSetResult | null>(null)
  const [media, setMedia] = useState<File[]>([])
  const [progress, setProgress] = useState<Progress[]>([])
  const [busy, setBusy] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requiredNames = useMemo(() => new Set((preview?.mediaRequirements ?? []).map((entry) => entry.filename.toLowerCase())), [preview])

  function reset() {
    setName(''); setXlsx(null); setPreview(null); setMedia([]); setProgress([]); setError(null); setBusy(false); setParsing(false)
  }

  async function parseWorkbook(file: File) {
    setError(null); setXlsx(file); setPreview(null); setParsing(true)
    if (file.size > 5 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Chỉ chấp nhận workbook .xlsx không quá 5 MiB.'); setParsing(false); return
    }
    try {
      const data = new FormData(); data.set('file', file)
      setPreview(await parseQuestionSetWorkbookAction(data))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đọc workbook.')
    } finally {
      setParsing(false)
    }
  }

  async function uploadMedia(file: File, path: string, token: string, endpoint: string, anonKey: string, onProgress: (value: number) => void) {
    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint, chunkSize: 6 * 1024 * 1024, retryDelays: [0, 1000, 3000, 5000, 10000],
        headers: { authorization: `Bearer ${token}`, apikey: anonKey },
        metadata: { bucketName: 'olympia-assets', objectName: path, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
        onError: reject, onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)), onSuccess: () => resolve(),
      })
      upload.start()
    })
  }

  async function submit() {
    if (!preview || !xlsx || !name.trim()) { setError('Cần chọn workbook, xem preview và nhập tên bộ đề.'); return }
    const selected = new Map(media.map((file) => [file.name.toLowerCase(), file]))
    const missing = Array.from(requiredNames).filter((file) => !selected.has(file))
    const extra = media.filter((file) => !requiredNames.has(file.name.toLowerCase())).map((file) => file.name)
    if (missing.length) { setError(`Thiếu media: ${missing.join(', ')}`); return }
    if (extra.length) toast.warning(`File thừa sẽ không được upload: ${extra.join(', ')}`)
    const uploadFiles = Array.from(requiredNames).map((file) => selected.get(file)).filter((file): file is File => file !== undefined)
    const invalid = uploadFiles.find((file) => file.size > MAX_FILE_SIZE || !validMedia(file))
    if (invalid) { setError(`Media không hợp lệ hoặc vượt 20 MiB: ${invalid.name}`); return }
    setBusy(true); setError(null)
    const uploaded: string[] = []; const questionSetId = globalThis.crypto.randomUUID()
    try {
      const supabase = await getSupabase()
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!token || !anonKey || !supabaseUrl) throw new Error('Không có phiên đăng nhập hoặc cấu hình Supabase.')
      const endpoint = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`
      setProgress(uploadFiles.map((file) => ({ name: file.name, value: 0 })))
      for (const file of uploadFiles) {
        const path = `question-sets/${questionSetId}/${file.name}`
        await uploadMedia(file, path, token, endpoint, anonKey, (value) => setProgress((current) => current.map((entry) => entry.name === file.name ? { ...entry, value } : entry)))
        uploaded.push(path)
      }
      const formData = new FormData()
      formData.set('questionSetId', questionSetId); formData.set('name', name.trim()); formData.set('filename', xlsx.name)
      formData.set('items', JSON.stringify(preview.items)); formData.set('mediaPaths', JSON.stringify(uploaded))
      await createQuestionSetFromWorkbookAction(formData)
      toast.success('Đã import bộ đề thành công.'); setOpen(false); reset(); onDone?.()
    } catch (cause) {
      try {
        const supabase = await getSupabase()
        if (uploaded.length) await supabase.storage.from('olympia-assets').remove(uploaded)
      } catch (cleanupError) {
        console.error('Không thể cleanup media sau khi import thất bại:', cleanupError)
      }
      setError(cause instanceof Error ? cause.message : 'Import bộ đề thất bại.')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset() }}>
      <DialogTrigger asChild><Button size="sm">Tạo bộ đề (.xlsx)</Button></DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import bộ đề V4(1)</DialogTitle>
          <DialogDescription>Workbook được kiểm tra trước khi import. Quy tắc CODE, sheet và media vẫn do parser V4(1) hiện có xử lý.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2 rounded-lg border bg-slate-50 p-3 text-xs sm:grid-cols-3">
            <div className="flex gap-2"><FileSpreadsheet className="h-4 w-4 text-primary" /><span>Chọn .xlsx tối đa 5 MiB</span></div>
            <div className="flex gap-2"><UploadCloud className="h-4 w-4 text-primary" /><span>Bổ sung đúng media được tham chiếu</span></div>
            <div className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-primary" /><span>Xem kết quả trước khi lưu</span></div>
          </div>
          <div className="space-y-2"><Label htmlFor="question-set-name">Tên bộ đề</Label><Input id="question-set-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="question-workbook">Workbook .xlsx</Label><Input id="question-workbook" type="file" accept=".xlsx" disabled={busy || parsing} onChange={(event) => { const file = event.target.files?.[0]; if (file) void parseWorkbook(file) }} />{parsing ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm tra workbook…</p> : null}</div>
          {preview && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm"><p className="font-medium text-green-900">Workbook đã được kiểm tra</p><p className="mt-1">Hợp lệ: <b>{preview.items.length}</b> câu · Bỏ qua: <b>{preview.skipped.length}</b> · Media cần chọn: <b>{preview.mediaRequirements.length}</b></p><p className="text-muted-foreground">Sheet: {preview.items.map((item) => item.sheet).filter((sheet, index, list) => list.indexOf(sheet) === index).join(', ')}</p></div>}
          {preview && <div className="space-y-2"><Label htmlFor="question-media">Media (chọn nhiều file)</Label><Input id="question-media" type="file" multiple onChange={(event) => setMedia(Array.from(event.target.files ?? []))} /><p className="text-xs text-muted-foreground">Không cần ZIP hoặc thư mục con. Chỉ upload file được workbook tham chiếu.</p></div>}
          {progress.length > 0 && <div className="space-y-1 text-xs"><p className="flex items-center gap-1 font-medium"> {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-green-600" />} Tổng tiến độ: {Math.round(progress.reduce((sum, entry) => sum + entry.value, 0) / progress.length)}%</p>{progress.map((entry) => <div key={entry.name}><div className="flex justify-between"><span>{entry.name}</span><span>{entry.value}%</span></div><div className="h-1 rounded bg-muted"><div className="h-1 rounded bg-primary" style={{ width: `${entry.value}%` }} /></div></div>)}</div>}
          {error && <div role="alert" className={cn('rounded-md bg-destructive/10 p-2 text-sm', 'text-destructive')}>{error}</div>}
          <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setOpen(false)} disabled={busy || parsing}>Hủy</Button><Button type="button" onClick={() => void submit()} disabled={busy || parsing || !preview}>{busy ? 'Đang import…' : 'Xác nhận import'}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
