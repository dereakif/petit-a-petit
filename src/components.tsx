import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Expression } from './data'
import { getRecordings } from './audio'
import type { AudioController, RecordingVoice } from './audio'

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    book: (
      <>
        <path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" />
        <path d="M12 5v15" />
      </>
    ),
    cards: (
      <>
        <rect x="6" y="7" width="15" height="14" rx="2" />
        <path d="m16 3-12 1a2 2 0 0 0-2 2l1 11M11 14l2 2 4-4" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    speaker: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C7 1 2 8 6 15s16 5 14-12Z" />
        <path d="M3 21 15 9" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.book}
    </svg>
  )
}

export function AudioControls({
  expression,
  audio,
  listening = false,
}: {
  expression: Expression
  audio: AudioController
  listening?: boolean
}) {
  const recordings = getRecordings(expression)
  const [voice, setVoice] = useState<RecordingVoice | undefined>(undefined)
  const selectedRecording =
    recordings.find((item) => item.voice === voice) ?? recordings[0]
  const selectorId = useId()
  return (
    <div className="audio-block">
      {selectedRecording && (
        <div className="recording-selector">
          <label htmlFor={selectorId}>Recording</label>
          <select
            id={selectorId}
            aria-label="Recording voice"
            value={selectedRecording.voice}
            onChange={(event) => {
              audio.stop()
              setVoice(event.target.value as RecordingVoice)
            }}
          >
            {recordings.map((item) => (
              <option key={item.voice} value={item.voice}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="audio-buttons">
        <button
          className="audio-button"
          onClick={() =>
            audio.play(expression, false, false, selectedRecording?.voice)
          }
          aria-label={
            listening ? 'Play French audio' : `Listen to ${expression.french}`
          }
        >
          <Icon name="speaker" size={17} />
          {listening ? 'Play French' : 'Listen'}
        </button>
        <button
          className="text-button slow-button"
          onClick={() =>
            audio.play(expression, true, false, selectedRecording?.voice)
          }
        >
          Slower <span aria-hidden="true">↘</span>
        </button>
        {audio.playing && (
          <button className="text-button" onClick={audio.stop}>
            Stop
          </button>
        )}
      </div>
      {recordings.length > 0 && (
        <button
          className="text-button fallback"
          onClick={() => audio.play(expression, false, true)}
        >
          Use French speech instead of recording
        </button>
      )}
    </div>
  )
}

export function Answer({
  expression: e,
  audio,
  includeAudio = true,
}: {
  expression: Expression
  audio: AudioController
  includeAudio?: boolean
}) {
  return (
    <div className="answer-content">
      <div className="answer-meanings">
        <p>
          <span className="field-label">ENGLISH</span>
          {e.english}
        </p>
        <p lang="tr">
          <span className="field-label">TURKISH</span>
          {e.turkish}
        </p>
      </div>
      <div className="pronunciation">
        <span className="field-label">APPROXIMATE PRONUNCIATION</span>
        <p>
          <span>EN</span> {e.pronunciationEn}
        </p>
        <p lang="tr">
          <span>TR</span> {e.pronunciationTr}
        </p>
      </div>
      <p className="usage">{e.situation}</p>
      {e.pronunciationNote && <p className="note">{e.pronunciationNote}</p>}
      {includeAudio && <AudioControls expression={e} audio={audio} />}
    </div>
  )
}

export function ConfirmDelete({
  expression,
  busy,
  onCancel,
  onDelete,
}: {
  expression: Expression
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    element?.showModal()
    return () => {
      element?.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      className="confirm-dialog panel"
      aria-labelledby="delete-title"
      aria-describedby="delete-description"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        )
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (!first || !last) {
          event.preventDefault()
          return
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
    >
      <h2 id="delete-title">Delete “{expression.french}”?</h2>
      <p id="delete-description">
        This removes the expression and its review history in all modes. It
        won’t return on reload. Export a backup first if you may want it back.
      </p>
      <div className="button-row">
        <button
          className="secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          Keep expression
        </button>
        <button
          className="primary danger-button"
          disabled={busy}
          onClick={onDelete}
        >
          Delete permanently
        </button>
      </div>
    </dialog>
  )
}

export function ExpressionForm({
  expression,
  onSave,
  onCancel,
  busy,
}: {
  expression?: Expression
  onSave: (e: Expression) => Promise<boolean>
  onCancel: () => void
  busy: boolean
}) {
  const form = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const text = (key: string) => String(fields.get(key) ?? '').trim()
    const now = new Date().toISOString()
    const result: Expression = {
      id: expression?.id ?? crypto.randomUUID(),
      french: text('french'),
      english: text('english'),
      turkish: text('turkish'),
      pronunciationEn: text('pronunciationEn'),
      pronunciationTr: text('pronunciationTr'),
      situation: text('situation'),
      category: text('category'),
      tags: text('tags')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      lesson: Number(text('lesson')),
      createdAt: expression?.createdAt ?? now,
      updatedAt: new Date(
        Math.max(Date.parse(now), Date.parse(expression?.updatedAt ?? now)),
      ).toISOString(),
      ...(text('pronunciationNote')
        ? { pronunciationNote: text('pronunciationNote') }
        : {}),
      ...(text('audioUrl') ? { audioUrl: text('audioUrl') } : {}),
      ...(text('femaleAudioUrl')
        ? { femaleAudioUrl: text('femaleAudioUrl') }
        : {}),
      ...(text('maleAudioUrl') ? { maleAudioUrl: text('maleAudioUrl') } : {}),
    }
    if (!(await onSave(result)))
      setError(
        'Could not save. Check the error message above and try again; your form has been kept.',
      )
  }
  const input = (
    name: keyof Expression,
    label: string,
    optional = false,
    type = 'text',
  ) => (
    <label>
      {label}
      {optional && <span className="optional"> · optional</span>}
      <input
        name={name}
        defaultValue={String(
          expression?.[name] ?? (name === 'lesson' ? 1 : ''),
        )}
        required={!optional}
        autoFocus={name === 'french'}
        type={type}
        min={type === 'number' ? 1 : undefined}
        maxLength={type === 'url' ? 2048 : 1000}
        lang={name === 'french' ? 'fr' : undefined}
      />
    </label>
  )
  return (
    <section className="panel form-panel" aria-labelledby="form-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR OWN WORDS</span>
          <h2 id="form-heading">
            {expression ? 'Edit expression' : 'Add an expression'}
          </h2>
        </div>
        <button
          className="icon-button"
          onClick={onCancel}
          aria-label="Close expression form"
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="muted">
        Keep the original French separate from your pronunciation memory aids.
      </p>
      <form ref={form} onSubmit={submit} className="expression-form">
        {input('french', 'French expression')}
        {input('english', 'English meaning')}
        {input('turkish', 'Turkish meaning')}
        <div className="form-grid">
          {input('pronunciationEn', 'English approximation')}
          {input('pronunciationTr', 'Turkish approximation')}
        </div>
        {input('situation', 'When would you use it?')}
        <label>
          Pronunciation note <span className="optional">· optional</span>
          <textarea
            name="pronunciationNote"
            rows={3}
            maxLength={5000}
            defaultValue={expression?.pronunciationNote}
          />
        </label>
        <div className="form-grid">
          {input('category', 'Category')}
          {input('lesson', 'Lesson number', false, 'number')}
        </div>
        <label>
          Tags <span className="optional">· optional, separated by commas</span>
          <input
            name="tags"
            defaultValue={expression?.tags.join(', ')}
            maxLength={1000}
          />
        </label>
        <fieldset className="recording-fields">
          <legend>Recorded French audio</legend>
          <p className="small muted">
            Add either or both voice recordings if you find them. These labels
            describe the recordings you supply, not browser-generated voices.
          </p>
          {input(
            'femaleAudioUrl',
            'Female voice audio URL (HTTP/HTTPS)',
            true,
            'url',
          )}
          {input(
            'maleAudioUrl',
            'Male voice audio URL (HTTP/HTTPS)',
            true,
            'url',
          )}
          {input('audioUrl', 'Recorded audio URL (HTTP/HTTPS)', true, 'url')}
          <p className="small muted">
            The general recording field keeps any existing URL. Without one,
            Listen starts with the female recording, then male. Use Notes &
            audio to choose a recording.
          </p>
        </fieldset>
        <p className="small muted">
          Remote recordings contact the URL’s provider and may require an
          internet connection.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save expression'}
            <Icon name="check" size={17} />
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}
