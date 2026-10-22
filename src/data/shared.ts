import { seedExpressions } from './seeds'
import { normalize } from './types'
import type {
  AppData,
  Expression,
  SharedLibrary,
  SharedLibraryChoice,
  SharedLibraryPreview,
  SharedLibraryState,
} from './types'
import {
  parseJson,
  validateAppData,
  validateExpressions,
  validateSharedLibrary,
} from './validation'

export const SHARED_LIBRARY_ID = 'akif-french'
export const SHARED_LIBRARY_NAME = 'Akif’s French library'

export function parseSharedLibrary(text: string): SharedLibrary {
  return validateSharedLibrary(parseJson(text, 'sharedLibrary'))
}

export function createSharedLibrary(
  data: AppData,
  revision: number,
  now = new Date(),
): SharedLibrary {
  return validateSharedLibrary({
    kind: 'petit-shared-library',
    version: 1,
    libraryId: SHARED_LIBRARY_ID,
    name: SHARED_LIBRARY_NAME,
    revision,
    publishedAt: now.toISOString(),
    expressions: validateAppData(data).expressions,
  })
}

// Validation constructs explicit field-ordered objects, including every optional field.
function equal(a: Expression, b: Expression): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sorted(expressions: Expression[]): Expression[] {
  return [...expressions].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

function publisherPayload(library: SharedLibrary | SharedLibraryState): string {
  return JSON.stringify({
    libraryId: library.libraryId,
    name: library.name,
    revision: library.revision,
    publishedAt: library.publishedAt,
    expressions: sorted(library.expressions),
  })
}

function previewToken(data: AppData): string {
  const state = data.sharedLibrary
  // An exact opaque snapshot avoids hash collisions and excludes learning activity.
  return JSON.stringify({
    expressions: sorted(data.expressions),
    sharedLibrary: state
      ? {
          payload: publisherPayload(state),
          deletedIds: [...state.deletedIds].sort(),
        }
      : null,
  })
}

export function previewSharedLibrary(
  library: SharedLibrary,
  data: AppData,
): SharedLibraryPreview {
  return previewValidated(validateSharedLibrary(library), validateAppData(data))
}

function previewValidated(
  library: SharedLibrary,
  data: AppData,
): SharedLibraryPreview {
  const state = data.sharedLibrary
  if (library.libraryId !== SHARED_LIBRARY_ID)
    throw new Error(
      `Unsupported shared library; expected ${SHARED_LIBRARY_ID}.`,
    )
  if (state && state.libraryId !== library.libraryId)
    throw new Error(
      'Shared library source does not match the subscribed library.',
    )
  if (state && library.revision < state.revision)
    throw new Error(
      'Shared library revision is older than the subscribed revision; refresh the feed.',
    )
  const isCurrent = state?.revision === library.revision
  if (isCurrent && publisherPayload(state!) !== publisherPayload(library))
    throw new Error(
      'Shared library payload changed at the same revision; the publisher must increment revision.',
    )

  const result: SharedLibraryPreview = {
    additions: [],
    updates: [],
    unchanged: [],
    conflicts: [],
    duplicates: [],
    deleted: [],
    removed: [],
    token: previewToken(data),
    isCurrent,
  }
  const localById = new Map(data.expressions.map((item) => [item.id, item]))
  const baseline = new Map(state?.expressions.map((item) => [item.id, item]))
  const seeds = new Map(
    validateExpressions(seedExpressions).map((item) => [item.id, item]),
  )
  const deleted = new Set(state?.deletedIds)
  // Include prospective additions to detect duplicate text inside the feed too.
  const byFrench = new Map<string, Expression>()
  for (const local of data.expressions)
    if (!byFrench.has(normalize(local.french)))
      byFrench.set(normalize(local.french), local)

  for (const incoming of library.expressions) {
    const local = localById.get(incoming.id)
    const previous = baseline.get(incoming.id)
    if (deleted.has(incoming.id)) {
      result.deleted.push(incoming)
    } else if (local) {
      if (equal(local, incoming) || (previous && equal(previous, incoming))) {
        result.unchanged.push(incoming)
      } else if (
        (previous && equal(local, previous)) ||
        (!state && seeds.has(local.id) && equal(local, seeds.get(local.id)!))
      ) {
        result.updates.push(incoming)
      } else {
        result.conflicts.push({ incoming, local })
      }
    } else {
      const duplicate = byFrench.get(normalize(incoming.french))
      if (duplicate) result.duplicates.push({ incoming, local: duplicate })
      else {
        result.additions.push(incoming)
        byFrench.set(normalize(incoming.french), incoming)
      }
    }
  }
  const incomingIds = new Set(library.expressions.map((item) => item.id))
  result.removed = (state?.expressions ?? []).filter(
    (item) => !incomingIds.has(item.id),
  )
  return result
}

/** Snapshot untrusted options before a transaction is opened (including caller mutation). */
export function validateSharedChoices(
  choices: Record<string, SharedLibraryChoice>,
): Record<string, SharedLibraryChoice> {
  if (!choices || typeof choices !== 'object' || Array.isArray(choices))
    throw new Error(
      'Shared library choices must be an object keyed by incoming expression ID.',
    )
  const entries = Object.entries(choices)
  for (const [id, choice] of entries) {
    if (
      !id.trim() ||
      id.length > 200 ||
      !['keep', 'shared', 'skip', 'add', 'restore'].includes(choice)
    )
      throw new Error(
        `Invalid shared library choice for ${JSON.stringify(id)}.`,
      )
  }
  return Object.fromEntries(entries)
}

function pair(a: string, b: string): string {
  return JSON.stringify([a, b].sort())
}

function validateFinalCollisions(
  expressions: Expression[],
  previous: Expression[],
  approved: Set<string>,
): void {
  const oldFrench = new Map(
    previous.map((item) => [item.id, normalize(item.french)]),
  )
  const groups = new Map<string, Map<string | undefined, string[]>>()
  for (const item of expressions) {
    const key = normalize(item.french)
    const originalFrench = oldFrench.get(item.id)
    const buckets = groups.get(key) ?? new Map<string | undefined, string[]>()
    // Existing duplicate groups need no pairwise expansion, even for large libraries.
    for (const [previousFrench, ids] of buckets) {
      if (originalFrench !== undefined && originalFrench === previousFrench)
        continue
      for (const id of ids)
        if (!approved.has(pair(id, item.id)))
          throw new Error(
            'Shared library choices would introduce a normalized French collision. Resolve the conflicting vocabulary locally and refresh the preview.',
          )
    }
    const ids = buckets.get(originalFrench) ?? []
    ids.push(item.id)
    buckets.set(originalFrench, ids)
    groups.set(key, buckets)
  }
}

/** Runs synchronously against the latest state in the repository's write transaction. */
export function mergeSharedLibrary(
  data: AppData,
  library: SharedLibrary,
  choices: Record<string, SharedLibraryChoice>,
  token: string,
): AppData {
  if (previewToken(data) !== token)
    throw new Error(
      'Shared library preview is stale. Reload your data and refresh the preview before applying.',
    )
  const preview = previewValidated(library, data)
  const allowed = new Map<string, SharedLibraryChoice[]>()
  for (const item of [
    ...preview.additions,
    ...preview.updates,
    ...preview.unchanged,
  ])
    allowed.set(item.id, [])
  for (const { incoming } of preview.conflicts)
    allowed.set(incoming.id, ['keep', 'shared'])
  for (const { incoming } of preview.duplicates)
    allowed.set(incoming.id, ['skip', 'add'])
  for (const item of preview.deleted) allowed.set(item.id, ['skip', 'restore'])
  for (const [id, choice] of Object.entries(choices)) {
    if (!allowed.get(id)?.includes(choice))
      throw new Error(
        `Choice ${JSON.stringify(choice)} is not valid for shared expression ${JSON.stringify(id)}; refresh the preview and resolve its category.`,
      )
  }
  for (const { incoming } of preview.conflicts)
    if (!Object.hasOwn(choices, incoming.id))
      throw new Error(
        `Resolve conflict ${JSON.stringify(incoming.id)} explicitly with keep or shared.`,
      )

  const replacements = new Map<string, Expression>()
  for (const item of [...preview.additions, ...preview.updates])
    replacements.set(item.id, item)
  for (const { incoming } of preview.conflicts)
    if (choices[incoming.id] === 'shared')
      replacements.set(incoming.id, incoming)
  const approvedCollisions = new Set<string>()
  for (const { incoming, local } of preview.duplicates) {
    if (choices[incoming.id] === 'add') {
      replacements.set(incoming.id, incoming)
      approvedCollisions.add(pair(incoming.id, local.id))
    }
  }
  for (const item of preview.deleted)
    if (choices[item.id] === 'restore') replacements.set(item.id, item)

  const expressions = data.expressions.map(
    (item) => replacements.get(item.id) ?? item,
  )
  const existingIds = new Set(data.expressions.map((item) => item.id))
  for (const item of replacements.values())
    if (!existingIds.has(item.id)) expressions.push(item)
  validateFinalCollisions(expressions, data.expressions, approvedCollisions)

  return {
    ...data,
    expressions,
    sharedLibrary: {
      libraryId: library.libraryId,
      name: library.name,
      revision: library.revision,
      publishedAt: library.publishedAt,
      expressions: library.expressions,
      deletedIds: (data.sharedLibrary?.deletedIds ?? []).filter(
        (id) => choices[id] !== 'restore',
      ),
    },
  }
}
