import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ViewerStage } from '@/components/olympia/client/viewer/ViewerStage'
import { getGuestSnapshot } from '@/lib/olympia/guest-snapshot'
import getOlympiaAdminClient from '@/lib/olympia/olympia-admin-client'
import type { GameSessionPayload } from '@/types/olympia/game'

// KEEP force-dynamic: Real-time match state
export const dynamic = 'force-dynamic'

type GuestPageProps = {
    params: Promise<{
        joinCode: string
    }>
}

async function getGuestSessionData(
    supabase: SupabaseClient,
    joinCode: string
): Promise<{ payload: GameSessionPayload | null; joinCode: string | null; matchName: string | null }> {
    const olympia = supabase.schema('olympia')

    const { data: session, error: sessionError } = await olympia
        .from('live_sessions')
        .select(
            'id, match_id, status, join_code, question_state, current_round_id, current_round_type, current_round_question_id, timer_deadline, requires_player_password, buzzer_enabled, show_scoreboard_overlay, show_answers_overlay, guest_media_control'
        )
        .eq('join_code', joinCode)
        .maybeSingle()

    if (sessionError) {
        console.error('[Olympia][Guest] load live session failed', sessionError.message)
    }

    if (!session?.match_id) {
        return { payload: null, joinCode: session?.join_code ?? null, matchName: null }
    }

    const { data: match, error: matchError } = await olympia
        .from('matches')
        .select('id, name, status, scheduled_at')
        .eq('id', session.match_id)
        .maybeSingle()

    if (matchError) {
        console.error('[Olympia][Guest] load match failed', matchError.message)
    }

    if (!match) {
        return { payload: null, joinCode: session?.join_code ?? null, matchName: null }
    }

    const payload = await getGuestSnapshot(supabase, session.id)

    return {
        payload,
        joinCode: payload?.session.join_code ?? session.join_code ?? null,
        matchName: match.name,
    }
}

export default async function OlympiaGuestPage({ params }: GuestPageProps) {
    const supabase = getOlympiaAdminClient()
    const resolvedParams = await params
    const joinCode = (resolvedParams.joinCode ?? '').trim().toUpperCase()
    const { payload, matchName } = await getGuestSessionData(supabase, joinCode)

    if (!payload) {
        return (
            <section className="mx-auto max-w-2xl px-4 py-8 space-y-4">
                <Alert>
                    <AlertTitle>Không thể mở chế độ khách</AlertTitle>
                    <AlertDescription>
                        {matchName
                            ? `Trận "${matchName}" chưa mở phòng live hoặc chưa có dữ liệu để xem.`
                            : 'Không tìm thấy phòng/trận với mã bạn cung cấp.'}
                    </AlertDescription>
                </Alert>

                <div className="flex gap-2">
                    <Button asChild variant="outline">
                        <Link href="/olympia/client/join">Về trang tham gia</Link>
                    </Button>
                    <Button asChild>
                        <Link href="/olympia/client/matches">Xem danh sách trận</Link>
                    </Button>
                </div>
            </section>
        )
    }

    return (
        <ViewerStage
            initialData={payload}
            sessionId={payload.session.id}
        />
    )
}
