import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import {
  buildQueue,
  createBackup,
  createLesson,
  defaultPreferences,
  newCountToday,
  normalize,
  openRepository,
  parseBackup,
  parseLesson,
  previewLesson,
  scheduleReview,
  seedExpressions,
  validateAudioUrl,
} from '../src/data'
import type {
  AppData,
  Backup,
  Expression,
  LessonImport,
  Mode,
  Repository,
  Review,
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

async function repository(initial?: AppData): Promise<Repository> {
  const repo = await openRepository()
  repositories.push(repo)
  if (initial) await repo.restore(createBackup(initial))
  return repo
}

function review(id: string, mode: Mode, at = now): Review {
  return scheduleReview(undefined, id, mode, 'good', at)
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
          item.situation &&
          item.category &&
          item.pronunciationNote,
      ),
    ).toBe(true)
    expect(seedExpressions[6]!.pronunciationNote).toContain(
      'vuar → rövuar → o rövuar',
    )
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

  test('the tomorrow lesson example parses and is lesson two', async () => {
    const text = await Bun.file(
      new URL('../public/example-lesson.json', import.meta.url),
    ).text()
    const example = parseLesson(text)
    expect(example.expressions).toHaveLength(3)
    expect(example.expressions.every((item) => item.lesson === 2)).toBe(true)
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
      { pronunciationNote: 'x'.repeat(8001) },
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

  test('preserves valid timestamp offsets and literal user text', () => {
    const item = expression('a', {
      createdAt: '2026-01-01T01:00:00+01:00',
      updatedAt: '2026-01-01T00:00:00Z',
      pronunciationNote: '',
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
    const state = data()
    state.reviews = [review('a', 'speaking')]
    const backup = createBackup(state)
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup)
    const exportedLesson = createLesson(state)
    expect(parseLesson(JSON.stringify(exportedLesson))).toEqual(exportedLesson)
    expect(Object.keys(exportedLesson).sort()).toEqual([
      'expressions',
      'kind',
      'version',
    ])
    backup.data.expressions[0]!.french = 'Changed copy'
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
