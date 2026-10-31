import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
// Table components not used on this page
import { LiveSessionControls } from '@/components/olympia/admin/matches/LiveSessionControls'
import { ResetLiveSessionAndScoresButton } from '@/components/olympia/admin/matches/ResetLiveSessionAndScoresButton'
import { MatchQuestionSetSelector } from '@/components/olympia/admin/matches/MatchQuestionSetSelector'
import { MatchPlayersReorder } from '@/components/olympia/admin/matches/MatchPlayersReorder'
import { AddPlayersToMatch } from '@/components/olympia/admin/matches/AddPlayersToMatch'
import { CopyMatchIdButton } from '@/components/olympia/admin/matches/CopyMatchIdButton'
import { CopyRoomLinksPanel } from '@/components/olympia/admin/matches/CopyRoomLinksPanel'
import { TournamentInfoCard } from '@/components/olympia/admin/matches/TournamentInfoCard'
import { requireOlympiaAdminContext } from '@/lib/olympia/olympia-auth'
import getOlympiaAdminClient from '@/lib/olympia/olympia-admin-client'
import { resetLiveSessionAndScoresAction } from '@/app/(olympia)/olympia/actions'

// Force dynamic to avoid timing issues with Turbopack performance measurements
export const dynamic = 'force-dynamic'
// ISR: Match detail page. Real-time handled by LiveSessionControls component.
export const revalidate = 0

const statusVariants: Record<string, string> = {
  draft: 'bg-slate-200 text-slate-700',
  scheduled: 'bg-blue-100 text-blue-700',
  live: 'bg-green-100 text-green-700',
  finished: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
}

const roundLabel: Record<string, string> = {
  khoi_dong: 'Khởi động',
  vcnv: 'Vượt chướng ngại vật',
  tang_toc: 'Tăng tốc',
  ve_dich: 'Về đích',
}

const formatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'full',
  timeStyle: 'short',
})

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  try {
    return formatter.format(new Date(value))
  } catch {
    return value
  }
}

async function fetchMatchDetail(matchId: string) {
  await requireOlympiaAdminContext()
  const admin = getOlympiaAdminClient()
  const olympia = admin.schema('olympia')

  const { data: match, error: matchError } = await olympia
    .from('matches')
    .select('id, name, status, scheduled_at, tournament_id, host_user_id, metadata, created_at, updated_at')
    .eq('id', matchId)
    .maybeSingle()

  if (matchError) throw matchError
  if (!match) return null

  const realMatchId = match.id

  const tournamentPromise = match.tournament_id
    ? olympia
      .from('tournaments')
      .select('id, name, status, starts_at, ends_at')
      .eq('id', match.tournament_id)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [
    liveSessionResult,
    playersResult,
    roundsResult,
    tournamentResult,
    matchQuestionSetsResult,
    questionSetsResult,
    allParticipantsResult,
  ] = await Promise.all([
    olympia
      .from('live_sessions')
      .select('id, match_id, status, join_code, question_state, current_round_type, timer_deadline, requires_player_password')
      .eq('match_id', realMatchId)
      .maybeSingle(),
    olympia
      .from('match_players')
      .select('id, match_id, seat_index, display_name, participant_id, created_at')
      .eq('match_id', realMatchId)
      .order('seat_index', { ascending: true }),
    olympia
      .from('match_rounds')
      .select('id, round_type, order_index, config')
      .eq('match_id', realMatchId)
      .order('order_index', { ascending: true }),
    tournamentPromise,
    (async () => {
      try {
        return await olympia
          .from('match_question_sets')
          .select('question_set_id')
          .eq('match_id', matchId)
      } catch {
        return { data: [], error: null }
      }
    })(),
    (async () => {
      try {
        return await olympia
          .from('question_sets')
          .select('id, name, item_count, original_filename, created_at')
          .order('created_at', { ascending: false })
          .limit(50)
      } catch {
        return { data: [], error: null }
      }
    })(),
    (async () => {
      const { data, error } = await olympia
        .from('participants')
        .select('user_id, contestant_code, is_active')
        .eq('is_active', true)
        .order('contestant_code', { ascending: true })
      if (error) return { data: [] as Array<Record<string, unknown>>, error }
      const userIds = (data ?? []).map((row) => row.user_id)
      const { data: profiles, error: profilesError } = await olympia
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds)
      if (profilesError) return { data: [] as Array<Record<string, unknown>>, error: profilesError }
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]))
      const users: Array<{ id: string; email?: string }> = []
      for (let page = 1; ; page += 1) {
        const result = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (result.error) return { data: [] as Array<Record<string, unknown>>, error: result.error }
        users.push(...result.data.users.map((user) => ({ id: user.id, email: user.email })))
        if (result.data.users.length < 1000) break
      }
      const emailMap = new Map(users.map((user) => [user.id, user.email ?? null]))
      return {
        data: (data ?? []).map((participant) => ({
          ...participant,
          display_name: profileMap.get(participant.user_id) ?? null,
          email: emailMap.get(participant.user_id) ?? null,
          class_name: null,
        })),
        error: null,
      }
    })(),
  ])

  if (liveSessionResult.error) throw liveSessionResult.error
  if (playersResult.error) {
    console.warn('[Olympia] Failed to load match players:', playersResult.error.message)
  }
  if (roundsResult.error) throw roundsResult.error
  if (tournamentResult && tournamentResult.error) throw tournamentResult.error

  let participantLookup = new Map<
    string,
    {
      contestant_code: string | null
      display_name?: string | null
      class_name?: string | null
    }
  >()
  const playerParticipantIds = (playersResult.data ?? [])
    .map((player) => player.participant_id)
    .filter((value): value is string => Boolean(value))

  if (playerParticipantIds.length > 0) {
    const { data: participants, error: participantError } = await olympia
      .from('participants')
      .select('user_id, contestant_code, is_active')
      .in('user_id', playerParticipantIds)

    if (participantError) {
      console.warn('[Olympia] Failed to load participants:', participantError.message)
    } else if (participants && participants.length > 0) {
      type SimpleParticipant = { user_id: string; contestant_code?: string | null; is_active?: boolean }
      const participantsList = participants as SimpleParticipant[]
      const userIds = participantsList.map((p) => p.user_id)
      const { data: profiles } = await olympia.from('profiles').select('id, display_name').in('id', userIds)
      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]))

      participantLookup = new Map(
        participantsList.map((participant) => {
          return [
            participant.user_id,
            {
              contestant_code: participant.contestant_code ?? null,
              display_name: profileMap.get(participant.user_id) ?? null,
              class_name: null,
            },
          ]
        })
      )
    }
  } else {
    type EnrichedParticipant = { user_id: string; contestant_code?: string | null; display_name?: string | null; class_name?: string | null }
    const all = (allParticipantsResult.data ?? []) as EnrichedParticipant[]
    participantLookup = new Map(
      all.map((participant) => [
        participant.user_id,
        {
          contestant_code: participant.contestant_code ?? null,
          display_name: participant.display_name ?? null,
          class_name: participant.class_name ?? null,
        },
      ])
    )
  }

  return {
    match,
    tournament: tournamentResult?.data ?? null,
    liveSession: liveSessionResult.data,
    players: playersResult.data ?? [],
    rounds: roundsResult.data ?? [],
    questionSets: questionSetsResult.data ?? [],
    selectedQuestionSetIds: (matchQuestionSetsResult.data ?? []).map((row) => row.question_set_id),
    participantLookup,
    allParticipants: allParticipantsResult.data ?? [],
  }
}

export default async function OlympiaMatchDetailPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params

  // Match routes now use match UUID in the URL (not code). matchId is the match.id UUID.
  const details = await fetchMatchDetail(matchId)
  if (!details) {
    console.error('[OlympiaMatchDetailPage] Match not found in database:', matchId)
    notFound()
  }

  const { match, tournament, liveSession, players, rounds, participantLookup, questionSets, selectedQuestionSetIds } = details
  const statusClass = statusVariants[match.status] ?? 'bg-slate-100 text-slate-700'

  type ParticipantRow = {
    user_id: string
    contestant_code?: string | null
    display_name?: string | null
    class_name?: string | null
  }
  const availableParticipants = (details.allParticipants ?? []) as ParticipantRow[]
  const preparationSteps = [
    { label: 'Bộ câu hỏi', complete: selectedQuestionSetIds.length > 0, href: '#question-sets' },
    { label: '4 thí sinh / xếp ghế', complete: players.length === 4, href: '#players' },
    { label: 'Cấu hình vòng', complete: rounds.length > 0, href: '#rounds' },
    { label: 'Mở phòng', complete: liveSession?.status === 'running', href: '#live-session' },
  ]
  const completedSteps = preparationSteps.filter((step) => step.complete).length
  const readyForRoom = preparationSteps.slice(0, 3).every((step) => step.complete)

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 border-b pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">Mã trận · {match.id}</p>
              <CopyMatchIdButton matchId={match.id} />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{match.name}</h1>
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span>Lịch dự kiến: {formatDate(match.scheduled_at)}</span>
              <span>· Cập nhật: {formatDate(match.updated_at)}</span>
            </div>
          </div>
          <Badge className={statusClass}>{match.status}</Badge>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span>Host: {match.host_user_id ?? '—'}</span>
          <span>Giải đấu: {tournament ? tournament.name : 'Chưa gán'}</span>
        </div>
        <div className="flex gap-3 text-sm">
          <Button asChild variant="ghost" size="sm">
            <Link href="/olympia/admin/matches">← Trở lại danh sách</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/olympia/admin">Về dashboard</Link>
          </Button>
          <Button asChild variant="default" size="sm">
            <Link href={`/olympia/admin/matches/${match.id}/host`}>Mở trung tâm điều khiển Admin</Link>
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Tiến độ chuẩn bị trận</CardTitle>
              <CardDescription>
                Hoàn thành {completedSteps}/{preparationSteps.length} bước trước khi chuyển sang giao diện MC.
              </CardDescription>
            </div>
            {readyForRoom && liveSession?.status !== 'running' ? (
              <Badge variant="outline" className="w-fit border-amber-300 bg-amber-50 text-amber-800">
                Sẵn sàng mở phòng
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-4">
            {preparationSteps.map((step, index) => (
              <a
                key={step.label}
                href={step.href}
                className={`rounded-lg border p-3 transition-colors hover:border-primary/50 ${
                  step.complete ? 'border-green-200 bg-green-50/70' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      step.complete ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {step.complete ? '✓' : index + 1}
                  </span>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {step.complete ? 'Đã hoàn tất' : 'Cần xử lý'}
                </p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card id="live-session" className="scroll-mt-6 md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>4. Mở phòng và chuyển sang MC</span>
              {liveSession?.status === 'running' ? <Badge className="bg-green-600">Đang mở</Badge> : null}
            </CardTitle>
            <CardDescription>
              Chỉ mở phòng sau khi đã chọn bộ đề, đủ 4 thí sinh và có cấu hình vòng.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {!readyForRoom && liveSession?.status !== 'running' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Hoàn thành các bước chuẩn bị ở trên trước khi mở phòng để tránh thiếu cấu hình khi MC bắt đầu.
                </div>
              ) : null}
              <LiveSessionControls
                matchId={match.id}
                liveSession={liveSession ?? undefined}
                canOpen={readyForRoom}
              />
              <ResetLiveSessionAndScoresButton matchId={match.id} action={resetLiveSessionAndScoresAction} />
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Link phòng thi</CardTitle>
              <CardDescription>Copy nhanh link vào phòng thi cho thí sinh / MC / Guest.</CardDescription>
            </CardHeader>
            <CardContent>
              <CopyRoomLinksPanel joinCode={liveSession?.join_code ?? null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Thông tin trận đấu</CardTitle>
              <CardDescription>Thông tin trận đấu và các link truy cập.</CardDescription>
            </CardHeader>
            <CardContent>
              <TournamentInfoCard
                matchName={match.name}
                tournamentName={tournament?.name ?? null}
                joinCode={liveSession?.join_code ?? null}
                playerPassword={null}
                mcPassword={null}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Mật khẩu phiên: chưa hỗ trợ xem lại trong giai đoạn này.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card id="players" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>2. Chọn 4 thí sinh và xếp ghế</span>
            <Badge variant={players.length === 4 ? 'default' : 'secondary'}>{players.length}/4</Badge>
          </CardTitle>
          <CardDescription>
            Thêm thí sinh còn trống, sau đó kéo thả để sắp xếp thứ tự ghế 1-4.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Quản lý thí sinh</h4>
            <AddPlayersToMatch
              matchId={match.id}
              availableParticipants={availableParticipants.map((p) => ({
                user_id: p.user_id,
                contestant_code: p.contestant_code ?? null,
                display_name: p.display_name ?? null,
                class_name: p.class_name ?? null,
              }))}
              currentPlayers={players}
            />
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">Sắp xếp thứ tự</h4>
            <MatchPlayersReorder
              matchId={match.id}
              players={players}
              participantLookup={participantLookup}
            />
          </div>
        </CardContent>
      </Card>

      <Card id="question-sets" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>1. Chọn bộ câu hỏi</span>
            <Badge variant={selectedQuestionSetIds.length > 0 ? 'default' : 'secondary'}>
              {selectedQuestionSetIds.length} bộ đã chọn
            </Badge>
          </CardTitle>
          <CardDescription>Chọn một hoặc nhiều bộ đề đã tải lên. Thay đổi áp dụng ngay cho trận này.</CardDescription>
        </CardHeader>
        <CardContent>
          <MatchQuestionSetSelector
            matchId={match.id}
            questionSets={questionSets}
            selectedIds={selectedQuestionSetIds}
          />
        </CardContent>
      </Card>

      <Card id="rounds" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>3. Kiểm tra cấu hình vòng thi</CardTitle>
          <CardDescription>Mỗi vòng tương ứng với cấu hình trong bảng olympia.match_rounds.</CardDescription>
        </CardHeader>
        <CardContent>
          {rounds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa cấu hình vòng thi cho trận này.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {rounds.map((round) => (
                <div key={round.id} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-semibold">
                    Vòng {round.order_index + 1}: {roundLabel[round.round_type] ?? round.round_type}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Config: {round.config ? JSON.stringify(round.config) : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
