import { DAY_MS, modes, nextInterval, ratings } from './scheduler'
import type {
  AppData,
  Backup,
  Expression,
  LessonImport,
  Mode,
  Preferences,
  Rating,
  Review,
  SharedLibrary,
  SharedLibraryState,
} from './types'

type ObjectValue = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}

function object(
  value: unknown,
  path: string,
  keys: readonly string[],
): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'expected an object.')
  const result = value as ObjectValue
  for (const key of Object.keys(result))
    if (!keys.includes(key))
      fail(`${path}.${key}`, 'unknown field; check the version 1 schema.')
  return result
}

function text(
  value: unknown,
  path: string,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') fail(path, 'expected a string.')
  if (!allowEmpty && !value.trim()) fail(path, 'must not be blank.')
  if (value.length > max) fail(path, `must contain at most ${max} characters.`)
  return value
}

function number(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    fail(
      path,
      `expected ${integer ? 'an integer' : 'a finite number'} from ${min} to ${max}.`,
    )
  }
  return value
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array.')
  if (value.length > max) fail(path, `must contain at most ${max} items.`)
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(value, i))
      fail(
        `${path}[${i}]`,
        'missing array item; sparse arrays are not allowed.',
      )
  }
  return value
}

export function timestamp(value: unknown, path: string): string {
  const result = text(value, path, 40)
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      result,
    )
  if (!match)
    fail(
      path,
      'expected an ISO 8601 date-time with seconds and a timezone, e.g. 2026-01-01T12:00:00.000Z.',
    )
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const zone = match[7]!
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]! ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    (zone !== 'Z' &&
      (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) ||
    !Number.isFinite(Date.parse(result))
  ) {
    fail(path, 'invalid calendar date, clock time, or timezone.')
  }
  return result
}

/** Validate rather than sanitize. In particular, never accept relative or credentialed URLs. */
export function validateAudioUrl(url: string): boolean {
  if (
    typeof url !== 'string' ||
    url.length === 0 ||
    url.length > 2048 ||
    url !== url.trim() ||
    /[\s\\]/u.test(url) ||
    !/^https?:\/\//i.test(url)
  )
    return false
  if (
    [...url].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return false
  try {
    const authority = /^https?:\/\/([^/?#]*)/i.exec(url)?.[1]
    if (!authority || authority.includes('@')) return false
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

/** Legacy English text is read-only compatibility input, never canonical output. */
function compatibleEnglish(
  obj: ObjectValue,
  legacy: string,
  current: string,
  max: number,
  path: string,
): string | undefined {
  const oldText = Object.hasOwn(obj, legacy)
    ? text(obj[legacy], `${path}.${legacy}`, max, true)
    : undefined
  const newText =
    obj[current] !== undefined
      ? text(obj[current], `${path}.${current}`, max, true)
      : undefined
  if (oldText !== undefined && newText !== undefined && oldText !== newText)
    fail(
      `${path}.${legacy}`,
      `conflicts with ${current}; reconcile both values and remove the legacy ${legacy} field to keep your text.`,
    )
  return newText ?? oldText
}

export function validateExpression(
  value: unknown,
  path = 'expression',
): Expression {
  const obj = object(value, path, [
    'id',
    'french',
    'english',
    'turkish',
    'pronunciationEn',
    'pronunciationTr',
    'situation',
    'situationEn',
    'situationTr',
    'category',
    'tags',
    'lesson',
    'createdAt',
    'updatedAt',
    'pronunciationNote',
    'pronunciationNoteEn',
    'pronunciationNoteTr',
    'audioUrl',
    'femaleAudioUrl',
    'maleAudioUrl',
  ])
  for (const field of ['situationEn', 'situationTr'] as const)
    if (Object.hasOwn(obj, field))
      text(obj[field], `${path}.${field}`, 4000, true)
  const situationEn =
    compatibleEnglish(obj, 'situation', 'situationEn', 4000, path) ?? ''
  const situationTr =
    obj.situationTr === undefined
      ? ''
      : text(obj.situationTr, `${path}.situationTr`, 4000, true)
  if (!situationEn.trim() && !situationTr.trim())
    fail(
      `${path}.situationEn`,
      'provide at least one nonblank situationEn or situationTr (legacy situation is also accepted); use an empty string for a missing translation.',
    )
  const result: Expression = {
    id: text(obj.id, `${path}.id`, 200),
    french: text(obj.french, `${path}.french`, 1000),
    english: text(obj.english, `${path}.english`, 1000),
    turkish: text(obj.turkish, `${path}.turkish`, 1000),
    pronunciationEn: text(obj.pronunciationEn, `${path}.pronunciationEn`, 1000),
    pronunciationTr: text(obj.pronunciationTr, `${path}.pronunciationTr`, 1000),
    situationEn,
    situationTr,
    category: text(obj.category, `${path}.category`, 100),
    tags: array(obj.tags, `${path}.tags`, 50).map((tag, i) =>
      text(tag, `${path}.tags[${i}]`, 80),
    ),
    lesson: number(obj.lesson, `${path}.lesson`, 1, 1_000_000, true),
    createdAt: timestamp(obj.createdAt, `${path}.createdAt`),
    updatedAt: timestamp(obj.updatedAt, `${path}.updatedAt`),
  }
  if (new Set(result.tags).size !== result.tags.length)
    fail(`${path}.tags`, 'tags must be unique.')
  if (Date.parse(result.updatedAt) < Date.parse(result.createdAt))
    fail(`${path}.updatedAt`, 'must not precede createdAt.')
  const noteEn = compatibleEnglish(
    obj,
    'pronunciationNote',
    'pronunciationNoteEn',
    8000,
    path,
  )
  if (noteEn !== undefined) result.pronunciationNoteEn = noteEn
  if (obj.pronunciationNoteTr !== undefined)
    result.pronunciationNoteTr = text(
      obj.pronunciationNoteTr,
      `${path}.pronunciationNoteTr`,
      8000,
      true,
    )
  for (const field of ['audioUrl', 'femaleAudioUrl', 'maleAudioUrl'] as const) {
    if (obj[field] === undefined) continue
    const url = text(obj[field], `${path}.${field}`, 2048)
    if (!validateAudioUrl(url))
      fail(
        `${path}.${field}`,
        'must be an absolute http:// or https:// URL without credentials, whitespace, or backslashes; omit it if unavailable.',
      )
    result[field] = url
  }
  return result
}

export function validateExpressions(
  value: unknown,
  path = 'expressions',
): Expression[] {
  const result = array(value, path, 10_000).map((item, i) =>
    validateExpression(item, `${path}[${i}]`),
  )
  const ids = new Set<string>()
  for (const expression of result) {
    if (ids.has(expression.id))
      fail(
        path,
        `duplicate expression id ${JSON.stringify(expression.id)}; IDs must be unique.`,
      )
    ids.add(expression.id)
  }
  return result
}

export function validatePreferences(
  value: unknown,
  path = 'preferences',
): Preferences {
  const obj = object(value, path, ['voiceURI', 'rate', 'dailyNewLimit'])
  return {
    voiceURI: text(obj.voiceURI, `${path}.voiceURI`, 2048, true),
    rate: number(obj.rate, `${path}.rate`, 0.1, 10),
    dailyNewLimit: number(
      obj.dailyNewLimit,
      `${path}.dailyNewLimit`,
      0,
      1000,
      true,
    ),
  }
}

function validateReview(
  value: unknown,
  path: string,
  ids: Set<string>,
): Review {
  const obj = object(value, path, [
    'expressionId',
    'mode',
    'dueAt',
    'intervalDays',
    'history',
  ])
  const expressionId = text(obj.expressionId, `${path}.expressionId`, 200)
  if (!ids.has(expressionId))
    fail(
      `${path}.expressionId`,
      `references missing expression ${JSON.stringify(expressionId)}.`,
    )
  if (!modes.includes(obj.mode as Mode))
    fail(`${path}.mode`, 'expected speaking, listening, or reading.')
  const dueAt = timestamp(obj.dueAt, `${path}.dueAt`)
  const intervalDays = number(
    obj.intervalDays,
    `${path}.intervalDays`,
    0,
    Number.MAX_VALUE,
  )
  let previousTime = -Infinity
  let expectedInterval: number | undefined
  const history = array(obj.history, `${path}.history`, 100_000).map(
    (item, i) => {
      const eventPath = `${path}.history[${i}]`
      const event = object(item, eventPath, ['at', 'rating'])
      const at = timestamp(event.at, `${eventPath}.at`)
      const time = Date.parse(at)
      if (time < previousTime)
        fail(`${eventPath}.at`, 'history must be chronological (oldest first).')
      previousTime = time
      if (!ratings.includes(event.rating as Rating))
        fail(`${eventPath}.rating`, 'expected again, hard, good, or easy.')
      const rating = event.rating as Rating
      expectedInterval = nextInterval(expectedInterval, rating)
      return { at, rating }
    },
  )
  if (history.length === 0) {
    if (intervalDays !== 0)
      fail(
        `${path}.intervalDays`,
        'an unintroduced review with empty history must have intervalDays 0.',
      )
  } else {
    if (intervalDays !== expectedInterval)
      fail(
        `${path}.intervalDays`,
        'does not match the interval calculated from the rating history.',
      )
    const expectedDue = new Date(previousTime + intervalDays * DAY_MS).getTime()
    if (!Number.isFinite(expectedDue) || Date.parse(dueAt) !== expectedDue)
      fail(
        `${path}.dueAt`,
        'must equal the last rating time plus intervalDays.',
      )
  }
  return { expressionId, mode: obj.mode as Mode, dueAt, intervalDays, history }
}

export function validateAppData(value: unknown, path = 'data'): AppData {
  const obj = object(value, path, [
    'expressions',
    'reviews',
    'preferences',
    'initialized',
    'sharedLibrary',
  ])
  if (obj.initialized !== true)
    fail(
      `${path}.initialized`,
      'must be true; restore must not trigger reseeding.',
    )
  const expressions = validateExpressions(
    obj.expressions,
    `${path}.expressions`,
  )
  const ids = new Set(expressions.map((expression) => expression.id))
  const reviews = array(obj.reviews, `${path}.reviews`, 30_000).map(
    (review, i) => validateReview(review, `${path}.reviews[${i}]`, ids),
  )
  const keys = new Set<string>()
  for (const review of reviews) {
    const key = JSON.stringify([review.expressionId, review.mode])
    if (keys.has(key))
      fail(
        `${path}.reviews`,
        `duplicate review for ${JSON.stringify(review.expressionId)} in ${review.mode}.`,
      )
    keys.add(key)
  }
  const result: AppData = {
    expressions,
    reviews,
    preferences: validatePreferences(obj.preferences, `${path}.preferences`),
    initialized: true,
  }
  if (obj.sharedLibrary !== undefined)
    result.sharedLibrary = validateSharedLibraryState(
      obj.sharedLibrary,
      `${path}.sharedLibrary`,
    )
  return result
}

function sharedFields(obj: ObjectValue, path: string) {
  return {
    libraryId: text(obj.libraryId, `${path}.libraryId`, 200),
    name: text(obj.name, `${path}.name`, 200),
    revision: number(
      obj.revision,
      `${path}.revision`,
      1,
      Number.MAX_SAFE_INTEGER,
      true,
    ),
    publishedAt: timestamp(obj.publishedAt, `${path}.publishedAt`),
    expressions: validateExpressions(obj.expressions, `${path}.expressions`),
  }
}

export function validateSharedLibrary(value: unknown): SharedLibrary {
  const path = 'sharedLibrary'
  const obj = object(value, path, [
    'kind',
    'version',
    'libraryId',
    'name',
    'revision',
    'publishedAt',
    'expressions',
  ])
  if (obj.kind !== 'petit-shared-library')
    fail(`${path}.kind`, 'expected "petit-shared-library".')
  if (obj.version !== 1)
    fail(`${path}.version`, 'unsupported schema version; expected 1.')
  return {
    kind: 'petit-shared-library',
    version: 1,
    ...sharedFields(obj, path),
  }
}

function validateSharedLibraryState(
  value: unknown,
  path: string,
): SharedLibraryState {
  const obj = object(value, path, [
    'libraryId',
    'name',
    'revision',
    'publishedAt',
    'expressions',
    'deletedIds',
  ])
  const fields = sharedFields(obj, path)
  const deletedIds = array(obj.deletedIds, `${path}.deletedIds`, 100_000).map(
    (id, i) => text(id, `${path}.deletedIds[${i}]`, 200),
  )
  if (new Set(deletedIds).size !== deletedIds.length)
    fail(`${path}.deletedIds`, 'IDs must be unique.')
  // Baseline and tombstones are historical publisher data, not local foreign keys.
  return { ...fields, deletedIds }
}

export function validateLesson(value: unknown): LessonImport {
  const obj = object(value, 'lesson', ['kind', 'version', 'expressions'])
  if (obj.kind !== 'petit-lesson')
    fail('lesson.kind', 'expected "petit-lesson".')
  if (obj.version !== 1)
    fail('lesson.version', 'unsupported schema version; expected 1.')
  return {
    kind: 'petit-lesson',
    version: 1,
    expressions: validateExpressions(obj.expressions, 'lesson.expressions'),
  }
}

export function validateBackup(value: unknown): Backup {
  const obj = object(value, 'backup', ['kind', 'version', 'exportedAt', 'data'])
  if (obj.kind !== 'petit-backup')
    fail('backup.kind', 'expected "petit-backup".')
  if (obj.version !== 1)
    fail('backup.version', 'unsupported schema version; expected 1.')
  return {
    kind: 'petit-backup',
    version: 1,
    exportedAt: timestamp(obj.exportedAt, 'backup.exportedAt'),
    data: validateAppData(obj.data),
  }
}

export function parseJson(textValue: string, kind: string): unknown {
  if (typeof textValue !== 'string') fail(kind, 'expected JSON text.')
  if (textValue.length > 20_000_000)
    fail(kind, 'JSON text exceeds the 20,000,000-character limit.')
  try {
    return JSON.parse(textValue) as unknown
  } catch (error) {
    fail(
      kind,
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
