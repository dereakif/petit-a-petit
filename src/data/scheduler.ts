import type { AppData, Expression, Mode, Rating, Review } from './types'

export const DAY_MS = 86_400_000
export const modes: readonly Mode[] = ['speaking', 'listening', 'reading']
export const ratings: readonly Rating[] = ['again', 'hard', 'good', 'easy']

export function assertMode(mode: unknown): asserts mode is Mode {
  if (!modes.includes(mode as Mode))
    throw new Error('mode must be speaking, listening, or reading.')
}

export function assertRating(rating: unknown): asserts rating is Rating {
  if (!ratings.includes(rating as Rating))
    throw new Error('rating must be again, hard, good, or easy.')
}

export function checkedTime(now: Date): number {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error('now must be a valid Date.')
  return now.getTime()
}

export function nextInterval(
  previous: number | undefined,
  rating: Rating,
): number {
  switch (rating) {
    case 'again':
      return 1 / 1440
    case 'hard':
      return previous === undefined ? 1 : Math.max(1, previous * 1.2)
    case 'good':
      return previous === undefined ? 1 : Math.max(1, previous * 2)
    case 'easy':
      return previous === undefined ? 3 : Math.max(3, previous * 3)
  }
}

/** Earliest actual rating, not queue display or a per-mode introduction. */
export function introductions(data: AppData): Map<string, number> {
  const first = new Map<string, number>()
  for (const review of data.reviews) {
    for (const event of review.history) {
      const at = Date.parse(event.at)
      if (at < (first.get(review.expressionId) ?? Infinity))
        first.set(review.expressionId, at)
    }
  }
  return first
}

export function newCountToday(data: AppData, now = new Date()): number {
  checkedTime(now)
  const start = new Date(now.getTime())
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 1)
  return [...introductions(data).values()].filter(
    (at) => at >= start.getTime() && at < end.getTime(),
  ).length
}

export function buildQueue(
  data: AppData,
  mode: Mode,
  now = new Date(),
  extra = false,
): Expression[] {
  assertMode(mode)
  const time = checkedTime(now)
  const reviews = new Map(
    data.reviews
      .filter((review) => review.mode === mode)
      .map((review) => [review.expressionId, review]),
  )
  const introduced = introductions(data)
  const due: Expression[] = []
  const fresh: Expression[] = []
  let remaining = Math.max(
    0,
    data.preferences.dailyNewLimit - newCountToday(data, now),
  )
  const ordered = [...data.expressions].sort(
    (a, b) =>
      a.lesson - b.lesson ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
  for (const expression of ordered) {
    const review = reviews.get(expression.id)
    if (review && review.history.length > 0) {
      if (extra || Date.parse(review.dueAt) <= time) due.push(expression)
    } else if (extra || introduced.has(expression.id)) {
      fresh.push(expression)
    } else if (remaining > 0) {
      fresh.push(expression)
      remaining -= 1
    }
  }
  due.sort(
    (a, b) =>
      Date.parse(reviews.get(a.id)!.dueAt) -
      Date.parse(reviews.get(b.id)!.dueAt),
  )
  return [...due, ...fresh]
}

export function scheduleReview(
  previous: Review | undefined,
  id: string,
  mode: Mode,
  rating: Rating,
  now = new Date(),
): Review {
  assertMode(mode)
  assertRating(rating)
  const time = checkedTime(now)
  if (typeof id !== 'string' || !id.trim() || id.length > 200)
    throw new Error(
      'expressionId must be a non-empty string of at most 200 characters.',
    )
  if (previous && (previous.expressionId !== id || previous.mode !== mode))
    throw new Error('Previous review must have the same expressionId and mode.')
  const history = previous?.history ?? []
  if (history.length > 0 && time < Date.parse(history[history.length - 1]!.at))
    throw new Error('Rating time cannot be earlier than the previous rating.')
  const intervalDays = nextInterval(
    history.length ? previous!.intervalDays : undefined,
    rating,
  )
  const due = new Date(time + intervalDays * DAY_MS)
  if (
    !Number.isFinite(intervalDays) ||
    !Number.isFinite(due.getTime()) ||
    due.getUTCFullYear() < 0 ||
    due.getUTCFullYear() > 9999 ||
    now.getUTCFullYear() < 0 ||
    now.getUTCFullYear() > 9999
  )
    throw new Error('Review interval exceeds the supported date range.')
  return {
    expressionId: id,
    mode,
    dueAt: due.toISOString(),
    intervalDays,
    history: [
      ...history.map((event) => ({ ...event })),
      { at: now.toISOString(), rating },
    ],
  }
}
