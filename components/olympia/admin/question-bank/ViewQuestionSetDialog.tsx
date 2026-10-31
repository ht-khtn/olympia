'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Eye } from 'lucide-react'
import { getQuestionSetItems, type QuestionSetItem } from '@/app/(olympia)/olympia/(admin)/admin/question-bank/actions'

type Props = {
  questionSetId: string
  questionSetName: string
  itemCount: number
}

export function ViewQuestionSetDialog({ questionSetId, questionSetName, itemCount }: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<QuestionSetItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && items.length === 0) {
      let cancelled = false

      const fetchItems = async () => {
        setLoading(true)
        try {
          const data = await getQuestionSetItems(questionSetId)
          if (!cancelled) {
            setItems(data)
          }
        } finally {
          if (!cancelled) {
            setLoading(false)
          }
        }
      }

      void fetchItems()

      return () => {
        cancelled = true
      }
    }
  }, [open, questionSetId, items.length])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Xem nội dung">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{questionSetName}</DialogTitle>
          <DialogDescription>
            Tổng số {itemCount} câu hỏi. Bộ đề chỉ cho phép xem, không chỉnh sửa.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Đang tải...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có câu hỏi nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">STT</TableHead>
                  <TableHead className="w-30">Mã</TableHead>
                  <TableHead className="w-35">Lĩnh vực</TableHead>
                  <TableHead>Câu hỏi</TableHead>
                  <TableHead className="w-50">Đáp án</TableHead>
                  <TableHead className="w-25">Media</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{item.code}</TableCell>
                    <TableCell>
                      {item.category ? (
                        <Badge variant="outline" className="text-xs">
                          {item.category}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm">{item.question_text ?? '—'}</p>
                        {item.note && (
                          <p className="text-xs text-muted-foreground italic">Ghi chú: {item.note}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{item.answer_text}</TableCell>
                    <TableCell>
                      {item.media_url ? (() => {
                        const extension = item.media_path?.split('.').pop()?.toLowerCase() ?? ''
                        if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
                          return <img src={item.media_url} alt={`Media ${item.code}`} className="max-h-24 max-w-32 rounded object-contain" />
                        }
                        if (['mp3', 'wav', 'ogg', 'm4a'].includes(extension)) {
                          return <audio controls src={item.media_url} className="max-w-44" />
                        }
                        if (['mp4', 'webm', 'mov', 'm4v'].includes(extension)) {
                          return <video controls src={item.media_url} className="max-h-24 max-w-44 rounded" />
                        }
                        return <a href={item.media_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Mở media</a>
                      })() : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
