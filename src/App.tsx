import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildQueue,
  defaultPreferences,
  normalize,
  openRepository,
  previewSharedLibrary,
} from './data'
import type {
  AppData,
  Expression,
  LearningLanguage,
  Mode,
  Rating,
  Repository,
  SharedLibraryPreview,
} from './data'
import { learningText } from './language'
import { useAudio } from './audio'
import { usePublishedLibrary } from './shared-library'
import {
  Answer,
  ConfirmDelete,
  ExpressionForm,
  Icon,
  LanguageToggle,
} from './components'
import Practice from './Practice'
import Manage from './Manage.tsx'
import './App.css'
import './shared-library.css'

type View = 'library' | 'practice' | 'manage'
const titles: Record<View, string> = {
  library: 'Your little French library.',
  practice: 'A little practice. A little closer.',
  manage: 'Make it your own.',
}
const subtitles: Record<View, string> = {
  library: 'Useful words. Familiar situations. One expression at a time.',
  practice: 'Listen, remember, and find your words — at your own pace.',
  manage: 'Add tomorrow’s words and take good care of today’s progress.',
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('library')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All categories')
  const [lesson, setLesson] = useState('All lessons')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [cardLanguages, setCardLanguages] = useState<
    Record<string, LearningLanguage>
  >({})
  const [editing, setEditing] = useState<Expression | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Expression | null>(null)
  const [reviewShared, setReviewShared] = useState(false)
  const repository = useRef<Repository | null>(null)
  const mutation = useRef(false)
  const main = useRef<HTMLElement>(null)
  const audio = useAudio(data?.preferences ?? defaultPreferences)
  const published = usePublishedLibrary(!!data)
  const checkPublished = published.check

  useEffect(() => {
    let active = true
    let connection: Repository | undefined
    void openRepository()
      .then(async (repo) => {
        connection = repo
        if (!active) {
          repo.close()
          return
        }
        repository.current = repo
        const loaded = await repo.load()
        if (active) setData(loaded)
      })
      .catch((e) => {
        if (active)
          setError(
            `Storage could not open. ${errorText(e)} Your existing data has not been replaced.`,
          )
      })
    return () => {
      active = false
      connection?.close()
      repository.current = null
    }
  }, [])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        view !== 'library' ||
        deleting
      )
        return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return
      event.preventDefault()
      document.getElementById('library-search')?.focus()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [view, deleting])

  const update = useCallback(
    async (
      action: (repo: Repository) => Promise<AppData>,
    ): Promise<boolean> => {
      if (!repository.current || mutation.current) return false
      mutation.current = true
      setBusy(true)
      setError('')
      try {
        setData(await action(repository.current))
        return true
      } catch (e) {
        setError(
          `Could not save changes. ${errorText(e)} No partial changes were applied.`,
        )
        return false
      } finally {
        mutation.current = false
        setBusy(false)
      }
    },
    [],
  )

  const checkShared = useCallback(async () => {
    if (await update((repo) => repo.load())) return checkPublished()
    return null
  }, [update, checkPublished])

  function navigate(next: View) {
    audio.stop()
    setView(next)
    setEditing(null)
    setDeleting(null)
    setExpanded(null)
    setReviewShared(false)
    requestAnimationFrame(() => main.current?.focus())
  }
  function add() {
    navigate('manage')
    setEditing('new')
  }
  function edit(e: Expression) {
    navigate('manage')
    setEditing(e)
  }
  async function save(e: Expression) {
    const saved = await update((repo) => repo.saveExpression(e))
    if (saved) {
      setEditing(null)
      setView('library')
    }
    return saved
  }
  async function rate(id: string, mode: Mode, rating: Rating) {
    return update((repo) => repo.rate(id, mode, rating))
  }

  let sharedPreview: SharedLibraryPreview | null = null
  let sharedWarning = ''
  if (data && published.library) {
    try {
      sharedPreview = previewSharedLibrary(published.library, data)
    } catch (failure) {
      sharedWarning =
        failure instanceof Error
          ? failure.message
          : 'The shared library could not be previewed.'
    }
  }

  const categories = data
    ? [...new Set(data.expressions.map((e) => e.category))].sort()
    : []
  const lessons = data
    ? [...new Set(data.expressions.map((e) => e.lesson))].sort((a, b) => a - b)
    : []
  const query = normalize(search)
  const filtered =
    data?.expressions.filter(
      (e) =>
        (category === 'All categories' || category === e.category) &&
        (lesson === 'All lessons' || Number(lesson) === e.lesson) &&
        normalize(
          [e.french, e.english, e.turkish, ...e.tags].join(' '),
        ).includes(query),
    ) ?? []

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#library"
          onClick={(e) => {
            e.preventDefault()
            navigate('library')
          }}
          aria-label="Petit à Petit home"
        >
          <span className="brand-mark">
            p<span>à</span>p<span className="brand-dot">.</span>
          </span>
          <span className="brand-name">
            petit à petit<span>YOUR FRENCH, DAY BY DAY</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(['library', 'practice', 'manage'] as View[]).map((v) => (
            <button
              key={v}
              className={`nav-item ${view === v ? 'active' : ''}`}
              aria-current={view === v ? 'page' : undefined}
              onClick={() => navigate(v)}
            >
              <Icon
                name={
                  v === 'library'
                    ? 'book'
                    : v === 'practice'
                      ? 'cards'
                      : 'settings'
                }
              />
              <span>{v[0].toUpperCase() + v.slice(1)}</span>
              {v === 'library' && (
                <span className="nav-count">
                  {data?.expressions.length ?? '–'}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="little-note">
            <Icon name="leaf" size={22} />
            <p>
              Little by little,
              <br />a language becomes yours.
            </p>
            <span>Un petit pas chaque jour.</span>
          </div>
          <div className="local-indicator">
            <span /> Saved on this device
          </div>
          <p className="sidebar-fine">No account. Just you and your French.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            My French notebook{' '}
            <span className="breadcrumb">
              / {view[0].toUpperCase() + view.slice(1)}
            </span>
          </span>
          <span className="trip-label">
            <span className="french-flag" /> A little French for the journey
          </span>
        </header>
        <main id="main" ref={main} tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">PETIT À PETIT · LITTLE BY LITTLE</p>
              <h1>{titles[view]}</h1>
              <p className="page-subtitle">{subtitles[view]}</p>
            </div>
            {view === 'library' && (
              <button
                className="primary add-button"
                onClick={add}
                disabled={!data}
              >
                <Icon name="plus" size={18} />
                Add expression
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error banner">
              {error}
              {!data && (
                <button
                  className="secondary"
                  onClick={() => window.location.reload()}
                >
                  Retry opening storage
                </button>
              )}
            </div>
          )}
          {audio.error && (
            <div className="error banner" role="alert">
              {audio.error}
            </div>
          )}
          {audio.voiceWarning && (
            <p className="notice" role="status">
              {audio.voiceWarning}
            </p>
          )}
          {!data ? (
            <div className="panel empty-state">
              <Icon name="book" size={30} />
              <h2>
                {error
                  ? 'Your notebook could not open'
                  : 'Opening your notebook…'}
              </h2>
              <p>
                {error
                  ? 'Enable browser storage, close other app tabs, and retry. Nothing has been reset.'
                  : 'Loading your expressions and progress from this browser.'}
              </p>
            </div>
          ) : (
            <>
              {view === 'library' && (
                <>
                  {(!data.sharedLibrary ||
                    published.error ||
                    sharedWarning ||
                    (sharedPreview && !sharedPreview.isCurrent)) && (
                    <section
                      className="shared-notice"
                      aria-label="Shared vocabulary"
                    >
                      <Icon name="book" size={24} />
                      <div>
                        <h2>
                          {!data.sharedLibrary
                            ? 'Learn with Akif’s library'
                            : published.error || sharedWarning
                              ? 'Shared library needs attention'
                              : 'Library update available'}
                        </h2>
                        <p>
                          {published.loading
                            ? 'Checking the published vocabulary…'
                            : published.error
                              ? 'The shared library could not be checked. Your own notebook is still available.'
                              : sharedWarning ||
                                (sharedPreview
                                  ? `${sharedPreview.additions.length} additions · ${sharedPreview.updates.length} updates · ${sharedPreview.conflicts.length} conflicts. Your progress stays yours.`
                                  : 'Shared French vocabulary, with your own independent progress.')}
                        </p>
                      </div>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          navigate('manage')
                          setReviewShared(!!sharedPreview)
                        }}
                      >
                        {sharedPreview
                          ? data.sharedLibrary
                            ? 'Review library update'
                            : 'Use shared library'
                          : 'View shared library'}
                        <Icon name="arrow" size={16} />
                      </button>
                    </section>
                  )}
                  <section className="practice-invitation">
                    <div className="invitation-icon">
                      <Icon name="cards" size={24} />
                    </div>
                    <div>
                      <h2>A few words today. More confidence tomorrow.</h2>
                      <p>
                        Start with a short review. Your daily pace is{' '}
                        {data.preferences.dailyNewLimit} new expressions.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => navigate('practice')}
                    >
                      Let’s practice
                      <Icon name="arrow" size={17} />
                    </button>
                  </section>
                  <section aria-label="Vocabulary library">
                    <div className="library-toolbar">
                      <div className="search-input">
                        <Icon name="search" size={19} />
                        <input
                          id="library-search"
                          aria-label="Search expressions"
                          type="search"
                          placeholder="Search French, English, Turkish, or tags…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <kbd>/</kbd>
                      </div>
                      <label className="sr-only" htmlFor="category">
                        Category
                      </label>
                      <select
                        id="category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option>All categories</option>
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor="lesson">
                        Lesson
                      </label>
                      <select
                        id="lesson"
                        value={lesson}
                        onChange={(e) => setLesson(e.target.value)}
                      >
                        <option>All lessons</option>
                        {lessons.map((l) => (
                          <option key={l} value={l}>
                            Lesson {l}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="collection-heading">
                      <p>
                        <strong>{filtered.length}</strong>{' '}
                        {filtered.length === 1 ? 'expression' : 'expressions'}
                        <span className="dot-separator">·</span>
                        {search ||
                        category !== 'All categories' ||
                        lesson !== 'All lessons'
                          ? 'Filtered collection'
                          : 'A small beginning, a world of possibilities'}
                      </p>
                      <span className="collection-hint">
                        Listen. Say it. Make it yours.
                      </span>
                    </div>
                    {filtered.length === 0 ? (
                      <div className="panel empty-state">
                        <Icon name="book" size={32} />
                        <h2>
                          {data.expressions.length
                            ? 'No expressions found'
                            : 'Your next word starts here'}
                        </h2>
                        <p>
                          {data.expressions.length
                            ? 'Try another spelling or clear your filters.'
                            : 'Add your first expression or import a lesson in Manage.'}
                        </p>
                        <button
                          className="secondary"
                          onClick={() => {
                            if (!data.expressions.length) add()
                            else {
                              setSearch('')
                              setCategory('All categories')
                              setLesson('All lessons')
                            }
                          }}
                        >
                          {data.expressions.length
                            ? 'Clear filters'
                            : 'Add expression'}
                        </button>
                      </div>
                    ) : (
                      <div className="expression-grid">
                        {filtered.map((e) => {
                          const language = cardLanguages[e.id] ?? 'tr'
                          const text = learningText(e, language)
                          return (
                            <article
                              className={`expression-card ${expanded === e.id ? 'is-expanded' : ''}`}
                              key={e.id}
                            >
                              <div className="card-meta">
                                <span
                                  className={`category-badge ${e.category.toLowerCase().includes('polite') || e.category.toLowerCase().includes('courtesy') ? 'peach' : ''}`}
                                >
                                  {e.category}
                                </span>
                                <span>LESSON {e.lesson}</span>
                              </div>
                              <div className="card-title">
                                <h2 lang="fr">{e.french}</h2>
                                <button
                                  className="icon-button listen-icon"
                                  aria-label={`Listen to ${e.french}`}
                                  onClick={() => audio.play(e)}
                                >
                                  <Icon name="speaker" size={21} />
                                </button>
                              </div>
                              <div className="card-language-row">
                                <span className="field-label">
                                  MEANING & NOTES
                                </span>
                                <LanguageToggle
                                  language={language}
                                  onChange={(next) =>
                                    setCardLanguages((current) => ({
                                      ...current,
                                      [e.id]: next,
                                    }))
                                  }
                                />
                              </div>
                              <p className="english-meaning" lang={language}>
                                {text.meaning}
                              </p>
                              <div className="card-pronunciation">
                                <span>{language.toUpperCase()}</span>
                                <span lang={language}>
                                  {text.pronunciation}
                                </span>
                                <small>approximate pronunciation</small>
                              </div>
                              <div className="card-footer">
                                <button
                                  className="text-button"
                                  aria-expanded={expanded === e.id}
                                  aria-controls={`details-${e.id}`}
                                  onClick={() => {
                                    audio.stop()
                                    setExpanded(expanded === e.id ? null : e.id)
                                  }}
                                >
                                  {expanded === e.id
                                    ? 'Less detail'
                                    : 'Notes & audio'}
                                  <span aria-hidden="true">
                                    {expanded === e.id ? '−' : '+'}
                                  </span>
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`Edit ${e.french}`}
                                  onClick={() => edit(e)}
                                >
                                  <Icon name="edit" size={16} />
                                </button>
                              </div>
                              {expanded === e.id && (
                                <div
                                  className="card-details"
                                  id={`details-${e.id}`}
                                >
                                  <Answer
                                    expression={e}
                                    audio={audio}
                                    language={language}
                                  />
                                  {e.tags.length > 0 && (
                                    <p className="tags">
                                      {e.tags.map((t) => `#${t}`).join(' ')}
                                    </p>
                                  )}
                                  <button
                                    className="text-button danger"
                                    onClick={() => {
                                      audio.stop()
                                      setDeleting(e)
                                    }}
                                  >
                                    Delete expression
                                  </button>
                                </div>
                              )}
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </section>
                  <aside className="pronunciation-tip">
                    <span className="tip-symbol">à</span>
                    <div>
                      <h3>A note on pronunciation</h3>
                      <p>
                        The English and Turkish guides are memory aids, not
                        exact phonetics. Listen to the French, then try it
                        aloud. Small steps count.
                      </p>
                    </div>
                  </aside>
                  <div className="library-bottom">
                    <span>
                      {buildQueue(data, 'speaking').length} expressions ready
                      for speaking practice
                    </span>
                    <button
                      className="text-button"
                      onClick={() => navigate('practice')}
                    >
                      Keep learning
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                </>
              )}
              {view === 'practice' && (
                <Practice data={data} audio={audio} onRate={rate} busy={busy} />
              )}
              {view === 'manage' &&
                (editing ? (
                  <ExpressionForm
                    key={typeof editing === 'string' ? 'new' : editing.id}
                    expression={
                      typeof editing === 'string' ? undefined : editing
                    }
                    onSave={save}
                    onCancel={() => setEditing(null)}
                    busy={busy}
                  />
                ) : (
                  <Manage
                    data={data}
                    audio={audio}
                    update={update}
                    onAdd={() => {
                      audio.stop()
                      setEditing('new')
                    }}
                    busy={busy}
                    published={published}
                    onCheckShared={checkShared}
                    initialSharedOpen={reviewShared}
                    onSharedClose={() => setReviewShared(false)}
                  />
                ))}
            </>
          )}
          <footer className="page-footer">
            <span>Made for the words you’ll actually use.</span>
            <span>Stored locally · Back up in Manage</span>
          </footer>
        </main>
      </div>
      {deleting && (
        <ConfirmDelete
          expression={deleting}
          busy={busy}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            void update((repo) => repo.deleteExpression(deleting.id)).then(
              (ok) => {
                if (ok) {
                  setDeleting(null)
                  main.current?.focus()
                }
              },
            )
          }}
        />
      )}
    </div>
  )
}
