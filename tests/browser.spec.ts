import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import type { AppData, Expression, Mode, Review } from '../src/data'

type AudioHarness = {
  calls: {
    text: string
    lang: string
    rate: number
    voiceURI: string | undefined
  }[]
  recordingAttempts: string[]
  recordingRates: number[]
  recordingPauses: number
  failRecordings: boolean
  holdRecordings: boolean
  cancellations: number
  failSpeech: boolean
  holdSpeech: boolean
  failWrites: boolean
  changeVoices: (french: boolean) => void
  finish: () => void
}

declare global {
  interface Window {
    __browserAudio: AudioHarness
  }
}

const timestamp = '2026-01-01T00:00:00.000Z'
function expression(
  id: string,
  overrides: Partial<Expression> = {},
): Expression {
  return {
    id,
    french: `Expression française ${id}`,
    english: `English cue ${id}`,
    turkish: `Türkçe anlam ${id}`,
    pronunciationEn: `en-guide-${id}`,
    pronunciationTr: `tr-guide-${id}`,
    pronunciationNote: `Pronunciation note ${id}`,
    situation: `Situation cue ${id}`,
    category: 'Travel',
    tags: ['browser-test'],
    lesson: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}
const first = expression('browser-a', {
  french: 'Je voudrais un billet.',
  english: 'I would like a ticket.',
})
const second = expression('browser-b', { french: 'Où est la sortie ?' })
const third = expression('browser-c', { french: 'À quelle heure ?' })
function notebook(expressions: Expression[] = [first, second]): AppData {
  return {
    expressions,
    reviews: [],
    preferences: { dailyNewLimit: 3, rate: 0.85, voiceURI: '' },
    initialized: true,
  }
}
function dueReview(id: string, mode: Mode = 'speaking'): Review {
  const at = new Date(Date.now() - 3 * 86_400_000).toISOString()
  return {
    expressionId: id,
    mode,
    intervalDays: 1,
    dueAt: new Date(Date.parse(at) + 86_400_000).toISOString(),
    history: [{ at, rating: 'good' }],
  }
}

// Playwright supplies a fresh browser context (and thus fresh IndexedDB) per test.
// Both audio paths are mocked before the application or its hooks can run.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const events = new EventTarget()
    const voice = (lang: string): SpeechSynthesisVoice => ({
      lang,
      name: `Mock ${lang}`,
      voiceURI: `mock-${lang}`,
      default: lang === 'fr-FR',
      localService: true,
    })
    let voices = [voice('en-US'), voice('fr-FR')]
    let current: SpeechSynthesisUtterance | null = null
    const harness: AudioHarness = {
      calls: [],
      recordingAttempts: [],
      recordingRates: [],
      recordingPauses: 0,
      failRecordings: true,
      holdRecordings: false,
      cancellations: 0,
      failSpeech: false,
      holdSpeech: false,
      failWrites: false,
      changeVoices(french) {
        voices = french ? [voice('en-US'), voice('fr-FR')] : [voice('en-US')]
        events.dispatchEvent(new Event('voiceschanged'))
      },
      finish() {
        const utterance = current
        current = null
        utterance?.onend?.call(
          utterance,
          new Event('end') as SpeechSynthesisEvent,
        )
      },
    }
    window.__browserAudio = harness
    class MockUtterance {
      text: string
      lang = ''
      rate = 1
      voice: SpeechSynthesisVoice | null = null
      onstart = null
      onend = null
      onerror = null
      constructor(text: string) {
        this.text = text
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        cancel() {
          harness.cancellations++
          current = null
        },
        speak(utterance: SpeechSynthesisUtterance) {
          harness.calls.push({
            text: utterance.text,
            lang: utterance.lang,
            rate: utterance.rate,
            voiceURI: utterance.voice?.voiceURI,
          })
          current = utterance
          const token = harness.cancellations
          queueMicrotask(() => {
            if (token !== harness.cancellations) return
            if (harness.failSpeech) {
              utterance.onerror?.call(utterance, {
                error: 'synthesis-failed',
              } as SpeechSynthesisErrorEvent)
            } else {
              utterance.onstart?.call(
                utterance,
                new Event('start') as SpeechSynthesisEvent,
              )
              if (!harness.holdSpeech) harness.finish()
            }
          })
        },
      },
    })
    class FailingRecording {
      src = ''
      preload = ''
      playbackRate = 1
      onplaying: (() => void) | null = null
      onended: (() => void) | null = null
      play() {
        harness.recordingAttempts.push(this.src)
        harness.recordingRates.push(this.playbackRate)
        if (harness.failRecordings)
          return Promise.reject(
            new DOMException('Mock recording unavailable', 'NotSupportedError'),
          )
        queueMicrotask(() => {
          this.onplaying?.()
          if (!harness.holdRecordings) this.onended?.()
        })
        return Promise.resolve()
      }
      pause() {
        harness.recordingPauses++
      }
      load() { }
      removeAttribute(name: string) {
        if (name === 'src') this.src = ''
      }
    }
    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: FailingRecording,
    })
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (harness.failWrites)
        throw new DOMException('Mock quota exhausted', 'QuotaExceededError')
      return put.call(this, value, key)
    }
  })
})

// Only fixture setup and persisted-state assertions bypass the UI, never mutations under test.
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
            resolve(value ?? (request.result as AppData))
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
async function openNotebook(page: Page, data = notebook()) {
  await page.goto('./')
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toBeVisible()
  await storedData(page, data)
  await page.reload()
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toBeVisible()
}
async function navigate(page: Page, name: 'Library' | 'Practice' | 'Manage') {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
}
async function start(
  page: Page,
  mode: 'Speaking' | 'Listening' | 'Reading',
  extra = false,
) {
  await navigate(page, 'Practice')
  await page.getByRole('button', { name: mode, exact: true }).click()
  await expect(page.locator('.practice-card')).toHaveCount(0)
  await page
    .getByRole('button', {
      name: extra ? 'Start extra practice' : 'Start due session',
      exact: true,
    })
    .click()
}
async function absentFromDOMAndAria(page: Page, values: string[]) {
  const html = await page.locator('body').innerHTML()
  const accessibility = await page.locator('body').ariaSnapshot()
  for (const value of values) {
    expect(html, `Answer must not be in DOM: ${value}`).not.toContain(value)
    expect(
      accessibility,
      `Answer must not be in accessibility tree: ${value}`,
    ).not.toContain(value)
  }
}
const hiddenGuides = (item: Expression) => [
  item.turkish,
  item.pronunciationEn,
  item.pronunciationTr,
  item.pronunciationNote!,
]
async function rate(page: Page, rating: 'Again' | 'Hard' | 'Good' | 'Easy') {
  await page
    .getByRole('group', { name: 'Rate your recall' })
    .getByRole('button', { name: new RegExp(`^${rating}\\b`) })
    .click()
}
async function upload(page: Page, label: string, value: unknown) {
  await page.getByLabel(label, { exact: true }).setInputFiles({
    name: 'browser-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(value)),
  })
}
function summaryCount(page: Page, label: string) {
  return page
    .locator('.practice-summary-counts > div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('dd')
}

test('speaking exposes only the situation and English cue until explicit reveal', async ({
  page,
}) => {
  await openNotebook(page)
  await start(page, 'Speaking')
  await expect(page.getByText(first.situation, { exact: true })).toBeVisible()
  await expect(page.getByText(first.english, { exact: true })).toBeVisible()
  await absentFromDOMAndAria(page, [first.french, ...hiddenGuides(first)])
  await expect(
    page.getByRole('group', { name: 'Rate your recall' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Listen to/ })).toHaveCount(0)
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeFocused()
  await expect(page.locator('.practice-answer')).toContainText(first.turkish)
  await expect(page.locator('.practice-answer')).toContainText(
    first.pronunciationEn,
  )
  await expect(page.locator('.practice-answer')).toContainText(
    first.pronunciationTr,
  )
  await expect(page.locator('.practice-answer')).toContainText(
    first.pronunciationNote!,
  )
})

test('listening hides every answer field and plays only mocked French, including slower playback', async ({
  page,
}) => {
  await openNotebook(page)
  await start(page, 'Listening')
  await absentFromDOMAndAria(page, [
    first.french,
    first.english,
    first.situation,
    ...hiddenGuides(first),
  ])
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  await page.evaluate(() => {
    window.__browserAudio.holdSpeech = true
  })
  await page
    .getByRole('button', { name: 'Play French audio', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([
    { text: first.french, lang: 'fr-FR', rate: 0.85, voiceURI: 'mock-fr-FR' },
  ])
  await page.evaluate(() => window.__browserAudio.finish())
  await page.getByRole('button', { name: /^Slower/ }).click()
  expect(
    await page.evaluate(() => window.__browserAudio.calls.at(-1)?.rate),
  ).toBeCloseTo(0.85 * 0.72)
  await page.evaluate(() => window.__browserAudio.finish())
  await absentFromDOMAndAria(page, [
    first.french,
    first.english,
    ...hiddenGuides(first),
  ])
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeFocused()
  await expect(page.locator('.practice-answer')).toContainText(first.english)
  const cancellations = await page.evaluate(
    () => window.__browserAudio.cancellations,
  )
  await page.getByRole('button', { name: 'Reading', exact: true }).click()
  await expect(page.locator('.practice-card')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Start due session', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => window.__browserAudio.cancellations),
  ).toBeGreaterThan(cancellations)
})

test('reading shows French but no meaning, pronunciation, usage, or audio before reveal', async ({
  page,
}) => {
  await openNotebook(page)
  await start(page, 'Reading')
  await expect(page.getByText(first.french, { exact: true })).toBeVisible()
  await absentFromDOMAndAria(page, [
    first.english,
    first.situation,
    ...hiddenGuides(first),
  ])
  await expect(
    page.getByRole('group', { name: 'Rate your recall' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Listen to/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(
    page.getByRole('heading', { name: 'Meaning and pronunciation' }),
  ).toBeFocused()
  await expect(page.locator('.practice-answer')).toContainText(first.english)
  expect((await storedData(page)).reviews).toEqual([])
})

test('missing French voices allow a no-progress skip and voiceschanged enables the next card', async ({
  page,
}) => {
  await openNotebook(page)
  await page.evaluate(() => window.__browserAudio.changeVoices(false))
  await start(page, 'Listening')
  await expect(
    page.getByText(/no recording and no French voice is available/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Play French audio' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Skip card without rating' }).click()
  expect((await storedData(page)).reviews).toEqual([])
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await page.evaluate(() => window.__browserAudio.changeVoices(true))
  await page.getByRole('button', { name: 'Play French audio' }).click()
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeEnabled()
  expect(
    await page.evaluate(() =>
      window.__browserAudio.calls.map((call) => call.lang),
    ),
  ).toEqual(['fr-FR'])
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(
    page.getByRole('heading', { name: second.french, exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Skip card without rating' }).click()
  await expect(summaryCount(page, 'Cards skipped without rating')).toHaveText(
    '2',
  )
  expect((await storedData(page)).reviews).toEqual([])
})

test('failed synthesis keeps listening answers hidden and can be skipped without a rating', async ({
  page,
}) => {
  await openNotebook(page, notebook([first]))
  await page.evaluate(() => {
    window.__browserAudio.failSpeech = true
  })
  await start(page, 'Listening')
  await page.getByRole('button', { name: 'Play French audio' }).click()
  await expect(page.locator('.practice-card').getByRole('alert')).toContainText(
    'French audio could not play',
  )
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  await absentFromDOMAndAria(page, [
    first.french,
    first.english,
    ...hiddenGuides(first),
  ])
  await expect(
    page.getByRole('group', { name: 'Rate your recall' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Skip card without rating' }).click()
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible()
  await expect(summaryCount(page, 'Ratings saved')).toHaveText('0')
  await expect(summaryCount(page, 'Cards skipped without rating')).toHaveText(
    '1',
  )
  expect((await storedData(page)).reviews).toEqual([])
})

test('a failed recording does not silently synthesize; explicit French fallback recovers', async ({
  page,
}) => {
  const recorded = {
    ...first,
    audioUrl: 'https://recordings.invalid/ticket.mp3',
  }
  await openNotebook(page, notebook([recorded]))
  await start(page, 'Listening')
  await page.getByRole('button', { name: 'Play French audio' }).click()
  await expect(page.locator('.practice-card').getByRole('alert')).toContainText(
    'French audio could not play',
  )
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([recorded.audioUrl])
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  await absentFromDOMAndAria(page, [
    first.french,
    first.english,
    ...hiddenGuides(first),
  ])
  await page
    .getByRole('button', {
      name: 'Use French speech instead of recording',
      exact: true,
    })
    .click()
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeEnabled()
  await expect(page.locator('.practice-card').getByRole('alert')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      window.__browserAudio.calls.map((call) => call.text),
    ),
  ).toEqual([first.french])
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await rate(page, 'Good')
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible()
  expect((await storedData(page)).reviews[0]?.mode).toBe('listening')
})

test('due-first daily-limited ratings persist, Again returns later, and extra practice is isolated', async ({
  page,
}) => {
  const data = notebook([first, second, third])
  data.preferences.dailyNewLimit = 1
  data.reviews = [dueReview(second.id)]
  await openNotebook(page, data)
  await start(page, 'Speaking')
  await expect(page.getByText(second.english, { exact: true })).toBeVisible()
  await expect(page.getByText(/Started with 2\./)).toBeVisible()
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await rate(page, 'Again')
  await expect(page.getByText(first.english, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await rate(page, 'Good')
  await expect(page.getByText(second.english, { exact: true })).toBeVisible()
  await absentFromDOMAndAria(page, [second.french, ...hiddenGuides(second)])
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await rate(page, 'Good')
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible()
  await expect(summaryCount(page, 'Ratings saved')).toHaveText('3')
  await expect(summaryCount(page, 'Again ratings (included above)')).toHaveText(
    '1',
  )
  const saved = await storedData(page)
  expect(
    saved.reviews
      .find((review) => review.expressionId === second.id)
      ?.history.map((event) => event.rating),
  ).toEqual(['good', 'again', 'good'])
  expect(
    saved.reviews
      .find((review) => review.expressionId === first.id)
      ?.history.map((event) => event.rating),
  ).toEqual(['good'])
  expect(saved.reviews.some((review) => review.expressionId === third.id)).toBe(
    false,
  )
  await page.reload()
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(saved)
  await start(page, 'Speaking', true)
  for (let turn = 0; turn < 3; turn++) {
    await page.getByRole('button', { name: 'Reveal answer' }).click()
    await rate(page, 'Easy')
  }
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible()
  await expect(summaryCount(page, 'Ratings (practice only)')).toHaveText('3')
  await expect(page.locator('.practice-summary')).toContainText(
    'No saved progress, review schedule, or daily new-expression count was changed',
  )
  expect(await storedData(page)).toEqual(saved)
})

test('failed rating writes retain the revealed card; rapid retries save exactly one rating', async ({
  page,
}) => {
  const data = notebook([first])
  await openNotebook(page, data)
  await start(page, 'Speaking')
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await page.evaluate(() => {
    window.__browserAudio.failWrites = true
  })
  await rate(page, 'Good')
  await expect(page.locator('.practice-card').getByRole('alert')).toContainText(
    'Your rating could not be saved',
  )
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(data)
  await page.evaluate(() => {
    window.__browserAudio.failWrites = false
  })
  await page
    .getByRole('group', { name: 'Rate your recall' })
    .getByRole('button', { name: /^Good\b/ })
    .evaluate((button) => {
      ; (button as HTMLButtonElement).click()
        ; (button as HTMLButtonElement).click()
    })
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeVisible()
  expect(
    (await storedData(page)).reviews[0]?.history.map((event) => event.rating),
  ).toEqual(['good'])
})

test('manual add, edit, cancelled deletion, and confirmed deletion survive reload', async ({
  page,
}) => {
  await openNotebook(page, notebook([first]))
  await page
    .getByRole('button', { name: 'Add expression', exact: true })
    .click()
  const fields = {
    'French expression': 'Un café pour moi.',
    'English meaning': 'A coffee for me.',
    'Turkish meaning': 'Benim için bir kahve.',
    'English approximation': 'uhn ka-FEH poor MWAH',
    'Turkish approximation': 'ön kafe pur mua',
    'When would you use it?': 'Order at a café.',
    Category: 'Café',
    'Lesson number': '2',
  }
  for (const [label, value] of Object.entries(fields))
    await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel(/^Tags/).fill('coffee, morning')
  await page
    .getByLabel(/^Pronunciation note/)
    .fill('A memory aid, not exact phonetics.')
  await page
    .getByRole('button', { name: 'Save expression', exact: true })
    .click()
  await expect(
    page.getByRole('heading', {
      name: fields['French expression'],
      exact: true,
    }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: fields['French expression'],
      exact: true,
    }),
  ).toBeVisible()
  const added = (await storedData(page)).expressions.find(
    (item) => item.french === fields['French expression'],
  )!
  expect(added.tags).toEqual(['coffee', 'morning'])
  expect(added.pronunciationTr).toBe(fields['Turkish approximation'])
  await page
    .getByRole('button', { name: `Edit ${added.french}`, exact: true })
    .click()
  await page
    .getByLabel('English meaning', { exact: true })
    .fill('One coffee for me, please.')
  await page
    .getByRole('button', { name: 'Save expression', exact: true })
    .click()
  await expect(
    page.getByText('One coffee for me, please.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText('One coffee for me, please.', { exact: true }),
  ).toBeVisible()
  const card = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: added.french, exact: true }),
  })
  await card.getByRole('button', { name: 'Notes & audio', exact: true }).click()
  await card
    .getByRole('button', { name: 'Delete expression', exact: true })
    .click()
  const dialog = page.getByRole('alertdialog')
  await expect(
    dialog.getByRole('button', { name: 'Keep expression' }),
  ).toBeFocused()
  await dialog.getByRole('button', { name: 'Keep expression' }).click()
  await expect(card).toBeVisible()
  await card
    .getByRole('button', { name: 'Delete expression', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: added.french, exact: true }),
  ).toHaveCount(0)
  expect((await storedData(page)).expressions).toEqual([first])
})

test('invalid imports are atomic, preview cancellation is harmless, and vocabulary updates preserve history', async ({
  page,
}) => {
  const data = notebook([first])
  data.reviews = [dueReview(first.id)]
  await openNotebook(page, data)
  await navigate(page, 'Manage')
  await upload(page, 'Choose lesson JSON file', {
    kind: 'petit-lesson',
    version: 1,
    expressions: [third, { ...second, audioUrl: 'javascript:alert(1)' }],
  })
  await expect(page.getByRole('alert')).toContainText(
    'Your current data is unchanged',
  )
  await expect(
    page.getByRole('button', { name: 'Apply lesson', exact: true }),
  ).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  const updated = { ...first, english: 'Updated ticket meaning', lesson: 2 }
  const lesson = {
    kind: 'petit-lesson',
    version: 1,
    expressions: [updated, second],
  }
  await page
    .getByLabel('Lesson JSON', { exact: true })
    .fill(JSON.stringify(lesson))
  await page.getByRole('button', { name: 'Validate & preview' }).click()
  await expect(
    page.getByRole('heading', { name: 'Review this lesson' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel import' }).click()
  await expect(
    page.getByRole('heading', { name: 'Review this lesson' }),
  ).toHaveCount(0)
  expect(await storedData(page)).toEqual(data)
  await page.getByRole('button', { name: 'Validate & preview' }).click()
  await page.getByLabel('When an ID already exists').selectOption('update')
  await page.getByRole('button', { name: 'Apply lesson', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Lesson added' }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual({
    ...data,
    expressions: [updated, second],
  })
  await page.reload()
  await expect(page.getByText(updated.english, { exact: true })).toBeVisible()
  expect((await storedData(page)).reviews).toEqual(data.reviews)
})

test('backup export contains the notebook and restore requires explicit replacement confirmation', async ({
  page,
}) => {
  const data = notebook([first, second])
  data.reviews = [dueReview(first.id)]
  await openNotebook(page, data)
  await navigate(page, 'Manage')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Download full backup/ }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^petit-backup-.*\.json$/)
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Backup download did not provide a stream')
  let text = ''
  for await (const chunk of stream) text += String(chunk)
  expect(JSON.parse(text)).toEqual({
    kind: 'petit-backup',
    version: 1,
    exportedAt: expect.any(String),
    data,
  })
  const replacement = notebook([third])
  replacement.preferences = {
    voiceURI: 'mock-fr-FR',
    rate: 0.7,
    dailyNewLimit: 0,
  }
  replacement.reviews = [dueReview(third.id, 'reading')]
  const backup = {
    kind: 'petit-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: replacement,
  }
  await page.getByText('Restore a full backup', { exact: true }).click()
  await upload(page, 'Choose full backup JSON', backup)
  await expect(
    page.getByRole('heading', { name: 'Validated backup' }),
  ).toBeVisible()
  const confirm = page.getByLabel('Type REPLACE to confirm replacement', {
    exact: true,
  })
  const replace = page.getByRole('button', { name: 'Replace with backup' })
  await expect(replace).toBeDisabled()
  await confirm.fill('replace')
  await expect(replace).toBeDisabled()
  await confirm.fill('REPLACE')
  await expect(replace).toBeEnabled()
  expect(await storedData(page)).toEqual(data)
  await page.getByRole('button', { name: 'Cancel restore' }).click()
  expect(await storedData(page)).toEqual(data)
  await upload(page, 'Choose full backup JSON', backup)
  await expect(replace).toBeDisabled()
  await confirm.fill('REPLACE')
  await replace.click()
  await expect(
    page.getByRole('status').filter({ hasText: 'Backup restored' }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(replacement)
  await page.reload()
  await expect(
    page.getByRole('heading', { name: third.french, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toHaveCount(0)
  await navigate(page, 'Manage')
  await expect(page.getByLabel('New expressions per day')).toHaveValue('0')
  await expect(page.getByLabel('Normal speech speed')).toHaveValue('0.7')
  await expect(
    page.getByRole('combobox', { name: /^French voice/ }),
  ).toHaveValue('mock-fr-FR')
})

test('native keyboard navigation reaches practice and reveal moves focus to the answer', async ({
  page,
}) => {
  await openNotebook(page, notebook([first]))
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Practice', exact: true })
    .focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await page.getByRole('button', { name: 'Speaking', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(
    page.getByRole('button', { name: 'Speaking', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Listening', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Start due session', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: /Due session · Speaking · Turn 1/ }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', {
      name: `Listen to ${first.french}`,
      exact: true,
    }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  expect(
    await page.evaluate(() => window.__browserAudio.calls.at(-1)?.text),
  ).toBe(first.french)
  await page
    .getByRole('group', { name: 'Rate your recall' })
    .getByRole('button', { name: /^Good\b/ })
    .focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Session complete' }),
  ).toBeFocused()
})

test('390×844 mobile library, practice, import preview, and expression form do not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openNotebook(page)
  const noOverflow = async () => {
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      )
      .toBeLessThanOrEqual(1)
  }
  await noOverflow()
  await start(page, 'Speaking')
  await noOverflow()
  await page.getByRole('button', { name: 'Reveal answer' }).click()
  await noOverflow()
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeVisible()
  await navigate(page, 'Manage')
  await page.getByLabel('Lesson JSON', { exact: true }).fill(
    JSON.stringify({
      kind: 'petit-lesson',
      version: 1,
      expressions: [third],
    }),
  )
  await page.getByRole('button', { name: 'Validate & preview' }).click()
  await expect(
    page.getByRole('heading', { name: 'Review this lesson' }),
  ).toBeVisible()
  await noOverflow()
  await page.getByRole('button', { name: 'Cancel import' }).click()
  await page
    .getByRole('button', { name: 'Add an expression', exact: true })
    .click()
  await expect(
    page.getByLabel('French expression', { exact: true }),
  ).toBeVisible()
  await noOverflow()
})

test('loading is explicit, and an initialized empty notebook stays empty across reloads', async ({
  page,
}) => {
  const empty = notebook([])
  await openNotebook(page, empty)
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: (name: string, version?: number) =>
        sessionStorage.getItem('allow-test-storage')
          ? open(name, version)
          : (new EventTarget() as IDBOpenDBRequest),
    })
  })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Opening your notebook…' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Add expression', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('searchbox', { name: 'Search expressions' }),
  ).toHaveCount(0)
  await page.evaluate(() => sessionStorage.setItem('allow-test-storage', 'yes'))
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Your next word starts here' }),
  ).toBeVisible()
  await navigate(page, 'Practice')
  await page.getByRole('button', { name: 'Speaking', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Start due session', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Start extra practice', exact: true }),
  ).toBeDisabled()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Your next word starts here' }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(empty)
})

test('storage-open errors explain recovery and Retry preserves the existing notebook', async ({
  page,
}) => {
  const data = notebook([first])
  data.reviews = [dueReview(first.id, 'reading')]
  await openNotebook(page, data)
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value: (name: string, version?: number) => {
        if (sessionStorage.getItem('deny-test-storage'))
          throw new DOMException('Mock storage denied', 'SecurityError')
        return open(name, version)
      },
    })
  })
  await page.evaluate(() => sessionStorage.setItem('deny-test-storage', 'yes'))
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Your notebook could not open' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(
    'Your existing data has not been replaced',
  )
  await expect(
    page.getByRole('button', { name: 'Add expression', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Retry opening storage' }),
  ).toBeEnabled()
  await page.evaluate(() => sessionStorage.removeItem('deny-test-storage'))
  await page.getByRole('button', { name: 'Retry opening storage' }).click()
  await expect(
    page.getByRole('heading', { name: first.french, exact: true }),
  ).toBeVisible()
  expect(await storedData(page)).toEqual(data)
})

test('French voice and speed preferences survive reload, and a missing saved voice never falls back to English', async ({
  page,
}) => {
  await openNotebook(page)
  await navigate(page, 'Manage')
  await page
    .getByRole('combobox', { name: 'French voice', exact: true })
    .selectOption('mock-fr-FR')
  await page
    .getByRole('combobox', { name: 'Normal speech speed', exact: true })
    .selectOption('0.7')
  await page
    .getByRole('button', { name: 'Save audio preferences', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Audio preferences saved',
  )
  await page.reload()
  await navigate(page, 'Manage')
  await expect(
    page.getByRole('combobox', { name: 'French voice', exact: true }),
  ).toHaveValue('mock-fr-FR')
  await expect(
    page.getByRole('combobox', { name: 'Normal speech speed', exact: true }),
  ).toHaveValue('0.7')
  await page.evaluate(() => window.__browserAudio.changeVoices(false))
  await expect(page.getByText(/Your saved voice is unavailable/)).toBeVisible()
  await page
    .getByRole('button', { name: 'Preview saved French voice', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'No French voice is available',
  )
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await page.evaluate(() => window.__browserAudio.changeVoices(true))
  await page
    .getByRole('button', { name: 'Preview saved French voice', exact: true })
    .click()
  const calls = await page.evaluate(() => window.__browserAudio.calls)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    lang: 'fr-FR',
    rate: 0.7,
    voiceURI: 'mock-fr-FR',
  })
})

test('search shortcut respects text fields, and the native deletion dialog contains focus and cancels with Escape', async ({
  page,
}) => {
  await openNotebook(page)
  await page.locator('body').click({ position: { x: 1000, y: 20 } })
  await page.keyboard.press('/')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await page.keyboard.type('ticket/')
  await expect(page.getByRole('searchbox')).toHaveValue('ticket/')
  await page.getByRole('searchbox').fill('')
  await page
    .getByRole('button', { name: 'Notes & audio', exact: false })
    .first()
    .click()
  await page
    .getByRole('button', { name: 'Delete expression', exact: true })
    .click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Keep expression' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    dialog.getByRole('button', { name: 'Delete permanently' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    dialog.getByRole('button', { name: 'Keep expression' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await storedData(page)).expressions).toHaveLength(2)
})

test('female and male URLs can be edited independently without changing general audio or review history', async ({
  page,
}) => {
  const item = { ...first, audioUrl: 'https://example.com/general.mp3' }
  const data = notebook([item])
  data.reviews = [dueReview(first.id)]
  await openNotebook(page, data)
  await page
    .getByRole('button', { name: `Edit ${first.french}`, exact: true })
    .click()
  await page
    .locator('input[name="femaleAudioUrl"]')
    .fill('https://example.com/female.mp3')
  await page
    .locator('input[name="maleAudioUrl"]')
    .fill('https://example.com/male.mp3')
  await page
    .getByRole('button', { name: 'Save expression', exact: true })
    .click()
  await expect(page.getByRole('searchbox')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('searchbox')).toBeVisible()
  let saved = await storedData(page)
  expect(saved.expressions[0]).toMatchObject({
    audioUrl: item.audioUrl,
    femaleAudioUrl: 'https://example.com/female.mp3',
    maleAudioUrl: 'https://example.com/male.mp3',
  })
  expect(saved.reviews).toEqual(data.reviews)
  await page
    .getByRole('button', { name: `Edit ${first.french}`, exact: true })
    .click()
  await expect(page.locator('input[name="femaleAudioUrl"]')).toHaveValue(
    'https://example.com/female.mp3',
  )
  await page.locator('input[name="femaleAudioUrl"]').fill('')
  await page
    .getByRole('button', { name: 'Save expression', exact: true })
    .click()
  await expect(page.getByRole('searchbox')).toBeVisible()
  saved = await storedData(page)
  expect(saved.expressions[0]).not.toHaveProperty('femaleAudioUrl')
  expect(saved.expressions[0]).toMatchObject({
    audioUrl: item.audioUrl,
    maleAudioUrl: 'https://example.com/male.mp3',
  })
  expect(saved.reviews).toEqual(data.reviews)
})

test('recording selection controls normal and slower playback and stops without autoplay on change', async ({
  page,
}) => {
  const item = {
    ...first,
    audioUrl: 'https://example.com/general.mp3',
    femaleAudioUrl: 'https://example.com/female.mp3',
    maleAudioUrl: 'https://example.com/male.mp3',
  }
  await openNotebook(page, notebook([item]))
  await page.evaluate(() => {
    window.__browserAudio.failRecordings = false
    window.__browserAudio.holdRecordings = true
  })
  await page
    .getByRole('button', { name: `Listen to ${first.french}`, exact: true })
    .click()
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([item.audioUrl])
  await page.getByRole('button', { name: /Notes & audio/ }).click()
  const picker = page.getByRole('combobox', { name: 'Recording voice' })
  await expect(picker).toHaveValue('general')
  await picker.selectOption('female')
  await page.locator('.audio-button').click()
  await page.getByRole('button', { name: /Slower/ }).click()
  expect(
    await page.evaluate(() => window.__browserAudio.recordingRates),
  ).toEqual([1, 1, 0.75])
  const pauses = await page.evaluate(
    () => window.__browserAudio.recordingPauses,
  )
  await picker.selectOption('male')
  expect(
    await page.evaluate(() => window.__browserAudio.recordingPauses),
  ).toBeGreaterThan(pauses)
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([item.audioUrl, item.femaleAudioUrl, item.femaleAudioUrl])
  await page.locator('.audio-button').click()
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([
    item.audioUrl,
    item.femaleAudioUrl,
    item.femaleAudioUrl,
    item.maleAudioUrl,
  ])
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([])
})

for (const voice of ['female', 'male'] as const) {
  test(`listening supports a ${voice}-only recording without device voices and keeps answers hidden`, async ({
    page,
  }) => {
    const url = `https://example.com/${voice}.mp3`
    const item = {
      ...first,
      [voice === 'female' ? 'femaleAudioUrl' : 'maleAudioUrl']: url,
    }
    await openNotebook(page, notebook([item]))
    await page.evaluate(() => {
      window.__browserAudio.changeVoices(false)
      window.__browserAudio.failRecordings = false
    })
    await start(page, 'Listening')
    await expect(
      page.getByRole('combobox', { name: 'Recording voice' }),
    ).toHaveValue(voice)
    await absentFromDOMAndAria(page, [
      first.french,
      first.english,
      ...hiddenGuides(first),
    ])
    await page
      .getByRole('button', { name: 'Play French audio', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Reveal answer' }),
    ).toBeEnabled()
    expect(
      await page.evaluate(() => window.__browserAudio.recordingAttempts),
    ).toEqual([url])
    expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
    await page.getByRole('button', { name: 'Reveal answer' }).click()
    await expect(
      page.getByRole('heading', { name: first.french, exact: true }),
    ).toBeVisible()
    expect((await storedData(page)).reviews).toEqual([])
  })
}

test('a selected female recording never silently falls back to male or speech when it fails', async ({
  page,
}) => {
  const item = {
    ...first,
    femaleAudioUrl: 'https://example.com/female.mp3',
    maleAudioUrl: 'https://example.com/male.mp3',
  }
  await openNotebook(page, notebook([item]))
  await start(page, 'Listening')
  await page
    .getByRole('button', { name: 'Play French audio', exact: true })
    .click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([item.femaleAudioUrl])
  expect(await page.evaluate(() => window.__browserAudio.calls)).toEqual([])
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeDisabled()
  await page
    .getByRole('combobox', { name: 'Recording voice' })
    .selectOption('male')
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toHaveLength(1)
  await page.evaluate(() => {
    window.__browserAudio.failRecordings = false
  })
  await page
    .getByRole('button', { name: 'Play French audio', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Reveal answer' }),
  ).toBeEnabled()
  expect(
    await page.evaluate(() => window.__browserAudio.recordingAttempts),
  ).toEqual([item.femaleAudioUrl, item.maleAudioUrl])
  await page
    .getByRole('button', {
      name: 'Use French speech instead of recording',
      exact: true,
    })
    .click()
  expect(await page.evaluate(() => window.__browserAudio.calls)).toHaveLength(1)
  expect((await storedData(page)).reviews).toEqual([])
})

test('production assets and the lesson download resolve under the GitHub Pages subpath', async ({
  page,
  request,
}) => {
  const response = await page.goto('./')
  expect(response?.ok()).toBe(true)
  await expect(page.getByRole('searchbox')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/petit-a-petit/')
  const script = await page.locator('script[type="module"]').getAttribute('src')
  expect(script).toMatch(/^\/petit-a-petit\/assets\/.+\.js$/)
  expect((await request.get(script!)).ok()).toBe(true)
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href')
  expect(favicon).toBe('/petit-a-petit/favicon.svg')
  expect((await request.get(favicon!)).ok()).toBe(true)
  await navigate(page, 'Manage')
  const example = page.getByRole('link', { name: 'Example lesson JSON ↓' })
  await expect(example).toHaveAttribute(
    'href',
    '/petit-a-petit/example-lesson.json',
  )
  const lesson = await request.get((await example.getAttribute('href'))!)
  expect(lesson.ok()).toBe(true)
  expect(await lesson.json()).toMatchObject({
    kind: 'petit-lesson',
    version: 1,
  })
  const downloading = page.waitForEvent('download')
  await example.click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('example-lesson.json')
  expect(await download.failure()).toBeNull()
})

test('library, revealed practice, and Manage pass automated accessibility checks', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByRole('searchbox')).toBeVisible()
  const check = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([])
  }
  await check()
  await page.screenshot({
    path: 'test-results/library-desktop.png',
    fullPage: true,
  })
  await start(page, 'Speaking')
  await page.getByRole('button', { name: 'Reveal answer', exact: true }).click()
  await check()
  await navigate(page, 'Manage')
  await check()
  await page.setViewportSize({ width: 390, height: 844 })
  await navigate(page, 'Library')
  await check()
  await page.screenshot({
    path: 'test-results/library-mobile.png',
    fullPage: true,
  })
})
