import Link from 'next/link'
import { ArrowRight, BookOpen, DoorOpen, PlayCircle, Trophy, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireOlympiaAdminContext } from '@/lib/olympia/olympia-auth'
import getOlympiaAdminClient from '@/lib/olympia/olympia-admin-client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type MatchSummary = {
  id: string
  name: string
  status: string
  scheduled_at: string | null
}

const statusLabel: Record<string, string> = {
  draft: 'Bản nháp',
  scheduled: 'Đã lên lịch',
  live: 'Đang diễn ra',
  finished: 'Đã kết thúc',
  cancelled: 'Đã hủy',
}

const statusClass: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-blue-100 text-blue-700',
  live: 'bg-green-100 text-green-700',
  finished: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

async function fetchDashboardData() {
  await requireOlympiaAdminContext()
  const olympia = getOlympiaAdminClient().schema('olympia')

  const [
    { count: tournamentCount, error: tournamentError },
    { count: matchCount, error: matchError },
    { count: questionSetCount, error: questionSetError },
    { data: sessions, error: sessionError },
    { data: matches, error: upcomingMatchError },
  ] = await Promise.all([
    olympia.from('tournaments').select('id', { count: 'exact', head: true }),
    olympia.from('matches').select('id', { count: 'exact', head: true }),
    olympia.from('question_sets').select('id', { count: 'exact', head: true }),
    olympia.from('live_sessions').select('id, match_id, status').in('status', ['running', 'pending']),
    olympia
      .from('matches')
      .select('id, name, status, scheduled_at')
      .in('status', ['draft', 'scheduled', 'live'])
      .order('scheduled_at', { ascending: true, nullsFirst: false })
      .limit(50),
  ])

  if (tournamentError) throw tournamentError
  if (matchError) throw matchError
  if (questionSetError) throw questionSetError
  if (sessionError) throw sessionError
  if (upcomingMatchError) throw upcomingMatchError

  return {
    counts: {
      tournaments: tournamentCount ?? 0,
      matches: matchCount ?? 0,
      questionSets: questionSetCount ?? 0,
      liveSessions: sessions?.filter((session) => session.status === 'running').length ?? 0,
      pendingSessions: sessions?.filter((session) => session.status === 'pending').length ?? 0,
    },
    matches: (matches ?? []) as MatchSummary[],
  }
}

const quickLinks = [
  {
    title: 'Tạo và chuẩn bị trận',
    description: 'Chọn bộ đề, gán 4 thí sinh, xếp ghế và mở phòng từ một luồng.',
    href: '/olympia/admin/matches',
    icon: Trophy,
    action: 'Mở quản lý trận',
  },
  {
    title: 'Theo dõi phòng thi',
    description: 'Mở phòng, sao chép mã và chuyển thẳng sang giao diện MC.',
    href: '/olympia/admin/rooms',
    icon: DoorOpen,
    action: 'Xem phòng thi',
  },
  {
    title: 'Chuẩn bị bộ câu hỏi',
    description: 'Kiểm tra các bộ đề đã tải lên trước khi gán vào trận.',
    href: '/olympia/admin/question-bank',
    icon: BookOpen,
    action: 'Mở ngân hàng câu hỏi',
  },
] as const

export default async function OlympiaAdminHomePage() {
  const { counts, matches } = await fetchDashboardData()
  const activeMatches = matches.filter((match) => match.status === 'live')
  const nextMatches = matches.filter((match) => match.status !== 'live').slice(0, 3)

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Olympia Admin</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Trung tâm điều hành</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Nắm nhanh tình trạng hệ thống và đi thẳng đến thao tác tiếp theo.
          </p>
        </div>
        <Button asChild>
          <Link href="/olympia/admin/matches">
            Tạo trận mới <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Giải đấu', value: counts.tournaments, icon: Trophy },
          { label: 'Tổng số trận', value: counts.matches, icon: PlayCircle },
          { label: 'Phòng đang mở', value: counts.liveSessions, icon: DoorOpen },
          { label: 'Phòng chờ mở', value: counts.pendingSessions, icon: Users },
          { label: 'Bộ đề', value: counts.questionSets, icon: BookOpen },
        ].map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label} className="gap-3 py-4">
              <CardContent className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{item.value}</p>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {activeMatches.length > 0 ? (
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              Trận đang diễn ra
            </CardTitle>
            <CardDescription>Có thể mở ngay giao diện MC để điều khiển.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeMatches.map((match) => (
              <div key={match.id} className="flex flex-col gap-2 rounded-lg border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{match.name}</p>
                  <Badge className={statusClass[match.status]}>{statusLabel[match.status]}</Badge>
                </div>
                <Button asChild size="sm">
                  <Link href={`/olympia/admin/matches/${match.id}/host`}>Mở giao diện MC</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader>
            <CardTitle>Việc cần xử lý tiếp theo</CardTitle>
            <CardDescription>Các trận chưa hoàn tất chuẩn bị hoặc đang chờ mở phòng.</CardDescription>
          </CardHeader>
          <CardContent>
            {nextMatches.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="font-medium">Chưa có trận cần xử lý</p>
                <p className="mt-1 text-sm text-muted-foreground">Tạo trận mới để bắt đầu chuẩn bị.</p>
              </div>
            ) : (
              <div className="divide-y">
                {nextMatches.map((match) => (
                  <Link key={match.id} href={`/olympia/admin/matches/${match.id}`} className="flex items-center justify-between gap-4 py-3 hover:text-primary">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{match.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {match.scheduled_at ? dateFormatter.format(new Date(match.scheduled_at)) : 'Chưa có lịch'}
                      </p>
                    </div>
                    <Badge className={statusClass[match.status] ?? 'bg-slate-100 text-slate-700'}>
                      {statusLabel[match.status] ?? match.status}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {quickLinks.map((link) => {
            const Icon = link.icon
            return (
              <Card key={link.href} className="transition-colors hover:border-primary/40">
                <CardContent className="flex gap-3 p-4">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <h2 className="font-semibold">{link.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                    <Link href={link.href} className="mt-3 inline-flex items-center text-sm font-medium text-primary hover:underline">
                      {link.action} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
