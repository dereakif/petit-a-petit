# Petit à Petit

A personal French vocabulary notebook and audio flashcard app for an English- and Turkish-speaking beginner. Built with Bun, Vite, React, strict TypeScript, and native IndexedDB. No account, backend, API key, or paid audio service.

## Run locally

Use a current Bun release and Node.js 22.12+ (Vite’s CLI runs on Node).

```sh
bun install
bun run dev
```

Open the local URL printed by Vite. Keep the same origin (scheme, hostname, and port) to access the same browser database. `localhost` and a LAN hostname/IP have separate storage.

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run preview
```

`bun run build` creates the deployable static app in `dist/`. For an iPhone on your Wi-Fi, run `bun run dev --host 0.0.0.0` and open your Mac’s LAN address with the displayed port. A trusted HTTPS deployment is preferable for regular use. This is a local-first website, not an installed offline PWA.

## Your notebook

- **Library:** search French, English, Turkish, and tags without case/accent sensitivity; filter by category or lesson; play audio; inspect usage and pronunciation notes; edit or delete expressions. `/` focuses search. Deletion asks for confirmation and removes the expression’s reviews in every mode.
- **Practice:** choose speaking recall, listening, or reading, then explicitly start a session. Answers stay hidden until reveal. Rate Again, Hard, Good, or Easy. Again cards return after the other cards; skips do not record progress. The summary distinguishes saved ratings from extra practice.
- **Manage:** add expressions, import lesson JSON, export vocabulary or full backups, restore a notebook, select a French voice, set normal speed, and change your daily pace.

The seven initial lesson-one expressions are seeded only on first database initialization. Editing, importing, or deleting them does not trigger reseeding. Clearing all browser site data creates a genuinely new database, which starts with the seeds again.

Pronunciation guides are clearly labeled approximations, not phonetic transcriptions. Notes cover nasal vowels, pure French vowels rather than English “ay” glides, French “r,” Turkish-like “ü,” and reading-aid capitalization. **Au revoir** includes **vuar → rövuar → o rövuar** backward-building practice.

## Add tomorrow’s vocabulary

1. In **Manage**, download **Example lesson JSON**, or use [`public/example-lesson.json`](public/example-lesson.json).
2. Give it to your tutor with this request:

   > Return only a valid Petit à Petit version-1 lesson JSON, following this template. Use lesson 2 (then increment for later days), unique stable IDs for genuinely new expressions, original French, English and Turkish meanings, separate approximate pronunciation guides, a practical situation, category, tags, and ISO timestamps. Keep an expression’s ID when correcting it. Do not include HTML or invent recorded-audio URLs. Capitalization is a reading aid, not strong English stress.

3. Upload their JSON or paste it into **Lesson JSON**, then choose **Validate & preview**.
4. Review additions, matching IDs, and normalized-French duplicates. Matching IDs default to **keep my version**. Choose **replace vocabulary** explicitly to update them; review history remains unchanged. Different IDs with matching French require explicit duplicate permission or correction in the file.
5. Choose **Apply lesson**. Import extends the collection in one transaction. Cancelling or failing validation makes no changes.

For just one expression, use **Add an expression** instead. All form data stays visible if saving fails.

To attach real recordings, edit an expression’s optional general/default URL (`audioUrl`), female recording URL (`femaleAudioUrl`), and/or male recording URL (`maleAudioUrl`) in the add/edit form, or add those fields to its lesson JSON and import with the same stable ID using **replace vocabulary**. Omit unavailable fields in JSON rather than using empty strings or `null`. Neither labeled recording is required; one or both may be supplied, with or without a general recording. The downloadable example intentionally has no recording URLs—do not invent links. Lesson exports and full backups retain all supplied recording URLs; matching-ID vocabulary updates leave progress in every practice mode unchanged.

## JSON formats

Full contracts, required fields, validation limits, scheduling details, and examples are in [`docs/SCHEMAS.md`](docs/SCHEMAS.md). The formats are intentionally different:

```json
{ "kind": "petit-lesson", "version": 1, "expressions": [] }
```

A vocabulary export is also a lesson import. It excludes progress and settings.

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

The three recording URL fields are optional additions to the existing version-1 schema: lesson/backup envelopes and the IndexedDB schema remain version 1, with no migration needed; old data remains valid unchanged. Imports are runtime-validated, including nested histories, timestamps, IDs, references, and identical HTTP(S) safety rules for all three audio URL fields. Unknown fields/versions are rejected rather than silently discarded. Imported text is rendered as text, never HTML. Files are limited to 10 MB in the interface.

## Back up, restore, or transfer devices

1. On the source device, **Manage → Download full backup**. Save the JSON outside browser storage (Files, iCloud Drive, or another safe location).
2. Transfer the file yourself to the destination device.
3. On the destination, first download a backup of any existing notebook you want to keep.
4. Expand **Restore a full backup**, select the file, and inspect its export time and counts.
5. Type **REPLACE** and choose **Replace with backup**. The complete file is validated before vocabulary, all review histories, and preferences are atomically replaced.

**Restore replaces; it does not merge. This is manual transfer, not automatic synchronization.** Mac and iPhone progress do not automatically sync. Browser data belongs to the current browser/profile/device/origin and may be cleared or evicted. Private-browsing storage can be temporary. Backups matter. There is no server copy or deleted-expression recovery without a backup.

## Audio

The app prefers `fr-FR`, then another French voice, and listens for asynchronous `voiceschanged` updates. It never substitutes an English voice. A missing saved voice produces feedback and falls back only to available French voices. Voice and speed preferences persist.

Playback requires an explicit tap/click. Starting another playback cancels the previous one; leaving a card or view stops it. Normal synthesis uses your saved speed; **Slower** uses 72% of it. Recorded audio uses 1× or 0.75×. An expression’s recording is preferred when present: the default is the general `audioUrl` first, then `femaleAudioUrl`, then `maleAudioUrl`. Use the recording picker to select an available general, female, or male recording, then tap **Listen** (or **Play French** in listening practice) or **Slower**. Female/male are speaker labels supplied by you for recordings, not gender inferred from the audio or a promise about synthesized voices. With no recording URLs, French speech remains available. Recording failures are visible, and **Use French speech instead of recording** is an explicit fallback, never a silent one.

Voice availability, quality, provider behavior, and offline audio depend on the device. **Offline audio is not guaranteed.** The browser/provider may process synthesis remotely. A recording contacts its URL’s host; do not add private URLs you do not trust. Only absolute HTTP(S) URLs without credentials are accepted; HTTP recordings may be blocked as mixed content on HTTPS sites. Typography currently uses Google Fonts with system fallbacks; those font requests contact Google but do not contain vocabulary or review data.

## Review rules

Each mode has its own due date and history. Scheduled sessions prioritize due reviews, then eligible new-to-mode expressions. Default daily introduction budget: **3 distinct expressions across all modes**, counted by first actual rating on the local calendar day, not by displaying a card. Switching modes does not create three separate budgets. Already-introduced expressions can be practiced in another mode without consuming another slot.

| Rating | Next interval                                     |
| ------ | ------------------------------------------------- |
| Again  | 1 minute                                          |
| Hard   | At least 1 day, otherwise previous interval × 1.2 |
| Good   | At least 1 day, otherwise previous interval × 2   |
| Easy   | At least 3 days, otherwise previous interval × 3  |

Dates are elapsed-time intervals; introduction budgets use local calendar days, including daylight-saving changes. Again can return sooner within the current session; its next rating schedules from that moment. Rapid rating clicks are locked until the turn commits. Extra practice uses session-only ratings: **no saved reviews, due dates, history, or daily counts change**. Deleting an expression deletes its history, so daily counts use the remaining records.

## Verification

```sh
bun run test                 # 46 domain / IndexedDB tests
bunx playwright install chromium
bun run test:browser         # 23 browser tests, including WCAG checks
bun run lint
bun run typecheck
bun run build
```

If using an already-installed Chromium binary instead of Playwright’s expected revision:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome bun run test:browser
```

Browser tests use mocked French speech and recordings: answer secrecy in all modes, asynchronous/missing voices, synthesis/recording failures, explicit fallback, rating persistence and write failures, Again requeue, extra-practice isolation, add/edit/delete, import cancellation/atomicity/history preservation, backup replacement, keyboard focus, 390×844 mobile overflow, loading/empty/storage-error states, and automated WCAG 2 AA checks. Playwright starts and stops a bounded local Vite server automatically. Screenshots are written to ignored `test-results/`.

**Manual device checks still needed:** real iPhone Safari and macOS voice availability/quality; speaker and slower playback after a tap; silent-mode/device audio routing; real remote recording playback and network failures; switching views during playback; Files download/restore on iPhone; VoiceOver and large-text/zoom ergonomics. Chromium viewport tests are not real iPhone testing, and mocked speech does not validate a device’s provider.

## Architecture

- `src/data/types.ts`, `seeds.ts`: vocabulary, independent review records, preferences, initial content.
- `src/data/repository.ts`: asynchronous repository boundary and atomic native IndexedDB transactions. Storage failures surface to the UI; no silent in-memory fallback.
- `src/data/validation.ts`, `imports.ts`: runtime schemas, safe URLs, detached exports, preview and explicit merge policies.
- `src/data/scheduler.ts`: small, deterministic review rules and global introduction budget.
- `src/audio.ts`: French voice lifecycle, explicit playback, cancellation, errors, recording fallback.
- `src/App.tsx`, `components.tsx`, `Practice.tsx`, `Manage.tsx`: focused views and reusable form/audio components.

The repository boundary can support a future authenticated sync adapter. There is no cloud authentication or sync implementation in this version.
