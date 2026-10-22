import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Download, Locator, Page } from '@playwright/test'
import type {
  AppData,
  Backup,
  Expression,
  Review,
  SharedLibrary,
} from '../src/data'

const timestamp = '2026-01-01T00:00:00.000Z'
const libraryId = 'akif-french'
const libraryName = 'Akif’s French library'

function expression(
  id: string,
  overrides: Partial<Expression> = {},
): Expression {
  return {
    id,
    french: `Expression française ${id}`,
    english: `English meaning ${id}`,
    turkish: `Türkçe anlam ${id}`,
    pronunciationEn: `English guide ${id}`,
    pronunciationTr: `Türkçe rehber ${id}`,
    pronunciationNoteEn: `English pronunciation note ${id}`,
    pronunciationNoteTr: `Türkçe telaffuz notu ${id}`,
    situationEn: `English situation ${id}`,
    situationTr: `Türkçe kullanım durumu ${id}`,
    category: 'Travel',
    tags: ['shared-library-test'],
    lesson: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

const first = expression('shared-a', { french: 'Je voudrais un billet.' })
const second = expression('shared-b', { french: 'Où est la sortie ?' })
const third = expression('shared-c', { french: 'À quelle heure ?' })

function notebook(expressions: Expression[] = []): AppData {
  return {
    expressions,
    reviews: [],
    preferences: { voiceURI: '', rate: 0.7, dailyNewLimit: 1 },
    initialized: true,
  }
}

function library(
  revision = 1,
  expressions: Expression[] = [first, second],
): SharedLibrary {
  return {
    kind: 'petit-shared-library',
    version: 1,
    libraryId,
    name: libraryName,
    revision,
    publishedAt: new Date(
      Date.parse(timestamp) + revision * 1000,
    ).toISOString(),
    expressions,
  }
}

function subscribed(baseline: SharedLibrary): AppData {
  return {
    ...notebook(baseline.expressions),
    sharedLibrary: {
      libraryId: baseline.libraryId,
      name: baseline.name,
      revision: baseline.revision,
      publishedAt: baseline.publishedAt,
      expressions: baseline.expressions,
      deletedIds: [],
    },
  }
}

function dueReview(id: string): Review {
  const at = new Date(Date.now() - 3 * 86_400_000).toISOString()
  return {
    expressionId: id,
    mode: 'speaking',
    dueAt: new Date(Date.parse(at) + 86_400_000).toISOString(),
    intervalDays: 1,
    history: [{ at, rating: 'good' }],
  }
}

type Feed = {
  body: unknown
  status: number
  abort: boolean
  requests: Array<{ url: string; method: string }>
}

type StorageHarness = {
  failWrites: boolean
  writes: number
  audioPlays: number
}

declare global {
  interface Window {
    __sharedLibraryTest: StorageHarness
  }
}

const externalRequests = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The shared-library suite requires baseURL')
  const origin = new URL(baseURL).origin
  const blocked: string[] = []
  externalRequests.set(page, blocked)
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) {
      // Block the existing Google Fonts stylesheet, including axe's CSS fetch.
      // Every other external request, especially recordings, is unexpected.
      if (
        url.origin !== 'https://fonts.googleapis.com' ||
        url.pathname !== '/css2' ||
        request.method() !== 'GET'
      )
        blocked.push(request.url())
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await page.addInitScript(() => {
    const harness: StorageHarness = {
      failWrites: false,
      writes: 0,
      audioPlays: 0,
    }
    window.__sharedLibraryTest = harness
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (harness.failWrites)
        throw new DOMException('Mock quota exhausted', 'QuotaExceededError')
      harness.writes++
      return put.call(this, value, key)
    }
    HTMLMediaElement.prototype.play = function () {
      harness.audioPlays++
      return Promise.reject(new Error('Audio must not play in library tests'))
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.speak = () => {
        harness.audioPlays++
      }
    }
  })
})

test.afterEach(async ({ page }) => {
  expect(externalRequests.get(page)).toEqual([])
  if (!page.isClosed()) {
    expect(
      await page.evaluate(() => window.__sharedLibraryTest?.audioPlays ?? 0),
    ).toBe(0)
  }
})

// Install before the initial navigation, including fixture initialization.
async function routeFeed(page: Page, body: unknown): Promise<Feed> {
  const feed: Feed = { body, status: 200, abort: false, requests: [] }
  await page.route('**/shared-library.json*', async (route) => {
    feed.requests.push({
      url: route.request().url(),
      method: route.request().method(),
    })
    if (feed.abort) await route.abort('failed')
    else {
      // Serialize a snapshot: later revisions must not mutate an open preview.
      const contents =
        typeof feed.body === 'string' ? feed.body : JSON.stringify(feed.body)
      await route.fulfill({
        status: feed.status,
        contentType: 'application/json',
        body: contents,
      })
    }
  })
  return feed
}

// Raw IndexedDB is used only for fixtures, persisted assertions, and a simulated
// independent cross-tab writer. All shared-library actions go through the UI.
async function storedData(
  page: Page,
  replacement: AppData | null = null,
): Promise<AppData> {
  return page.evaluate(
    (value) =>
      new Promise<AppData>((resolve, reject) => {
        const open = indexedDB.open('petit-a-petit', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('state', value ? 'readwrite' : 'readonly')
          const store = tx.objectStore('state')
          const request = value ? store.put(value, 'app') : store.get('app')
          tx.oncomplete = () => {
            db.close()
            resolve((value ?? request.result) as AppData)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error ?? new Error('Fixture transaction aborted'))
          }
          tx.onerror = () => {
            /* onabort reports the failed transaction. */
          }
        }
      }),
    replacement,
  )
}

async function ready(page: Page) {
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toBeVisible()
}

async function openNotebook(page: Page, data: AppData, feed: Feed) {
  await page.goto('./')
  await ready(page)
  await expect.poll(() => feed.requests.length).toBeGreaterThan(0)
  await storedData(page, data)
  const previous = feed.requests.length
  await page.reload()
  await ready(page)
  await expect.poll(() => feed.requests.length).toBeGreaterThan(previous)
}

async function navigate(page: Page, name: 'Library' | 'Practice' | 'Manage') {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
}

function panel(page: Page) {
  return page.getByRole('region', { name: 'Shared library', exact: true })
}

function preview(page: Page) {
  return page.getByRole('region', {
    name: 'Shared library preview',
    exact: true,
  })
}

function banner(page: Page) {
  return page.getByRole('region', { name: 'Shared vocabulary', exact: true })
}

async function review(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Review shared library', exact: true })
    .click()
  await expect(preview(page)).toBeVisible()
}

async function refresh(page: Page, feed: Feed) {
  const previous = feed.requests.length
  const response = page.waitForResponse('**/shared-library.json*')
  const button = panel(page).getByRole('button', {
    name: 'Check for updates',
    exact: true,
  })
  await button.click()
  await response
  await expect.poll(() => feed.requests.length).toBeGreaterThan(previous)
  await expect(button).toBeEnabled()
}

async function expectCounts(region: Locator, counts: Record<string, number>) {
  for (const [label, count] of Object.entries(counts)) {
    // Match within a summary paragraph: textContent of the entire region joins
    // adjacent blocks (e.g. revision 2 followed by 1 addition becomes "21").
    const pattern = new RegExp(
      `\\b${count}\\s+${label}\\b|\\b${label}\\s*:?\\s*${count}\\b`,
      'i',
    )
    await expect(
      region.locator(':scope > p').filter({ hasText: pattern }),
    ).toBeVisible()
  }
}

async function apply(page: Page, revision: number) {
  await preview(page)
    .getByRole('button', { name: 'Apply library update', exact: true })
    .click()
  await expect
    .poll(async () => (await storedData(page)).sharedLibrary?.revision)
    .toBe(revision)
  await expect(preview(page)).toHaveCount(0)
}

async function downloadJson(download: Download): Promise<unknown> {
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download did not provide a stream')
  let contents = ''
  for await (const chunk of stream) contents += String(chunk)
  return JSON.parse(contents) as unknown
}

test('first use is opt-in, fetches the production subpath, and keeps an initialized empty notebook until apply', async ({
  page,
  baseURL,
}) => {
  const recorded = expression(first.id, {
    ...first,
    audioUrl: 'https://recordings.example.test/general.mp3',
    femaleAudioUrl: 'https://recordings.example.test/female.mp3',
    maleAudioUrl: 'https://recordings.example.test/male.mp3',
  })
  const incoming = library(1, [recorded, second])
  const feed = await routeFeed(page, incoming)
  const data = notebook()
  await openNotebook(page, data, feed)
  await expect(
    banner(page).getByRole('button', {
      name: 'Use shared library',
      exact: true,
    }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(data)
  expect(await page.evaluate(() => window.__sharedLibraryTest.writes)).toBe(0)
  for (const request of feed.requests) {
    expect(request.method).toBe('GET')
    expect(new URL(request.url).origin).toBe(new URL(baseURL!).origin)
    expect(new URL(request.url).pathname).toBe(
      '/petit-a-petit/shared-library.json',
    )
  }
  await banner(page)
    .getByRole('button', { name: 'Use shared library', exact: true })
    .click()
  await expect(
    panel(page).getByRole('heading', { name: 'Shared library', exact: true }),
  ).toBeVisible()
  await expect(preview(page)).toBeVisible()
  await expectCounts(preview(page), {
    additions: 2,
    updates: 0,
    conflicts: 0,
    duplicates: 0,
    '(?:locally )?deleted': 0,
    '(?:publisher )?removed': 0,
  })
  await expect(preview(page)).toContainText(/review.*(?:kept|preserv)/i)
  await expect(preview(page).getByRole('combobox')).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  expect(await page.evaluate(() => window.__sharedLibraryTest.writes)).toBe(0)
  await apply(page, 1)
  expect(await storedData(page)).toEqual({
    ...subscribed(incoming),
    preferences: data.preferences,
    reviews: [],
  })
  await page.reload()
  await ready(page)
  expect((await storedData(page)).expressions).toEqual(incoming.expressions)
  await expect(
    banner(page).getByRole('button', {
      name: 'Use shared library',
      exact: true,
    }),
  ).toHaveCount(0)
})

test('a following revision notifies without applying, preserves ratings, and respects the daily new-expression cap', async ({
  page,
}) => {
  const baseline = library(1, [first])
  const corrected = expression(first.id, {
    ...first,
    english: 'A corrected ticket meaning.',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })
  const incoming = library(2, [corrected, second, third])
  const feed = await routeFeed(page, incoming)
  const data = subscribed(baseline)
  data.reviews = [dueReview(first.id)]
  await openNotebook(page, data, feed)
  const update = banner(page).getByRole('button', {
    name: 'Review library update',
    exact: true,
  })
  await expect(update).toBeVisible()
  expect(await storedData(page)).toEqual(data)
  await update.click()
  await expect(preview(page)).toBeVisible()
  await expectCounts(preview(page), { additions: 2, updates: 1, conflicts: 0 })
  await expect(preview(page).getByRole('combobox')).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  await apply(page, 2)
  expect(await storedData(page)).toEqual({
    ...subscribed(incoming),
    reviews: data.reviews,
    preferences: data.preferences,
  })
  await navigate(page, 'Practice')
  await page.getByRole('button', { name: 'Speaking', exact: true }).click()
  await page
    .getByRole('button', { name: 'Start due session', exact: true })
    .click()
  await expect(page.getByText(first.turkish, { exact: true })).toBeVisible()
  for (const item of [first, second]) {
    await expect(page.getByText(item.turkish, { exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: 'Reveal answer', exact: true })
      .click()
    await page
      .getByRole('group', { name: 'Rate your recall' })
      .getByRole('button', { name: /^Good\b/ })
      .click()
  }
  await expect(
    page.getByRole('heading', { name: 'Session complete', exact: true }),
  ).toBeVisible()
  const saved = await storedData(page)
  expect(
    saved.reviews.find((item) => item.expressionId === first.id)?.history,
  ).toEqual([
    ...data.reviews[0].history,
    { at: expect.any(String), rating: 'good' },
  ])
  expect(
    saved.reviews.find((item) => item.expressionId === second.id)?.history,
  ).toEqual([{ at: expect.any(String), rating: 'good' }])
  expect(saved.reviews.some((item) => item.expressionId === third.id)).toBe(
    false,
  )
  expect(saved.preferences.dailyNewLimit).toBe(1)
})

test('personalized first-use conflicts need explicit choices, bulk choices work, and cancel preserves existing progress', async ({
  page,
}) => {
  const personalFirst = expression(first.id, {
    ...first,
    english: 'My ticket note',
  })
  const personalSecond = expression(second.id, {
    ...second,
    english: 'My exit note',
  })
  const data = notebook([personalFirst, personalSecond])
  data.reviews = [dueReview(first.id), dueReview(second.id)]
  const incoming = library(1, [first, second, third])
  const feed = await routeFeed(page, incoming)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  const choices = [first, second].map((item) =>
    preview(page).getByRole('combobox', {
      name: `Conflict choice for ${item.id}`,
      exact: true,
    }),
  )
  const applyButton = preview(page).getByRole('button', {
    name: 'Apply library update',
    exact: true,
  })
  await expectCounts(preview(page), { additions: 1, conflicts: 2 })
  for (const choice of choices) await expect(choice).toHaveValue('')
  await expect(applyButton).toBeDisabled()
  await choices[0].selectOption('keep')
  await expect(applyButton).toBeDisabled()
  await preview(page)
    .getByRole('button', { name: 'Keep all my versions', exact: true })
    .click()
  for (const choice of choices) await expect(choice).toHaveValue('keep')
  await expect(applyButton).toBeEnabled()
  await preview(page)
    .getByRole('button', { name: 'Cancel library update', exact: true })
    .click()
  await expect(preview(page)).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  await review(page)
  for (const choice of choices) await expect(choice).toHaveValue('')
  await preview(page)
    .getByRole('button', {
      name: 'Use shared versions for all conflicts',
      exact: true,
    })
    .click()
  for (const choice of choices) await expect(choice).toHaveValue('shared')
  await choices[0].selectOption('keep')
  await apply(page, 1)
  expect(await storedData(page)).toEqual({
    ...subscribed(incoming),
    expressions: [personalFirst, second, third],
    reviews: data.reviews,
    preferences: data.preferences,
  })
})

test('a UI deletion persists its tombstone across reloads and updates, and only explicit restore resurrects it', async ({
  page,
}) => {
  const data = subscribed(library())
  data.reviews = [dueReview(first.id)]
  const feed = await routeFeed(page, library())
  await openNotebook(page, data, feed)
  const card = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: first.french, exact: true }),
  })
  await card.getByRole('button', { name: 'Notes & audio', exact: true }).click()
  await card
    .getByRole('button', { name: 'Delete expression', exact: true })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click()
  await expect(card).toHaveCount(0)
  const deleted = await storedData(page)
  expect(deleted.expressions).toEqual([second])
  expect(deleted.reviews).toEqual([])
  expect(deleted.sharedLibrary?.deletedIds).toEqual([first.id])
  feed.body = library(2, [first, second, third])
  await page.reload()
  await ready(page)
  expect(await storedData(page)).toEqual(deleted)
  await banner(page)
    .getByRole('button', { name: 'Review library update', exact: true })
    .click()
  const choice = preview(page).getByRole('combobox', {
    name: `Deleted choice for ${first.id}`,
    exact: true,
  })
  await expect(choice).toHaveValue('skip')
  await expectCounts(preview(page), { additions: 1, '(?:locally )?deleted': 1 })
  await apply(page, 2)
  expect((await storedData(page)).expressions).toEqual([second, third])
  expect((await storedData(page)).sharedLibrary?.deletedIds).toEqual([first.id])
  const restored = expression(first.id, {
    ...first,
    english: 'Publisher revision three',
  })
  feed.body = library(3, [restored, second, third])
  await page.reload()
  await ready(page)
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toHaveCount(0)
  await banner(page)
    .getByRole('button', { name: 'Review library update', exact: true })
    .click()
  await expect(choice).toHaveValue('skip')
  await choice.selectOption('restore')
  await apply(page, 3)
  const saved = await storedData(page)
  expect(saved.expressions).toEqual([second, third, restored])
  expect(saved.sharedLibrary?.deletedIds).toEqual([])
  expect(saved.reviews).toEqual([])
})

test('publisher removals keep local vocabulary and reviews, while full backup and restore retain baseline and tombstones', async ({
  page,
}) => {
  const data = subscribed(library(1, [first, second, third]))
  data.expressions = [first, second]
  data.reviews = [dueReview(first.id)]
  data.sharedLibrary!.deletedIds = [third.id]
  const incoming = library(2, [second, third])
  const feed = await routeFeed(page, incoming)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  await expectCounts(preview(page), {
    '(?:publisher )?removed': 1,
    '(?:locally )?deleted': 1,
  })
  await apply(page, 2)
  const saved = await storedData(page)
  expect(saved.expressions).toEqual(data.expressions)
  expect(saved.reviews).toEqual(data.reviews)
  expect(saved.preferences).toEqual(data.preferences)
  expect(saved.sharedLibrary).toEqual({
    ...subscribed(incoming).sharedLibrary,
    deletedIds: [third.id],
  })
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Download full backup/ }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^petit-backup-.*\.json$/)
  const backup = (await downloadJson(download)) as Backup
  expect(backup).toEqual({
    kind: 'petit-backup',
    version: 1,
    exportedAt: expect.any(String),
    data: saved,
  })
  // Replace the fixture so that a successful restore cannot be a no-op.
  await storedData(page, notebook())
  await page.reload()
  await ready(page)
  await navigate(page, 'Manage')
  await page.getByText('Restore a full backup', { exact: true }).click()
  await page
    .getByLabel('Choose full backup JSON', { exact: true })
    .setInputFiles({
      name: 'shared-library-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
  await expect(
    page.getByRole('heading', { name: 'Validated backup' }),
  ).toBeVisible()
  await page
    .getByLabel('Type REPLACE to confirm replacement', { exact: true })
    .fill('REPLACE')
  await page
    .getByRole('button', { name: 'Replace with backup', exact: true })
    .click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Backup restored' }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(saved)
  await page.reload()
  await ready(page)
  expect(await storedData(page)).toEqual(saved)
})

test('network, HTTP, and JSON failures stay in the shared panel and Check for updates retries without damaging the app', async ({
  page,
}) => {
  const feed = await routeFeed(page, library())
  feed.abort = true
  const data = notebook([third])
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await expect(
    panel(page).getByRole('heading', { name: 'Shared library', exact: true }),
  ).toBeVisible()
  await expect(panel(page).getByRole('alert')).toBeVisible()
  expect(await storedData(page)).toEqual(data)
  feed.abort = false
  feed.status = 503
  await refresh(page, feed)
  await expect(panel(page).getByRole('alert')).toBeVisible()
  expect(await storedData(page)).toEqual(data)
  feed.status = 200
  feed.body = '{not valid JSON'
  await refresh(page, feed)
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(preview(page)).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  await navigate(page, 'Library')
  await expect(
    page.getByRole('heading', { name: third.french, exact: true }),
  ).toBeVisible()
  await navigate(page, 'Manage')
  feed.body = library(1, [first])
  await refresh(page, feed)
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await review(page)
  await apply(page, 1)
  expect((await storedData(page)).expressions).toEqual([third, first])
})

test('whole-feed validation and revision/source guards reject atomically, then allow a valid newer revision', async ({
  page,
}) => {
  const baseline = library(3, [first])
  const data = subscribed(baseline)
  data.reviews = [dueReview(first.id)]
  const feed = await routeFeed(page, baseline)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  const invalidFeeds = [
    {
      name: 'a valid addition followed by unsafe audio',
      body: library(4, [
        second,
        expression(third.id, { audioUrl: 'javascript:alert(1)' }),
      ]),
      error: /audio|url|https?/i,
    },
    {
      name: 'duplicate IDs',
      body: library(4, [second, second]),
      error: /duplicate|id/i,
    },
    {
      name: 'nonpositive revision',
      body: { ...library(4), revision: 0 },
      error: /revision/i,
    },
    {
      name: 'invalid publication date',
      body: { ...library(4), publishedAt: 'not-a-date' },
      error: /publishedAt|date|time/i,
    },
    {
      name: 'unsupported source',
      body: { ...library(4), libraryId: 'someone-else' },
      error: /unsupported|source|akif-french/i,
      previewGuard: true,
    },
    {
      name: 'revision downgrade',
      body: library(2, [first, second]),
      error: /older|revision|downgrade/i,
      previewGuard: true,
    },
    {
      name: 'different payload at the current revision',
      body: { ...baseline, expressions: [first, second] },
      error: /same revision|payload|increment/i,
      previewGuard: true,
    },
  ]
  for (const invalid of invalidFeeds) {
    await test.step(invalid.name, async () => {
      feed.body = invalid.body
      await refresh(page, feed)
      const button = panel(page).getByRole('button', {
        name: 'Review shared library',
        exact: true,
      })
      // Envelope errors can fail during fetch; source/revision guards can fail
      // when opening the preview. Both must be contained in this panel.
      if (
        invalid.previewGuard &&
        (await button.count()) &&
        (await button.isEnabled())
      )
        await button.click()
      await expect(panel(page).getByRole('alert')).toContainText(invalid.error)
      await expect(preview(page)).toHaveCount(0)
      expect(await storedData(page)).toEqual(data)
    })
  }
  feed.body = library(4, [first, second])
  await refresh(page, feed)
  await review(page)
  await apply(page, 4)
  expect((await storedData(page)).expressions).toEqual([first, second])
  expect((await storedData(page)).reviews).toEqual(data.reviews)
})

test('normalized French duplicates default to skip and explicit add keeps separate IDs and review histories', async ({
  page,
}) => {
  const own = expression('my-exit', { ...second, id: 'my-exit' })
  const incoming = expression('publisher-exit', {
    ...second,
    id: 'publisher-exit',
    french: '  OU EST LA SORTIE ?  ',
    english: 'A separate publisher entry',
  })
  const data = notebook([own])
  data.reviews = [dueReview(own.id)]
  const feed = await routeFeed(page, library(1, [incoming]))
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  const choice = preview(page).getByRole('combobox', {
    name: `Duplicate choice for ${incoming.id}`,
    exact: true,
  })
  await expectCounts(preview(page), { additions: 0, duplicates: 1 })
  await expect(choice).toHaveValue('skip')
  await apply(page, 1)
  expect((await storedData(page)).expressions).toEqual([own])
  expect((await storedData(page)).reviews).toEqual(data.reviews)
  feed.body = library(2, [incoming])
  await refresh(page, feed)
  await review(page)
  await expect(choice).toHaveValue('skip')
  await choice.selectOption('add')
  await apply(page, 2)
  const saved = await storedData(page)
  expect(saved.expressions).toEqual([own, incoming])
  expect(saved.reviews).toEqual(data.reviews)
  expect(saved.reviews.some((item) => item.expressionId === incoming.id)).toBe(
    false,
  )
})

test('a cross-tab vocabulary change makes apply stale, and Check for updates reloads the latest local repository', async ({
  page,
}) => {
  const data = subscribed(library(1, [first]))
  data.expressions = [
    expression(first.id, { ...first, english: 'My first note' }),
  ]
  data.reviews = [dueReview(first.id)]
  const incoming = library(2, [
    expression(first.id, { ...first, english: 'Publisher correction' }),
    second,
  ])
  const feed = await routeFeed(page, incoming)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  const choice = preview(page).getByRole('combobox', {
    name: `Conflict choice for ${first.id}`,
    exact: true,
  })
  await choice.selectOption('keep')
  const latest: AppData = {
    ...data,
    expressions: [
      expression(first.id, { ...first, english: 'My newer cross-tab note' }),
      third,
    ],
    preferences: { ...data.preferences, dailyNewLimit: 2 },
  }
  // A separate connection commits after the preview token was captured.
  await storedData(page, latest)
  await preview(page)
    .getByRole('button', { name: 'Apply library update', exact: true })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: /stale|refresh/i }),
  ).toBeVisible()
  await expect(preview(page)).toBeVisible()
  await expect(choice).toHaveValue('keep')
  expect(await storedData(page)).toEqual(latest)
  await preview(page)
    .getByRole('button', { name: 'Cancel library update', exact: true })
    .click()
  await refresh(page, feed)
  await review(page)
  await expectCounts(preview(page), { additions: 1, conflicts: 1 })
  await choice.selectOption('keep')
  await apply(page, 2)
  expect(await storedData(page)).toEqual({
    ...latest,
    expressions: [...latest.expressions, second],
    sharedLibrary: subscribed(incoming).sharedLibrary,
  })
})

test('an IndexedDB apply failure retains the preview and selections, and retry commits all categories atomically', async ({
  page,
}) => {
  const data = subscribed(library(1, [first]))
  data.expressions = [
    expression(first.id, { ...first, english: 'Personal ticket note' }),
    second,
  ]
  data.reviews = [dueReview(first.id), dueReview(second.id)]
  const duplicate = expression('publisher-exit', {
    ...second,
    id: 'publisher-exit',
  })
  const corrected = expression(first.id, {
    ...first,
    english: 'Shared correction',
  })
  const incoming = library(2, [corrected, duplicate, third])
  const feed = await routeFeed(page, incoming)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  const conflictChoice = preview(page).getByRole('combobox', {
    name: `Conflict choice for ${first.id}`,
    exact: true,
  })
  const duplicateChoice = preview(page).getByRole('combobox', {
    name: `Duplicate choice for ${duplicate.id}`,
    exact: true,
  })
  await conflictChoice.selectOption('shared')
  await duplicateChoice.selectOption('add')
  await page.evaluate(() => {
    window.__sharedLibraryTest.failWrites = true
  })
  await preview(page)
    .getByRole('button', { name: 'Apply library update', exact: true })
    .click()
  await expect(
    page.getByRole('alert').filter({ hasText: /quota|storage|write/i }),
  ).toBeVisible()
  await expect(preview(page)).toBeVisible()
  await expect(conflictChoice).toHaveValue('shared')
  await expect(duplicateChoice).toHaveValue('add')
  expect(await storedData(page)).toEqual(data)
  await page.evaluate(() => {
    window.__sharedLibraryTest.failWrites = false
  })
  await apply(page, 2)
  expect(await storedData(page)).toEqual({
    ...data,
    expressions: [corrected, second, third, duplicate],
    sharedLibrary: subscribed(incoming).sharedLibrary,
  })
})

test('publisher export requires public acknowledgement and downloads only canonical vocabulary at the next revision without publishing', async ({
  page,
}) => {
  const data = subscribed(library(7, [first, second]))
  data.expressions = [
    expression(first.id, {
      ...first,
      english: '<script>window.__notExecuted = true</script>',
      femaleAudioUrl: 'https://recordings.example.test/female.mp3',
    }),
  ]
  data.reviews = [dueReview(first.id)]
  data.sharedLibrary!.deletedIds = [second.id]
  const feed = await routeFeed(page, library(7, [first, second]))
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await page
    .getByText('Publish your vocabulary (for the library owner)', {
      exact: true,
    })
    .click()
  const acknowledge = page.getByRole('checkbox', {
    name: 'I understand this export may be published publicly.',
    exact: true,
  })
  const exportButton = page.getByRole('button', {
    name: 'Export shared library',
    exact: true,
  })
  await expect(acknowledge).not.toBeChecked()
  await expect(exportButton).toBeDisabled()
  await acknowledge.check()
  await expect(exportButton).toBeEnabled()
  const requestsBefore = feed.requests.length
  const downloading = page.waitForEvent('download')
  await exportButton.click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('shared-library.json')
  const exported = (await downloadJson(download)) as SharedLibrary
  expect(exported).toEqual({
    kind: 'petit-shared-library',
    version: 1,
    libraryId,
    name: libraryName,
    revision: 8,
    publishedAt: expect.any(String),
    expressions: data.expressions,
  })
  expect(Number.isFinite(Date.parse(exported.publishedAt))).toBe(true)
  for (const item of exported.expressions) {
    expect(item).toHaveProperty('situationEn', expect.any(String))
    expect(item).toHaveProperty('situationTr', expect.any(String))
    expect(item).not.toHaveProperty('situation')
    expect(item).not.toHaveProperty('pronunciationNote')
  }
  expect(await storedData(page)).toEqual(data)
  expect(feed.requests).toHaveLength(requestsBefore)
  expect(
    await page.evaluate(() => Object.hasOwn(window, '__notExecuted')),
  ).toBe(false)
})

test('the 390px shared-library preview exposes every category without overflow and passes axe', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const removed = expression('publisher-removed', {
    french: 'Gardez cette expression locale.',
  })
  const duplicate = expression('publisher-duplicate', {
    french: 'OU EST LA SORTIE ?',
  })
  const updated = expression('publisher-updated', {
    french: 'Une ancienne version.',
  })
  const baseline = library(1, [first, third, removed, updated])
  const data = subscribed(baseline)
  data.expressions = [
    expression(first.id, { ...first, english: 'My personalized meaning' }),
    second,
    removed,
    updated,
  ]
  data.sharedLibrary!.deletedIds = [third.id]
  const incoming = library(2, [
    expression(first.id, { ...first, english: 'Publisher correction' }),
    duplicate,
    third,
    expression(updated.id, {
      ...updated,
      english: 'Corrected automatic update',
    }),
    expression('publisher-added', {
      french: 'Une nouvelle expression pour une longue conversation française.',
    }),
  ])
  const feed = await routeFeed(page, incoming)
  await openNotebook(page, data, feed)
  await navigate(page, 'Manage')
  await review(page)
  await expectCounts(preview(page), {
    additions: 1,
    updates: 1,
    conflicts: 1,
    duplicates: 1,
    '(?:locally )?deleted': 1,
    '(?:publisher )?removed': 1,
  })
  await expect(preview(page).getByRole('combobox')).toHaveCount(3)
  await expect(preview(page)).toContainText(/review.*(?:kept|preserv)/i)
  expect(
    await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    })),
  ).toEqual({ scroll: 390, viewport: 390 })
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([])
  expect(await storedData(page)).toEqual(data)
})
