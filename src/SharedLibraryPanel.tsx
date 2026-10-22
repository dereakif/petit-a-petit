import { useRef, useState } from 'react'
import { createSharedLibrary, previewSharedLibrary } from './data'
import type {
  AppData,
  Expression,
  Repository,
  SharedLibraryChoice,
  SharedLibraryPreview,
} from './data'
import type { PublishedLibrary } from './shared-library'
import { Icon } from './components'

type Update = (
  action: (repository: Repository) => Promise<AppData>,
) => Promise<boolean>

function Comparison({
  expression,
  label,
}: {
  expression: Expression
  label: string
}) {
  return (
    <div className="shared-comparison">
      <h4>{label}</h4>
      <dl>
        <dt>French</dt>
        <dd lang="fr">{expression.french}</dd>
        <dt>Turkish meaning</dt>
        <dd lang="tr">{expression.turkish}</dd>
        <dt>English meaning</dt>
        <dd>{expression.english}</dd>
        <dt>Turkish approximation</dt>
        <dd lang="tr">{expression.pronunciationTr}</dd>
        <dt>English approximation</dt>
        <dd>{expression.pronunciationEn}</dd>
        <dt>Turkish situation</dt>
        <dd lang="tr">{expression.situationTr || '—'}</dd>
        <dt>English situation</dt>
        <dd>{expression.situationEn || '—'}</dd>
        <dt>Turkish pronunciation note</dt>
        <dd lang="tr">{expression.pronunciationNoteTr || '—'}</dd>
        <dt>English pronunciation note</dt>
        <dd>{expression.pronunciationNoteEn || '—'}</dd>
        <dt>Category · lesson</dt>
        <dd>
          {expression.category} · {expression.lesson}
        </dd>
        <dt>Tags</dt>
        <dd>{expression.tags.join(', ') || '—'}</dd>
        <dt>General recording</dt>
        <dd>{expression.audioUrl || '—'}</dd>
        <dt>Female recording</dt>
        <dd>{expression.femaleAudioUrl || '—'}</dd>
        <dt>Male recording</dt>
        <dd>{expression.maleAudioUrl || '—'}</dd>
      </dl>
    </div>
  )
}

function ExpressionList({
  title,
  expressions,
}: {
  title: string
  expressions: Expression[]
}) {
  if (!expressions.length) return null
  return (
    <details className="shared-expression-list">
      <summary>
        {title} · {expressions.length}
      </summary>
      <ul className="preview-list">
        {expressions.map((expression) => (
          <li key={expression.id}>
            <strong lang="fr">{expression.french}</strong>
            <span>
              {expression.id} · Lesson {expression.lesson}
            </span>
            <details>
              <summary>View shared expression</summary>
              <Comparison expression={expression} label="Shared version" />
            </details>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function SharedLibraryPanel({
  data,
  published,
  update,
  onCheck,
  busy,
  initialOpen = false,
  onClose,
}: {
  data: AppData
  published: PublishedLibrary
  update: Update
  onCheck: () => Promise<unknown>
  busy: boolean
  initialOpen?: boolean
  onClose: () => void
}) {
  const [open, setOpen] = useState(initialOpen)
  const [decisions, setDecisions] = useState<{
    key: string
    values: Record<string, SharedLibraryChoice>
  }>({ key: '', values: {} })
  const [message, setMessage] = useState('')
  const [exportError, setExportError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const lock = useRef(false)
  let preview: SharedLibraryPreview | null = null
  let previewError = ''
  if (published.library) {
    try {
      preview = previewSharedLibrary(published.library, data)
    } catch (error) {
      previewError =
        error instanceof Error
          ? error.message
          : 'This update could not be previewed.'
    }
  }
  const key =
    preview && published.library
      ? JSON.stringify([
        preview.token,
        published.library.revision,
        published.library.publishedAt,
      ])
      : ''
  const choices = decisions.key === key ? decisions.values : {}
  const choiceFor = (id: string) =>
    Object.hasOwn(choices, id) ? choices[id] : undefined
  function choose(id: string, choice: SharedLibraryChoice) {
    setDecisions((current) => ({
      key,
      values: { ...(current.key === key ? current.values : {}), [id]: choice },
    }))
  }
  function chooseAll(choice: 'keep' | 'shared') {
    setDecisions((current) => ({
      key,
      values: {
        ...(current.key === key ? current.values : {}),
        ...Object.fromEntries(
          (preview?.conflicts ?? []).map(({ incoming }) => [
            incoming.id,
            choice,
          ]),
        ),
      },
    }))
  }
  const unresolved =
    preview?.conflicts.some(
      ({ incoming }) =>
        !['keep', 'shared'].includes(choiceFor(incoming.id) ?? ''),
    ) ?? false
  const hasChanges =
    !!preview &&
    (!preview.isCurrent ||
      preview.additions.length > 0 ||
      preview.updates.length > 0 ||
      preview.conflicts.some(
        ({ incoming }) => choiceFor(incoming.id) === 'shared',
      ) ||
      preview.duplicates.some(
        ({ incoming }) => choiceFor(incoming.id) === 'add',
      ) ||
      preview.deleted.some(
        (expression) => choiceFor(expression.id) === 'restore',
      ))

  async function apply() {
    if (
      lock.current ||
      !preview ||
      !published.library ||
      unresolved ||
      !hasChanges
    )
      return
    lock.current = true
    const selected = Object.fromEntries(
      [
        ...preview.conflicts.map(({ incoming }) => incoming),
        ...preview.duplicates.map(({ incoming }) => incoming),
        ...preview.deleted,
      ].flatMap((expression) => {
        const choice = choiceFor(expression.id)
        return choice ? [[expression.id, choice]] : []
      }),
    ) as Record<string, SharedLibraryChoice>
    try {
      if (
        await update((repository) =>
          repository.applySharedLibrary(
            published.library!,
            selected,
            preview.token,
          ),
        )
      ) {
        setOpen(false)
        setDecisions({ key: '', values: {} })
        setMessage(
          'Shared library updated. Your review history, due dates, and settings were kept.',
        )
        onClose()
      }
    } finally {
      lock.current = false
    }
  }

  function exportLibrary() {
    setExportError('')
    try {
      const revision =
        Math.max(
          published.library?.revision ?? 0,
          data.sharedLibrary?.revision ?? 0,
        ) + 1
      const file = createSharedLibrary(data, revision)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'shared-library.json'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : 'The shared library export could not be created.',
      )
    }
  }

  return (
    <section className="panel shared-library-panel" aria-label="Shared library">
      <div className="section-heading">
        <div>
          <span className="eyebrow">ONE VOCABULARY · YOUR OWN PROGRESS</span>
          <h2>Shared library</h2>
        </div>
        <Icon name="book" size={24} />
      </div>
      <p>
        Learn with Akif’s vocabulary without copying his progress or settings.
        Updates only apply when you review and accept them.
      </p>
      <p className="shared-source-status">
        {data.sharedLibrary
          ? `Following ${data.sharedLibrary.name} · Revision ${data.sharedLibrary.revision}`
          : 'Not following yet. Your current notebook will be kept.'}
      </p>
      {published.loading && (
        <p role="status" className="muted">
          Checking the published library…
        </p>
      )}
      {published.error && (
        <p role="alert" className="error">
          {published.error} Your notebook is unchanged. Check your connection
          and try again.
        </p>
      )}
      {previewError && (
        <p role="alert" className="error">
          {previewError} Nothing was applied.
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {published.library && !previewError && (
        <p className="small muted">
          Published revision {published.library.revision} ·{' '}
          {published.library.expressions.length} expressions
          {preview?.isCurrent ? ' · Up to date' : ''}
        </p>
      )}
      <div className="button-row">
        <button
          className="secondary"
          disabled={busy || published.loading}
          onClick={async () => {
            setMessage('')
            await onCheck()
          }}
        >
          {published.loading ? 'Checking…' : 'Check for updates'}
        </button>
        {preview && !open && (
          <button
            className="primary"
            disabled={busy || published.loading}
            onClick={() => {
              setMessage('')
              setOpen(true)
            }}
          >
            Review shared library
          </button>
        )}
      </div>
      {published.checkedAt && (
        <p className="small muted shared-checked">
          Last successful check {published.checkedAt.toLocaleString()}
        </p>
      )}
      {open && !preview && !previewError && !published.error && (
        <p className="notice">
          Waiting for a validated library before previewing changes.
        </p>
      )}
      {open && preview && published.library && (
        <section
          className="import-preview shared-preview"
          aria-label="Shared library preview"
        >
          <h3>Review revision {published.library.revision}</h3>
          <p>
            <strong>{preview.additions.length}</strong> additions ·{' '}
            <strong>{preview.updates.length}</strong> updates ·{' '}
            <strong>{preview.unchanged.length}</strong> unchanged ·{' '}
            <strong>{preview.conflicts.length}</strong> conflicts
          </p>
          <p className="small muted">{preview.duplicates.length} duplicates · {preview.deleted.length} locally deleted · {preview.removed.length} publisher removed</p>
          <p className="small muted">
            No ratings are imported. Your reviews, due dates, daily pace, voice
            preferences, and personal expressions are kept. New expressions
            still follow your daily learning limit.
          </p>
          <ExpressionList title="Additions" expressions={preview.additions} />
          <ExpressionList title="Updates" expressions={preview.updates} />
          {preview.conflicts.length > 0 && (
            <div className="shared-decisions">
              <h4>Your versions differ</h4>
              <p className="small muted">
                Choose explicitly for each conflict. Either choice keeps your
                existing review progress.
              </p>
              <div className="button-row">
                <button className="secondary" onClick={() => chooseAll('keep')}>
                  Keep all my versions
                </button>
                <button
                  className="secondary"
                  onClick={() => chooseAll('shared')}
                >
                  Use shared versions for all conflicts
                </button>
              </div>
              {preview.conflicts.map(({ incoming, local }) => (
                <div className="shared-decision" key={incoming.id}>
                  <label>
                    <strong lang="fr">{incoming.french}</strong>
                    <select
                      aria-label={`Conflict choice for ${incoming.id}`}
                      value={choiceFor(incoming.id) ?? ''}
                      onChange={(event) =>
                        choose(
                          incoming.id,
                          event.target.value as 'keep' | 'shared',
                        )
                      }
                    >
                      <option value="" disabled>
                        Choose which version to keep
                      </option>
                      <option value="keep">Keep my version</option>
                      <option value="shared">Use shared version</option>
                    </select>
                  </label>
                  <details>
                    <summary>Compare versions</summary>
                    <Comparison expression={local} label="Your version" />
                    <Comparison expression={incoming} label="Shared version" />
                  </details>
                </div>
              ))}
            </div>
          )}
          {preview.duplicates.length > 0 && (
            <div className="shared-decisions">
              <h4>Potential duplicates · {preview.duplicates.length}</h4>
              <p className="small muted">
                Matching French with different IDs is never merged
                automatically. Adding a separate expression starts separate
                progress for that ID.
              </p>
              {preview.duplicates.map(({ incoming, local }) => (
                <div className="shared-decision" key={incoming.id}>
                  <label>
                    <strong lang="fr">{incoming.french}</strong>
                    <select
                      aria-label={`Duplicate choice for ${incoming.id}`}
                      value={choiceFor(incoming.id) ?? 'skip'}
                      onChange={(event) =>
                        choose(
                          incoming.id,
                          event.target.value as 'skip' | 'add',
                        )
                      }
                    >
                      <option value="skip">Skip this duplicate</option>
                      <option value="add">Add as a separate expression</option>
                    </select>
                  </label>
                  <p className="small muted">
                    Shared ID: {incoming.id} · Your matching ID: {local.id}
                  </p>
                </div>
              ))}
            </div>
          )}
          {preview.deleted.length > 0 && (
            <div className="shared-decisions">
              <h4>Expressions you deleted · {preview.deleted.length}</h4>
              <p className="small muted">
                These stay deleted unless you explicitly restore them.
                Previously deleted review history cannot be recovered by
                restoring vocabulary.
              </p>
              {preview.deleted.map((expression) => (
                <label className="shared-decision" key={expression.id}>
                  <strong lang="fr">{expression.french}</strong>
                  <select
                    aria-label={`Deleted choice for ${expression.id}`}
                    value={choiceFor(expression.id) ?? 'skip'}
                    onChange={(event) =>
                      choose(
                        expression.id,
                        event.target.value as 'skip' | 'restore',
                      )
                    }
                  >
                    <option value="skip">Keep deleted</option>
                    <option value="restore">Restore expression</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {preview.removed.length > 0 && (
            <div className="notice">
              <h4>No longer published · {preview.removed.length}</h4>
              <p>
                Publisher removals do not change your notebook: existing expressions and reviews are kept, and anything you deleted stays deleted.
              </p>
              <ul>
                {preview.removed.map((expression) => (
                  <li key={expression.id} lang="fr">
                    {expression.french}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unresolved && (
            <p className="notice">
              Choose a version for every conflict before applying this update.
            </p>
          )}
          {preview.isCurrent && !hasChanges && (
            <p className="small muted">
              You already have this revision. You can still choose to restore a
              deleted expression or add a previously skipped duplicate.
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || published.loading || unresolved || !hasChanges}
              onClick={() => void apply()}
            >
              {busy ? 'Applying…' : 'Apply library update'}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setDecisions({ key: '', values: {} })
                onClose()
              }}
            >
              Cancel library update
            </button>
          </div>
        </section>
      )}
      <details className="shared-publishing">
        <summary>Publish your vocabulary (for the library owner)</summary>
        <p className="small muted">
          This downloads vocabulary only, not progress or preferences. It does
          not publish anything. Publishing requires updating{' '}
          <code>public/shared-library.json</code> in the GitHub repository and
          committing it; no GitHub token belongs in this app.
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          I understand this export may be published publicly.
        </label>
        <div className="button-row">
          <button
            className="secondary"
            disabled={!acknowledged || busy || published.loading}
            onClick={exportLibrary}
          >
            Export shared library <span aria-hidden="true">↓</span>
          </button>
        </div>
        <p className="small muted">
          After downloading, run{' '}
          <code>bun run publish:library /path/to/shared-library.json</code>,
          inspect the published file, then commit and push to main. The
          publishing tool assigns the next revision. Recording URLs will also be
          public. Only publish content you have permission to share.
        </p>
        {exportError && (
          <p className="error" role="alert">
            {exportError}
          </p>
        )}
      </details>
    </section>
  )
}
