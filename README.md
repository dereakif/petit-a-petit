# Petit à Petit

A personal French vocabulary notebook and audio flashcard app for an English- and Turkish-speaking beginner. Built with Bun, Vite, React, strict TypeScript, and native IndexedDB. No account, backend, API key, or paid audio service.

## Run locally

Use a current Bun release and Node.js 22.12+ (Vite’s CLI runs on Node).

```sh
bun install
bun run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173/petit-a-petit/`). Keep the same origin (scheme, hostname, and port) to access the same browser database. `localhost` and a LAN hostname/IP have separate storage.

```sh
bun run lint
bun run typecheck
bun run test
bun run build
bun run preview
```

`bun run build` creates the deployable static app in `dist/`. For an iPhone on your Wi-Fi, run `bun run dev --host 0.0.0.0` and open your Mac’s LAN address with the displayed port. A trusted HTTPS deployment is preferable for regular use. This is a local-first website, not an installed offline PWA.

## Deploy to GitHub Pages

Deployment target: **https://dereakif.github.io/petit-a-petit/**, from the `main` branch of `dereakif/petit-a-petit`.

1. Before moving from localhost, download a **full backup** in Manage. The deployed HTTPS origin has separate browser storage; restore that backup on the deployed app to transfer your notebook. Mac and iPhone still do not automatically sync.
2. On GitHub, open **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**. A public repository works with free GitHub Pages; private repositories require a plan that supports Pages. Repository Actions must also be enabled.
3. Commit and push these repository changes to `main`. The **Deploy to GitHub Pages** workflow starts automatically. For later manual deployments, use **Actions → Deploy to GitHub Pages → Run workflow** on `main`.
4. Wait for both the build and deploy jobs to pass in Actions, then open the deployment URL above. The `github-pages` environment and deployment log also link to the live site.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) installs Node.js 22 and pinned Bun 1.4.4, installs from `bun.lockb` with `--frozen-lockfile`, runs lint/type-check/data tests, builds the site, and uploads **only `dist/`** through the official Pages actions. Build failures block deployment. It uses GitHub’s automatic workflow token with scoped permissions; no personal access token, deployment secret, or `gh-pages` branch is needed. Subsequent pushes to `main` redeploy automatically. The workflow does not run browser tests; those can be run locally using the command below.

Vite’s `base` is `/petit-a-petit/` in development, builds, and preview. Public-file download links use `import.meta.env.BASE_URL`. If the repository name changes, or you switch to the root profile site or a custom domain, update `vite.config.ts` and the browser-test base URL accordingly. There are no path-based client-side routes requiring a Pages 404 workaround.

Deployment publishes the application and the intentionally public vocabulary feed at [`public/shared-library.json`](public/shared-library.json), not your browser database or review history. Browser data is never uploaded by this workflow. The initial feed contains 13 expressions and their owner-approved public recording links. Any content explicitly committed under `public/` or bundled into the app is public, so do not commit personal backup files or private recordings.

## Publish the shared French library

The shared feed is **Akif’s French library** (`libraryId: akif-french`). It shares vocabulary, bilingual situations/notes, and optional recording links—not either person’s reviews, schedules, preferences, or shared-library baseline/deletion metadata. Progress stays independent in each browser. There are no accounts and this is **not cloud sync**; both people still need browser backups.

### Owner’s daily flow

1. Edit or add vocabulary in the app. **Keep stable expression IDs** when correcting existing entries; assign a new ID only for a genuinely new expression.
2. In **Manage → Export shared library**, download the shared-library JSON. Downloading an export **does not publish anything**.
3. From the repository, publish the downloaded file:

   ```sh
   bun run publish:library /absolute/path/to/shared-library.json
   ```

4. Preview the changes with `git diff -- public/shared-library.json`. Check the vocabulary and recording links carefully: **the entire feed and all its links are public**. Do not publish credentials, private text, or private recording URLs.
5. Commit the intended `public/shared-library.json` change and push to `main`. The existing Pages workflow builds and deploys the public file with the app. The publisher itself never commits, pushes, calls GitHub, or requests a token.
6. Your girlfriend opens the app, sees the update banner, chooses **Review library update**, reviews the preview, and explicitly applies the library update. She does not need to download or manage JSON files.

In Manage, expand **Publish your vocabulary (for the library owner)** and acknowledge that the export may be published publicly before downloading. The repository already includes the first revision: 13 expressions extracted from the validated bilingual backup, without its private learning data. Your local notebook is never automatically replaced with that file.

The publisher requires an explicit local source path; it never searches Downloads or fetches a URL. It accepts a shared-library export, vocabulary/lesson export, or full backup. **The complete source is validated before extracting only expressions**, including all reviews, settings, and optional baseline metadata in a backup; none of that private state is copied to the feed. Keep backups outside the repository. All three optional audio URL fields use the domain’s HTTP(S) safety validation, without fetching recordings.

The target defaults to this project’s `public/shared-library.json`, regardless of the caller’s working directory. The current public file must also pass runtime validation and have the configured library ID. Each successful publication uses that file’s revision plus one (or revision 1 if absent), the fixed library ID/name, and the current publication timestamp. Incoming revisions and names never determine the published revision/name; an unconfigured source is rejected. The source file is not modified. Validation, temporary-write, or rename failures leave the previous target unchanged; replacement uses a same-directory temporary file and atomic rename, with cleanup.

`bun run validate:shared` validates the full published envelope, expressions, and configured library ID, reports expression count/revision, and exits nonzero on errors. Every `bun run build` runs this check first, including GitHub Actions deployment, so a malformed public feed blocks deployment.

### Recipient’s update flow

- On app open, the browser checks the same-origin public `shared-library.json` under the deployment base path. This check does **not** merge vocabulary or progress. The first-use banner’s **Use shared library** button navigates to **Manage** and opens a preview, never an automatic merge.
- The **Shared library** section in Manage offers **Check for updates** and **Review shared library**. An available-update banner offers **Review library update**. Before applying, the preview shows additions/updates and asks for choices where needed: **Keep my version / Use shared version** for conflicts; **Skip / Add separate** for different-ID French duplicates; **Keep deleted / Restore expression** for locally deleted expressions.
- **Apply library update** is the explicit commit step. Cancelling or just opening a preview changes nothing. Publisher removals keep local expressions and their reviews. A locally deleted shared expression does not return unless the recipient explicitly chooses **Restore expression**.
- Stable IDs connect corrections to the same expression and its existing learning history. Each browser retains its own progress/settings; updates do not import the owner’s progress or overwrite the recipient’s learning records.
- Revision and no-change rules belong to the shared-library domain: an older revision is rejected; an identical already-applied revision is current; a changed payload at the same revision is rejected. Checks bypass the browser cache, accept only the same-origin configured source, time out after 15 seconds, and enforce a 10 MB limit. A failed check leaves the notebook intact. GitHub’s CDN can take time to refresh after deployment; recheck if the feed has not refreshed. Do not hand-edit the feed without incrementing its revision through the publisher.

There is no admin password or GitHub token in the frontend. Authority to publish comes from permission to write to the GitHub repository. An export is only a local download; only reviewing, committing, and pushing the feed makes it public on Pages.

## Your notebook

- **Library:** search French, English, Turkish, and tags without case/accent sensitivity; filter by category or lesson; play audio; inspect usage and pronunciation notes; edit or delete expressions. Cards default to **TR**: only the Turkish meaning, approximation, situation, and note appear. Each card has an **EN/TR** toggle to show the other language instead—not both at once. `/` focuses search. Deletion asks for confirmation and removes the expression’s reviews in every mode.
- **Practice:** choose speaking recall, listening, or reading, then explicitly start a session. Each new card defaults to Turkish with its own EN/TR toggle. Speaking uses the selected language’s situation and meaning cue. Reading and listening keep all translations and notes hidden until reveal; changing language never reveals or plays an answer. Answers stay hidden until reveal. Rate Again, Hard, Good, or Easy. Again cards return after the other cards; skips do not record progress. The summary distinguishes saved ratings from extra practice.
- **Manage:** add expressions, import lesson JSON, export vocabulary or full backups, restore a notebook, select a French voice, set normal speed, and change your daily pace.

The seven initial lesson-one expressions are seeded only on first database initialization. Editing, importing, or deleting them does not trigger reseeding. Clearing all browser site data creates a genuinely new database, which starts with the seeds again.

Pronunciation guides are clearly labeled approximations, not phonetic transcriptions. Notes cover nasal vowels, pure French vowels rather than English “ay” glides, French “r,” Turkish-like “ü,” and reading-aid capitalization. **Au revoir** includes **vuar → rövuar → o rövuar** backward-building practice.

## Add tomorrow’s vocabulary

1. In **Manage**, download **Example lesson JSON**, or use [`public/example-lesson.json`](public/example-lesson.json).
2. Give it to your tutor with this request:

   > Return only a valid Petit à Petit version-1 lesson JSON, following this template. Use lesson 2 (then increment for later days), unique stable IDs for genuinely new expressions, original French, English and Turkish meanings, separate approximate pronunciation guides, `situationTr` and `situationEn`, optional `pronunciationNoteTr` and `pronunciationNoteEn`, category, tags, and ISO timestamps. Write actual Turkish and English translations in their respective fields. Keep an expression’s ID when correcting it. Do not include HTML or invent recorded-audio URLs. Capitalization is a reading aid, not strong English stress.

3. Upload their JSON or paste it into **Lesson JSON**, then choose **Validate & preview**.
4. Review additions, matching IDs, and normalized-French duplicates. Matching IDs default to **keep my version**. Choose **replace vocabulary** explicitly to update them; review history remains unchanged. Different IDs with matching French require explicit duplicate permission or correction in the file.
5. Choose **Apply lesson**. Import extends the collection in one transaction. Cancelling or failing validation makes no changes.

For just one expression, use **Add an expression** instead. All form data stays visible if saving fails.

To attach real recordings, edit an expression’s optional general/default URL (`audioUrl`), female recording URL (`femaleAudioUrl`), and/or male recording URL (`maleAudioUrl`) in the add/edit form, or add those fields to its lesson JSON and import with the same stable ID using **replace vocabulary**. Omit unavailable fields in JSON rather than using empty strings or `null`. Neither labeled recording is required; one or both may be supplied, with or without a general recording. The downloadable example intentionally has no recording URLs—do not invent links. Lesson exports and full backups retain all supplied recording URLs; matching-ID vocabulary updates leave progress in every practice mode unchanged.

### Bilingual situations and pronunciation notes

New expressions and exports use **`situationTr` / `situationEn`** and optional **`pronunciationNoteTr` / `pronunciationNoteEn`**, not the old unsuffixed keys. The add/edit form lets you edit both languages together, with Turkish first. Add at least one nonblank situation; a missing translation is an empty string. Notes may be omitted when unavailable. The example lesson includes both languages.

Older saved notebooks and version-1 imports/backups still work. Legacy `situation` and `pronunciationNote` values migrate to their English fields without changing IDs, timestamps, recordings, or reviews. Turkish translations are **not invented**: when missing, TR cards explain that the Turkish situation/note has not been added, rather than silently displaying English. If a file contains both an old key and a conflicting new English value, validation asks you to reconcile them before importing. Exports use only the new keys.

Card language choices are display-only: they do not change progress, schedules, audio, or vocabulary. Library choices remain while you navigate during the current page session; reload resets them to Turkish. Each practice turn starts in Turkish.

## JSON formats

Full contracts, required fields, validation limits, scheduling details, and examples are in [`docs/SCHEMAS.md`](docs/SCHEMAS.md). The formats are intentionally different:

```json
{ "kind": "petit-lesson", "version": 1, "expressions": [] }
```

A vocabulary export is also a lesson import. It excludes progress and settings.

```json
{
  "kind": "petit-shared-library",
  "version": 1,
  "libraryId": "akif-french",
  "name": "Akif’s French library",
  "revision": 1,
  "publishedAt": "2026-10-23T12:00:00.000Z",
  "expressions": []
}
```

A shared-library export also excludes private state. Its revision is a positive integer; the publisher assigns the next revision from the existing public feed, not from the downloaded export.

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

**Restore replaces; it does not merge. This is manual transfer, not automatic synchronization.** Mac and iPhone progress do not automatically sync. Browser data belongs to the current browser/profile/device/origin and may be cleared or evicted. Private-browsing storage can be temporary. Backups matter. There is no private server copy. Backups are needed to recover personal vocabulary and progress; a still-published shared expression can be restored explicitly through the shared-library preview once that UI is integrated.

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
bun run test                 # 90 data/IndexedDB tests + 51 publishing tests
bun run validate:shared      # validate the public vocabulary-only feed
bunx playwright install chromium
bun run test:browser         # 46 browser tests, including shared updates and WCAG checks
bun run lint
bun run typecheck
bun run build
```

If using an already-installed Chromium binary instead of Playwright’s expected revision:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chrome bun run test:browser
```

Browser tests use mocked French speech and recordings: answer secrecy in all modes, asynchronous/missing voices, synthesis/recording failures, explicit fallback, rating persistence and write failures, Again requeue, extra-practice isolation, add/edit/delete, import cancellation/atomicity/history preservation, backup replacement, keyboard focus, 390×844 mobile overflow, loading/empty/storage-error states, and automated WCAG 2 AA checks. Playwright builds the app and starts/stops a local production-preview server automatically, testing the same `/petit-a-petit/` subpath used by GitHub Pages. Shared-library browser tests cover opt-in, progress-preserving updates, explicit conflicts, duplicates, persistent deletion choices, publisher removals, invalid/network responses, stale previews, backup metadata, public-only exports, and mobile accessibility. Deployment checks cover bundled JavaScript, the favicon, the published feed path, and downloading the example lesson. Screenshots are written to ignored `test-results/`.

**Manual device checks still needed:** real iPhone Safari and macOS voice availability/quality; speaker and slower playback after a tap; silent-mode/device audio routing; real remote recording playback and network failures; switching views during playback; Files download/restore on iPhone; VoiceOver and large-text/zoom ergonomics. Chromium viewport tests are not real iPhone testing, and mocked speech does not validate a device’s provider.

## Architecture

- `src/data/types.ts`, `seeds.ts`: vocabulary, independent review records, preferences, initial content.
- `src/data/repository.ts`: asynchronous repository boundary and atomic native IndexedDB transactions. Storage failures surface to the UI; no silent in-memory fallback.
- `src/data/validation.ts`, `imports.ts`: runtime schemas, safe URLs, detached exports, preview and explicit merge policies.
- `src/data/scheduler.ts`: small, deterministic review rules and global introduction budget.
- `src/data/shared.ts`: shared-library envelopes, revision checks, previews, and explicit update choices.
- `scripts/publish-library.ts`, `scripts/validate-shared-library.ts`: local-only atomic feed publishing and runtime validation; no repository credentials or network requests.
- `src/audio.ts`: French voice lifecycle, explicit playback, cancellation, errors, recording fallback.
- `src/data/shared.ts`, `src/shared-library.ts`, `src/SharedLibraryPanel.tsx`: revisioned publisher snapshots, safe local merges, same-origin checks, and explicit update previews.
- `scripts/publish-library.ts`, `scripts/validate-shared-library.ts`: vocabulary-only publication and build-time feed validation.
- `src/App.tsx`, `components.tsx`, `Practice.tsx`, `Manage.tsx`: focused views and reusable form/audio components.

The repository boundary can support a future authenticated sync adapter. There is no cloud authentication or sync implementation in this version.
