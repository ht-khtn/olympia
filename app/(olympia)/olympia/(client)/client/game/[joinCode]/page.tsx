import { notFound, redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PlayerPasswordGate } from '@/components/olympia/client/game/PlayerPasswordGate'
import { PlayerStage } from '@/components/olympia/client/game/PlayerStage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { resolveDisplayNamesForUserIds } from '@/lib/olympia-display-names'
import { getServerAuthContext } from '@/lib/server-auth'
import getOlympiaAdminClient from '@/lib/olympia/olympia-admin-client'
import type { GameSessionPayload, RoundQuestionRow } from '@/types/olympia/game'
import { hasOlympiaGrant } from '@/lib/olympia/session-grants'

// KEEP force-dynamic: Real-time game state (timer, scores, questions update per-second)
export const dynamic = 'force-dynamic'

type PageProps = {
    params: {
        joinCode: string
    }
}

async function getGameSessionData(
    supabase: SupabaseClient,
    joinCode: string,
    appUserId: string
): Promise<GameSessionPayload | null> {
    const olympia = supabase.schema('olympia')
    const selectWithGuestMediaControl =
        'id, match_id, status, join_code, question_state, current_round_id, current_round_type, current_round_question_id, timer_deadline, requires_player_password, buzzer_enabled, show_scoreboard_overlay, show_answers_overlay, guest_media_control'
    const selectWithoutGuestMediaControl =
        'id, match_id, status, join_code, question_state, current_round_id, current_round_type, current_round_question_id, timer_deadline, requires_player_password, buzzer_enabled, show_scoreboard_overlay'

    const firstAttempt = await olympia
        .from('live_sessions')
        .select(selectWithGuestMediaControl)
        .eq('join_code', joinCode)
        .maybeSingle()

    const shouldRetryWithoutGuestMediaControl =
        firstAttempt.error?.message != null &&
        firstAttempt.error.message.toLowerCase().includes('guest_media_control')

    const { data: session, error: sessionError } = shouldRetryWithoutGuestMediaControl
        ? await olympia.from('live_sessions').select(selectWithoutGuestMediaControl).eq('join_code', joinCode).maybeSingle()
        : firstAttempt

    if (sessionError) {
        console.error('[Olympia] load live session failed', sessionError.message)
        return null
    }

    if (!session) {
        console.error(`[Olympia] Session not found: ${joinCode}`)
        return null
    }

    if (!session.match_id) {
        console.error(`[Olympia] Session has no match_id: ${joinCode}`)
        return null
    }

    const [{ data: match, error: matchError }, { data: membership, error: membershipError }] = await Promise.all([
        olympia
            .from('matches')
            .select('id, name, status, scheduled_at')
            .eq('id', session.match_id)
            .maybeSingle(),
        olympia
            .from('match_players')
            .select('id')
            .eq('match_id', session.match_id)
            .eq('participant_id', appUserId)
            .maybeSingle(),
    ])

    if (matchError) {
        console.error('[Olympia] load match failed', matchError.message)
        return null
    }

    if (!match) {
        console.error(`[Olympia] Match not found for match_id: ${session.match_id}`)
        return null
    }

    if (membershipError || !membership) {
        if (membershipError) {
            console.error('[Olympia] load player membership failed', membershipError.message)
        }
        return null
    }

    const canReadAnswer =
        (await hasOlympiaGrant({ sessionId: session.id, scope: 'player', userId: appUserId })) &&
        (session.question_state === 'answer_revealed' || session.question_state === 'completed')
    const roundQuestionSelect =
        'id, match_round_id, question_set_item_id, order_index, target_player_id, meta, question_text, note, image_path, audio_path, image_external_url, audio_external_url, media_path, letter_count, match_rounds!inner(match_id, round_type)'
    const [
        { data: scores },
        { data: rawRoundQuestions },
        { data: buzzerEvents },
        { data: starUses },
        { data: currentAnswer },
    ] = await Promise.all([
        olympia
            .from('match_scores')
            .select('id, match_id, player_id, round_type, points')
            .eq('match_id', session.match_id),
        olympia
            .from('round_questions')
            .select(
                roundQuestionSelect
            )
            .eq('match_rounds.match_id', session.match_id)
            .order('order_index', { ascending: true }),
        session.current_round_question_id
            ? olympia
                .from('buzzer_events')
                .select('id, match_id, round_question_id, player_id, event_type, result, occurred_at')
                .eq('round_question_id', session.current_round_question_id)
                .order('occurred_at', { ascending: false })
                .limit(20)
            : Promise.resolve({ data: [] }),
        olympia
            .from('star_uses')
            .select('id, match_id, round_question_id, player_id, outcome, declared_at')
            .eq('match_id', session.match_id),
        canReadAnswer && session.current_round_question_id
            ? olympia
                .from('round_questions')
                .select('id, answer_text')
                .eq('id', session.current_round_question_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
    ])

    const { data: players, error: playersError } = await olympia
        .from('match_players')
        .select('id, match_id, participant_id, seat_index, display_name, is_disqualified_obstacle')
        .eq('match_id', session.match_id)
        .order('seat_index', { ascending: true })

    if (playersError) {
        console.warn('[Olympia] load players failed', playersError.message)
    }

    const participantIds = (players ?? [])
        .map((p) => (p as { participant_id?: string | null }).participant_id ?? null)
        .filter((id): id is string => Boolean(id))
    const nameMap = await resolveDisplayNamesForUserIds(supabase, participantIds)
    const normalizedPlayers = (players ?? []).map((p) => {
        const row = p as { participant_id?: string | null; display_name?: string | null }
        const pid = row.participant_id ?? null
        const resolved = pid ? nameMap.get(pid) ?? null : null
        return { ...p, display_name: row.display_name ?? resolved }
    })

    const roundQuestions = (rawRoundQuestions ?? []).map((question) =>
        question.id === session.current_round_question_id
            ? { ...question, answer_text: currentAnswer?.answer_text ?? null }
            : question
    ) as RoundQuestionRow[]

    return {
        session,
        match,
        players: normalizedPlayers,
        scores: scores ?? [],
        roundQuestions: roundQuestions ?? [],
        buzzerEvents: buzzerEvents ?? [],
        starUses: starUses ?? [],
        obstacle: null,
        obstacleTiles: [],
        obstacleGuesses: [],
        serverTimestamp: new Date().toISOString(),
        viewerUserId: null,
    }
}

export default async function OlympiaGamePage({ params }: PageProps) {
    const { authUid, appUserId } = await getServerAuthContext()
    const { joinCode } = await params
    if (!joinCode) {
        notFound()
    }

    if (!authUid) {
        redirect(`/login?redirect=${encodeURIComponent(`/olympia/client/game/${joinCode}`)}`)
    }

    if (!appUserId) {
        return (
            <section className="mx-auto max-w-2xl px-4 py-8 space-y-4">
                <Alert>
                    <AlertTitle>Tài khoản chưa sẵn sàng</AlertTitle>
                    <AlertDescription>Tài khoản Olympia của bạn chưa có hồ sơ thí sinh hợp lệ.</AlertDescription>
                </Alert>
            </section>
        )
    }

    const supabase = getOlympiaAdminClient()
    const data = await getGameSessionData(supabase, joinCode, appUserId)
    if (!data) {
        notFound()
    }

    const userAlreadyVerified = await hasOlympiaGrant({ sessionId: data.session.id, scope: 'player', userId: appUserId })

    // UI game tự xử lý trạng thái phòng (running/pending/ended)

    return (
        <PlayerPasswordGate session={data.session} userAlreadyVerified={userAlreadyVerified}>
            <PlayerStage
                initialData={{ ...data, viewerUserId: appUserId }}
                sessionId={data.session.id}
            />
        </PlayerPasswordGate>
    )
}
