import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { McJoinForm } from './McJoinForm'

export const dynamic = 'force-dynamic'

export default async function OlympiaMcHomePage() {
    return (
        <section className="mx-auto max-w-2xl px-4 py-8 space-y-6">
            <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Olympia · Người dẫn chương trình</p>
                <h1 className="text-3xl font-semibold tracking-tight">Màn hình theo dõi cho MC</h1>
                <p className="text-sm text-muted-foreground">Nhập mã phòng để theo dõi diễn biến, thí sinh và bảng điểm. MC không điều khiển nghiệp vụ trận đấu.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Vào phòng thi</CardTitle>
                    <CardDescription>Dùng mã phòng do ban tổ chức cung cấp</CardDescription>
                </CardHeader>
                <CardContent>
                    <McJoinForm />
                </CardContent>
            </Card>

            <Button asChild variant="outline" size="sm">
                <Link href="/olympia">← Quay lại</Link>
            </Button>
        </section>
    )
}
