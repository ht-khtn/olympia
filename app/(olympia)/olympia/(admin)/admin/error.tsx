'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function OlympiaAdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="flex min-h-[420px] items-center justify-center">
      <Card className="w-full max-w-lg border-rose-200">
        <CardHeader>
          <div className="flex items-center gap-2 text-rose-700">
            <AlertCircle className="h-5 w-5" />
            <CardTitle>Không tải được dữ liệu Olympia</CardTitle>
          </div>
          <CardDescription>
            Có lỗi khi kết nối dữ liệu quản trị. Thao tác của bạn chưa được thực hiện, hãy thử tải lại.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Thử lại
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
