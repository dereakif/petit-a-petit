import { useEffect, useId, useRef, useState } from 'react'
import { buildQueue } from './data'
import type { AppData, Expression, Mode, Rating } from './data'
import { getRecordings } from './audio'
import type { AudioController } from './audio'
import { Answer, AudioControls, Icon } from './components'

type PracticeProps = {
  data: AppData
  audio: AudioController
  onRate: (id: string, mode: Mode, rating: Rating) => Promise<boolean>
  busy: boolean
}

type Session = {
  id: number
  mode: Mode
  extra: boolean
  status: 'active' | 'complete' | 'ended' | 'empty'
  queue: Expression[]
  initialCount: number
  turn: number
  rated: number
  again: number
  skipped: number
  notice: string
}

const modes: { value: Mode; label: string; instruction: string }[] = [
  {
    value: 'speaking',
    label: 'Speaking',
    instruction:
      'Use the situation and English cue to say the expression in French.',
  },
  {
    value: 'listening',
    label: 'Listening',
    instruction:
      'Play the French audio and recall what it means before revealing the answer.',
  },
  {
    value: 'reading',
    label: 'Reading',
    instruction:
      'Read the French expression and recall its meaning before revealing the answer.',
  },
]

const ratings: { value: Rating; label: string; description: string }[] = [
  { value: 'again', label: 'Again', description: 'I need another try' },
  {
    value: 'hard',
    label: 'Hard',
    description: 'I recalled it with difficulty',
  },
  { value: 'good', label: 'Good', description: 'I recalled it' },
  { value: 'easy', label: 'Easy', description: 'I recalled it easily' },
]

function PracticeCard({
  expression,
  mode,
  audio,
  disabled,
  saving,
  error,
  onRate,
  onSkip,
}: {
  expression: Expression
  mode: Mode
  audio: AudioController
  disabled: boolean
  saving: boolean
  error: string
  onRate: (rating: Rating) => void
  onSkip: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [attemptedAudio, setAttemptedAudio] = useState(false)
  const answerHeading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const answerId = useId()
  const hasFrenchVoice =
    audio.supported &&
    !!audio.selected &&
    /^fr(?:[-_]|$)/i.test(audio.selected.lang)
  const hasAudio = getRecordings(expression).length > 0 || hasFrenchVoice
  // stop() does not clear the controller's error, so ignore errors from earlier cards.
  const playbackFailed = attemptedAudio && !!audio.error
  const listeningBlocked = mode === 'listening' && (!hasAudio || playbackFailed)
  const waitingForAudio = mode === 'listening' && audio.playing
  const listeningAudio: AudioController = {
    ...audio,
    play: (item, slow, synthesized, recordingVoice) => {
      if (disabled) return
      setAttemptedAudio(true)
      audio.play(item, slow, synthesized, recordingVoice)
    },
  }

  useEffect(() => {
    if (revealed) answerHeading.current?.focus()
  }, [revealed])

  return (
    <article
      className="practice-card"
      aria-labelledby={headingId}
      aria-busy={saving}
    >
      <h2 id={headingId}>
        {mode === 'speaking'
          ? 'Say it in French'
          : mode === 'listening'
            ? 'Listen and recall'
            : 'Read and understand'}
      </h2>
      <p className="muted">
        {modes.find((item) => item.value === mode)!.instruction}
      </p>

      {mode === 'speaking' && (
        <div className="practice-cue">
          <p className="eyebrow">SITUATION</p>
          <p>{expression.situation}</p>
          <p className="eyebrow">ENGLISH CUE</p>
          <p lang="en">{expression.english}</p>
        </div>
      )}

      {mode === 'reading' && (
        <p className="practice-french" lang="fr">
          {expression.french}
        </p>
      )}

      {mode === 'listening' && (
        <div className="practice-listening">
          {hasAudio ? (
            <AudioControls
              expression={expression}
              audio={listeningAudio}
              listening
            />
          ) : (
            <p role="status" className="practice-audio-unavailable">
              This card has no recording and no French voice is available on
              this device. Enable a French voice in your device settings, or
              skip this card without changing your progress.
            </p>
          )}
          {audio.voiceWarning && <p className="muted">{audio.voiceWarning}</p>}
          {hasAudio && !hasFrenchVoice && (
            <p className="muted">
              No French device voice is available. Use this card’s recording.
            </p>
          )}
          {playbackFailed && (
            <p role="alert" className="error">
              French audio could not play. Try again, use French speech if
              available, or skip this card. Skipping does not change your
              progress.
            </p>
          )}
          {!revealed && hasAudio && !attemptedAudio && (
            <p className="muted">
              Play the audio first. The French text and meaning stay hidden
              until you reveal them.
            </p>
          )}
          {waitingForAudio && (
            <p role="status" className="muted">
              Listen to the audio, then reveal or rate your answer when playback
              finishes.
            </p>
          )}
        </div>
      )}

      {!revealed ? (
        <button
          type="button"
          className="primary practice-reveal"
          disabled={
            disabled ||
            listeningBlocked ||
            waitingForAudio ||
            (mode === 'listening' && !attemptedAudio)
          }
          onClick={() => {
            if (!disabled && !listeningBlocked && !waitingForAudio)
              setRevealed(true)
          }}
        >
          Reveal answer
        </button>
      ) : (
        <section className="practice-answer" aria-labelledby={answerId}>
          <h3 id={answerId} ref={answerHeading} tabIndex={-1}>
            {mode === 'reading' ? (
              'Meaning and pronunciation'
            ) : (
              <span lang="fr">{expression.french}</span>
            )}
          </h3>
          <Answer
            expression={expression}
            audio={mode === 'listening' ? listeningAudio : audio}
            includeAudio={mode !== 'listening'}
          />
          {mode !== 'listening' && audio.error && (
            <p role="alert" className="error">
              {audio.error}
            </p>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {revealed && !listeningBlocked && (
        <div className="practice-rating">
          <p className="eyebrow">HOW DID YOU DO?</p>
          <div
            className="button-row"
            role="group"
            aria-label="Rate your recall"
          >
            {ratings.map((rating) => (
              <button
                type="button"
                className="secondary practice-rating-button"
                key={rating.value}
                disabled={disabled || waitingForAudio}
                onClick={() => {
                  if (
                    revealed &&
                    !disabled &&
                    !listeningBlocked &&
                    !waitingForAudio
                  )
                    onRate(rating.value)
                }}
              >
                <span>{rating.label}</span>{' '}
                <span className="practice-rating-description">
                  {rating.description}
                </span>
              </button>
            ))}
          </div>
          <p className="muted">
            Again brings this card back after the other cards. If it is the last
            card, your next turn is another try.
          </p>
        </div>
      )}
      {saving && (
        <p role="status" className="muted">
          Saving your rating…
        </p>
      )}
      <button
        type="button"
        className="text-button practice-skip"
        disabled={disabled}
        onClick={onSkip}
      >
        Skip card without rating
      </button>
    </article>
  )
}

export default function Practice({ data, audio, onRate, busy }: PracticeProps) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const sequence = useRef(0)
  const mounted = useRef(true)
  const sessionHeading = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const stopAudio = audio.stop
  const disabled = busy || saving
  const active = session?.status === 'active'
  const eligibleCount = mode && !active ? buildQueue(data, mode).length : 0

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      stopAudio()
    }
  }, [stopAudio])

  // Keep the synchronous action lock until the new turn has actually committed.
  useEffect(() => {
    lock.current = false
  }, [session?.id, session?.turn, session?.status, mode])

  useEffect(() => {
    sessionHeading.current?.focus()
  }, [session?.id, session?.turn, session?.status])

  function changeMode(next: Mode) {
    if (disabled || lock.current || next === mode) return
    audio.stop()
    sequence.current++
    setMode(next)
    setSession(null)
    setError('')
  }

  function start(extra: boolean) {
    if (!mode || disabled || lock.current || active) return
    lock.current = true
    audio.stop()
    // Re-evaluate time and parent data here, not from a possibly stale setup preview.
    const queue = buildQueue(data, mode, new Date(), extra)
    setSession({
      id: ++sequence.current,
      mode,
      extra,
      queue,
      initialCount: queue.length,
      status: queue.length ? 'active' : 'empty',
      turn: 0,
      rated: 0,
      again: 0,
      skipped: 0,
      notice: '',
    })
    setError('')
  }

  function skip() {
    if (!session || !active || disabled || lock.current) return
    lock.current = true
    audio.stop()
    const queue = session.queue.slice(1)
    setSession({
      ...session,
      queue,
      turn: session.turn + 1,
      skipped: session.skipped + 1,
      status: queue.length ? 'active' : 'complete',
      notice: 'Card skipped. No rating or progress change was recorded for it.',
    })
    setError('')
  }

  async function rate(rating: Rating) {
    if (!session || !active || disabled || lock.current) return
    const expression = session.queue[0]
    if (!expression) return
    lock.current = true
    setError('')
    audio.stop()
    if (!session.extra) {
      setSaving(true)
      try {
        const success = await onRate(expression.id, session.mode, rating)
        if (!mounted.current || sequence.current !== session.id) return
        if (!success) {
          setError(
            'Your rating could not be saved. Your revealed card has been kept; please try rating it again.',
          )
          setSaving(false)
          lock.current = false
          return
        }
      } catch {
        if (!mounted.current || sequence.current !== session.id) return
        setError(
          'Your rating could not be saved. Your revealed card has been kept; please try rating it again.',
        )
        setSaving(false)
        lock.current = false
        return
      }
    }
    audio.stop()
    const queue = session.queue.slice(1)
    if (rating === 'again') queue.push(expression)
    setSession({
      ...session,
      queue,
      turn: session.turn + 1,
      rated: session.rated + 1,
      again: session.again + (rating === 'again' ? 1 : 0),
      status: queue.length ? 'active' : 'complete',
      notice:
        rating === 'again'
          ? queue.length === 1
            ? 'Again: this is the only card left. It is back for another try; reveal it again when you are ready.'
            : 'Again: this card will return after the other cards in the queue.'
          : '',
    })
    setSaving(false)
  }

  function end() {
    if (!session || !active || disabled || lock.current) return
    lock.current = true
    audio.stop()
    setSession({ ...session, status: 'ended' })
    setError('')
  }

  return (
    <section className="panel practice-panel" aria-labelledby={headingId}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">A LITTLE, EVERY DAY</span>
          <h1 id={headingId}>Practice</h1>
        </div>
        {active && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={end}
          >
            End session
          </button>
        )}
      </div>

      <div
        className="button-row practice-modes"
        role="group"
        aria-label="Practice mode"
      >
        {modes.map((item) => (
          <button
            type="button"
            key={item.value}
            className={mode === item.value ? 'primary' : 'secondary'}
            aria-pressed={mode === item.value}
            disabled={disabled}
            onClick={() => changeMode(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {active && (
        <p className="muted">
          Changing mode ends this session and clears its queue. Saved ratings
          are kept.
        </p>
      )}

      {active && session && (
        <>
          <h2
            className="practice-session-heading"
            ref={sessionHeading}
            tabIndex={-1}
          >
            {session.extra ? 'Extra practice' : 'Due session'} ·{' '}
            {modes.find((item) => item.value === session.mode)!.label} · Turn{' '}
            {session.turn + 1}
          </h2>
          <p className="muted">
            {session.queue.length}{' '}
            {session.queue.length === 1 ? 'card' : 'cards'} in the queue,
            including this one. Started with {session.initialCount}.
          </p>
          {session.extra && (
            <p className="practice-extra-notice">
              Extra practice only: ratings count toward this session’s summary,
              but do not change your saved progress, review schedule, or daily
              new-expression count.
            </p>
          )}
          {session.notice && (
            <p role="status" className="practice-notice">
              {session.notice}
            </p>
          )}
          <PracticeCard
            key={`${session.id}-${session.turn}`}
            expression={session.queue[0]!}
            mode={session.mode}
            audio={audio}
            disabled={disabled}
            saving={saving}
            error={error}
            onRate={(rating) => {
              void rate(rating)
            }}
            onSkip={skip}
          />
        </>
      )}

      {session &&
        (session.status === 'complete' || session.status === 'ended') && (
          <section
            className="practice-summary"
            aria-labelledby={`${headingId}-summary`}
          >
            <h2 id={`${headingId}-summary`} ref={sessionHeading} tabIndex={-1}>
              {session.status === 'ended'
                ? 'Session ended'
                : 'Session complete'}
            </h2>
            <p>
              {modes.find((item) => item.value === session.mode)!.label} ·{' '}
              {session.extra ? 'Extra practice' : 'Due session'}
            </p>
            <dl className="practice-summary-counts">
              <div>
                <dt>Ratings {session.extra ? '(practice only)' : 'saved'}</dt>
                <dd>{session.rated}</dd>
              </div>
              <div>
                <dt>Again ratings (included above)</dt>
                <dd>{session.again}</dd>
              </div>
              <div>
                <dt>Cards skipped without rating</dt>
                <dd>{session.skipped}</dd>
              </div>
            </dl>
            {session.status === 'ended' && (
              <p className="muted">
                {session.queue.length}{' '}
                {session.queue.length === 1 ? 'card was' : 'cards were'} still
                in this session’s queue.
              </p>
            )}
            <p className="muted">
              {session.extra
                ? 'These were practice-only ratings. No saved progress, review schedule, or daily new-expression count was changed.'
                : 'Only successfully saved ratings changed your progress. Skipped and unattempted cards were not rated.'}
            </p>
          </section>
        )}

      {!active && (
        <div className="practice-setup">
          {!mode ? (
            <p className="muted">
              Choose speaking, listening, or reading, then start a session when
              you are ready.
            </p>
          ) : (
            <>
              {session?.status === 'empty' && (
                <h2 ref={sessionHeading} tabIndex={-1}>
                  {data.expressions.length
                    ? 'Nothing due right now'
                    : 'No expressions to practice yet'}
                </h2>
              )}
              {!data.expressions.length ? (
                <p className="muted">
                  Add or import some expressions before starting practice.
                </p>
              ) : (
                <>
                  <p>
                    {modes.find((item) => item.value === mode)!.instruction}
                  </p>
                  {eligibleCount ? (
                    <p className="muted">
                      {eligibleCount}{' '}
                      {eligibleCount === 1 ? 'card is' : 'cards are'} eligible
                      now. Due reviews come first, then new expressions within
                      your daily limit of {data.preferences.dailyNewLimit}.
                    </p>
                  ) : (
                    <p className="muted">
                      Nothing is due right now, and no new expressions are
                      eligible within your daily limit. You can check again or
                      do extra practice.
                    </p>
                  )}
                  <p className="muted">
                    Each start checks what is due at that moment. Extra practice
                    includes expressions outside the due queue and never changes
                    saved progress.
                  </p>
                </>
              )}
              <div className="button-row practice-start">
                <button
                  type="button"
                  className="primary"
                  disabled={disabled || !data.expressions.length}
                  onClick={() => start(false)}
                >
                  {session?.status === 'empty'
                    ? 'Check due cards and start'
                    : 'Start due session'}
                  <Icon name="arrow" size={17} />
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled || !data.expressions.length}
                  onClick={() => start(true)}
                >
                  Start extra practice
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
