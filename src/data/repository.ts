import { mergeLesson } from './imports'
import {
  assertMode,
  assertRating,
  checkedTime,
  introductions,
  newCountToday,
  scheduleReview,
} from './scheduler'
import { seedExpressions } from './seeds'
import { defaultPreferences } from './types'
import type { AppData, Repository } from './types'
import {
  validateAppData,
  validateBackup,
  validateExpression,
  validateLesson,
  validatePreferences,
} from './validation'

const DATABASE = 'petit-a-petit'
const STORE = 'state'
const KEY = 'app'

function initialData(): AppData {
  return validateAppData({
    expressions: seedExpressions,
    reviews: [],
    preferences: defaultPreferences,
    initialized: true,
  })
}

function repositoryFor(db: IDBDatabase): Repository {
  let closed = false
  const close = (): void => {
    closed = true
    db.close()
  }
  db.onversionchange = close

  // All readers/writers use the same store scope. No await occurs between get and put:
  // IndexedDB serializes these readwrite transactions even across tabs/connections.
  const transaction = (mutate?: (data: AppData) => AppData): Promise<AppData> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(
          new Error(
            'Repository is closed. Call openRepository() to reconnect.',
          ),
        )
        return
      }
      let tx: IDBTransaction
      try {
        tx = db.transaction(STORE, 'readwrite')
      } catch (error) {
        reject(error)
        return
      }
      let result: AppData
      let failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onabort = () =>
        reject(
          failure ??
            tx.error ??
            new Error('IndexedDB transaction was aborted.'),
        )
      tx.onerror = () => {
        failure ??= tx.error
      }
      const store = tx.objectStore(STORE)
      const request = store.get(KEY)
      request.onerror = () => {
        failure = request.error
      }
      request.onsuccess = () => {
        try {
          const missing = request.result === undefined
          const data = missing ? initialData() : validateAppData(request.result)
          result = mutate ? validateAppData(mutate(data)) : data
          const legacy =
            !missing &&
            (request.result as AppData).expressions.some(
              (expression) =>
                Object.hasOwn(expression, 'situation') ||
                Object.hasOwn(expression, 'pronunciationNote'),
            )
          if (missing || mutate || legacy) store.put(result, KEY)
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
    })

  return {
    load: () => transaction(),
    async saveExpression(expression) {
      const valid = validateExpression(expression)
      return transaction((data) => {
        const index = data.expressions.findIndex((item) => item.id === valid.id)
        if (index >= 0) data.expressions[index] = valid
        else data.expressions.push(valid)
        return data
      })
    },
    async deleteExpression(id) {
      if (typeof id !== 'string' || !id.trim() || id.length > 200)
        throw new Error(
          'id must be a non-empty string of at most 200 characters.',
        )
      return transaction((data) => {
        data.expressions = data.expressions.filter(
          (expression) => expression.id !== id,
        )
        data.reviews = data.reviews.filter(
          (review) => review.expressionId !== id,
        )
        return data
      })
    },
    async savePreferences(preferences) {
      const valid = validatePreferences(preferences)
      return transaction((data) => ({ ...data, preferences: valid }))
    },
    async rate(id, mode, rating, now = new Date()) {
      assertMode(mode)
      assertRating(rating)
      const at = new Date(checkedTime(now))
      return transaction((data) => {
        if (!data.expressions.some((expression) => expression.id === id))
          throw new Error(
            `Cannot rate missing expression ${JSON.stringify(id)}.`,
          )
        const first = introductions(data).get(id)
        if (first !== undefined && at.getTime() < first)
          throw new Error(
            'Rating time cannot precede the expression’s first introduction.',
          )
        if (
          first === undefined &&
          newCountToday(data, at) >= data.preferences.dailyNewLimit
        ) {
          throw new Error(
            `Daily new-expression limit (${data.preferences.dailyNewLimit}) reached. Review introduced expressions or increase the limit.`,
          )
        }
        const index = data.reviews.findIndex(
          (review) => review.expressionId === id && review.mode === mode,
        )
        const review = scheduleReview(
          index >= 0 ? data.reviews[index] : undefined,
          id,
          mode,
          rating,
          at,
        )
        if (index >= 0) data.reviews[index] = review
        else data.reviews.push(review)
        return data
      })
    },
    async applyLesson(lesson, policy, allowDuplicates) {
      const valid = validateLesson(lesson)
      if (policy !== 'skip' && policy !== 'update')
        throw new Error('Import policy must be skip or update.')
      if (typeof allowDuplicates !== 'boolean')
        throw new Error('allowDuplicates must be a boolean.')
      return transaction((data) =>
        mergeLesson(data, valid, policy, allowDuplicates),
      )
    },
    async restore(backup) {
      // Validate everything before opening a write transaction. Invalid restores cannot
      // partially replace state, preferences, or the initialized marker.
      const valid = validateBackup(backup)
      return transaction(() => valid.data)
    },
    close,
  }
}

export async function openRepository(): Promise<Repository> {
  if (typeof indexedDB === 'undefined')
    throw new Error(
      'IndexedDB is unavailable. Open Petit à Petit in a browser with local storage enabled.',
    )
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE)
    }
    request.onerror = () =>
      reject(request.error ?? new Error('Unable to open IndexedDB.'))
    request.onblocked = () => {
      blocked = true
      reject(
        new Error(
          'Database upgrade is blocked. Close other Petit à Petit tabs and retry.',
        ),
      )
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
  })
  const repository = repositoryFor(db)
  try {
    await repository.load()
    return repository
  } catch (error) {
    repository.close()
    throw error
  }
}
