'use client'

import { useMemo, useState } from 'react'
import { Maximize, Radio, Trophy, Users } from 'lucide-react'
import { useOlympiaGameState } from '@/components/olympia/shared/game/useOlympiaGameState'
import type { GameSessionPayload, RoundQuestionRow } from '@/types/olympia/game'

type ViewerStageProps = {
  initialData: GameSessionPayload
  sessionId: string
}

const roundLabels: Record<string, string> = {
  khoi_dong: 'Khởi động',
  vcnv: 'Vượt chướng ngại vật',
  tang_toc: 'Tăng tốc',
  ve_dich: 'Về đích',
}

const stateLabels: Record<string, string> = {
  hidden: 'Chuẩn bị câu hỏi',
  showing: 'Đang thi',
  answer_revealed: 'Đáp án',
  completed: 'Đã hoàn thành',
}

const roundThemes: Record<string, string> = {
  khoi_dong: 'viewer-stage--warmup',
  vcnv: 'viewer-stage--obstacle',
  tang_toc: 'viewer-stage--speed',
  ve_dich: 'viewer-stage--finish',
}

function getCurrentQuestion(
  questions: RoundQuestionRow[],
  currentQuestionId: string | null
): RoundQuestionRow | null {
  if (!currentQuestionId) return null
  return questions.find((question) => question.id === currentQuestionId) ?? null
}

function getScoreTotal(scores: GameSessionPayload['scores'], playerId: string): number {
  return scores
    .filter((score) => score.player_id === playerId)
    .reduce((total, score) => total + (score.points ?? 0), 0)
}

export function ViewerStage({ initialData, sessionId }: ViewerStageProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const {
    match,
    session,
    players,
    scores,
    roundQuestions,
    buzzerEvents,
    answers,
    questionState,
    roundType,
    timerLabel,
    isRealtimeReady,
    statusMessage,
  } = useOlympiaGameState({
    sessionId,
    initialData,
    viewerMode: 'guest',
  })

  const currentQuestion = useMemo(
    () => getCurrentQuestion(roundQuestions, session.current_round_question_id),
    [roundQuestions, session.current_round_question_id]
  )
  const currentBuzzer = buzzerEvents.find(
    (event) =>
      event.round_question_id === session.current_round_question_id &&
      event.result === 'accepted'
  )
  const buzzerPlayer = currentBuzzer?.player_id
    ? players.find((player) => player.id === currentBuzzer.player_id)
    : null
  const sortedPlayers = useMemo(
    () =>
      players
        .map((player) => ({
          ...player,
          total: getScoreTotal(scores, player.id),
        }))
        .sort((a, b) => b.total - a.total),
    [players, scores]
  )
  const isAnswerVisible =
    questionState === 'answer_revealed' || questionState === 'completed'
  const publicAnswer = isAnswerVisible
    ? answers.find((answer) => answer.round_question_id === currentQuestion?.id)
    : null
  const theme = roundThemes[roundType] ?? 'viewer-stage--default'
  const stateLabel = stateLabels[questionState] ?? 'Đang cập nhật'

  async function toggleFullscreen() {
    if (typeof document === 'undefined') return
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      setIsFullscreen(false)
      return
    }
    await document.documentElement.requestFullscreen()
    setIsFullscreen(true)
  }

  if (session.status === 'ended' || session.status === 'completed' || match.status === 'finished') {
    return (
      <main className="viewer-stage viewer-stage--ended">
        <div className="viewer-stage__end-card">
          <Trophy className="mx-auto mb-6 h-16 w-16 text-amber-300" />
          <p className="viewer-kicker">OLYMPIA</p>
          <h1 className="viewer-title">{match.name}</h1>
          <p className="viewer-subtitle">Trận đấu đã kết thúc</p>
          <div className="viewer-stage__final-scores">
            {sortedPlayers.map((player) => (
              <div key={player.id} className="viewer-score-row">
                <span>{player.display_name ?? `Thí sinh ${player.seat_index}`}</span>
                <strong>{player.total}</strong>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className={`viewer-stage ${theme}`}>
      <header className="viewer-stage__header">
        <div>
          <p className="viewer-kicker">ĐƯỜNG LÊN ĐỈNH OLYMPIA</p>
          <h1 className="viewer-match-name">{match.name}</h1>
        </div>
        <div className="viewer-stage__header-actions">
          <span className={`viewer-live-indicator ${isRealtimeReady ? '' : 'viewer-live-indicator--offline'}`}>
            <Radio className="h-4 w-4" />
            {isRealtimeReady ? 'TRỰC TIẾP' : 'ĐANG KẾT NỐI'}
          </span>
          <button type="button" className="viewer-icon-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}>
            <Maximize className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="viewer-stage__round-bar">
        <div>
          <p className="viewer-kicker">VÒNG THI</p>
          <h2>{roundLabels[roundType] ?? 'Đang chờ vòng thi'}</h2>
        </div>
        <div className="viewer-state">{stateLabel}</div>
      </div>

      <section className="viewer-stage__content">
        <div className="viewer-question-panel">
          {session.status === 'pending' || !session.current_round_id ? (
            <div className="viewer-empty-state">
              <Users className="mx-auto mb-5 h-12 w-12 text-cyan-300" />
              <p className="viewer-kicker">SẴN SÀNG</p>
              <h2>Trận đấu sẽ bắt đầu sau ít phút</h2>
              <p>Hãy cùng chờ các thí sinh bước vào sân thi đấu.</p>
            </div>
          ) : !currentQuestion ? (
            <div className="viewer-empty-state">
              <p className="viewer-kicker">ĐANG CHUẨN BỊ</p>
              <h2>Câu hỏi tiếp theo đang được thiết lập</h2>
              <p>Nội dung sẽ xuất hiện ngay khi MC mở câu hỏi.</p>
            </div>
          ) : (
            <>
              <div className="viewer-question-meta">
                <span>CÂU {currentQuestion.order_index ?? '—'}</span>
                <span className="viewer-timer">{timerLabel}</span>
              </div>
              <h2 className="viewer-question-text">
                {questionState === 'hidden' ? 'Câu hỏi đang được giữ kín' : currentQuestion.question_text ?? 'Đang cập nhật nội dung câu hỏi'}
              </h2>
              {questionState !== 'hidden' &&
              (currentQuestion.image_external_url || currentQuestion.image_path) ? (
                <img
                  className="viewer-question-media"
                  src={currentQuestion.image_external_url ?? currentQuestion.image_path ?? ''}
                  alt="Hình ảnh minh họa cho câu hỏi"
                />
              ) : null}
              {buzzerPlayer ? (
                <div className="viewer-buzzer">
                  <span>QUYỀN TRẢ LỜI</span>
                  <strong>{buzzerPlayer.display_name ?? `Thí sinh ${buzzerPlayer.seat_index}`}</strong>
                </div>
              ) : null}
              {publicAnswer?.answer_text ? (
                <div className="viewer-answer">
                  <span>ĐÁP ÁN</span>
                  <strong>{publicAnswer.answer_text}</strong>
                </div>
              ) : null}
            </>
          )}
        </div>

        <aside className="viewer-scoreboard">
          <div className="viewer-scoreboard__heading">
            <Trophy className="h-5 w-5 text-amber-300" />
            <span>BẢNG ĐIỂM</span>
          </div>
          {sortedPlayers.length === 0 ? (
            <p className="viewer-muted">Chưa có dữ liệu thí sinh.</p>
          ) : (
            sortedPlayers.map((player, index) => (
              <div key={player.id} className="viewer-score-row">
                <span className="viewer-rank">{index + 1}</span>
                <span className="viewer-player-name">{player.display_name ?? `Thí sinh ${player.seat_index}`}</span>
                <strong>{player.total}</strong>
              </div>
            ))
          )}
        </aside>
      </section>

      {statusMessage ? <p className="viewer-status">{statusMessage}</p> : null}
    </main>
  )
}
