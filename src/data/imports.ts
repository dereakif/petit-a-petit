import { normalize } from './types'
import type {
  AppData,
  Backup,
  Expression,
  LessonImport,
  LessonPreview,
} from './types'
import {
  parseJson,
  validateAppData,
  validateBackup,
  validateExpressions,
  validateLesson,
} from './validation'

export function parseLesson(text: string): LessonImport {
  return validateLesson(parseJson(text, 'lesson'))
}

export function parseBackup(text: string): Backup {
  return validateBackup(parseJson(text, 'backup'))
}

export function createBackup(data: AppData): Backup {
  return {
    kind: 'petit-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: validateAppData(data),
  }
}

export function createLesson(data: AppData): LessonImport {
  return {
    kind: 'petit-lesson',
    version: 1,
    expressions: validateAppData(data).expressions,
  }
}

/** Matching IDs are updates; a different ID with matching normalized French is a duplicate. */
export function previewLesson(
  lesson: LessonImport,
  expressions: Expression[],
): LessonPreview {
  const incoming = validateLesson(lesson).expressions
  const current = validateExpressions(expressions)
  const result: LessonPreview = { additions: [], updates: [], duplicates: [] }
  for (const expression of incoming) {
    const index = current.findIndex((existing) => existing.id === expression.id)
    if (index >= 0) {
      result.updates.push(expression)
      current[index] = expression
    } else {
      const duplicate = current.find(
        (existing) =>
          normalize(existing.french) === normalize(expression.french),
      )
      if (duplicate)
        result.duplicates.push({ incoming: expression, existing: duplicate })
      else {
        result.additions.push(expression)
        current.push(expression)
      }
    }
  }
  return result
}

/** The caller must validate lesson and options before entering its IDB transaction. */
export function mergeLesson(
  data: AppData,
  lesson: LessonImport,
  policy: 'skip' | 'update',
  allowDuplicates: boolean,
): AppData {
  for (const incoming of lesson.expressions) {
    const index = data.expressions.findIndex(
      (existing) => existing.id === incoming.id,
    )
    if (index >= 0 && policy === 'skip') continue
    if (
      !allowDuplicates &&
      data.expressions.some(
        (existing) =>
          existing.id !== incoming.id &&
          normalize(existing.french) === normalize(incoming.french),
      )
    )
      continue
    if (index >= 0) data.expressions[index] = incoming
    else data.expressions.push(incoming)
  }
  return data
}
