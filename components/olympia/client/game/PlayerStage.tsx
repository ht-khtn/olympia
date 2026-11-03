'use client'

import { useEffect, useMemo, useState } from 'react'
import { useActionState } from 'react'
import { AlertCircle, Bell, CheckCircle2, Clock3, Wifi, WifiOff } from 'lucide-react'
import { submitAnswerAction, triggerBuzzerAction, type ActionState } from '@/app/(olympia)/olympia/actions'
import { useOlympiaGameState } from '@/components/olympia/shared/game/useOlympiaGameState'
import type { GameSessionPayload, RoundQuestionRow } from '@/types/olympia/game'

type PlayerStageProps = {
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
  hidden: 'Đang chờ MC mở câu hỏi',
  showing: 'Đang thi',
  answer_revealed: 'Đã công bố đáp án',
  completed: 'Câu hỏi đã hoàn tất',
}

const initialActionState: ActionState = { error: null, success: null }

function findCurrentQuestion(
  questions: RoundQuestionRow[],
  questionId: string | null
): RoundQuestionRow | null {
  return questionId ? questions.find((question) => question.id === questionId) ?? null : null
}

export function PlayerStage({ initialData, sessionId }: PlayerStageProps) {
  const [answer, setAnswer] = useState('')
  const [answerSentForQuestion, setAnswerSentForQuestion] = useState<string | null>(null)
  const [answerState, answerAction] = useActionState(submitAnswerAction, initialActionState)
  const [buzzerState, buzzerAction] = useActionState(triggerBuzzerAction, initialActionState)
  const {
    match,
    session,
    players,
    roundQuestions,
    answers,
    buzzerEvents,
    questionState,
    roundType,
    timerLabel,
    isRealtimeReady,
    statusMessage,
    viewerUserId,
    refreshFromServer,
  } = useOlympiaGameState({
    sessionId,
    initialData,
    viewerMode: 'player',
  })

  const player = players.find((candidate) => candidate.participant_id === viewerUserId) ?? null
  const currentQuestion = useMemo(
    () => findCurrentQuestion(roundQuestions, session.current_round_question_id),
    [roundQuestions, session.current_round_question_id]
  )
  const currentQuestionId = currentQuestion?.id ?? null
  const currentAnswer = currentQuestionId
    ? answers.find((item) => item.round_question_id === currentQuestionId && item.player_id === player?.id)
    : null
  const currentBuzzer = currentQuestionId
    ? buzzerEvents.find(
        (event) =>
          event.round_question_id === currentQuestionId &&
          event.player_id === player?.id &&
          event.result === 'win'
      )
    : null
  const currentWinner = currentQuestionId
    ? buzzerEvents.find(
        (event) => event.round_question_id === currentQuestionId && event.result === 'win'
      )
    : null
  const isStealWindow = roundType === 've_dich' && questionState === 'answer_revealed'
  const isWaitingScreen = questionState === 'hidden'
  const questionCode = useMemo(() => {
    const raw = currentQuestion?.meta?.code
    return typeof raw === 'string' ? raw.trim().toUpperCase() : null
  }, [currentQuestion?.meta])
  const isCnvQuestion = questionCode?.startsWith('CNV') === true && !questionCode.startsWith('VCNV')
  const isTarget =
    !currentQuestion?.target_player_id || currentQuestion.target_player_id === player?.id
  const canAnswer =
    session.status === 'running' &&
    questionState === 'showing' &&
    Boolean(currentQuestionId && player) &&
    roundType !== 'khoi_dong' &&
    roundType !== 've_dich' &&
    !isCnvQuestion &&
    isTarget &&
    !player?.is_disqualified_obstacle &&
    !currentAnswer &&
    answerSentForQuestion !== currentQuestionId
  const canBuzz =
    session.status === 'running' &&
    session.buzzer_enabled !== false &&
    Boolean(player) &&
    !player?.is_disqualified_obstacle &&
    (questionState === 'showing' || isStealWindow || (isWaitingScreen && roundType !== 've_dich')) &&
    (!isStealWindow || !currentQuestion?.target_player_id || currentQuestion.target_player_id !== player?.id) &&
    !currentBuzzer
  const publicAnswer =
    questionState === 'answer_revealed' || questionState === 'completed'
      ? currentQuestion?.answer_text
      : null
  const feedback = answerState.error ?? answerState.success ?? buzzerState.error ?? buzzerState.success
  const feedbackIsError = Boolean(answerState.error ?? buzzerState.error)
  const displayName = player?.display_name ?? 'Thí sinh'

  useEffect(() => {
    setAnswer('')
    setAnswerSentForQuestion(null)
  }, [currentQuestionId])

  useEffect(() => {
    if (answerState.error) setAnswerSentForQuestion(null)
  }, [answerState.error])

  function handleAnswerSubmit() {
    if (currentQuestionId) setAnswerSentForQuestion(currentQuestionId)
  }

  return (
    <main className="player-stage">
      <header className="player-stage__header">
        <div className="min-w-0">
          <p className="player-kicker">OLYMPIA · THÍ SINH</p>
          <h1 className="player-match-name">{match.name}</h1>
        </div>
        <div className="player-connection">
          {isRealtimeReady ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {isRealtimeReady ? 'Đã kết nối' : 'Đang kết nối'}
        </div>
      </header>

      <section className="player-identity">
        <div>
          <span className="player-label">THÍ SINH</span>
          <strong>{displayName}</strong>
        </div>
        <div>
          <span className="player-label">GHẾ</span>
          <strong>{player?.seat_index ?? '—'}</strong>
        </div>
        <div>
          <span className="player-label">VÒNG THI</span>
          <strong>{roundLabels[roundType] ?? 'Chưa bắt đầu'}</strong>
        </div>
        <div className="player-timer">
          <Clock3 className="h-5 w-5" />
          <strong>{timerLabel}</strong>
        </div>
      </section>

      {session.status !== 'running' ? (
        <section className="player-card player-waiting">
          <p className="player-kicker">TRẠNG THÁI PHÒNG</p>
          <h2>{session.status === 'ended' ? 'Trận đấu đã kết thúc' : 'Đang chờ trận đấu bắt đầu'}</h2>
          <p>Hãy giữ màn hình mở. MC sẽ bắt đầu trận khi tất cả đã sẵn sàng.</p>
        </section>
      ) : !currentQuestion ? (
        <section className="player-card player-waiting">
          <p className="player-kicker">SẴN SÀNG</p>
          <h2>Chờ MC chọn câu hỏi</h2>
          <p>Bạn sẽ nhận được câu hỏi và đồng hồ ngay khi lượt thi bắt đầu.</p>
        </section>
      ) : (
        <section className="player-card player-question-card">
          <div className="player-question-topline">
            <span className="player-kicker">CÂU {currentQuestion.order_index ?? '—'}</span>
            <span className="player-state">{stateLabels[questionState] ?? questionState}</span>
          </div>
          <h2 className="player-question">
            {questionState === 'hidden'
              ? 'Câu hỏi đang được giữ kín'
              : currentQuestion.question_text ?? 'Đang chờ nội dung câu hỏi'}
          </h2>
          {questionState !== 'hidden' &&
          (currentQuestion.image_external_url || currentQuestion.image_path) ? (
            <img
              className="player-question-media"
              src={currentQuestion.image_external_url ?? currentQuestion.image_path ?? ''}
              alt="Hình ảnh câu hỏi"
            />
          ) : null}
          {publicAnswer ? (
            <div className="player-result player-result--answer">
              <span>ĐÁP ÁN ĐƯỢC CÔNG BỐ</span>
              <strong>{publicAnswer}</strong>
            </div>
          ) : null}
        </section>
      )}

      <section className="player-actions">
        <div className="player-card player-answer-card">
          <div>
            <p className="player-kicker">TRẢ LỜI</p>
            <h2>{currentAnswer ? 'Bạn đã gửi câu trả lời' : 'Nhập câu trả lời của bạn'}</h2>
          </div>
          {roundType === 'khoi_dong' || roundType === 've_dich' || isCnvQuestion ? (
            <p className="player-muted">
              {isCnvQuestion
                ? 'Câu chướng ngại vật được MC xác nhận theo luật của vòng thi.'
                : 'Vòng này không nhận câu trả lời bằng ô nhập trên thiết bị.'}
            </p>
          ) : (
            <form
              action={answerAction}
              className="player-answer-form"
              onSubmit={handleAnswerSubmit}
            >
              <input type="hidden" name="sessionId" value={session.id} />
              <input
                name="answer"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                disabled={!canAnswer}
                placeholder={canAnswer ? 'Nhập đáp án…' : 'Chưa đến lượt trả lời'}
                autoComplete="off"
                className="player-answer-input"
              />
              <button type="submit" disabled={!canAnswer || !answer.trim()} className="player-submit-button">
                Gửi đáp án
              </button>
            </form>
          )}
          {currentAnswer ? (
            <div className="player-result player-result--sent">
              <CheckCircle2 className="h-5 w-5" />
              <span>Đã gửi. Đang chờ MC xử lý.</span>
            </div>
          ) : null}
        </div>

        <div className="player-card player-buzzer-card">
          <div>
            <p className="player-kicker">QUYỀN TRẢ LỜI</p>
            <h2>{currentWinner ? 'Đã có người giành quyền' : 'Sẵn sàng bấm chuông?'}</h2>
            {currentWinner ? (
              <p className="player-muted">
                {currentWinner.player_id === player?.id
                  ? 'Bạn đã giành quyền trả lời.'
                  : 'Hệ thống đã ghi nhận người bấm nhanh nhất.'}
              </p>
            ) : null}
          </div>
          <form action={buzzerAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            {isWaitingScreen ? <input type="hidden" name="trial" value="1" /> : null}
            <button type="submit" disabled={!canBuzz} className="player-buzzer-button">
              <Bell className="h-8 w-8" />
              <span>{canBuzz ? 'BẤM CHUÔNG' : 'CHƯA THỂ BẤM'}</span>
            </button>
          </form>
        </div>
      </section>

      {feedback ? (
        <div className={`player-feedback ${feedbackIsError ? 'player-feedback--error' : 'player-feedback--success'}`}>
          {feedbackIsError ? <AlertCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          <span>{feedback}</span>
        </div>
      ) : null}
      {statusMessage ? <p className="player-status">{statusMessage}</p> : null}
      <button type="button" className="player-refresh" onClick={refreshFromServer}>
        Đồng bộ lại trạng thái
      </button>
    </main>
  )
}
