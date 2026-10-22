import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import {
  buildQueue,
  createBackup,
  createLesson,
  createSharedLibrary,
  defaultPreferences,
  newCountToday,
  normalize,
  openRepository,
  parseBackup,
  parseLesson,
  parseSharedLibrary,
  previewLesson,
  previewSharedLibrary,
  scheduleReview,
  seedExpressions,
  SHARED_LIBRARY_ID,
  SHARED_LIBRARY_NAME,
  validateAudioUrl,
  validateSharedLibrary,
} from '../src/data'
import type {
  AppData,
  Backup,
  Expression,
  LessonImport,
  Mode,
  Repository,
  Review,
  SharedLibrary,
  SharedLibraryChoice,
} from '../src/data'

const now = new Date(2026, 9, 22, 12, 0, 0)
const repositories: Repository[] = []

function expression(id: string, fields: Partial<Expression> = {}): Expression {
  return {
    ...structuredClone(seedExpressions[0]!),
    id,
    french: `French ${id}`,
    ...fields,
  }
}

function data(
  expressions = [expression('a'), expression('b'), expression('c')],
): AppData {
  return {
    expressions,
    reviews: [],
    preferences: { ...defaultPreferences },
    initialized: true,
  }
}

function lesson(expressions: Expression[]): LessonImport {
  return { kind: 'petit-lesson', version: 1, expressions }
}

function shared(expressions: Expression[], revision = 1): SharedLibrary {
  return createSharedLibrary(data(expressions), revision, now)
}

async function applyShared(
  repo: Repository,
  library: SharedLibrary,
  choices: Record<string, SharedLibraryChoice> = {},
): Promise<AppData> {
  const preview = previewSharedLibrary(library, await repo.load())
  return repo.applySharedLibrary(library, choices, preview.token)
}

async function repository(initial?: AppData): Promise<Repository> {
  const repo = await openRepository()
  repositories.push(repo)
  if (initial) await repo.restore(createBackup(initial))
  return repo
}

function review(id: string, mode: Mode, at = now): Review {
  return scheduleReview(undefined, id, mode, 'good', at)
}

function parseItem(value: unknown): Expression {
  return parseLesson(JSON.stringify({ ...lesson([]), expressions: [value] }))
    .expressions[0]!
}

function legacyExpression(
  item = expression('legacy'),
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...item,
    situation: item.situationEn,
  }
  if (item.pronunciationNoteEn !== undefined)
    result.pronunciationNote = item.pronunciationNoteEn
  delete result.situationEn
  delete result.situationTr
  delete result.pronunciationNoteEn
  delete result.pronunciationNoteTr
  return result
}

// Bypass repository validation to exercise real pre-transition persisted records.
async function storedState(value?: unknown): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('petit-a-petit', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      'state',
      value === undefined ? 'readonly' : 'readwrite',
    )
    const store = tx.objectStore('state')
    const request =
      value === undefined ? store.get('app') : store.put(value, 'app')
    tx.oncomplete = () => {
      db.close()
      resolve(request.result as unknown)
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error)
    }
  })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  for (const repo of repositories.splice(0)) repo.close()
})

describe('seeds and text safety', () => {
  test('seven stable lesson-one expressions have the requested pronunciation guides', () => {
    expect(
      seedExpressions.map((item) => [
        item.id,
        item.french,
        item.pronunciationEn,
        item.pronunciationTr,
      ]),
    ).toEqual([
      ['seed-bonjour', 'Bonjour', 'bohn-ZHOOR', 'bonjur'],
      ['seed-bonsoir', 'Bonsoir', 'bohn-SWAHR', 'bonsuar'],
      ['seed-desole', 'Désolé', 'day-zoh-LAY', 'dezole'],
      ['seed-anglais', 'Anglais', 'ahn-GLAY', 'angle'],
      ['seed-sil-vous-plait', 'S’il vous plaît', 'seel voo PLEH', 'sil vu ple'],
      ['seed-excusez-moi', 'Excusez-moi', 'ehk-skü-zay MWAH', 'eksküze mua'],
      ['seed-au-revoir', 'Au revoir', 'oh ruh-VWAHR', 'o rövuar'],
    ])
    expect(
      seedExpressions.every(
        (item) =>
          item.lesson === 1 &&
          item.turkish &&
          item.situationEn &&
          item.situationTr &&
          item.category &&
          item.pronunciationNoteEn &&
          item.pronunciationNoteTr,
      ),
    ).toBe(true)
    expect(seedExpressions[6]!.pronunciationNoteEn).toContain(
      'vuar → rövuar → o rövuar',
    )
    expect(seedExpressions[6]!.pronunciationNoteTr).toContain(
      'vuar → rövuar → o rövuar',
    )
    expect(seedExpressions.map((item) => item.situationTr)).toEqual([
      'Gündüz birini selamlarken, örneğin bir dükkâna girerken kullanın.',
      'Akşam birini selamlarken kullanın.',
      'Küçük bir hata için özür dilerken kullanın.',
      'İngilizceden söz ederken, örneğin birinin hangi dili konuştuğunu sorarken kullanın.',
      'Tanımadığınız birine veya birden fazla kişiye hitap ederken isteğinizi kibarlaştırmak için kullanın.',
      'Birinin dikkatini kibarca çekmek veya yanından geçmek için kullanın.',
      'Bir dükkândan ayrılırken veya konuşmayı bitirirken vedalaşmak için kullanın.',
    ])
    for (const item of seedExpressions) {
      expect(item.pronunciationNoteEn).toMatch(
        /Capital letters.*Nasal n.*French r.*ü/,
      )
      expect(item.pronunciationNoteTr).toMatch(
        /Büyük harfler.*Geniz.*Fransızca r.*ü/,
      )
      expect(item.situationTr).not.toBe(item.situationEn)
      expect(item.pronunciationNoteTr).not.toBe(item.pronunciationNoteEn)
    }
    expect(
      parseLesson(JSON.stringify(lesson(seedExpressions))).expressions,
    ).toEqual(seedExpressions)
  })

  test('normalization is comparison-only, accent/case/apostrophe/whitespace insensitive', () => {
    expect(normalize('  S’IL  VOUS PLAÎT\n')).toBe(normalize("s'il vous plait"))
    expect(normalize('DE\u0301SOLE\u0301')).toBe('desole')
    expect(normalize('HAYIR')).toBe(normalize('Hayır'))
    expect(normalize('İNGİLİZCE')).toBe(normalize('İngilizce'))
    const literal = expression('literal', {
      french: ' <script>alert("x")</script> & Désolé ',
      english: '<img src=x onerror=alert(1)>',
    })
    expect(
      parseLesson(JSON.stringify(lesson([literal]))).expressions[0],
    ).toEqual(literal)
  })

  test('audio URL policy permits only absolute HTTP(S) without credentials', () => {
    for (const url of [
      'https://example.com/a.mp3',
      'http://localhost:8080/audio?q=1#part',
      'HTTPS://example.com/%20.mp3',
    ])
      expect(validateAudioUrl(url)).toBe(true)
    for (const url of [
      '',
      '/audio.mp3',
      '//example.com/a',
      'https:example.com/a',
      'javascript:alert(1)',
      'data:audio/mp3;base64,AAA',
      'blob:https://example.com/x',
      'file:///tmp/a',
      'https://user:pass@example.com/a',
      'https://user@example.com',
      'https://@example.com',
      ' https://example.com',
      'https://example.com/\na',
      'https://example.com/with space',
      'https://example.com\\evil',
      'https://',
    ])
      expect(validateAudioUrl(url)).toBe(false)
  })
})

describe('scheduling and global daily introductions', () => {
  test('default daily budget is three without replacing saved preferences', async () => {
    expect(defaultPreferences.dailyNewLimit).toBe(3)
    const repo = await repository()
    const initial = await repo.load()
    expect(initial.preferences.dailyNewLimit).toBe(3)
    const queue = buildQueue(initial, 'reading', now)
    expect(queue).toHaveLength(3)
    for (const item of queue) await repo.rate(item.id, 'reading', 'good', now)
    const next = initial.expressions.find(
      (item) => !queue.some((candidate) => candidate.id === item.id),
    )!
    await expect(repo.rate(next.id, 'reading', 'good', now)).rejects.toThrow(
      'limit (3)',
    )
    await repo.savePreferences({ ...defaultPreferences, dailyNewLimit: 5 })
    repo.close()
    expect((await (await repository()).load()).preferences.dailyNewLimit).toBe(
      5,
    )
  })

  test('first intervals and repeated multipliers are exact', () => {
    const intervals = { again: 1 / 1440, hard: 1, good: 1, easy: 3 } as const
    for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
      const result = scheduleReview(undefined, 'a', 'reading', rating, now)
      expect(result.intervalDays).toBe(intervals[rating])
      expect(Date.parse(result.dueAt)).toBe(
        now.getTime() + intervals[rating] * 86_400_000,
      )
      expect(result.history).toEqual([{ at: now.toISOString(), rating }])
    }
    const previous = scheduleReview(undefined, 'a', 'reading', 'easy', now)
    expect(
      scheduleReview(previous, 'a', 'reading', 'hard', now).intervalDays,
    ).toBe(3 * 1.2)
    expect(
      scheduleReview(previous, 'a', 'reading', 'good', now).intervalDays,
    ).toBe(6)
    expect(
      scheduleReview(previous, 'a', 'reading', 'easy', now).intervalDays,
    ).toBe(9)
    expect(
      scheduleReview(previous, 'a', 'reading', 'again', now).intervalDays,
    ).toBe(1 / 1440)
    expect(previous.history).toHaveLength(1)
  })

  test('non-Again ratings recover to their day floors after repeated Again ratings', () => {
    const long = scheduleReview(undefined, 'a', 'reading', 'easy', now)
    const reset = scheduleReview(long, 'a', 'reading', 'again', now)
    const again = scheduleReview(
      reset,
      'a',
      'reading',
      'again',
      new Date(now.getTime() + 60_000),
    )
    expect(again.intervalDays).toBe(1 / 1440)
    const at = new Date(now.getTime() + 120_000)
    for (const [rating, days] of [
      ['hard', 1],
      ['good', 1],
      ['easy', 3],
    ] as const) {
      const recovered = scheduleReview(again, 'a', 'reading', rating, at)
      expect(recovered.intervalDays).toBe(days)
      expect(Date.parse(recovered.dueAt)).toBe(at.getTime() + days * 86_400_000)
      expect(recovered.history.map((event) => event.rating)).toEqual([
        'easy',
        'again',
        'again',
        rating,
      ])
      const state = data()
      state.reviews = [recovered]
      expect(parseBackup(JSON.stringify(createBackup(state))).data).toEqual(
        state,
      )
    }
    expect(again.history).toHaveLength(3)
  })

  test('rejects invalid clocks, mismatched reviews, and backwards ratings', () => {
    const previous = review('a', 'reading')
    expect(() => scheduleReview(previous, 'b', 'reading', 'good', now)).toThrow(
      'same expressionId',
    )
    expect(() =>
      scheduleReview(previous, 'a', 'listening', 'good', now),
    ).toThrow('same expressionId')
    expect(() =>
      scheduleReview(
        previous,
        'a',
        'reading',
        'good',
        new Date(now.getTime() - 1),
      ),
    ).toThrow('earlier')
    expect(() =>
      scheduleReview(undefined, 'a', 'reading', 'good', new Date('bad')),
    ).toThrow('valid Date')
    expect(() => buildQueue(data(), 'reading', new Date('bad'))).toThrow(
      'valid Date',
    )
  })

  test('new candidates are truncated, showing a queue does not consume budget, and extra returns all', () => {
    const state = data()
    state.preferences.dailyNewLimit = 1
    const before = structuredClone(state)
    expect(buildQueue(state, 'speaking', now).map((item) => item.id)).toEqual([
      'a',
    ])
    expect(buildQueue(state, 'speaking', now).map((item) => item.id)).toEqual([
      'a',
    ])
    expect(newCountToday(state, now)).toBe(0)
    expect(buildQueue(state, 'speaking', now, true)).toHaveLength(3)
    expect(state).toEqual(before)
  })

  test('one introduction is counted once across modes and only on its earliest local day', () => {
    const state = data()
    const yesterday = new Date(2026, 9, 21, 23, 59)
    state.reviews = [
      review('a', 'speaking', yesterday),
      review('a', 'listening'),
      review('b', 'speaking'),
      review('b', 'reading'),
    ]
    expect(newCountToday(state, now)).toBe(1)
    expect(newCountToday(state, yesterday)).toBe(1)
    expect(newCountToday(state, new Date(2026, 9, 23, 0, 0))).toBe(0)
  })

  test('local midnight boundaries are inclusive at start and exclusive at next midnight', () => {
    const state = data()
    state.reviews = [
      review('a', 'speaking', new Date(2026, 9, 22, 0, 0)),
      review('b', 'speaking', new Date(2026, 9, 21, 23, 59, 59, 999)),
      review('c', 'speaking', new Date(2026, 9, 23, 0, 0)),
    ]
    expect(newCountToday(state, now)).toBe(1)
  })

  test('local calendar boundaries remain correct on spring/fall DST dates', () => {
    for (const [month, day] of [
      [2, 8],
      [10, 1],
    ] as const) {
      const state = data()
      const noon = new Date(2026, month, day, 12)
      state.reviews = [
        review('a', 'reading', new Date(2026, month, day, 23, 59, 59)),
        review('b', 'reading', new Date(2026, month, day + 1, 0, 0)),
      ]
      expect(newCountToday(state, noon)).toBe(1)
    }
  })

  test('due first, oldest due first; future current-mode reviews excluded; other modes independent of cap', () => {
    const state = data(['a', 'b', 'c', 'd', 'e'].map((id) => expression(id)))
    state.preferences.dailyNewLimit = 1
    const earlier = new Date(now.getTime() - 3 * 86_400_000)
    const later = new Date(now.getTime() - 2 * 86_400_000)
    state.reviews = [
      review('a', 'speaking', later),
      review('b', 'speaking', earlier),
      review('c', 'speaking'),
      review('d', 'listening'),
    ]
    expect(buildQueue(state, 'speaking', now).map((item) => item.id)).toEqual([
      'b',
      'a',
      'd',
    ])
    expect(
      buildQueue(state, 'speaking', now, true).map((item) => item.id),
    ).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  test('introduced expressions do not consume remaining new-candidate slots', () => {
    const state = data(['a', 'b', 'c', 'd'].map((id) => expression(id)))
    state.preferences.dailyNewLimit = 2
    state.reviews = [review('b', 'reading')]
    expect(buildQueue(state, 'speaking', now).map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
    state.preferences.dailyNewLimit = 0
    expect(buildQueue(state, 'speaking', now).map((item) => item.id)).toEqual([
      'b',
    ])
  })

  test('empty-history review is still new and rating it uses the first interval', () => {
    const state = data()
    const empty: Review = {
      expressionId: 'a',
      mode: 'reading',
      dueAt: now.toISOString(),
      intervalDays: 0,
      history: [],
    }
    state.reviews = [empty]
    state.preferences.dailyNewLimit = 0
    expect(buildQueue(state, 'reading', now)).toEqual([])
    expect(
      scheduleReview(empty, 'a', 'reading', 'easy', now).intervalDays,
    ).toBe(3)
    expect(parseBackup(JSON.stringify(createBackup(state))).data).toEqual(state)
  })
})

describe('lesson parsing, preview, and merging', () => {
  test('preview separates IDs, normalized content conflicts, and additions, including within a lesson', () => {
    const existing = expression('a', { french: 'Désolé' })
    const update = { ...existing, english: 'Updated' }
    const duplicate = expression('b', { french: ' DE\u0301SOLE\u0301 ' })
    const addition = expression('c')
    const within = expression('d', { french: addition.french })
    const result = previewLesson(
      lesson([update, duplicate, addition, within]),
      [existing],
    )
    expect(result.updates).toEqual([update])
    expect(result.additions).toEqual([addition])
    expect(result.duplicates).toEqual([
      { incoming: duplicate, existing: update },
      { incoming: within, existing: addition },
    ])
    expect(existing.english).not.toBe('Updated')
  })

  test('skip vs update preserves review history and preferences; content duplicates require permission', async () => {
    const repo = await repository(data())
    const rated = await repo.rate('a', 'speaking', 'good', now)
    const update = expression('a', { english: 'New translation', lesson: 2 })
    const duplicate = expression('different-id', { french: ' french B ' })
    const addition = expression('d')
    const incoming = lesson([update, duplicate, addition])
    const skipped = await repo.applyLesson(incoming, 'skip', false)
    expect(
      skipped.expressions.find((item) => item.id === 'a')!.english,
    ).not.toBe('New translation')
    expect(skipped.expressions.map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    const updated = await repo.applyLesson(incoming, 'update', false)
    expect(updated.expressions.find((item) => item.id === 'a')!.english).toBe(
      'New translation',
    )
    expect(updated.reviews).toEqual(rated.reviews)
    expect(updated.preferences).toEqual(rated.preferences)
    const duplicated = await repo.applyLesson(incoming, 'update', true)
    expect(duplicated.expressions.map((item) => item.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'different-id',
    ])
    expect(duplicated.reviews).toEqual(rated.reviews)
  })

  test('ID collision never creates a second identity; update cannot silently introduce a content duplicate', async () => {
    const repo = await repository(data())
    const conflicting = lesson([expression('a', { french: 'French b' })])
    expect(
      (await repo.applyLesson(conflicting, 'update', false)).expressions[0]!
        .french,
    ).toBe('French a')
    const allowed = await repo.applyLesson(conflicting, 'update', true)
    expect(allowed.expressions).toHaveLength(3)
    expect(allowed.expressions[0]!.french).toBe('French b')
  })

  test('recording imports, updates, and vocabulary exports preserve all mode progress', async () => {
    const original = expression('a', {
      audioUrl: 'https://example.com/original.mp3',
      femaleAudioUrl: 'https://example.com/original-female.mp3',
      maleAudioUrl: 'https://example.com/original-male.mp3',
    })
    const repo = await repository(data([original]))
    await repo.rate('a', 'speaking', 'good', now)
    await repo.rate('a', 'listening', 'hard', now)
    const before = await repo.rate('a', 'reading', 'easy', now)
    const update = expression('a', {
      english: 'Updated with recordings',
      audioUrl: 'https://example.com/general.mp3',
      femaleAudioUrl: 'https://example.com/female.mp3',
      maleAudioUrl: 'https://example.com/male.mp3',
    })
    const addition = expression('new', {
      femaleAudioUrl: 'http://example.com/new-female.mp3',
      maleAudioUrl: 'https://example.com/new-male.mp3',
    })
    const incoming = parseLesson(JSON.stringify(lesson([update, addition])))
    expect(previewLesson(incoming, before.expressions)).toEqual({
      additions: [addition],
      updates: [update],
      duplicates: [],
    })
    const skipped = await repo.applyLesson(incoming, 'skip', false)
    expect(skipped.expressions).toEqual([original, addition])
    expect(skipped.reviews).toEqual(before.reviews)
    const updated = await repo.applyLesson(incoming, 'update', false)
    expect(updated.expressions).toEqual([update, addition])
    expect(updated.reviews).toEqual(before.reviews)
    expect(updated.preferences).toEqual(before.preferences)
    const exported = createLesson(updated)
    expect(exported.version).toBe(1)
    expect(parseLesson(JSON.stringify(exported))).toEqual(incoming)
    repo.close()
    expect(await (await repository()).load()).toEqual(updated)
  })

  test('the tomorrow lesson example parses and is lesson two', async () => {
    const text = await Bun.file(
      new URL('../public/example-lesson.json', import.meta.url),
    ).text()
    const example = parseLesson(text)
    expect(example.expressions).toHaveLength(3)
    expect(example.expressions.every((item) => item.lesson === 2)).toBe(true)
    for (const item of example.expressions) {
      expect(item.situationEn.trim()).not.toBe('')
      expect(item.situationTr.trim()).not.toBe('')
      expect(item.pronunciationNoteEn).toBeTruthy()
      expect(item.pronunciationNoteTr).toBeTruthy()
      expect(item.situationTr).not.toBe(item.situationEn)
      expect(item.pronunciationNoteTr).not.toBe(item.pronunciationNoteEn)
      expect(Object.hasOwn(item, 'situation')).toBe(false)
      expect(Object.hasOwn(item, 'pronunciationNote')).toBe(false)
      expect(item.audioUrl).toBeUndefined()
      expect(item.femaleAudioUrl).toBeUndefined()
      expect(item.maleAudioUrl).toBeUndefined()
    }
  })
})

describe('bilingual metadata and version 1 compatibility', () => {
  test('old lessons migrate literally without inventing translations or optional notes', () => {
    const original = expression('old', {
      situationEn: '  My edited <situation> & context  ',
      pronunciationNoteEn: '  My own pronunciation note  ',
      createdAt: '2026-01-01T01:00:00+01:00',
      updatedAt: '2026-01-02T01:00:00+01:00',
      audioUrl: 'https://example.com/general.mp3',
      femaleAudioUrl: 'https://example.com/female.mp3',
      maleAudioUrl: 'http://example.com/male.mp3',
    })
    const old = legacyExpression(original)
    const before = structuredClone(old)
    const expected = { ...original, situationTr: '' }
    delete expected.pronunciationNoteTr
    expect(parseItem(old)).toEqual(expected)
    expect(old).toEqual(before)
    delete old.pronunciationNote
    delete expected.pronunciationNoteEn
    expect(parseItem(old)).toEqual(expected)
    expect(Object.hasOwn(parseItem(old), 'pronunciationNoteTr')).toBe(false)
  })

  test.each(['old', 'mixed', 'dual'] as const)(
    '%s version 1 backups retain every ID, timestamp, recording, preference and mode review',
    async (shape) => {
      const original = expression('progress', {
        createdAt: '2026-01-01T01:00:00+01:00',
        updatedAt: '2026-01-02T01:00:00+01:00',
        audioUrl: 'https://example.com/general.mp3',
        femaleAudioUrl: 'https://example.com/female.mp3',
        maleAudioUrl: 'http://example.com/male.mp3',
      })
      const expectedItem = { ...original }
      const incoming =
        shape === 'dual' ? { ...original } : legacyExpression(original)
      if (shape !== 'dual') expectedItem.situationTr = ''
      if (shape === 'old') delete expectedItem.pronunciationNoteTr
      if (shape === 'mixed') {
        delete (incoming as Record<string, unknown>).pronunciationNote
        incoming.pronunciationNoteEn = original.pronunciationNoteEn
        incoming.pronunciationNoteTr = original.pronunciationNoteTr
      }
      const expected = data([expectedItem])
      expected.preferences = {
        voiceURI: 'saved-voice',
        rate: 0.6,
        dailyNewLimit: 7,
      }
      expected.reviews = ['speaking', 'listening', 'reading'].map((mode) =>
        review(original.id, mode as Mode),
      )
      const raw = {
        kind: 'petit-backup',
        version: 1,
        exportedAt: '2026-10-22T13:00:00+01:00',
        data: { ...expected, expressions: [incoming] },
      }
      const parsed = parseBackup(JSON.stringify(raw))
      expect(parsed.exportedAt).toBe(raw.exportedAt)
      expect(parsed.version).toBe(1)
      expect(parsed.data).toEqual(expected)
      const repo = await repository(data([]))
      expect(await repo.restore(parsed)).toEqual(expected)
      repo.close()
      expect(await (await repository()).load()).toEqual(expected)
      expect(await storedState()).toEqual(expected)
      // Export validation must also migrate unparsed legacy/mixed runtime input.
      const backup = createBackup(raw.data as unknown as AppData)
      const exportedLesson = createLesson(raw.data as unknown as AppData)
      expect(backup.data).toEqual(expected)
      expect(exportedLesson.expressions).toEqual([expectedItem])
      for (const output of [parsed, backup, exportedLesson]) {
        expect(JSON.stringify(output)).not.toMatch(
          /"(?:situation|pronunciationNote)":/,
        )
      }
    },
  )

  test('matching legacy and new English text is accepted and removed; Turkish fields win independently', () => {
    const item = expression('matching')
    const incoming = {
      ...item,
      situation: item.situationEn,
      pronunciationNote: item.pronunciationNoteEn,
    }
    expect(parseItem(incoming)).toEqual(item)
    const withOnlyTurkish = legacyExpression(item)
    withOnlyTurkish.situationTr = item.situationTr
    withOnlyTurkish.pronunciationNoteTr = item.pronunciationNoteTr
    expect(parseItem(withOnlyTurkish)).toEqual(item)
  })

  test('either situation can be missing or empty; canonical output always has both strings', () => {
    const item = expression('partial')
    for (const missing of ['situationEn', 'situationTr'] as const) {
      const input: Record<string, unknown> = { ...item }
      delete input[missing]
      expect(parseItem(input)).toEqual({ ...item, [missing]: '' })
      expect(parseItem({ ...item, [missing]: '' })).toEqual({
        ...item,
        [missing]: '',
      })
    }
    expect(
      parseItem({ ...item, situationEn: '  ', situationTr: ' bağlam ' })
        .situationEn,
    ).toBe('  ')
    const noSituations: Record<string, unknown> = { ...item }
    delete noSituations.situationEn
    delete noSituations.situationTr
    for (const input of [
      noSituations,
      { ...item, situationEn: '', situationTr: '' },
      { ...item, situationEn: ' \n', situationTr: '\t' },
      { ...noSituations, situation: ' ' },
    ])
      expect(() => parseItem(input)).toThrow(
        'provide at least one nonblank situationEn or situationTr',
      )
  })

  test('explicit undefined situations and legacy fields are invalid direct input, even with new fields', () => {
    for (const field of [
      'situationEn',
      'situationTr',
      'situation',
      'pronunciationNote',
    ])
      expect(() =>
        createLesson(
          data([{ ...expression('undefined'), [field]: undefined }]),
        ),
      ).toThrow(`data.expressions[0].${field}:`)
  })

  test('notes stay optional, including empty strings, without synthesizing another language', () => {
    const item = expression('notes')
    delete item.pronunciationNoteEn
    delete item.pronunciationNoteTr
    expect(parseItem(item)).toEqual(item)
    for (const field of [
      'pronunciationNoteEn',
      'pronunciationNoteTr',
    ] as const) {
      expect(parseItem({ ...item, [field]: '' })).toEqual({
        ...item,
        [field]: '',
      })
      expect(parseItem({ ...item, [field]: ' note ' })).toEqual({
        ...item,
        [field]: ' note ',
      })
      expect(
        createLesson(data([{ ...item, [field]: undefined }])).expressions,
      ).toEqual([item])
    }
    expect(parseItem({ ...item, pronunciationNote: '' })).toEqual({
      ...item,
      pronunciationNoteEn: '',
    })
  })

  test.each([
    ['situation', 4000],
    ['situationEn', 4000],
    ['situationTr', 4000],
    ['pronunciationNote', 8000],
    ['pronunciationNoteEn', 8000],
    ['pronunciationNoteTr', 8000],
  ] as const)(
    '%s validates types and length atomically even alongside the new fields',
    async (field, max) => {
      const repo = await repository(data())
      const before = await repo.rate('a', 'reading', 'good', now)
      for (const value of [null, 42, true, [], {}, 'x'.repeat(max + 1)]) {
        const invalid = { ...expression('bad'), [field]: value }
        expect(() => parseItem(invalid)).toThrow(
          `lesson.expressions[0].${field}:`,
        )
        await expect(repo.saveExpression(invalid)).rejects.toThrow(
          `expression.${field}:`,
        )
        await expect(
          repo.applyLesson(
            { ...lesson([]), expressions: [expression('new'), invalid] },
            'update',
            false,
          ),
        ).rejects.toThrow(`lesson.expressions[1].${field}:`)
        const backup = {
          ...createBackup(before),
          data: {
            ...before,
            expressions: [expression('new'), invalid],
            reviews: [],
            preferences: { ...defaultPreferences, rate: 0.5 },
          },
        }
        expect(() => parseBackup(JSON.stringify(backup))).toThrow(
          `data.expressions[1].${field}:`,
        )
        await expect(repo.restore(backup)).rejects.toThrow(
          `data.expressions[1].${field}:`,
        )
        expect(await repo.load()).toEqual(before)
        expect(await storedState()).toEqual(before)
      }
      const boundary = { ...expression('boundary'), [field]: 'x'.repeat(max) }
      if (field === 'situation') boundary.situationEn = 'x'.repeat(max)
      if (field === 'pronunciationNote')
        boundary.pronunciationNoteEn = 'x'.repeat(max)
      expect(() => parseItem(boundary)).not.toThrow()
    },
  )

  test.each(['situation', 'pronunciationNote'] as const)(
    'conflicting %s rejects parses, exports, saves, imports and restores without partial writes',
    async (field) => {
      const repo = await repository(data())
      const before = await repo.rate('a', 'reading', 'easy', now)
      for (const value of ['different legacy text', '', 42, null]) {
        const invalid = { ...expression('a'), [field]: value }
        const incoming = {
          ...lesson([]),
          expressions: [expression('new'), invalid],
        }
        const backup = {
          ...createBackup(before),
          data: {
            ...before,
            expressions: [expression('new'), invalid],
            reviews: [],
            preferences: { ...defaultPreferences, rate: 0.5 },
          },
        }
        expect(() => parseLesson(JSON.stringify(incoming))).toThrow(field)
        expect(() => parseBackup(JSON.stringify(backup))).toThrow(field)
        expect(() => createBackup(backup.data)).toThrow(field)
        expect(() => createLesson(backup.data)).toThrow(field)
        await expect(repo.saveExpression(invalid)).rejects.toThrow(field)
        await expect(
          repo.applyLesson(incoming, 'update', false),
        ).rejects.toThrow(field)
        await expect(repo.restore(backup)).rejects.toThrow(field)
        expect(await repo.load()).toEqual(before)
        expect(await storedState()).toEqual(before)
      }
      expect(() =>
        parseItem({
          ...expression('conflict'),
          [field]: 'different legacy text',
        }),
      ).toThrow('reconcile both values')
      // An explicit empty new English field must not silently discard legacy text either.
      expect(() =>
        parseItem({
          ...expression('conflict'),
          [field]: 'legacy text',
          [`${field}En`]: '',
        }),
      ).toThrow('conflicts with')
    },
  )

  test.each(['both', 'situation', 'pronunciationNote'] as const)(
    'load atomically persists old DB %s fields once, preserving edited seeds and deletions',
    async (fields) => {
      const edited = {
        ...seedExpressions[0]!,
        english: 'My edited translation',
        situationEn: 'My own context',
        situationTr: '',
        pronunciationNoteEn: 'My own pronunciation note',
        audioUrl: 'https://example.com/general.mp3',
        femaleAudioUrl: 'https://example.com/female.mp3',
        maleAudioUrl: 'http://example.com/male.mp3',
        updatedAt: '2026-02-01T01:00:00+01:00',
      }
      delete edited.pronunciationNoteTr
      const expected = data([edited])
      expected.preferences = {
        voiceURI: 'my-voice',
        rate: 0.7,
        dailyNewLimit: 1,
      }
      expected.reviews = ['speaking', 'listening', 'reading'].map((mode) =>
        review(edited.id, mode as Mode),
      )
      const incoming = legacyExpression(edited)
      if (fields === 'situation') {
        delete incoming.pronunciationNote
        incoming.pronunciationNoteEn = edited.pronunciationNoteEn
      }
      if (fields === 'pronunciationNote') {
        delete incoming.situation
        incoming.situationEn = edited.situationEn
        incoming.situationTr = edited.situationTr
      }
      await storedState({ ...expected, expressions: [incoming] })
      const put = spyOn(IDBObjectStore.prototype, 'put')
      try {
        const repo = await repository()
        expect(put).toHaveBeenCalledTimes(1)
        expect(await storedState()).toEqual(expected)
        expect(await repo.load()).toEqual(expected)
        repo.close()
        expect(await (await repository()).load()).toEqual(expected)
        expect(put).toHaveBeenCalledTimes(1)
      } finally {
        put.mockRestore()
      }
    },
  )

  test('canonical loads do not write, including an empty initialized DB', async () => {
    for (const state of [data(), data([])]) {
      await storedState(state)
      const put = spyOn(IDBObjectStore.prototype, 'put')
      try {
        expect(await (await repository()).load()).toEqual(state)
        expect(put).not.toHaveBeenCalled()
      } finally {
        put.mockRestore()
      }
    }
  })

  test('an invalid old DB is rejected without rewriting even valid earlier expressions', async () => {
    for (const badFields of [
      { situation: 'conflicting legacy context' },
      { pronunciationNote: 'conflicting legacy note' },
      { situation: 42 },
      { pronunciationNote: null },
      { situationEn: '', situationTr: '' },
      { situationEn: false },
    ]) {
      const raw = {
        ...data(),
        expressions: [
          legacyExpression(expression('first')),
          { ...expression('bad'), ...badFields },
        ],
      }
      await storedState(raw)
      const put = spyOn(IDBObjectStore.prototype, 'put')
      try {
        await expect(openRepository()).rejects.toThrow()
        expect(put).not.toHaveBeenCalled()
        expect(await storedState()).toEqual(raw)
      } finally {
        put.mockRestore()
      }
    }
  })

  test('a migration write failure aborts and leaves the old DB available for retry', async () => {
    const raw = { ...data([]), expressions: [legacyExpression()] }
    await storedState(raw)
    const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
      () => {
        throw new DOMException(
          'Storage full during migration',
          'QuotaExceededError',
        )
      },
    )
    try {
      await expect(openRepository()).rejects.toThrow(
        'Storage full during migration',
      )
    } finally {
      put.mockRestore()
    }
    expect(await storedState()).toEqual(raw)
    const migrated = await (await repository()).load()
    expect(migrated.expressions[0]!.situationTr).toBe('')
    expect(await storedState()).toEqual(migrated)
  })
})

describe('complete runtime schema validation', () => {
  test('rejects invalid JSON, version, kind, unknown fields, duplicated IDs, and missing fields', () => {
    expect(() => parseLesson('{')).toThrow('invalid JSON')
    for (const invalid of [
      null,
      [],
      { ...lesson([]), version: 2 },
      { ...lesson([]), kind: 'petit-backup' },
      { ...lesson([]), surprise: true },
      lesson([expression('a'), expression('a')]),
      lesson([
        { ...expression('a'), english: undefined } as unknown as Expression,
      ]),
    ])
      expect(() => parseLesson(JSON.stringify(invalid))).toThrow()
  })

  test('rejects wrong types, excessive lengths, unsafe audio, invalid calendars, and inverted dates', () => {
    const invalid: Array<Partial<Expression>> = [
      { id: '' },
      { french: ' ' },
      { french: 'x'.repeat(1001) },
      { tags: ['x', 'x'] },
      { tags: [1] as unknown as string[] },
      { lesson: 1.5 },
      { lesson: 0 },
      { audioUrl: '/relative.mp3' },
      { audioUrl: 'https://user:pass@example.com/a' },
      { pronunciationNoteEn: 'x'.repeat(8001) },
      { pronunciationNoteTr: 'x'.repeat(8001) },
      { createdAt: '2026-02-30T12:00:00.000Z' },
      { createdAt: '2026-01-01' },
      { createdAt: '2026-01-01T24:00:00.000Z' },
      { updatedAt: '2025-01-01T00:00:00.000Z' },
    ]
    for (const fields of invalid)
      expect(() =>
        parseLesson(JSON.stringify(lesson([expression('a', fields)]))),
      ).toThrow()
  })

  test.each(['audioUrl', 'femaleAudioUrl', 'maleAudioUrl'] as const)(
    '%s uses the same URL safety rules and reports the exact field path',
    (field) => {
      for (const url of [
        'https://example.com/a.mp3',
        'http://localhost:8080/audio?q=1#part',
        'HTTPS://example.com/%20.mp3',
        `https://example.com/${'a'.repeat(2028)}`,
      ]) {
        const item = expression('a', { [field]: url })
        expect(parseLesson(JSON.stringify(lesson([item]))).expressions).toEqual(
          [item],
        )
      }
      for (const value of [
        null,
        42,
        true,
        [],
        {},
        '',
        ' ',
        '/audio.mp3',
        '//example.com/a',
        'https:example.com/a',
        'javascript:alert(1)',
        'data:audio/mp3;base64,AAA',
        'blob:https://example.com/x',
        'file:///tmp/a',
        'https://user:pass@example.com/a',
        'https://user@example.com',
        'https://@example.com',
        ' https://example.com/a',
        'https://example.com/a ',
        'https://example.com/with space',
        'https://example.com/\\na',
        'https://example.com/\\u0000a',
        'https://example.com/\\u007fa',
        'https://example.com\\\\evil',
        'https://',
        `https://example.com/${'a'.repeat(2029)}`,
      ]) {
        const invalid = lesson([expression('a', { [field]: value })])
        expect(() => parseLesson(JSON.stringify(invalid))).toThrow(
          `lesson.expressions[0].${field}:`,
        )
      }
      const omitted = createLesson(
        data([expression('a', { [field]: undefined })]),
      )
      expect(Object.hasOwn(omitted.expressions[0]!, field)).toBe(false)
    },
  )

  test('preserves valid timestamp offsets and literal user text', () => {
    const item = expression('a', {
      createdAt: '2026-01-01T01:00:00+01:00',
      updatedAt: '2026-01-01T00:00:00Z',
      pronunciationNoteEn: '',
      pronunciationNoteTr: '',
    })
    expect(parseLesson(JSON.stringify(lesson([item]))).expressions).toEqual([
      item,
    ])
  })

  test('validates every backup field, reference, review key, history event, interval and due date', () => {
    const state = data()
    state.reviews = [review('a', 'speaking')]
    const good = createBackup(state)
    const corruptions: Array<(backup: Backup) => void> = [
      (backup) => {
        ;(backup as { version: number }).version = 2
      },
      (backup) => {
        backup.exportedAt = 'not-a-date'
      },
      (backup) => {
        ;(backup.data as unknown as { initialized: boolean }).initialized =
          false
      },
      (backup) => {
        backup.data.preferences.rate = NaN
      },
      (backup) => {
        backup.data.preferences.dailyNewLimit = -1
      },
      (backup) => {
        backup.data.preferences.dailyNewLimit = 1.5
      },
      (backup) => {
        backup.data.preferences.voiceURI = 4 as unknown as string
      },
      (backup) => {
        backup.data.reviews[0]!.expressionId = 'missing'
      },
      (backup) => {
        backup.data.reviews.push(structuredClone(backup.data.reviews[0]!))
      },
      (backup) => {
        backup.data.reviews[0]!.mode = 'writing' as Mode
      },
      (backup) => {
        backup.data.reviews[0]!.history[0]!.rating = 'ok' as 'good'
      },
      (backup) => {
        backup.data.reviews[0]!.history[0]!.at = 'bad'
      },
      (backup) => {
        backup.data.reviews[0]!.intervalDays = 999
      },
      (backup) => {
        backup.data.reviews[0]!.dueAt = now.toISOString()
      },
      (backup) => {
        backup.data.reviews[0]!.history.push({
          at: new Date(now.getTime() - 1).toISOString(),
          rating: 'good',
        })
      },
      (backup) => {
        backup.data.expressions[2]!.audioUrl = 'javascript:alert(1)'
      },
    ]
    for (const corrupt of corruptions) {
      const invalid = structuredClone(good)
      corrupt(invalid)
      expect(() => parseBackup(JSON.stringify(invalid))).toThrow()
    }
    expect(() =>
      createBackup({
        ...state,
        preferences: { ...state.preferences, rate: Infinity },
      }),
    ).toThrow('rate')
  })

  test('direct typed input still rejects sparse arrays and invalid nested values', async () => {
    const repo = await repository(data())
    const before = await repo.load()
    const invalid = createBackup(before)
    invalid.data.expressions[0]!.tags = new Array<string>(1)
    await expect(repo.restore(invalid)).rejects.toThrow('tags[0]')
    await expect(
      repo.saveExpression(expression('sparse', { tags: new Array<string>(1) })),
    ).rejects.toThrow('tags[0]')
    expect(await repo.load()).toEqual(before)
  })

  test('backup and lesson exports are detached, valid round trips, with no progress in lessons', () => {
    const state = data([
      expression('a', {
        audioUrl: 'https://example.com/general.mp3',
        femaleAudioUrl: 'https://example.com/female.mp3',
        maleAudioUrl: 'https://example.com/male.mp3',
      }),
      expression('b', {
        femaleAudioUrl: 'https://example.com/only-female.mp3',
      }),
      expression('c', { maleAudioUrl: 'https://example.com/only-male.mp3' }),
    ])
    state.reviews = [review('a', 'speaking')]
    const backup = createBackup(state)
    expect(backup.version).toBe(1)
    expect(backup.data).toEqual(state)
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup)
    const exportedLesson = createLesson(state)
    expect(exportedLesson.version).toBe(1)
    expect(exportedLesson.expressions).toEqual(state.expressions)
    expect(parseLesson(JSON.stringify(exportedLesson))).toEqual(exportedLesson)
    expect(Object.keys(exportedLesson).sort()).toEqual([
      'expressions',
      'kind',
      'version',
    ])
    backup.data.expressions[0]!.french = 'Changed copy'
    backup.data.expressions[0]!.femaleAudioUrl = 'https://example.com/copy.mp3'
    exportedLesson.expressions[0]!.maleAudioUrl = 'https://example.com/copy.mp3'
    expect(state.expressions[0]!.femaleAudioUrl).toBe(
      'https://example.com/female.mp3',
    )
    expect(state.expressions[0]!.maleAudioUrl).toBe(
      'https://example.com/male.mp3',
    )
    exportedLesson.expressions[1]!.tags.push('copy-only')
    expect(state.expressions[0]!.french).toBe('French a')
    expect(state.expressions[1]!.tags).not.toContain('copy-only')
  })
})

describe('IndexedDB persistence, atomicity, and errors', () => {
  test('seeds once; deleting every seed and reopening never resurrects them', async () => {
    const repo = await repository()
    expect((await repo.load()).expressions).toEqual(seedExpressions)
    await repo.rate(seedExpressions[0]!.id, 'reading', 'good', now)
    for (const item of seedExpressions) await repo.deleteExpression(item.id)
    repo.close()
    const reopened = await repository()
    expect(await reopened.load()).toEqual({
      expressions: [],
      reviews: [],
      preferences: defaultPreferences,
      initialized: true,
    })
  })

  test('all optional recording combinations save and survive reopening without a schema upgrade', async () => {
    const repo = await repository(data([]))
    const recordings = {
      audioUrl: 'https://example.com/general.mp3',
      femaleAudioUrl: 'https://example.com/female.mp3',
      maleAudioUrl: 'http://example.com/male.mp3',
    }
    const items: Expression[] = []
    for (let mask = 0; mask < 8; mask += 1) {
      const item = expression(`recordings-${mask}`)
      if (mask & 1) item.audioUrl = recordings.audioUrl
      if (mask & 2) item.femaleAudioUrl = recordings.femaleAudioUrl
      if (mask & 4) item.maleAudioUrl = recordings.maleAudioUrl
      items.push(item)
      const saved = await repo.saveExpression(item)
      expect(saved.expressions).toEqual(items)
    }
    repo.close()
    const reopened = await repository()
    expect((await reopened.load()).expressions).toEqual(items)
    const backup = parseBackup(
      JSON.stringify(createBackup(await reopened.load())),
    )
    await reopened.deleteExpression(items[0]!.id)
    expect((await reopened.restore(backup)).expressions).toEqual(items)
    reopened.close()
    expect((await (await repository()).load()).expressions).toEqual(items)
  })

  test('ratings, preference changes and edited expressions survive reopening', async () => {
    const repo = await repository(data())
    await repo.savePreferences({
      voiceURI: 'a-voice',
      rate: 0.7,
      dailyNewLimit: 2,
    })
    await repo.rate('a', 'listening', 'again', now)
    await repo.rate('a', 'listening', 'hard', new Date(now.getTime() + 60_000))
    const final = await repo.saveExpression(
      expression('a', { english: 'Edited' }),
    )
    expect(final.reviews[0]!.history.map((event) => event.rating)).toEqual([
      'again',
      'hard',
    ])
    expect(final.reviews[0]!.intervalDays).toBe(1)
    expect(Date.parse(final.reviews[0]!.dueAt)).toBe(
      now.getTime() + 60_000 + 86_400_000,
    )
    repo.close()
    expect(await (await repository()).load()).toEqual(final)
  })

  test('deleting an expression cleans all its modes but not another expression', async () => {
    const repo = await repository(data())
    await repo.rate('a', 'speaking', 'good', now)
    await repo.rate('a', 'reading', 'easy', now)
    await repo.rate('b', 'speaking', 'hard', now)
    const state = await repo.deleteExpression('a')
    expect(state.expressions.map((item) => item.id)).toEqual(['b', 'c'])
    expect(state.reviews.map((item) => item.expressionId)).toEqual(['b'])
  })

  test('daily cap applies globally only to first distinct introduction; early extra ratings are allowed', async () => {
    const state = data()
    state.preferences.dailyNewLimit = 1
    const repo = await repository(state)
    await repo.rate('a', 'speaking', 'good', now)
    await repo.rate('a', 'listening', 'easy', now)
    const repeated = await repo.rate('a', 'speaking', 'good', now)
    expect(
      repeated.reviews.find((item) => item.mode === 'speaking')!.history,
    ).toHaveLength(2)
    expect(newCountToday(repeated, now)).toBe(1)
    await expect(repo.rate('b', 'reading', 'good', now)).rejects.toThrow(
      'Daily new-expression limit',
    )
    const tomorrow = new Date(2026, 9, 23, 12)
    expect(
      newCountToday(
        await repo.rate('b', 'reading', 'good', tomorrow),
        tomorrow,
      ),
    ).toBe(1)
  })

  test('zero daily cap still allows already introduced expressions in a new mode', async () => {
    const state = data()
    state.preferences.dailyNewLimit = 0
    state.reviews = [review('a', 'speaking', new Date(2026, 9, 21, 12))]
    const repo = await repository(state)
    await repo.rate('a', 'reading', 'good', now)
    await expect(repo.rate('b', 'speaking', 'good', now)).rejects.toThrow(
      'limit (0)',
    )
  })

  test('concurrent introductions from separate connections cannot overspend the final daily slot', async () => {
    const state = data()
    state.preferences.dailyNewLimit = 1
    const first = await repository(state)
    const second = await repository()
    const results = await Promise.allSettled([
      first.rate('a', 'reading', 'good', now),
      second.rate('b', 'speaking', 'good', now),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const saved = await first.load()
    expect(saved.reviews).toHaveLength(1)
    expect(newCountToday(saved, now)).toBe(1)
  })

  test('concurrent first ratings in two modes of the same expression share one introduction', async () => {
    const state = data()
    state.preferences.dailyNewLimit = 1
    const first = await repository(state)
    const second = await repository()
    await Promise.all([
      first.rate('a', 'reading', 'good', now),
      second.rate('a', 'speaking', 'easy', now),
    ])
    const saved = await first.load()
    expect(saved.reviews).toHaveLength(2)
    expect(newCountToday(saved, now)).toBe(1)
  })

  test('concurrent writes and repeated ratings do not lose data across connections', async () => {
    const first = await repository(data())
    const second = await repository()
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? first : second).saveExpression(expression(`added-${i}`)),
      ),
    )
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? first : second).rate('a', 'reading', 'again', now),
      ),
    )
    const saved = await first.load()
    expect(saved.expressions).toHaveLength(23)
    expect(saved.reviews[0]!.history).toHaveLength(20)
  })

  test('concurrent import and edit both survive; imports preserve an existing review', async () => {
    const first = await repository(data())
    const second = await repository()
    const rated = await first.rate('a', 'speaking', 'easy', now)
    await Promise.all([
      first.applyLesson(
        lesson([expression('a', { english: 'Imported' }), expression('d')]),
        'update',
        false,
      ),
      second.saveExpression(expression('b', { english: 'Edited separately' })),
      second.savePreferences({ ...defaultPreferences, rate: 0.6 }),
    ])
    const saved = await first.load()
    expect(saved.expressions.find((item) => item.id === 'a')!.english).toBe(
      'Imported',
    )
    expect(saved.expressions.find((item) => item.id === 'b')!.english).toBe(
      'Edited separately',
    )
    expect(saved.expressions.some((item) => item.id === 'd')).toBe(true)
    expect(saved.preferences.rate).toBe(0.6)
    expect(saved.reviews).toEqual(rated.reviews)
  })

  test('input and returned snapshots cannot mutate persisted state after the call', async () => {
    const repo = await repository(data())
    const input = expression('new')
    const saving = repo.saveExpression(input)
    input.french = 'Mutated after calling'
    const output = await saving
    expect(output.expressions.find((item) => item.id === 'new')!.french).toBe(
      'French new',
    )
    output.expressions[0]!.french = 'Mutated returned value'
    expect((await repo.load()).expressions[0]!.french).toBe('French a')
  })

  test('full backup restore replaces state, retains progress and empty initialized backups stay empty', async () => {
    const repo = await repository(data())
    const rated = await repo.rate('a', 'speaking', 'easy', now)
    const backup = parseBackup(JSON.stringify(createBackup(rated)))
    await repo.deleteExpression('a')
    expect(await repo.restore(backup)).toEqual(rated)
    await repo.restore(createBackup(data([])))
    repo.close()
    expect((await (await repository()).load()).expressions).toEqual([])
  })

  test('invalid restore or import rejects without any partial writes', async () => {
    const repo = await repository(data())
    const before = await repo.load()
    const backup = createBackup(before)
    backup.data.expressions[1]!.audioUrl = 'javascript:alert(1)'
    await expect(repo.restore(backup)).rejects.toThrow('audioUrl')
    await expect(
      repo.applyLesson(
        lesson([expression('new'), expression('invalid', { lesson: 0 })]),
        'update',
        false,
      ),
    ).rejects.toThrow('lesson')
    await expect(repo.rate('missing', 'reading', 'good', now)).rejects.toThrow(
      'missing expression',
    )
    expect(await repo.load()).toEqual(before)
  })

  test.each(['femaleAudioUrl', 'maleAudioUrl'] as const)(
    'invalid %s rejects saves, imports, and restores atomically',
    async (field) => {
      const repo = await repository(data())
      await repo.rate('a', 'speaking', 'good', now)
      await repo.rate('a', 'listening', 'hard', now)
      const before = await repo.rate('a', 'reading', 'easy', now)
      for (const value of ['javascript:alert(1)', 42, null]) {
        const invalid = expression('a', { [field]: value })
        await expect(repo.saveExpression(invalid)).rejects.toThrow(
          `expression.${field}:`,
        )
        expect(await repo.load()).toEqual(before)
        await expect(
          repo.applyLesson(
            lesson([expression('new'), invalid]),
            'update',
            false,
          ),
        ).rejects.toThrow(`lesson.expressions[1].${field}:`)
        expect(await repo.load()).toEqual(before)
        const backup = createBackup(before)
        backup.data.expressions = [expression('replacement'), invalid]
        backup.data.reviews = []
        backup.data.preferences.rate = 0.5
        expect(() => parseBackup(JSON.stringify(backup))).toThrow(
          `data.expressions[1].${field}:`,
        )
        await expect(repo.restore(backup)).rejects.toThrow(
          `data.expressions[1].${field}:`,
        )
        expect(await repo.load()).toEqual(before)
      }
      repo.close()
      expect(await (await repository()).load()).toEqual(before)
    },
  )

  test('out-of-order rating is rejected without changing saved history', async () => {
    const repo = await repository(data())
    const before = await repo.rate('a', 'reading', 'good', now)
    await expect(
      repo.rate('a', 'reading', 'good', new Date(now.getTime() - 1)),
    ).rejects.toThrow('first introduction')
    expect(await repo.load()).toEqual(before)
  })

  test('failed IDB writes reject and roll back rather than returning unsaved state', async () => {
    const repo = await repository(data())
    const before = await repo.load()
    const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
      () => {
        throw new DOMException('Storage full', 'QuotaExceededError')
      },
    )
    try {
      await expect(repo.saveExpression(expression('new'))).rejects.toThrow(
        'Storage full',
      )
    } finally {
      put.mockRestore()
    }
    expect(await repo.load()).toEqual(before)
  })

  test('closed repositories and unavailable IndexedDB reject clearly', async () => {
    const repo = await repository()
    repo.close()
    await expect(repo.load()).rejects.toThrow('closed')
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    await expect(openRepository()).rejects.toThrow('unavailable')
  })
})

describe('shared vocabulary libraries', () => {
  test('simultaneous applies serialize and only one may commit a shared preview token', async () => {
    const first = await repository(data([]))
    const second = await repository()
    const feed = shared([expression('a')])
    const token = previewSharedLibrary(feed, await first.load()).token
    const results = await Promise.allSettled([
      first.applySharedLibrary(feed, {}, token),
      second.applySharedLibrary(feed, {}, token),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected')
      expect(String(rejected.reason)).toContain('stale')
    const saved = await first.load()
    expect(saved.expressions).toEqual(feed.expressions)
    expect(saved.sharedLibrary?.expressions).toEqual(feed.expressions)
  })

  test('restores cannot silently duplicate vocabulary and tombstones accept only skip/restore', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    const feed = shared([a])
    await applyShared(repo, feed)
    await repo.deleteExpression('a')
    await repo.saveExpression(expression('mine', { french: a.french }))
    const before = await repo.load()
    const preview = previewSharedLibrary(feed, before)
    expect(preview.deleted).toEqual([a])
    for (const choice of ['keep', 'shared', 'add'] as const) {
      await expect(
        repo.applySharedLibrary(feed, { a: choice }, preview.token),
      ).rejects.toThrow('not valid')
      expect(await repo.load()).toEqual(before)
    }
    await expect(
      repo.applySharedLibrary(feed, { a: 'restore' }, preview.token),
    ).rejects.toThrow('collision')
    expect(await repo.load()).toEqual(before)
    expect(
      (await repo.applySharedLibrary(feed, { a: 'skip' }, preview.token))
        .sharedLibrary?.deletedIds,
    ).toEqual(['a'])
  })

  test('absent metadata stays absent through local deletion and direct undefined normalizes away', async () => {
    const repo = await repository()
    const deleted = await repo.deleteExpression(seedExpressions[0]!.id)
    expect(Object.hasOwn(deleted, 'sharedLibrary')).toBe(false)
    const loaded = await (await repository()).load()
    expect(
      loaded.expressions.some((item) => item.id === seedExpressions[0]!.id),
    ).toBe(false)
    expect(Object.hasOwn(loaded, 'sharedLibrary')).toBe(false)
    const exported = createBackup({ ...loaded, sharedLibrary: undefined })
    expect(Object.hasOwn(exported.data, 'sharedLibrary')).toBe(false)
  })

  test('first follow reconciles untouched stock seeds but never clobbers edited or personal IDs', async () => {
    const seed = structuredClone(seedExpressions[0]!)
    const changed = { ...seed, english: 'Publisher translation' }
    const repo = await repository()
    const preview = previewSharedLibrary(shared([changed]), await repo.load())
    expect(preview.updates).toEqual([changed])
    expect(preview.isCurrent).toBe(false)
    const state = await repo.applySharedLibrary(
      shared([changed]),
      {},
      preview.token,
    )
    expect(state.expressions.find((item) => item.id === seed.id)).toEqual(
      changed,
    )
    expect(state.sharedLibrary?.expressions).toEqual([changed])
    expect(previewSharedLibrary(shared([changed]), state).isCurrent).toBe(true)

    const personal = { ...seed, english: 'My translation' }
    const edited = data([personal, expression('personal')])
    const incoming = shared([
      changed,
      expression('personal', { english: 'Other' }),
    ])
    expect(previewSharedLibrary(incoming, edited).conflicts).toEqual([
      { incoming: changed, local: personal },
      { incoming: incoming.expressions[1]!, local: edited.expressions[1]! },
    ])
    expect(
      previewSharedLibrary(shared([seed]), data([seed])).unchanged,
    ).toEqual([seed])
  })

  test('three-way comparison includes all metadata and preserves locally edited publisher-unchanged entries', async () => {
    const a = expression('a')
    const b = expression('b')
    const repo = await repository(data([a, b]))
    await applyShared(repo, shared([a, b]))
    const local = {
      ...a,
      english: 'My edit',
      updatedAt: '2026-10-23T00:00:00Z',
    }
    await repo.saveExpression(local)
    const remoteB = { ...b, femaleAudioUrl: 'https://example.org/b.mp3' }
    const incoming = shared([a, remoteB], 2)
    const preview = previewSharedLibrary(incoming, await repo.load())
    expect(preview.unchanged).toEqual([a])
    expect(preview.updates).toEqual([remoteB])
    const saved = await repo.applySharedLibrary(incoming, {}, preview.token)
    expect(saved.expressions).toEqual([local, remoteB])
    expect(saved.sharedLibrary?.expressions).toEqual([a, remoteB])

    const timestampOnly = { ...remoteB, updatedAt: '2026-10-23T00:00:00Z' }
    expect(
      previewSharedLibrary(shared([a, timestampOnly], 3), saved).updates,
    ).toEqual([timestampOnly])
    const alreadyLocal = await repo.saveExpression(timestampOnly)
    expect(
      previewSharedLibrary(shared([a, timestampOnly], 3), alreadyLocal)
        .unchanged,
    ).toEqual([a, timestampOnly])
  })

  test('conflicts require explicit resolution, keep saves the publisher baseline, shared preserves all learning data', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    await applyShared(repo, shared([a]))
    await repo.rate('a', 'reading', 'good', now)
    await repo.saveExpression({ ...a, english: 'Personal edit' })
    const before = await repo.load()
    const incoming = shared([{ ...a, english: 'Publisher edit' }], 2)
    const preview = previewSharedLibrary(incoming, before)
    expect(preview.conflicts).toHaveLength(1)
    await expect(
      repo.applySharedLibrary(incoming, {}, preview.token),
    ).rejects.toThrow('explicitly')
    expect(await repo.load()).toEqual(before)
    const kept = await repo.applySharedLibrary(
      incoming,
      { a: 'keep' },
      preview.token,
    )
    expect(kept.expressions).toEqual(before.expressions)
    expect(kept.sharedLibrary?.expressions).toEqual(incoming.expressions)
    expect(previewSharedLibrary(incoming, kept).unchanged).toEqual(
      incoming.expressions,
    )

    const next = shared([{ ...a, english: 'Another publisher edit' }], 3)
    const resolved = await applyShared(repo, next, { a: 'shared' })
    expect(resolved.expressions).toEqual(next.expressions)
    expect(resolved.reviews).toEqual(before.reviews)
    expect(resolved.preferences).toEqual(before.preferences)
    expect(newCountToday(resolved, now)).toBe(newCountToday(before, now))
  })

  test('canonical comparisons ignore object field order and publisher array order', async () => {
    const a = expression('a', { audioUrl: 'https://example.org/a.mp3' })
    const b = expression('b')
    const repo = await repository(data([a, b]))
    await applyShared(repo, shared([a, b]))
    const reordered = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as Expression
    const feed = shared([b, reordered])
    const preview = previewSharedLibrary(feed, await repo.load())
    expect(preview.isCurrent).toBe(true)
    expect(preview.unchanged).toEqual([b, a])
    await repo.applySharedLibrary(feed, {}, preview.token)
  })

  test('different-ID normalized duplicates skip by default or explicitly add without moving progress', async () => {
    const local = expression('mine', { french: 'École ’ ici' })
    const incoming = expression('published', { french: " ecole '  ici " })
    const repo = await repository(data([local]))
    const rated = await repo.rate('mine', 'speaking', 'good', now)
    const feed = shared([incoming])
    const preview = previewSharedLibrary(feed, rated)
    expect(preview.duplicates).toEqual([{ incoming, local }])
    await expect(
      repo.applySharedLibrary(feed, { published: 'shared' }, preview.token),
    ).rejects.toThrow('not valid')
    const skipped = await repo.applySharedLibrary(feed, {}, preview.token)
    expect(skipped.expressions).toEqual([local])
    expect(skipped.sharedLibrary?.expressions).toEqual([incoming])
    const added = await applyShared(repo, feed, { published: 'add' })
    expect(added.expressions).toEqual([local, incoming])
    expect(added.reviews).toEqual(rated.reviews)
    expect(added.reviews.every((item) => item.expressionId === 'mine')).toBe(
      true,
    )
    expect(previewSharedLibrary(feed, added).unchanged).toEqual([incoming])
    expect((await applyShared(repo, feed)).expressions).toHaveLength(2)
  })

  test('duplicates within a feed need explicit add and retained IDs are stable', async () => {
    const a = expression('a')
    const b = expression('b', { french: a.french })
    const repo = await repository(data([]))
    const feed = shared([a, b])
    const preview = previewSharedLibrary(feed, await repo.load())
    expect(preview.additions).toEqual([a])
    expect(preview.duplicates).toEqual([{ incoming: b, local: a }])
    const saved = await repo.applySharedLibrary(
      feed,
      { b: 'add' },
      preview.token,
    )
    expect(saved.expressions).toEqual([a, b])
  })

  test('deletion tombstones survive reload, source removal/readdition, and explicit restore', async () => {
    const a = expression('a')
    let repo = await repository(data([a]))
    await applyShared(repo, shared([a]))
    await repo.rate('a', 'reading', 'good', now)
    await repo.deleteExpression('a')
    await repo.deleteExpression('a')
    repo.close()
    repo = await repository()
    const deleted = await repo.load()
    expect(deleted.sharedLibrary?.deletedIds).toEqual(['a'])
    expect(deleted.reviews).toEqual([])
    expect(previewSharedLibrary(shared([a]), deleted).deleted).toEqual([a])
    expect((await applyShared(repo, shared([a]))).expressions).toEqual([])
    await applyShared(repo, shared([], 2))
    expect((await repo.load()).sharedLibrary?.deletedIds).toEqual(['a'])
    const readded = shared([{ ...a, english: 'Reappeared' }], 3)
    expect(previewSharedLibrary(readded, await repo.load()).deleted).toEqual(
      readded.expressions,
    )
    expect((await applyShared(repo, readded)).expressions).toEqual([])
    const restored = await applyShared(repo, readded, { a: 'restore' })
    expect(restored.expressions).toEqual(readded.expressions)
    expect(restored.sharedLibrary?.deletedIds).toEqual([])
    expect(restored.reviews).toEqual([])
  })

  test('source removals keep local vocabulary, reviews, due dates, preferences and daily counts', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    await applyShared(repo, shared([a]))
    const before = await repo.rate('a', 'listening', 'hard', now)
    const feed = shared([], 2)
    expect(previewSharedLibrary(feed, before).removed).toEqual([a])
    const after = await applyShared(repo, feed)
    expect(after.expressions).toEqual(before.expressions)
    expect(after.reviews).toEqual(before.reviews)
    expect(after.preferences).toEqual(before.preferences)
    expect(newCountToday(after, now)).toBe(newCountToday(before, now))
    expect(after.sharedLibrary?.expressions).toEqual([])
  })

  test('stale previews reject concurrent vocabulary or shared-state edits across connections', async () => {
    const a = expression('a')
    const first = await repository(data([a]))
    const second = await repository()
    const feed = shared([a, expression('b')])
    const token = previewSharedLibrary(feed, await first.load()).token
    await second.saveExpression(expression('personal'))
    const before = await second.load()
    await expect(first.applySharedLibrary(feed, {}, token)).rejects.toThrow(
      /stale.*refresh/i,
    )
    expect(await first.load()).toEqual(before)

    const fresh = previewSharedLibrary(feed, before)
    await second.applySharedLibrary(feed, {}, fresh.token)
    const subscribed = await first.load()
    await expect(
      first.applySharedLibrary(feed, {}, fresh.token),
    ).rejects.toThrow('stale')
    expect(await first.load()).toEqual(subscribed)
  })

  test('concurrent ratings and preferences do not invalidate previews and are preserved', async () => {
    const a = expression('a')
    const first = await repository(data([a]))
    const second = await repository()
    const feed = shared([a, expression('b')])
    const token = previewSharedLibrary(feed, await first.load()).token
    await second.rate('a', 'reading', 'good', now)
    const before = await second.savePreferences({
      ...defaultPreferences,
      rate: 1.2,
    })
    expect(previewSharedLibrary(feed, before).token).toBe(token)
    const after = await first.applySharedLibrary(feed, {}, token)
    expect(after.reviews).toEqual(before.reviews)
    expect(after.preferences).toEqual(before.preferences)
    expect(newCountToday(after, now)).toBe(newCountToday(before, now))
  })

  test('old revisions and tampered same-revision payloads reject without mutation', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    const before = await applyShared(repo, shared([a], 2))
    const token = previewSharedLibrary(shared([a], 2), before).token
    const invalid = [
      shared([a], 1),
      shared([{ ...a, english: 'Tampered' }], 2),
      { ...shared([a], 2), name: 'Renamed without revision' },
      { ...shared([a], 2), publishedAt: '2026-10-23T00:00:00Z' },
      shared([], 2),
    ]
    for (const feed of invalid) {
      expect(() => previewSharedLibrary(feed, before)).toThrow(/revision/)
      await expect(repo.applySharedLibrary(feed, {}, token)).rejects.toThrow(
        /revision/,
      )
      expect(await repo.load()).toEqual(before)
    }
  })

  test('parsing permits arbitrary valid sources but applying rejects configured/subscribed mismatches', async () => {
    const other = parseSharedLibrary(
      JSON.stringify({ ...shared([]), libraryId: 'another-library' }),
    )
    const repo = await repository(data([]))
    const before = await repo.load()
    const token = previewSharedLibrary(shared([]), before).token
    await expect(repo.applySharedLibrary(other, {}, token)).rejects.toThrow(
      'Unsupported',
    )
    expect(await repo.load()).toEqual(before)
    const foreign: AppData = {
      ...before,
      sharedLibrary: {
        libraryId: other.libraryId,
        name: other.name,
        revision: other.revision,
        publishedAt: other.publishedAt,
        expressions: other.expressions,
        deletedIds: [],
      },
    }
    await repo.restore(createBackup(foreign))
    expect(() => previewSharedLibrary(shared([]), foreign)).toThrow('source')
  })

  test('invalid feed, missing conflict resolutions and category-invalid choices are atomic', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    const incoming = shared([{ ...a, english: 'Conflict' }, expression('b')])
    const before = await repo.load()
    const token = previewSharedLibrary(incoming, before).token
    const choices: Array<Record<string, SharedLibraryChoice>> = [
      {},
      { a: 'add' },
      { a: 'restore' },
      { a: 'skip' },
      { a: 'keep', unknown: 'skip' },
      { a: 'shared', b: 'shared' },
    ]
    for (const choice of choices) {
      await expect(
        repo.applySharedLibrary(incoming, choice, token),
      ).rejects.toThrow()
      expect(await repo.load()).toEqual(before)
    }
    const malformed = {
      ...incoming,
      expressions: [expression('valid'), { ...a, audioUrl: 'javascript:bad' }],
    }
    await expect(
      repo.applySharedLibrary(malformed, { a: 'shared' }, token),
    ).rejects.toThrow('audioUrl')
    await expect(
      repo.applySharedLibrary(incoming, { a: 'nonsense' } as never, token),
    ).rejects.toThrow('choice')
    await expect(
      repo.applySharedLibrary(incoming, null as never, token),
    ).rejects.toThrow('choices')
    await expect(
      repo.applySharedLibrary(incoming, { a: 'shared' }, ''),
    ).rejects.toThrow('token')
    expect(await repo.load()).toEqual(before)
  })

  test('final collision validation catches safe-update/addition collisions and keep-dependent collisions', async () => {
    const a = expression('a')
    const b = expression('b')
    const repo = await repository(data([a, b]))
    await applyShared(repo, shared([a, b]))
    const before = await repo.load()
    const incoming = shared(
      [
        { ...a, french: 'Brand new text' },
        b,
        expression('c', { french: 'Brand new text' }),
      ],
      2,
    )
    expect(previewSharedLibrary(incoming, before).updates).toHaveLength(1)
    expect(previewSharedLibrary(incoming, before).additions).toHaveLength(1)
    await expect(applyShared(repo, incoming)).rejects.toThrow('collision')
    expect(await repo.load()).toEqual(before)

    await repo.saveExpression({ ...b, french: 'My personal text' })
    const next = shared(
      [
        a,
        { ...b, french: 'Publisher text' },
        expression('c', { french: 'My personal text' }),
      ],
      2,
    )
    const preview = previewSharedLibrary(next, await repo.load())
    expect(preview.conflicts).toHaveLength(1)
    expect(preview.duplicates).toHaveLength(1)
    const saved = await repo.applySharedLibrary(
      next,
      { b: 'keep', c: 'add' },
      preview.token,
    )
    expect(saved.expressions.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  test('manual saves, lesson imports and preference writes retain metadata and expose local edits', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    const followed = await applyShared(repo, shared([a]))
    await repo.saveExpression(expression('personal'))
    await repo.applyLesson(
      lesson([{ ...a, english: 'Lesson import edit' }]),
      'update',
      false,
    )
    const saved = await repo.savePreferences({
      ...defaultPreferences,
      dailyNewLimit: 10,
    })
    expect(saved.sharedLibrary).toEqual(followed.sharedLibrary)
    const feed = shared([{ ...a, english: 'Publisher edit' }], 2)
    expect(previewSharedLibrary(feed, saved).conflicts).toHaveLength(1)
  })

  test('optional state full-backup round trips including missing baseline locals and historical tombstones', async () => {
    const a = expression('a')
    const b = expression('b')
    const repo = await repository(data([a, b]))
    await applyShared(repo, shared([a, b]))
    await repo.deleteExpression('b')
    await repo.rate('a', 'reading', 'easy', now)
    const saved = await applyShared(repo, shared([b], 2))
    const backup = parseBackup(JSON.stringify(createBackup(saved)))
    expect(backup.data).toEqual(saved)
    await repo.restore(createBackup(data([])))
    expect(await repo.restore(backup)).toEqual(saved)
    repo.close()
    expect(await (await repository()).load()).toEqual(saved)
    const old = createBackup(data([]))
    expect(Object.hasOwn(old.data, 'sharedLibrary')).toBe(false)
    expect(
      Object.hasOwn(parseBackup(JSON.stringify(old)).data, 'sharedLibrary'),
    ).toBe(false)
    expect(await (await repository()).restore(old)).toEqual(data([]))
  })

  test('shared metadata strictly validates every nested field without local/baseline foreign-key assumptions', async () => {
    const a = expression('a')
    const repo = await repository(data([a]))
    const before = await applyShared(repo, shared([a]))
    const corruptions: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value.libraryId = ''
      },
      (value) => {
        value.name = null
      },
      (value) => {
        value.revision = 0
      },
      (value) => {
        value.revision = 1.5
      },
      (value) => {
        value.revision = Number.MAX_SAFE_INTEGER + 1
      },
      (value) => {
        value.publishedAt = '2026-02-30T00:00:00Z'
      },
      (value) => {
        value.expressions = [a, a]
      },
      (value) => {
        value.expressions = [{ ...a, surprise: true }]
      },
      (value) => {
        value.deletedIds = ['a', 'a']
      },
      (value) => {
        value.deletedIds = ['']
      },
      (value) => {
        value.deletedIds = [1]
      },
      (value) => {
        delete value.deletedIds
      },
      (value) => {
        value.kind = 'petit-shared-library'
      },
      (value) => {
        value.version = 1
      },
    ]
    for (const corrupt of corruptions) {
      const backup = createBackup(before)
      corrupt(backup.data.sharedLibrary as unknown as Record<string, unknown>)
      expect(() => parseBackup(JSON.stringify(backup))).toThrow('sharedLibrary')
      await expect(repo.restore(backup)).rejects.toThrow('sharedLibrary')
      expect(await repo.load()).toEqual(before)
    }
    const detachedBaseline = createBackup(before)
    detachedBaseline.data.sharedLibrary!.expressions = [
      expression('remote-only'),
    ]
    detachedBaseline.data.sharedLibrary!.deletedIds = [
      'historical-no-longer-in-feed',
    ]
    detachedBaseline.data.reviews = [review('a', 'reading')]
    expect(await repo.restore(detachedBaseline)).toEqual(detachedBaseline.data)
  })

  test('shared envelope validation is strict and canonical exports contain no learning data or state', async () => {
    const state = data([
      expression('a', { maleAudioUrl: 'https://example.org/a.mp3' }),
    ])
    state.reviews = [review('a', 'reading')]
    const repo = await repository(state)
    const followed = await applyShared(repo, shared(state.expressions))
    const exported = createSharedLibrary(followed, 3, now)
    expect(exported.libraryId).toBe(SHARED_LIBRARY_ID)
    expect(exported.name).toBe(SHARED_LIBRARY_NAME)
    expect(exported.publishedAt).toBe(now.toISOString())
    expect(Object.keys(exported)).toEqual([
      'kind',
      'version',
      'libraryId',
      'name',
      'revision',
      'publishedAt',
      'expressions',
    ])
    expect(parseSharedLibrary(JSON.stringify(exported))).toEqual(exported)
    expect(Object.keys(createLesson(followed))).toEqual([
      'kind',
      'version',
      'expressions',
    ])
    expect(JSON.stringify(exported)).not.toMatch(
      /reviews|preferences|sharedLibrary|deletedIds|history|dueAt/,
    )
    exported.expressions[0]!.english = 'Mutated export'
    expect((await repo.load()).expressions).toEqual(followed.expressions)
    expect(() => parseSharedLibrary('{')).toThrow('JSON')
    for (const invalid of [
      { ...shared([]), kind: 'petit-lesson' },
      { ...shared([]), version: 2 },
      { ...shared([]), reviews: [] },
      { ...shared([]), revision: 0 },
      { ...shared([]), name: '' },
      { ...shared([]), expressions: [expression('a'), expression('a')] },
    ])
      expect(() => validateSharedLibrary(invalid)).toThrow('sharedLibrary')
    expect(() => createSharedLibrary(followed, 0, now)).toThrow('revision')
  })

  test('shared input is detached before queued transactions and failed writes preserve the baseline', async () => {
    const repo = await repository(data([]))
    const feed = shared([expression('a')])
    const token = previewSharedLibrary(feed, await repo.load()).token
    const saving = repo.applySharedLibrary(feed, {}, token)
    feed.expressions[0]!.english = 'Mutated after call'
    const saved = await saving
    expect(saved.expressions[0]!.english).not.toBe('Mutated after call')
    const next = shared([expression('a'), expression('b')], 2)
    const nextToken = previewSharedLibrary(next, saved).token
    const put = spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
      () => {
        throw new DOMException('Simulated quota failure', 'QuotaExceededError')
      },
    )
    try {
      await expect(
        repo.applySharedLibrary(next, {}, nextToken),
      ).rejects.toThrow('quota')
    } finally {
      put.mockRestore()
    }
    expect(await repo.load()).toEqual(saved)
  })
})
