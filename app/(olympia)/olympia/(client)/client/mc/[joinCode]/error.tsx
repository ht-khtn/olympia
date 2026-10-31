'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function McError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md border-rose-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-700">
            <AlertCircle className="h-5 w-5" />
            Không tải được màn hình MC
          </CardTitle>
          <CardDescription>Không thể đồng bộ dữ liệu phòng thi. Bạn chưa thực hiện thao tác điều khiển nào.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={reset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Thử kết nối lại
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
