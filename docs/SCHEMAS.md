# Petit à Petit: data contracts (version 1)

The public TypeScript entry point is `src/data/index.ts`. The data layer uses native IndexedDB, with no runtime dependencies. `tests/data.test.ts` uses `bun:test` and the dev dependency `fake-indexeddb`.

## API

```ts
openRepository(): Promise<Repository>

interface Repository {
  load(): Promise<AppData>
  saveExpression(e: Expression): Promise<AppData>
  deleteExpression(id: string): Promise<AppData>
  savePreferences(p: Preferences): Promise<AppData>
  rate(id: string, mode: Mode, rating: Rating, now?: Date): Promise<AppData>
  applyLesson(lesson: LessonImport, policy: 'skip' | 'update', allowDuplicates: boolean): Promise<AppData>
  applySharedLibrary(library: SharedLibrary, choices: Record<string, 'keep' | 'shared' | 'skip' | 'add' | 'restore'>, token: string): Promise<AppData>
  restore(backup: Backup): Promise<AppData>
  close(): void
}

normalize(text: string): string
validateAudioUrl(url: string): boolean
parseLesson(text: string): LessonImport
parseBackup(text: string): Backup
createLesson(data: AppData): LessonImport
createBackup(data: AppData): Backup
previewLesson(lesson: LessonImport, expressions: Expression[]): {
  additions: Expression[]
  updates: Expression[]
  duplicates: Array<{ incoming: Expression; existing: Expression }>
}
buildQueue(data: AppData, mode: Mode, now?: Date, extra?: boolean): Expression[]
scheduleReview(previous: Review | undefined, id: string, mode: Mode, rating: Rating, now?: Date): Review
newCountToday(data: AppData, now?: Date): number
```

`Lesson` and `LessonImport` are aliases for the same schema. All repository methods except `close()` return promises; storage and validation errors reject. Parsing, exporting, previewing, and scheduling are synchronous and throw actionable field-path errors. Exports and repository results are detached snapshots; mutating one does not change saved data. The pure queue/count functions expect validated `AppData` (e.g. from `load()` or `parseBackup()`); they do not revalidate an entire backup on every render.

## Expression

Canonical expressions use bilingual `situationEn` / `situationTr` and optional `pronunciationNoteEn` / `pronunciationNoteTr`; they never contain `situation` or `pronunciationNote`. All fields below are required in canonical output except the two notes and three recording URLs. Validation accepts a missing alternate situation and normalizes it to `''`, but **at least one situation must be nonblank**. No translation is inferred or copied between languages. Other required strings must contain at least one non-whitespace character. Lengths are JavaScript string lengths (UTF-16 code units). Text is retained **literally**: no HTML decoding, escaping, stripping, normalization, or trimming is performed on stored text.

| Field                                        | Type / constraints                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                         | String, at most 200 characters; unique, stable identity                                                                                            |
| `french`, `english`, `turkish`               | Strings, at most 1,000 characters each                                                                                                             |
| `pronunciationEn`, `pronunciationTr`         | Strings, at most 1,000 characters each                                                                                                             |
| `situationEn`, `situationTr`                 | Strings, at most 4,000 characters each; either may be empty, but at least one must be nonblank                                                     |
| `category`                                   | String, at most 100 characters                                                                                                                     |
| `tags`                                       | Array of at most 50 unique, nonblank strings, at most 80 characters each; empty array allowed                                                      |
| `lesson`                                     | Integer from 1 through 1,000,000                                                                                                                   |
| `createdAt`, `updatedAt`                     | Valid ISO date-times; `updatedAt >= createdAt`                                                                                                     |
| `pronunciationNoteEn`, `pronunciationNoteTr` | Optional strings, at most 8,000 characters each; empty strings allowed                                                                             |
| `audioUrl`                                   | Optional general/default recording URL; absolute HTTP(S), at most 2,048 characters, no credentials, whitespace, control characters, or backslashes |
| `femaleAudioUrl`, `maleAudioUrl`             | Optional user-labeled female/male recording URLs; each has exactly the same URL constraints as `audioUrl`; omit when unavailable                   |

Date-times require a four-digit year, actual calendar date, `T`, hours/minutes/seconds, optional 1–3 fractional digits, and `Z` or a numeric timezone offset. Invalid dates such as February 30, hour 24, and leap seconds are rejected. Stored imported offsets are preserved; newly generated timestamps use UTC `toISOString()` output.

IDs are case-sensitive and are never generated/reassigned by imports. UI-created expressions need their own stable unique ID, e.g. `crypto.randomUUID()`, and creation/update timestamps. Editing an expression replaces its supplied fields but leaves its reviews untouched; the caller supplies `updatedAt`. `saveExpression()` does not forbid equal French text under distinct IDs. Import duplicate controls are separate.

### Bilingual shape transition and read compatibility (version 1)

Lesson/backup envelopes and the IndexedDB database remain **version 1**. This is a canonical expression shape transition with backwards-compatible reads, not a new envelope version. Older application builds are not guaranteed to read new exports. The exported `Expression` TypeScript interface describes only the new canonical shape; legacy keys are accepted only as runtime compatibility input by validation, including lesson parsing, backup parsing/restoring, exports, saves, and persisted-state loading.

- Legacy `situation` maps literally to `situationEn`; if no Turkish situation was supplied, `situationTr` becomes `''`.
- Legacy `pronunciationNote` maps literally to `pronunciationNoteEn`; if no Turkish note was supplied, `pronunciationNoteTr` stays **omitted**, not synthesized. Notes remain independently optional; `''` is valid.
- Mixed transitional input is valid: a hand-edited backup may contain both new note fields but still use legacy `situation`, or new situations with a legacy note. Supplied Turkish fields are retained unchanged.
- New English fields take precedence only when the legacy counterpart is absent or **exactly equal**. If old and new English text differ (even whitespace or an explicit empty new value), validation rejects with both field names and asks the user to reconcile the text and remove the legacy key. It never silently discards either value. Legacy values are type/length-validated even when new fields are present.
- Every supplied situation must be a string of at most 4,000 characters. A missing alternate normalizes to `''`; whitespace is retained literally but does not satisfy the nonblank requirement. No situations, or only blank situations, produces an actionable error asking for `situationEn` or `situationTr`. A supplied non-string situation (including `null` or direct-input `undefined`) is invalid, not treated as a missing translation.
- Every supplied note must be a string of at most 8,000 characters; omitted or direct-input `undefined` optional new notes are ignored. Legacy keys, if present, must have valid string values.
- Returned canonical objects and all new exports contain **only** the new names, never legacy keys. IDs, literal timestamps, recording URLs, reviews, preferences, and the initialized marker are preserved. Import replacement/skip/duplicate policies are unchanged.

For example, the legacy fragment `{"situation":"Greet someone.","pronunciationNote":"Keep r gentle."}` becomes `{"situationEn":"Greet someone.","situationTr":"","pronunciationNoteEn":"Keep r gentle."}`. These are fragments, not complete expressions. Missing translations stay missing; only the bundled initial seeds and example lesson supply authored translations.

`load()` (also called by `openRepository()`) validates the **entire** saved state and, if any expression has a legacy key, atomically writes the canonical migration before resolving. Untouched canonical state is not rewritten on each load. Invalid state or a failed migration write leaves the old record unchanged and rejects; no partial migration or fallback reseeding occurs. Existing seed expressions are migrated as user data, never replaced with the new bilingual seeds: their old English text is retained and missing Turkish translations remain missing unless the user explicitly imports/edits them. Deleted seeds are never resurrected.

`LearningLanguage = 'tr' | 'en'` is exported for consumers. It does not add a preference or change scheduling/review semantics.

### Optional recordings (additive version 1 fields)

`audioUrl` remains the optional general/default recording for backwards compatibility. `femaleAudioUrl?: string` and `maleAudioUrl?: string` are optional recording **speaker labels supplied by the user**, not genders inferred from audio or synthesized voices. Neither labeled URL is required: provide neither, either one, or both, with or without `audioUrl`. When no recordings exist, French speech synthesis remains available without a gender guarantee.

Default playback chooses the first available URL in this order: **`audioUrl` → `femaleAudioUrl` → `maleAudioUrl`**. The recording picker lets the user choose a supplied recording for normal-speed or slower playback; it does not select or infer synthesized voice gender. This order selects an initial recording, not a silent fallback on network/playback failure.

These are additive optional fields within the existing **version 1** lesson and backup envelopes and IndexedDB schema. The recording fields require no version bump, recording migration, new preferences, or review changes. Old data without these recording fields remains valid; the independent bilingual text migration is described above. Saves, lesson imports/exports, and full backup exports/restores retain supplied recording fields. Import updates still replace expression metadata under the existing merge policies and preserve all per-mode progress; omitting a field in replacement metadata does not merge it from the old expression.

For illustration only, the following is a recording-fields fragment, **not a complete expression**. These `example.com` URLs are placeholders, not playable recordings; replace them with real URLs you trust, or omit the fields entirely:

```json
{
  "audioUrl": "https://example.com/illustrative-general.mp3",
  "femaleAudioUrl": "https://example.com/illustrative-female.mp3",
  "maleAudioUrl": "https://example.com/illustrative-male.mp3"
}
```

### Text and URL safety

Treat all text as untrusted display content. Render via text nodes/React string children, **never** `innerHTML` or `dangerouslySetInnerHTML`. Validation is not HTML sanitization. `normalize()` is comparison-only: NFKD decomposition, removal of combining marks, French lowercase, typographic-apostrophe folding to `'`, whitespace collapse and trimming. It does not change stored/displayed strings or remove arbitrary punctuation.

All three recording fields use the same `validateAudioUrl()` rules, with errors naming the exact field (e.g. `lesson.expressions[0].femaleAudioUrl` or `data.expressions[0].maleAudioUrl`). Absent or `undefined` optional fields are ignored; provided `null`, non-string, blank, or unsafe values are rejected before any writes. `validateAudioUrl()` accepts only explicit `http://` or `https://` URLs with a hostname and no credentials. Relative, protocol-relative, `javascript:`, `data:`, `blob:`, and `file:` URLs are rejected. Empty audio strings are invalid. HTTP is intentionally allowed by the contract, though HTTPS pages may block HTTP audio as mixed content. URL validation is not a network availability, CORS, content-type, or trusted-host check. Playback may contact the URL's host, disclose network metadata, and incur provider costs; the UI/audio layer owns consent and fetch/playback behavior. The data layer never fetches audio.

## Preferences and application state

```ts
type LearningLanguage = 'tr' | 'en'
type Mode = 'speaking' | 'listening' | 'reading'
type Rating = 'again' | 'hard' | 'good' | 'easy'

interface Preferences {
  voiceURI: string // up to 2,048 chars; empty means system/default voice
  rate: number // finite, 0.1–10
  dailyNewLimit: number // integer, 0–1,000; zero disables brand-new introductions
}

interface Review {
  expressionId: string
  mode: Mode
  dueAt: string
  intervalDays: number
  history: Array<{ at: string; rating: Rating }>
}

interface AppData {
  expressions: Expression[]
  reviews: Review[]
  preferences: Preferences
  initialized: true
  sharedLibrary?: SharedLibraryState
}
```

`defaultPreferences = { voiceURI: '', rate: 0.85, dailyNewLimit: 3 }`.

The default budget is three new expressions per local calendar day. Existing saved preferences are preserved; changing the default does not overwrite a previously chosen daily limit.

Every review references an existing expression. There is at most one review per `(expressionId, mode)`. Histories are chronological, oldest first; equal timestamps are allowed (two ratings in the same millisecond). Every rating, including early extra practice, is retained. `intervalDays` must exactly match replay of the full history using the algorithm below. `dueAt` must equal the final history timestamp plus that interval (JavaScript `Date` millisecond precision). Future timestamps are not rejected merely because the local clock is earlier. Rates cannot precede the expression's earliest introduction or the current mode's last rating.

Normally a review is created only by its first rating. An imported empty-history review is allowed only with `intervalDays: 0` and a valid `dueAt`; it is still **new**, not a consumed introduction or a due review. A nonempty history requires the positive interval and matching due date calculated from history.

An application state can contain at most 10,000 expressions, 30,000 reviews, and 100,000 history entries per review. JSON parsing is limited to 20,000,000 characters. Every object has exactly the documented schema: unknown fields, unsupported versions, nulls/wrong types, missing required values, nonfinite numbers, and invalid references are rejected. Optional fields can be omitted (or `undefined` in direct TypeScript input); JSON `null` is not accepted for them. Arrays may be empty. Multiple expressions may have the same normalized French text when duplicates have been explicitly allowed.

## Lesson import/export

```json
{
  "kind": "petit-lesson",
  "version": 1,
  "expressions": []
}
```

`public/example-lesson.json` is a complete **tomorrow / lesson 2** example dated October 23, 2026, containing **Merci**, **Oui**, and **Non** with English/Turkish pronunciation guides, situations, and pronunciation notes. Its date is metadata, not a release gate: a lesson becomes available as soon as it is imported. It deliberately omits all optional recording URLs rather than inventing playable links. Add `audioUrl`, `femaleAudioUrl`, and/or `maleAudioUrl` to an expression only when you have real recordings. `createLesson(data)` exports all expression metadata, including supplied recording URLs, and **no** reviews or preferences.

All incoming expressions are validated before any import writes. IDs must be unique within the lesson; equal normalized French under distinct IDs is allowed in the file so the user can resolve it via preview/import options.

### Preview

Preview is non-mutating and processes file order:

1. Existing identical ID → `updates`, even if the content is unchanged.
2. Different ID but matching normalized French → `duplicates: { incoming, existing }`.
3. Otherwise → `additions`.

For subsequent comparisons the preview virtually applies matching-ID updates and additions, so later duplicates within the lesson are reported as well. Duplicate entries themselves are not virtually inserted. The result is an identity/content preview, **not** a policy-specific execution plan: e.g. a matching-ID update is still listed as an update if its French conflicts with a different expression. The final flags below decide whether it is applied.

### Apply

Each import is a single transaction against the **latest** saved state. File order determines conflicts, including within the lesson.

| Conflict                                                       | Behavior                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Same ID, `policy: 'skip'`                                      | Leave existing expression unchanged                                            |
| Same ID, `policy: 'update'`                                    | Replace expression metadata; retain all reviews for that ID                    |
| Different ID, same normalized French, `allowDuplicates: false` | Skip incoming expression; do not overwrite a differently identified expression |
| Different ID, same normalized French, `allowDuplicates: true`  | Add a separate expression under the incoming ID                                |
| Same-ID update would conflict with another ID's French         | Skip unless `allowDuplicates: true`                                            |
| No conflict                                                    | Add expression                                                                 |

`allowDuplicates` permits duplicate **text**, never duplicate IDs. To update progress-bearing content, reuse its original ID. Existing reviews/preferences are preserved; added expressions have no reviews. Imports do not delete expressions absent from the file. A preview is a snapshot; another tab can change state before apply, which resolves conflicts again atomically.

## Shared vocabulary libraries

This is an explicit preview/apply domain API; loading the repository does not fetch or subscribe to any source. UI and publication are separate concerns. Public exports from `src/data/index.ts`:

```ts
const SHARED_LIBRARY_ID = 'akif-french'
const SHARED_LIBRARY_NAME = 'Akif’s French library'

interface SharedLibrary {
  kind: 'petit-shared-library'
  version: 1
  libraryId: string
  name: string
  revision: number
  publishedAt: string
  expressions: Expression[]
}

interface SharedLibraryState {
  libraryId: string
  name: string
  revision: number
  publishedAt: string
  expressions: Expression[] // last publisher snapshot, NOT local vocabulary
  deletedIds: string[] // persistent local tombstones, unique IDs
}

interface SharedLibraryPreview {
  additions: Expression[]
  updates: Expression[]
  unchanged: Expression[]
  conflicts: Array<{ incoming: Expression; local: Expression }>
  duplicates: Array<{ incoming: Expression; local: Expression }>
  deleted: Expression[]
  removed: Expression[]
  token: string
  isCurrent: boolean
}

type SharedLibraryChoice = 'keep' | 'shared' | 'skip' | 'add' | 'restore'

parseSharedLibrary(text: string): SharedLibrary
validateSharedLibrary(value: unknown): SharedLibrary
createSharedLibrary(data: AppData, revision: number, now?: Date): SharedLibrary
previewSharedLibrary(library: SharedLibrary, data: AppData): SharedLibraryPreview
```

### Validation and compatibility

Shared envelopes/state are strict at every nested level, reusing expression, calendar/timezone and safe audio validation (including version-1 bilingual compatibility). `libraryId` and `name` are nonblank strings of at most 200 characters. `revision` is a positive safe integer, up to `Number.MAX_SAFE_INTEGER`. `publishedAt` is an ISO timestamp with seconds and timezone. Each expression collection has unique IDs and the usual 10,000-expression limit. `deletedIds` holds at most 100,000 unique nonblank IDs, each at most 200 characters. Unknown fields, learning data in a feed, wrong kinds/versions, unsafe URLs, malformed timestamps, and malformed nested values reject rather than sanitize.

Parsing/validation may accept any valid library ID; preview and apply require the configured `akif-french` ID and reject a mismatch with an existing subscription. A foreign subscription restored from backup is valid data, but cannot be silently switched to the configured source.

`AppData.sharedLibrary` is **optional**. Absent or direct-input `undefined` metadata normalizes to no property at all; existing version-1 fixtures/backups retain their shape. Full `petit-backup` version-1 exports/restores include and validate metadata when present, without changing the backup kind/version. Lesson exports and shared-library exports contain **no** reviews, history, due dates, preferences, subscription state, or tombstones. Shared exports always use the fixed configured ID/name, the supplied revision, and `now` (default current time); expressions are detached canonical objects. They publish current local vocabulary, not the previous baseline.

Baseline expressions and tombstones are historical publisher information, not foreign keys into local vocabulary. A baseline may contain skipped/deleted entries; a tombstone may refer to an entry absent from the current feed. Reviews reference **only local expressions**, never the baseline. Manual saves, generic lesson imports, preference writes and ratings retain metadata. Generic lesson import merging remains unchanged; its edits are subsequently visible to the three-way shared comparison.

### Preview and revisions

Comparisons include all canonical expression fields, including timestamps, recordings, optional notes, and ordered tags. Object field order is irrelevant; French normalization is used only for duplicate detection, never for rewriting displayed text. Publisher snapshot comparison ignores expression array order but includes `libraryId`, name, revision, `publishedAt`, and complete canonical expressions.

- Older revisions reject. The same revision must have exactly the saved publisher payload; changing content, name, or publication time requires a new revision. A valid same-revision feed sets `isCurrent: true` but can still be explicitly reapplied, including to restore tombstones or add previously skipped duplicates.
- Tombstoned incoming IDs appear in `deleted` before any other classification. They never reappear automatically, even after publisher removal and readdition.
- Matching local/incoming IDs: exact matches are `unchanged`. If incoming still equals the baseline, classify `unchanged` and retain local edits. If incoming changed and local still equals baseline, classify as safe `updates`. If both changed, classify `conflicts`, unless local already equals incoming.
- On first follow, an exact local/incoming ID match is unchanged. An untouched canonical stock seed with that ID is safe to update. Every other nonmatching existing ID is a conflict, including personal entries. An ID collision never creates a new identity.
- New IDs with different-ID matching normalized French appear in `duplicates`, not automatic merges. Preview also detects duplicates against earlier prospective additions within the feed. Other new IDs are `additions`.
- Baseline entries absent from the new publisher feed appear in `removed`; they are **not** deleted from local vocabulary and their reviews remain untouched.

The token is an opaque exact canonical snapshot of current local expressions plus shared state (baseline and tombstones), excluding reviews/preferences. Treat it as an in-memory optimistic-concurrency token, not a secret or a compact digest. Expression/baseline array ordering and tombstone ordering are ignored. Any intervening vocabulary/subscription change invalidates it; concurrent ratings and preference changes do not. A stale-token error instructs callers to reload local data and refresh the preview.

### Apply choices and atomicity

Call `repository.applySharedLibrary(library, choices, preview.token)`. Choice keys are **incoming IDs**, never normalized French or local duplicate IDs:

| Preview category                    | Accepted choice         | Default                                                    |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `additions`, `updates`, `unchanged` | No choice key permitted | Automatically add/update, or preserve unchanged local text |
| `conflicts`                         | `keep` or `shared`      | None; every conflict requires explicit resolution          |
| `duplicates`                        | `skip` or `add`         | `skip`                                                     |
| `deleted`                           | `skip` or `restore`     | `skip`                                                     |
| `removed` / unknown IDs             | No choice key permitted | Retain local entries and learning data                     |

`shared` replaces only the conflicted expression under its existing ID. `add` creates the incoming duplicate under its publisher ID and never transfers the existing entry's reviews. `restore` reinstates the incoming expression and removes its tombstone; previously deleted reviews are not recreated. All automatic/explicit changes preserve reviews, due dates, histories, preferences, and daily-introduction counts. Shared apply never rates expressions.

The full feed/options are validated and detached before opening a write transaction. Inside the same serialized IndexedDB store transaction, apply loads the latest state, checks the token, recalculates the preview, validates category-specific choices and all required conflict resolutions, and validates the final candidate before writing. New normalized-French collision pairs are rejected with a resolve/refresh instruction unless the exact incoming/local duplicate pair was explicitly approved with `add`. Pre-existing collision pairs remain allowed. This final check catches collisions caused by combinations of updates, additions, restores, and choices; feeds with multiple duplicate partners can require local resolution rather than blanket permission. Any validation/storage failure aborts the whole transaction, including baseline changes.

After success, the baseline always becomes the complete publisher snapshot, even for kept conflicts, skipped duplicates, or tombstones; all tombstones persist except explicit restores. This means future publisher-unchanged entries preserve local choices without repeatedly prompting. `deleteExpression(id)` adds a unique tombstone when the current baseline contains that ID, then performs its existing local deletion and all-mode review cleanup. Source removals never remove tombstones. Deletions before subscribing add no metadata; no background operation imports anything without an explicit apply.

## Backup export/restore

```json
{
  "kind": "petit-backup",
  "version": 1,
  "exportedAt": "2026-10-22T12:00:00.000Z",
  "data": {
    "expressions": [],
    "reviews": [],
    "preferences": { "voiceURI": "", "rate": 0.85, "dailyNewLimit": 3 },
    "initialized": true
  }
}
```

`createBackup(data)` validates and copies the complete state and uses the current time for `exportedAt`. `parseBackup()` and `restore()` validate **all** nested values, timestamps, references, review uniqueness, history order, intervals, URLs, and the initialized marker. An invalid direct object cannot bypass parsing by calling `restore()` directly.

Restore atomically **replaces** the whole state (not a merge). Existing lessons, preferences, and progress absent from the backup are removed. An empty initialized backup remains empty after reopening, without new seed content. Confirm destructive restore in the UI and consider exporting the current backup first. Backups are plain JSON, not encrypted, and contain the user's study history and configured voice URI.

## Scheduling and daily budget

Intervals are expressed in fractional days. One scheduling day is exactly 86,400,000 ms; due-date scheduling is elapsed time, not local wall-clock arithmetic.

| Rating | First review in this mode  | Subsequent reviews in this mode       |
| ------ | -------------------------- | ------------------------------------- |
| Again  | 1 minute (`1 / 1440` days) | Reset to 1 minute                     |
| Hard   | 1 day                      | `max(1 day, previous interval × 1.2)` |
| Good   | 1 day                      | `max(1 day, previous interval × 2)`   |
| Easy   | 3 days                     | `max(3 days, previous interval × 3)`  |

Again always resets to one minute. The next non-Again rating recovers to at least one day for Hard/Good or three days for Easy, including after repeated Again ratings. Multipliers still apply above those floors, without rounding to whole days or a hidden ease factor. Every rating reschedules from the supplied `now`, even when given early. Invalid clocks, backwards events, and date/interval overflow reject rather than saving a broken schedule.

History replay validation uses these same floors and rejects inconsistent intervals or due dates before any restore writes occur.

**First introduction** of an expression means the earliest rating timestamp across **all** modes. `newCountToday()` counts distinct expression IDs whose first introduction falls within the local calendar day containing `now`. Repeated ratings and introductions to another mode do not consume another slot. Local midnight boundaries use calendar arithmetic, including 23-/25-hour DST days; counts do not use a sliding 24-hour window or UTC dates. Deleting an expression deletes its history, so counts are calculated from the remaining state, not a separate lifetime audit ledger.

Regular `buildQueue()`:

1. Include current-mode reviews with nonempty history and `dueAt <= now`, sorted by due time (oldest first).
2. Include expressions new to this mode that were already introduced in another mode, regardless of the daily budget.
3. Include at most `max(0, dailyNewLimit - newCountToday(data, now))` never-introduced expressions.

New-to-mode candidates in steps 2–3 are interleaved in deterministic lesson / creation timestamp / ID order. Already introduced candidates never consume candidate budget. Future-due current-mode reviews do not appear in the regular queue. The queue is pure: viewing it does not reserve slots or create reviews. Persist only when the user actually rates.

`buildQueue(..., extra: true)` includes **all** expressions, including future reviews and new expressions beyond the displayed budget, without modifying or persisting anything. The UI never calls repository `rate()` for extra practice: ratings in that mode are session-only and cannot change progress or the daily count. Repository `rate()` permits early reviews so Again cards can return within a session; it still enforces the global daily introduction cap. Increase `dailyNewLimit` explicitly to introduce more expressions.

## IndexedDB lifecycle and atomicity

Database: **`petit-a-petit`**, database version **1**. Object store: **`state`**. Singleton key: **`app`** containing `AppData`. Database schema versioning and JSON envelope versioning are separate concerns.

`openRepository()` opens the database and initializes missing state once with the seven stable lesson-one seeds. It only returns after initialization commits. The seed IDs are `seed-bonjour`, `seed-bonsoir`, `seed-desole`, `seed-anglais`, `seed-sil-vous-plait`, `seed-excusez-moi`, and `seed-au-revoir`. The initial seeds have genuinely translated English/Turkish situations and notes. Both note languages explain nasal n, pure vowels without English ay glides, French r, rounded ü, capitalization as a reading aid rather than English-style word stress, and backward **vuar → rövuar → o rövuar** practice. These bilingual seeds initialize only missing state; they never overwrite edited or deleted expressions. Loads of existing state persist legacy-field migrations as described above, without a database version upgrade.

All operations use native read-modify-write transactions on the same store. Reads, conflict checks, daily-budget checks, mutations, and writes are performed synchronously inside the request callback, with **no await between reading and writing**. IndexedDB serializes these transactions across repository instances/tabs, preventing lost independent writes and double-spending the last daily slot. Two full edits of the same expression follow normal last-transaction-wins replacement semantics, not field merging. Concurrent whole-state restores intentionally replace the earlier state.

Promises resolve on transaction **completion**, not on a successful `put` request. Quota failures, transaction aborts, unavailable storage, blocked upgrades, or invalid saved data reject; failures are never silently converted to ephemeral in-memory storage or fresh seeds. Invalid saved state is not overwritten. `close()` is idempotent, closes the connection, and makes future operations reject; pending transactions may still finish. Connections also close on a database version change. Browser/site-data deletion removes the database, after which a fresh database naturally seeds again.

## Validation

After installing the project's dev tools plus `fake-indexeddb` and Bun types, run:

```sh
bun test tests/data.test.ts
```

Tests exercise bilingual seeds/example content, old DB/lesson/backup and mixed-format migrations, missing translations and optional notes, conflicting legacy/new text, canonical-only exports, one-time load persistence and atomic migration failures, seed deletion/reopening, literal untrusted text, URL validation, schema failures at nested paths, lesson preview/conflicts and progress preservation, backup round trips/atomic replacement, scheduling intervals and ordering, local-day distinct caps, early ratings, input isolation, concurrent writes across connections, daily-cap races, and injected storage failures. Shared-library tests additionally cover first-follow seed reconciliation, three-way conflicts and explicit choices, normalized duplicates/stable IDs, tombstones across reload/removal/readdition, explicit restore, source removals preserving progress, revision rollback and same-revision tampering, stale cross-connection previews and simultaneous applies, ratings/preferences surviving apply, collision rejection, optional metadata backup round trips, learning-data-free exports, input isolation, and atomic write failures. No browser network or audio service is required.
