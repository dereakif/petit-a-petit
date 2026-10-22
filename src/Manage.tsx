import { useRef, useState } from 'react'
import {
  createBackup,
  createLesson,
  parseBackup,
  parseLesson,
  previewLesson,
} from './data'
import type { AppData, Backup, LessonImport, Repository } from './data'
import type { AudioController } from './audio'
import { Icon } from './components'
import SharedLibraryPanel from './SharedLibraryPanel'
import type { PublishedLibrary } from './shared-library'

type Update = (
  action: (repo: Repository) => Promise<AppData>,
) => Promise<boolean>
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Manage({
  data,
  audio,
  update,
  onAdd,
  busy,
  published,
  onCheckShared,
  initialSharedOpen,
  onSharedClose,
}: {
  data: AppData
  audio: AudioController
  update: Update
  onAdd: () => void
  busy: boolean
  published: PublishedLibrary
  onCheckShared: () => Promise<unknown>
  initialSharedOpen: boolean
  onSharedClose: () => void
}) {
  const [text, setText] = useState('')
  const [lesson, setLesson] = useState<LessonImport | null>(null)
  const [backup, setBackup] = useState<Backup | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [policy, setPolicy] = useState<'skip' | 'update'>('skip')
  const [allowDuplicates, setAllowDuplicates] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const fileVersion = useRef(0)
  const lock = useRef(false)
  const [limit, setLimit] = useState(data.preferences.dailyNewLimit)
  const [rate, setRate] = useState(data.preferences.rate)
  const [voiceURI, setVoiceURI] = useState(data.preferences.voiceURI)
  const preview = lesson ? previewLesson(lesson, data.expressions) : null

  function reset() {
    fileVersion.current++
    setLesson(null)
    setBackup(null)
    setError('')
    setMessage('')
    setConfirmation('')
    setAllowDuplicates(false)
    setPolicy('skip')
  }
  function parse(value: string, restore = false) {
    reset()
    try {
      if (restore) setBackup(parseBackup(value))
      else setLesson(parseLesson(value))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This JSON could not be read.')
    }
  }
  async function readFile(file: File | undefined, restore = false) {
    if (!file) return
    reset()
    if (file.size > 10 * 1024 * 1024) {
      setError('Please select a JSON file smaller than 10 MB.')
      return
    }
    const version = fileVersion.current
    try {
      const contents = await file.text()
      if (version === fileVersion.current) parse(contents, restore)
    } catch {
      if (version === fileVersion.current)
        setError('Could not read this file. Please choose it again.')
    }
  }
  async function apply() {
    if (lock.current || !lesson) return
    lock.current = true
    const success = await update((repo) =>
      repo.applyLesson(lesson, policy, allowDuplicates),
    )
    lock.current = false
    if (success) {
      reset()
      setText('')
      setMessage('Lesson added. Existing review history was kept.')
    }
  }
  async function restore() {
    if (lock.current || !backup || confirmation !== 'REPLACE') return
    lock.current = true
    audio.stop()
    const success = await update((repo) => repo.restore(backup))
    lock.current = false
    if (success) {
      setLimit(backup.data.preferences.dailyNewLimit)
      setRate(backup.data.preferences.rate)
      setVoiceURI(backup.data.preferences.voiceURI)
      reset()
      setMessage(
        'Backup restored. Vocabulary, reviews, and preferences were replaced successfully.',
      )
    }
  }

  return (
    <div className="manage-layout">
      {error && (
        <p role="alert" className="error manage-feedback">
          {error} Your current data is unchanged.
        </p>
      )}
      {message && (
        <p role="status" className="success manage-feedback">
          {message}
        </p>
      )}
      <div className="manage-main">
        <SharedLibraryPanel
          data={data}
          published={published}
          update={(action) => {
            audio.stop()
            return update(action)
          }}
          onCheck={onCheckShared}
          busy={busy}
          initialOpen={initialSharedOpen}
          onClose={onSharedClose}
        />
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">GROW YOUR COLLECTION</span>
              <h2>Tomorrow’s words start here.</h2>
            </div>
            <Icon name="book" size={25} />
          </div>
          <p>
            Add one useful expression, or bring in a whole lesson from your
            tutor.
          </p>
          <div className="button-row">
            <button className="primary" onClick={onAdd}>
              <Icon name="plus" size={17} />
              Add an expression
            </button>
            <a
              className="secondary button-link"
              href={`${import.meta.env.BASE_URL}example-lesson.json`}
              download
            >
              Example lesson JSON ↓
            </a>
          </div>
        </section>
        <section className="panel" aria-labelledby="import-heading">
          <span className="eyebrow">LESSON IMPORT · VERSION 1</span>
          <h2 id="import-heading">A little more French.</h2>
          <p>
            Importing extends your library. You’ll preview additions and
            conflicts before anything changes.
          </p>
          <label className="file-label">
            Choose a lesson JSON file
            <input
              aria-label="Choose lesson JSON file"
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => {
                void readFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <div className="or-divider">
            <span>or paste from your tutor</span>
          </div>
          <label>
            Lesson JSON
            <textarea
              className="json-input"
              placeholder={
                '{ "kind": "petit-lesson", "version": 1, "expressions": […] }'
              }
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (lesson || backup) reset()
              }}
            />
          </label>
          <div className="button-row">
            <button
              className="secondary"
              disabled={!text.trim() || busy}
              onClick={() => parse(text)}
            >
              Validate & preview
            </button>
          </div>

          {preview && lesson && (
            <div className="import-preview" aria-label="Lesson import preview">
              <h3>Review this lesson</h3>
              <p>
                <strong>{preview.additions.length}</strong> additions ·{' '}
                <strong>{preview.updates.length}</strong> matching IDs ·{' '}
                <strong>{preview.duplicates.length}</strong> potential duplicate
                matches
              </p>
              <ul className="preview-list">
                {lesson.expressions.map((e) => (
                  <li key={e.id}>
                    <strong lang="fr">{e.french}</strong>
                    <span>
                      {data.expressions.some((old) => old.id === e.id)
                        ? 'Existing ID'
                        : 'New ID'}{' '}
                      · {e.id}
                    </span>
                  </li>
                ))}
              </ul>
              <label>
                When an ID already exists
                <select
                  value={policy}
                  onChange={(e) =>
                    setPolicy(e.target.value as 'skip' | 'update')
                  }
                >
                  <option value="skip">
                    Keep my version (skip existing IDs)
                  </option>
                  <option value="update">
                    Replace vocabulary with imported version
                  </option>
                </select>
              </label>
              <p className="small muted">
                Review progress is preserved with either choice. Stable IDs are
                the primary identity.
              </p>
              {preview.duplicates.length > 0 && (
                <div className="notice">
                  <h4>Same French, different IDs</h4>
                  <ul>
                    {preview.duplicates.map((d, i) => (
                      <li key={i}>
                        “{d.incoming.french}” ({d.incoming.id}) matches “
                        {d.existing.french}” ({d.existing.id}).
                      </li>
                    ))}
                  </ul>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={allowDuplicates}
                      onChange={(e) => setAllowDuplicates(e.target.checked)}
                    />
                    I understand these are separate expressions. Allow potential
                    duplicates.
                  </label>
                  <p className="small">
                    Duplicates are blocked unless you explicitly allow them.
                    Cancel to correct IDs in your lesson file.
                  </p>
                </div>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={
                    busy || (preview.duplicates.length > 0 && !allowDuplicates)
                  }
                  onClick={() => void apply()}
                >
                  {busy ? 'Applying…' : 'Apply lesson'}
                </button>
                <button className="secondary" onClick={reset}>
                  Cancel import
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="backup-heading">
          <span className="eyebrow">KEEP YOUR NOTEBOOK SAFE</span>
          <h2 id="backup-heading">Backups & portability</h2>
          <p>
            Your collection lives in this browser on this device. Mac and iPhone
            do not automatically sync. Browser storage can be cleared — keep a
            full backup somewhere safe.
          </p>
          <div className="backup-actions">
            <div>
              <h3>Vocabulary only</h3>
              <p>
                Share expressions or transfer a lesson. Does not include
                progress or settings.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  download(createLesson(data), 'petit-vocabulary.json')
                }
              >
                Export vocabulary ↓
              </button>
            </div>
            <div>
              <h3>Your whole notebook</h3>
              <p>
                Vocabulary, all three review histories, and preferences in one
                file.
              </p>
              <button
                className="primary"
                onClick={() =>
                  download(
                    createBackup(data),
                    `petit-backup-${new Date().toISOString().slice(0, 10)}.json`,
                  )
                }
              >
                Download full backup ↓
              </button>
            </div>
          </div>
          <details className="restore-details">
            <summary>Restore a full backup</summary>
            <p className="notice">
              Restore is a replacement, not a merge or automatic sync. It
              deletes this device’s current vocabulary, progress, and
              preferences and replaces them with the file’s contents. Export a
              backup of this device first.
            </p>
            <label className="file-label">
              Choose full backup JSON
              <input
                aria-label="Choose full backup JSON"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  void readFile(e.target.files?.[0], true)
                  e.target.value = ''
                }}
              />
            </label>
            {backup && (
              <div className="import-preview">
                <h3>Validated backup</h3>
                <p>Exported {new Date(backup.exportedAt).toLocaleString()}</p>
                <p>
                  {backup.data.expressions.length} expressions ·{' '}
                  {backup.data.reviews.length} mode-specific review records ·{' '}
                  {backup.data.reviews.reduce(
                    (n, r) => n + r.history.length,
                    0,
                  )}{' '}
                  ratings
                </p>
                <label>
                  Type REPLACE to confirm replacement
                  <input
                    autoComplete="off"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="primary danger-button"
                    disabled={confirmation !== 'REPLACE' || busy}
                    onClick={() => void restore()}
                  >
                    Replace with backup
                  </button>
                  <button className="secondary" onClick={reset}>
                    Cancel restore
                  </button>
                </div>
              </div>
            )}
          </details>
        </section>
      </div>
      <aside className="manage-aside">
        <section className="panel">
          <span className="eyebrow">LISTEN YOUR WAY</span>
          <h2>French audio</h2>
          <p>
            Only French voices are used. Voice availability, quality, and
            offline playback depend on your device and provider. Offline audio
            is not guaranteed.
          </p>
          {!audio.supported ? (
            <p className="notice">
              Speech synthesis is not supported in this browser. Recorded audio
              can still be played.
            </p>
          ) : audio.voices.length === 0 ? (
            <p role="status" className="notice">
              No French voices found yet. Enable or download a French voice in
              your device settings. This list updates when voices become
              available.
            </p>
          ) : null}
          <label>
            French voice
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
            >
              <option value="">Automatic · prefer fr-FR</option>
              {voiceURI &&
                !audio.voices.some((v) => v.voiceURI === voiceURI) && (
                  <option value={voiceURI}>Saved voice (unavailable)</option>
                )}
              {audio.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
          </label>
          <label>
            Normal speech speed
            <select
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              <option value={0.7}>Gentle · 0.7×</option>
              <option value={0.85}>Comfortable · 0.85×</option>
              <option value={1}>Natural · 1×</option>
              {![0.7, 0.85, 1].includes(rate) && (
                <option value={rate}>Custom · {rate}×</option>
              )}
            </select>
          </label>
          <p className="small muted">
            Slower playback uses 72% of your saved normal speed. Save changes
            before previewing.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await update((repo) =>
                  repo.savePreferences({ ...data.preferences, voiceURI, rate }),
                )
              ) {
                audio.stop()
                setMessage('Audio preferences saved.')
              }
            }}
          >
            Save audio preferences
          </button>
          <button
            className="text-button preview-voice"
            onClick={() =>
              audio.play(
                { french: 'Bonjour. Je voudrais un café, s’il vous plaît.' },
                false,
                true,
              )
            }
          >
            <Icon name="speaker" size={17} />
            Preview saved French voice
          </button>
          {audio.playing && (
            <button className="text-button" onClick={audio.stop}>
              Stop preview
            </button>
          )}
        </section>
        <section className="panel">
          <span className="eyebrow">SMALL, STEADY STEPS</span>
          <h2>Your daily pace</h2>
          <label>
            New expressions per day
            <input
              type="number"
              min={0}
              max={100}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            />
          </label>
          <p className="small muted">
            Default: 3 distinct expressions across all modes. Seeing a card
            doesn’t count; rating it does. Due reviews are never capped. Set to
            0 for reviews only.
          </p>
          <button
            className="secondary"
            disabled={
              busy || !Number.isInteger(limit) || limit < 0 || limit > 100
            }
            onClick={async () => {
              if (
                await update((repo) =>
                  repo.savePreferences({
                    ...data.preferences,
                    dailyNewLimit: limit,
                  }),
                )
              )
                setMessage('Daily pace saved.')
            }}
          >
            Save daily pace
          </button>
        </section>
        <section className="help-note">
          <h3>Tomorrow, with your tutor</h3>
          <p>
            Download the example lesson. Ask your tutor to use its format with
            new stable IDs and the next lesson number. Paste or upload their
            JSON, check the preview, then apply. Your current collection and
            progress stay with you.
          </p>
          <details>
            <summary>Pronunciation & review help</summary>
            <p>
              Guides are approximations. Nasal vowels do not end with a strong
              English or Turkish “n.” English “ay” should not create a strong
              glide. French “r” differs from both languages. In English guides,
              “ü” is like Turkish “ü.” Capitals are reading aids, not strong
              English word stress.
            </p>
            <p>
              Again: 1 minute. Hard: at least 1 day, then ×1.2. Good: at least 1
              day, then ×2. Easy: at least 3 days, then ×3. Each mode has its
              own schedule. Again cards can return in the session. Extra
              practice never changes schedules.
            </p>
          </details>
        </section>
      </aside>
    </div>
  )
}
